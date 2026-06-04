'use server';

import { createServerClient } from '@/lib/supabase';
import * as engine from '@/lib/game/engine';
import type { GameState } from '@/types/game';

export async function joinSeat(
  gameId: string,
  seat: number,
  displayName: string,
  startingStackCents: number
) {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Sign in required. Refresh the page and try again.');
  }

  const { data: gameRow, error: fetchError } = await supabase
    .from('games')
    .select('game_state, host_id')
    .eq('id', gameId)
    .single();

  if (fetchError || !gameRow?.game_state) {
    throw new Error('Game not found');
  }

  let game = gameRow.game_state as GameState;
  const isFirstToSit = game.players.length === 0;

  const existing = game.players.find((p) => p.user_id === user.id);
  if (existing) {
    if (existing.seat === seat) {
      const updatedPlayers = game.players.map((p) =>
        p.user_id === user.id ? { ...p, display_name: displayName.trim() || p.display_name } : p
      );
      game = {
        ...game,
        players: updatedPlayers,
        updated_at: engine.now(),
      };
    } else {
      throw new Error(`You are already in seat ${existing.seat}`);
    }
  } else {
    if (game.players.some((p) => p.seat === seat)) {
      throw new Error('Seat already taken');
    }
    if (startingStackCents < 0) {
      throw new Error('Starting stack cannot be negative');
    }
    try {
      game = engine.joinSeat(
        game,
        user.id,
        seat,
        displayName.trim() || 'Player',
        startingStackCents
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Cannot join seat';
      throw new Error(message);
    }

    if (isFirstToSit) {
      game = {
        ...game,
        host_id: user.id,
        last_action: `${displayName.trim() || 'Player'} is host (seat ${seat})`,
      };
    }
  }

  const updatePayload: { game_state: GameState; host_id?: string } = {
    game_state: game,
  };
  if (isFirstToSit) {
    updatePayload.host_id = user.id;
  }

  const { error: updateError } = await supabase
    .from('games')
    .update(updatePayload)
    .eq('id', gameId);

  if (updateError) {
    throw updateError;
  }

  return game;
}