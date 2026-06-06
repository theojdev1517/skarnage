import { NextRequest, NextResponse } from 'next/server';
import type { GameState } from '@/types/game';
import * as engine from '@/lib/game/engine';
import { createServerClient } from '@/lib/supabase';
import { sanitizeGameStateForUser } from '@/lib/game/clientView';
import { GameApiError, GameErrorCode, gameErrorResponse } from '@/lib/game/apiErrors';
import { mapThrownError } from '@/lib/game/safeErrors';
import {
  assertActorOnTurn,
  assertPhaseAllows,
  parseBetAction,
} from '@/lib/game/actionGuards';
import { applyJoinRequest } from '@/lib/game/joinGame';
import {
  approveJoin,
  denyJoin,
  assertCanStartHand,
  playerRebuy,
  requestSetAway,
  requestStandUp,
  hostForceAway,
  hostRemovePlayer,
  applyRebuyTimeouts,
  requestAddChips,
  approveAddChips,
  denyAddChips,
  requestRebuy,
  approveRebuy,
  denyRebuy,
  directJoin,
  applyPendingChipAdds,
} from '@/lib/game/seatManagement';
import { saveGameState } from '@/lib/game/persistGame';
import {
  parseCents,
  parseDisplayName,
  parseGameState,
  parseSeat,
} from '@/lib/game/validateState';

type LoadedGame = { game: GameState; version: string };

async function loadGame(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  gameId: string
): Promise<LoadedGame | NextResponse> {
  const { data: gameRow, error: fetchError } = await supabase
    .from('games')
    .select('game_state')
    .eq('id', gameId)
    .single();

  if (fetchError || !gameRow?.game_state) {
    return gameErrorResponse(GameErrorCode.GAME_NOT_FOUND, 'Game not found.', 404);
  }

  try {
    const game = parseGameState(gameRow.game_state, gameId);
    return { game, version: game.updated_at };
  } catch (error) {
    return mapThrownError(error);
  }
}

function requireHost(game: GameState, userId: string): void {
  if (userId !== game.host_id) {
    throw new GameApiError(GameErrorCode.HOST_ONLY, 'Host only.', 403);
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const loaded = await loadGame(supabase, gameId);
    if (loaded instanceof NextResponse) return loaded;

    return NextResponse.json({
      game: sanitizeGameStateForUser(loaded.game, user?.id ?? null),
    });
  } catch (error) {
    console.error('API GET Error:', error);
    return mapThrownError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const body = await request.json();
    const { action } = body;

    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return gameErrorResponse(
        GameErrorCode.SIGN_IN_REQUIRED,
        'Sign in required.',
        401
      );
    }

    const loaded = await loadGame(supabase, gameId);
    if (loaded instanceof NextResponse) return loaded;

    const { game: loadedGame, version } = loaded;
    // Apply any expired rebuy timeouts (sets broke non-rebuyers to away after 10s window)
    const game = applyRebuyTimeouts(loadedGame);
    let result: GameState;
    let hostIdUpdate: string | undefined;

    switch (action) {
      case 'startHand': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'startHand');
        assertCanStartHand(game);
        result = engine.startNewHand(game);
        break;
      }

      case 'bet': {
        assertPhaseAllows(game, 'bet');
        const betAction = parseBetAction(body.betAction);
        const seat = parseSeat(body.seat);
        const amount = parseCents(body.amount ?? 0, 'Bet amount');

        assertActorOnTurn(game, seat, user.id);

        const confirmFreeFold = body.confirmFreeFold === true;
        if (confirmFreeFold && betAction !== 'fold') {
          throw new GameApiError(
            GameErrorCode.INVALID_REQUEST,
            'confirmFreeFold is only valid with fold.',
            400
          );
        }
        result = engine.processBet(game, seat, betAction, amount, {
          confirmFreeFold,
        });
        break;
      }

      case 'advance': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'advance');
        result = engine.advanceToNextPhase(game);
        break;
      }

      case 'requestJoin': {
        const seat = parseSeat(body.seat);
        const displayName = parseDisplayName(body.displayName);
        const startingStackCents = parseCents(
          body.startingStackCents,
          'Starting stack'
        );
        if (startingStackCents <= 0) {
          throw new GameApiError(
            GameErrorCode.INVALID_REQUEST,
            'Starting stack must be greater than zero.',
            400
          );
        }
        assertPhaseAllows(game, 'requestJoin');
        result = applyJoinRequest(
          game,
          user.id,
          seat,
          displayName,
          startingStackCents
        );
        break;
      }

      case 'join': {
        // Direct/auto join (no host approval). Stack validated inside directJoin per pre-start vs post-start rules.
        const seat = parseSeat(body.seat);
        const displayName = parseDisplayName(body.displayName);
        const startingStackCents = parseCents(
          body.startingStackCents,
          'Starting stack'
        );
        assertPhaseAllows(game, 'requestJoin'); // reuse same phase allowance (joins always ok)
        const joined = directJoin(
          game,
          user.id,
          seat,
          displayName,
          startingStackCents
        );
        result = joined.game;
        hostIdUpdate = joined.hostId;
        break;
      }

      case 'addChips': {
        // Queue via pending (for mid-hand deferral). If currently between hands (finished), apply immediately.
        // Mid-hand: will be applied post-awardPot (before rebuy decisions).
        // Bounded at apply time. No host approval.
        const amountCents = parseCents(body.amountCents, 'Add chips amount');
        result = requestAddChips(game, user.id, amountCents);
        if (game.status === 'finished') {
          result = applyPendingChipAdds(result);
        }
        // Set "back" immediately (for +add chips while away or at 0).
        result = {
          ...result,
          players: result.players.map((p) =>
            p.user_id === user.id ? { ...p, presence: 'active' as const, seat_intent: 'none' as const } : p
          ),
        };
        break;
      }

      case 'approveJoin': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'approveJoin');
        if (typeof body.requestId !== 'string') {
          throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'requestId required.', 400);
        }
        const approved = approveJoin(game, user.id, body.requestId);
        result = approved.game;
        hostIdUpdate = approved.hostId;
        break;
      }

      case 'denyJoin': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'denyJoin');
        if (typeof body.requestId !== 'string') {
          throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'requestId required.', 400);
        }
        result = denyJoin(game, user.id, body.requestId);
        break;
      }

      case 'setAway': {
        assertPhaseAllows(game, 'setAway');
        result = requestSetAway(game, user.id);
        break;
      }

      case 'standUp': {
        assertPhaseAllows(game, 'standUp');
        result = requestStandUp(game, user.id);
        break;
      }

      case 'rebuy': {
        assertPhaseAllows(game, 'rebuy');
        const stackCents = parseCents(body.startingStackCents, 'Rebuy stack');
        result = playerRebuy(game, user.id, stackCents);
        break;
      }

      case 'requestAddChips': {
        assertPhaseAllows(game, 'requestAddChips');
        const amountCents = parseCents(body.amountCents, 'Add chips amount');
        result = requestAddChips(game, user.id, amountCents);
        break;
      }

      case 'approveAddChips': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'approveAddChips');
        if (typeof body.requestId !== 'string') {
          throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'requestId required.', 400);
        }
        result = approveAddChips(game, user.id, body.requestId);
        break;
      }

      case 'denyAddChips': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'denyAddChips');
        if (typeof body.requestId !== 'string') {
          throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'requestId required.', 400);
        }
        result = denyAddChips(game, user.id, body.requestId);
        break;
      }

      case 'requestRebuy': {
        assertPhaseAllows(game, 'requestRebuy');
        const stackCents = parseCents(body.startingStackCents, 'Rebuy stack');
        result = requestRebuy(game, user.id, stackCents);
        break;
      }

      case 'approveRebuy': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'approveRebuy');
        if (typeof body.requestId !== 'string') {
          throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'requestId required.', 400);
        }
        result = approveRebuy(game, user.id, body.requestId);
        break;
      }

      case 'denyRebuy': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'denyRebuy');
        if (typeof body.requestId !== 'string') {
          throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'requestId required.', 400);
        }
        result = denyRebuy(game, user.id, body.requestId);
        break;
      }

      case 'turnTimeout': {
        assertPhaseAllows(game, 'turnTimeout');
        const seat = parseSeat(body.seat);
        assertActorOnTurn(game, seat, user.id);
        result = engine.applyTurnTimeout(game, seat);
        break;
      }

      case 'hostAddStack': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'hostAddStack');
        const seat = parseSeat(body.seat);
        const amountCents = parseCents(body.amountCents, 'Amount');
        result = engine.hostAddToStack(game, seat, amountCents);
        break;
      }

      case 'hostRemoveStack': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'hostRemoveStack');
        const seat = parseSeat(body.seat);
        const amountCents = parseCents(body.amountCents, 'Amount');
        result = engine.hostRemoveFromStack(game, seat, amountCents);
        break;
      }

      case 'hostSetStack': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'hostSetStack');
        const seat = parseSeat(body.seat);
        const stackCents = parseCents(body.stackCents, 'Stack');
        result = engine.hostSetStack(game, seat, stackCents);
        break;
      }

      case 'hostTransfer': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'hostTransfer');
        const seat = parseSeat(body.seat);
        result = engine.transferHost(game, seat);
        hostIdUpdate = result.host_id;
        break;
      }

      case 'hostForceAway': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'hostForceAway');
        const seat = parseSeat(body.seat);
        result = hostForceAway(game, user.id, seat);
        break;
      }

      case 'hostRemovePlayer': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'hostRemovePlayer');
        const seat = parseSeat(body.seat);
        result = hostRemovePlayer(game, user.id, seat);
        break;
      }

      default:
        throw new GameApiError(
          GameErrorCode.INVALID_REQUEST,
          `Unknown action: ${String(action)}`,
          400
        );
    }

    await saveGameState(supabase, gameId, version, result, {
      ...(hostIdUpdate ? { host_id: hostIdUpdate } : {}),
    });

    return NextResponse.json({
      success: true,
      game: sanitizeGameStateForUser(result, user.id),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return gameErrorResponse(
        GameErrorCode.INVALID_REQUEST,
        'Invalid request body.',
        400
      );
    }
    console.error('API POST Error:', error);
    return mapThrownError(error);
  }
}