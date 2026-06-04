import { NextRequest, NextResponse } from 'next/server';
import type { GameState } from '@/types/game';
import * as engine from '@/lib/game/engine';
import { createServerClient } from '@/lib/supabase';
import { sanitizeGameStateForUser } from '@/lib/game/clientView';

async function loadGame(supabase: Awaited<ReturnType<typeof createServerClient>>, gameId: string) {
  const { data: gameRow, error: fetchError } = await supabase
    .from('games')
    .select('game_state')
    .eq('id', gameId)
    .single();

  if (fetchError || !gameRow?.game_state) {
    return { error: NextResponse.json({ error: 'Game not found' }, { status: 404 }) };
  }

  return { game: gameRow.game_state as GameState };
}

function requireHost(game: GameState, userId: string) {
  if (userId !== game.host_id) {
    return NextResponse.json({ error: 'Host only' }, { status: 403 });
  }
  return null;
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
    if ('error' in loaded) return loaded.error;

    return NextResponse.json({
      game: sanitizeGameStateForUser(loaded.game, user?.id ?? null),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('API GET Error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const body = await request.json();
    const { action, seat, betAction, amount = 0 } = body;

    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const loaded = await loadGame(supabase, gameId);
    if ('error' in loaded) return loaded.error;

    let game = loaded.game;
    let result: GameState;

    switch (action) {
      case 'startHand': {
        const denied = requireHost(game, user.id);
        if (denied) return denied;
        result = engine.startNewHand(game);
        break;
      }

      case 'bet': {
        if (!betAction) {
          return NextResponse.json({ error: 'betAction required' }, { status: 400 });
        }
        const actor = game.players.find((p) => p.seat === seat);
        if (!actor || actor.user_id !== user.id) {
          return NextResponse.json({ error: 'Not your turn or seat' }, { status: 403 });
        }
        if (game.current_player_seat !== seat) {
          return NextResponse.json({ error: 'Not your turn' }, { status: 403 });
        }
        result = engine.processBet(game, seat, betAction, amount);
        break;
      }

      case 'advance': {
        const denied = requireHost(game, user.id);
        if (denied) return denied;
        result = engine.advanceToNextPhase(game);
        break;
      }

      case 'hostAddStack': {
        const denied = requireHost(game, user.id);
        if (denied) return denied;
        if (typeof seat !== 'number' || typeof body.amountCents !== 'number') {
          return NextResponse.json({ error: 'seat and amountCents required' }, { status: 400 });
        }
        result = engine.hostAddToStack(game, seat, body.amountCents);
        break;
      }

      case 'hostRemoveStack': {
        const denied = requireHost(game, user.id);
        if (denied) return denied;
        if (typeof seat !== 'number' || typeof body.amountCents !== 'number') {
          return NextResponse.json({ error: 'seat and amountCents required' }, { status: 400 });
        }
        result = engine.hostRemoveFromStack(game, seat, body.amountCents);
        break;
      }

      case 'hostSetStack': {
        const denied = requireHost(game, user.id);
        if (denied) return denied;
        if (typeof seat !== 'number' || typeof body.stackCents !== 'number') {
          return NextResponse.json({ error: 'seat and stackCents required' }, { status: 400 });
        }
        result = engine.hostSetStack(game, seat, body.stackCents);
        break;
      }

      case 'hostTransfer': {
        const denied = requireHost(game, user.id);
        if (denied) return denied;
        if (typeof seat !== 'number') {
          return NextResponse.json({ error: 'seat required' }, { status: 400 });
        }
        result = engine.transferHost(game, seat);
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const rowUpdate: { game_state: GameState; host_id?: string } = {
      game_state: result,
    };
    if (action === 'hostTransfer') {
      rowUpdate.host_id = result.host_id;
    }

    const { error: updateError } = await supabase
      .from('games')
      .update(rowUpdate)
      .eq('id', gameId);

    if (updateError) {
      console.error('DB update error:', updateError);
      return NextResponse.json({ error: 'Failed to save game state' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      game: sanitizeGameStateForUser(result, user.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('API Action Error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}