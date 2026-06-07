import { NextRequest, NextResponse } from 'next/server';
import type { GameState } from '@/types/game';
import * as engine from '@/lib/game/engine';
import { logLedgerEvent } from '@/lib/game/ledger';
import { GAME_CONFIG } from '@/lib/game/config';
import { createServerClient } from '@/lib/supabase';
import { sanitizeGameStateForUser } from '@/lib/game/clientView';
import { GameApiError, GameErrorCode, gameErrorResponse } from '@/lib/game/apiErrors';
import { mapThrownError } from '@/lib/game/safeErrors';
import {
  assertActorOnTurn,
  assertPhaseAllows,
  parseBetAction,
} from '@/lib/game/actionGuards';
import { isRebuyWindowOpen } from '@/lib/game/playerLifecycle';
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
import { liveShowdownPlayers, resolveShowdown } from '@/lib/game/showdown';
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

    // Enforce timers and auto-advance on read (so passive clients / realtime refetches
    // catch up expired showdown timers, rebuy windows, and auto-start next hand without
    // requiring an explicit client mutation/POST).
    let game = applyRebuyTimeouts(loaded.game);

    let awardedHandNumber: number | null = null;
    const preAwardStatus = game.status;
    game = engine.applyShowdownTimeout(game, supabase);
    if (preAwardStatus !== 'finished' && game.status === 'finished') {
      awardedHandNumber = game.hand_number;
    }

    let advancedHandNumber: number | null = null;
    if (
      game.status === 'finished' &&
      !isRebuyWindowOpen(game) &&
      (game.pending_rebuys || []).length === 0
    ) {
      const oldHand = game.hand_number || 0;
      game = await engine.startNewHand(game, supabase);
      const newHand = game.hand_number || 0;
      if (newHand > oldHand) {
        advancedHandNumber = newHand;
      }
    }

    // If we advanced the state (timers fired or hand auto-started), attempt to persist.
    // Use original version for optimistic lock. On conflict, ignore — caller gets
    // advanced view and next fetch/realtime will converge.
    if (game.updated_at !== loaded.game.updated_at) {
      try {
        await saveGameState(supabase, gameId, loaded.version, game, {});
        // Log hand_start + deal_hole *only* for the request that successfully persisted
        // the hand advance. This stops duplicate hand_start blocks and phantom "Your hand"
        // (spurious deal_hole from temp shuffles in raced startNewHand calls from GET+POST).
        if (advancedHandNumber != null) {
          const seated = game.players
            .filter((p) => p.presence === 'active' && p.stack > 0)
            .map((p) => ({ seat: p.seat, display_name: p.display_name, stack_cents: p.stack }));
          await logLedgerEvent(supabase, gameId, advancedHandNumber, 'hand_start', {
            game_type: GAME_CONFIG.GAME_TYPE,
            small_blind_cents: game.blinds.small,
            big_blind_cents: game.blinds.big,
            button_seat: game.button_seat,
            small_blind_seat: game.last_blinds?.small_seat ?? null,
            big_blind_seat: game.last_blinds?.big_seat ?? null,
            seats: seated,
          });
          for (const p of game.players) {
            if (p.hole_cards && p.hole_cards.length > 0) {
              await logLedgerEvent(supabase, gameId, advancedHandNumber, 'deal_hole', {
                player: p.display_name,
                hole_cards: p.hole_cards,
                user_id: p.user_id,
              }, p.user_id);
            }
          }
        }
        // Similarly, only the "winning" request for an award logs the (one) showdown + hand_end.
        // Prevents the 3x "End Hand" + repeated SHOWDOWN blocks from concurrent timeout applies.
        if (awardedHandNumber != null) {
          // Only log hand_end here (showdown shows logged at enter time for timing consistency).
          await logLedgerEvent(supabase, gameId, awardedHandNumber, 'hand_end', {});
        }
      } catch (e) {
        // Stale concurrent update or other; safe to ignore for this response. No ledger log on lost race.
      }
    }

    return NextResponse.json({
      game: sanitizeGameStateForUser(game, user?.id ?? null),
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
    let game = applyRebuyTimeouts(loadedGame);
    // Apply invisible showdown timer: if past, perform awardPot now (pots, finished state, rebuy window)
    let result: GameState;
    let hostIdUpdate: string | undefined;
    // Track when *this* request advanced the hand (via explicit startHand or post-finish auto).
    // We only emit the hand_start + deal_hole ledger events after the save succeeds.
    // Combined with the same guard in GET, this ensures exactly one set of hand_start/deal_hole
    // per hand even under concurrent GET catch-up + POST races (prevents dup "Start Hand" blocks
    // and phantom "Your hand" cards from temporary shuffles in extra startNewHand calls).
    let advancedHandNumber: number | null = null;
    // Track when *this* request performed the award (via early applyShowdownTimeout on expired timer).
    // Log hand_end early (before switch for action metas) to have End before post-hand metas.
    // 'showdown' (shows) is logged at enter time for correct timing in both all-in-pre and regular.
    let awardedHandNumber: number | null = null;

    const preAwardStatus = game.status;
    game = engine.applyShowdownTimeout(game, supabase);
    if (preAwardStatus !== 'finished' && game.status === 'finished') {
      awardedHandNumber = game.hand_number;
      await logLedgerEvent(supabase, gameId, awardedHandNumber, 'hand_end', {});
    }

    switch (action) {
      case 'startHand': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'startHand');
        assertCanStartHand(game);
        result = await engine.startNewHand(game, supabase);
        advancedHandNumber = result.hand_number || 0;
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
        // Log the action BEFORE processBet (which may auto-advance streets on all-ins).
        // This ensures the action event gets an earlier seq than any consequent street/shred logs,
        // so in reconstruction the triggering action appears before the streets (e.g. all-in calls don't
        // appear after river).
        const preActing = game.players.find((p) => p.seat === seat);
        const preToCall = Math.max(0, (game.current_wager ?? 0) - (preActing?.bet_this_street ?? 0));
        let addedCents = 0;
        if (betAction === 'call') {
          addedCents = Math.min(preToCall, preActing?.stack ?? 0);
        } else if (betAction === 'bet' || betAction === 'raise') {
          const preBet = preActing?.bet_this_street ?? 0;
          addedCents = Math.min(amount - preBet, preActing?.stack ?? 0);
        }
        let preAllIn = addedCents >= (preActing?.stack ?? 0) && addedCents > 0;
        await logLedgerEvent(supabase, gameId, game.hand_number, 'action', {
          seat,
          player: preActing?.display_name,
          action: betAction,
          amount_cents: amount,
          added_cents: addedCents,
          to_cents: (betAction === 'raise' || betAction === 'bet') ? amount : undefined,
          all_in: preAllIn,
        }, user.id);

        result = await engine.processBet(game, seat, betAction, amount, {
          confirmFreeFold,
        }, supabase);
        break;
      }

      case 'advance': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'advance');
        result = await engine.advanceToNextPhase(game, supabase);
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
          startingStackCents,
          supabase
        );
        result = joined.game;
        hostIdUpdate = joined.hostId;
        // Seat meta is logged inside directJoin (for hand 0 when pre-start, or current hand otherwise).
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
        logLedgerEvent(supabase, gameId, game.hand_number, 'meta', {
          type: 'set_away',
        }, user.id);
        break;
      }

      case 'standUp': {
        assertPhaseAllows(game, 'standUp');
        result = requestStandUp(game, user.id);
        logLedgerEvent(supabase, gameId, game.hand_number, 'meta', {
          type: 'stand_up',
        }, user.id);
        break;
      }

      case 'rebuy': {
        assertPhaseAllows(game, 'rebuy');
        const stackCents = parseCents(body.startingStackCents, 'Rebuy stack');
        result = playerRebuy(game, user.id, stackCents);
        const rebuyer = result.players.find((p: any) => p.user_id === user.id);
        logLedgerEvent(supabase, gameId, game.hand_number, 'meta', {
          type: 'rebuy',
          display_name: rebuyer?.display_name,
          stack_cents: stackCents,
        }, user.id);
        break;
      }

      case 'requestAddChips': {
        assertPhaseAllows(game, 'requestAddChips');
        const amountCents = parseCents(body.amountCents, 'Add chips amount');
        result = requestAddChips(game, user.id, amountCents);
        logLedgerEvent(supabase, gameId, game.hand_number, 'meta', {
          type: 'add_chips',
          amount_cents: amountCents,
        }, user.id);
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
        const reqRebuyer = result.players.find((p: any) => p.user_id === user.id) || game.players.find((p: any) => p.user_id === user.id);
        logLedgerEvent(supabase, gameId, game.hand_number, 'meta', {
          type: 'request_rebuy',
          display_name: reqRebuyer?.display_name,
          stack_cents: stackCents,
        }, user.id);
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
        result = await engine.applyTurnTimeout(game, seat, supabase);
        break;
      }

      case 'hostAddStack': {
        requireHost(game, user.id);
        assertPhaseAllows(game, 'hostAddStack');
        const seat = parseSeat(body.seat);
        const amountCents = parseCents(body.amountCents, 'Amount');
        result = engine.hostAddToStack(game, seat, amountCents);
        logLedgerEvent(supabase, gameId, game.hand_number, 'meta', {
          type: 'host_add_stack',
          seat,
          amount_cents: amountCents,
        }, user.id);
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

    // Auto-advance to next hand (removes manual "New Hand" button for ongoing games).
    // Triggers once: pots awarded (status 'finished' after awardPot), rebuys processed
    // (window closed + no pending_rebuys after applyRebuyTimeouts + approvals/denies at top),
    // and any showdown timer has fired (via applyShowdownTimeout above).
    // The initial unstarted game (status 'waiting') still requires the host's manual
    // "Start Game" button + 'startHand' action (one-time).
    if (
      result.status === 'finished' &&
      !isRebuyWindowOpen(result) &&
      (result.pending_rebuys || []).length === 0
    ) {
      const oldHand = result.hand_number || 0;
      result = await engine.startNewHand(result, supabase);
      const newHand = result.hand_number || 0;
      if (newHand > oldHand) {
        advancedHandNumber = newHand;
      }
    }

    await saveGameState(supabase, gameId, version, result, {
      ...(hostIdUpdate ? { host_id: hostIdUpdate } : {}),
    });

    // Emit hand_start + per-player deal_hole (for private "Your hand") *after* the save
    // succeeded for this POST. (The GET path only logs inside its successful CAS save.)
    if (advancedHandNumber != null) {
      const seated = result.players
        .filter((p) => p.presence === 'active' && p.stack > 0)
        .map((p) => ({ seat: p.seat, display_name: p.display_name, stack_cents: p.stack }));
      await logLedgerEvent(supabase, gameId, advancedHandNumber, 'hand_start', {
        game_type: GAME_CONFIG.GAME_TYPE,
        small_blind_cents: result.blinds.small,
        big_blind_cents: result.blinds.big,
        button_seat: result.button_seat,
        small_blind_seat: result.last_blinds?.small_seat ?? null,
        big_blind_seat: result.last_blinds?.big_seat ?? null,
        seats: seated,
      });
      for (const p of result.players) {
        if (p.hole_cards && p.hole_cards.length > 0) {
          await logLedgerEvent(supabase, gameId, advancedHandNumber, 'deal_hole', {
            player: p.display_name,
            hole_cards: p.hole_cards,
            user_id: p.user_id,
          }, p.user_id);
        }
      }
    }

    // Note: hand_end was logged early (right after applyShowdownTimeout set the flag) so that
    // it precedes any metas from the action switch (e.g. rebuys after award). Showdown shows
    // are logged at enterShowdownWithTimer time.

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