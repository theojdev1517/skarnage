//actions.ts

'use server';

import { createServerClient } from '@/lib/supabase';
import * as engine from '@/lib/game/engine';
import type { GameState } from '@/types/game';

export async function createGame(hostId: string, hostName: string, gameId: string) {
  console.log('Creating game with ID:', gameId);

  const supabase = await createServerClient();

  const initialState = engine.createNewGame(hostId, hostName);

  const { data, error } = await supabase
    .from('games')
    .insert({
      id: gameId,
      game_state: initialState,
      host_id: hostId,
      status: 'waiting',
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insert error:', error);
    throw error;
  }

  console.log('Game created successfully:', data);
  return initialState;
}

export async function joinSeat(gameId: string, seat: number, displayName: string) {
  console.log('Join attempt:', { gameId, seat, displayName });

  const supabase = await createServerClient();

  const { data: gameRow, error: fetchError } = await supabase
    .from('games')
    .select('game_state')
    .eq('id', gameId)
    .single();

  if (fetchError || !gameRow?.game_state) {
    console.error('Fetch error:', fetchError);
    throw new Error('Game not found');
  }

  let game = gameRow.game_state as GameState;

  try {
    game = engine.joinSeat(game, 'temp-user', seat, displayName);
  } catch (e: any) {
    console.error('Engine join error:', e);
    throw new Error(e.message || 'Cannot join seat');
  }

  const { error: updateError } = await supabase
    .from('games')
    .update({ game_state: game })
    .eq('id', gameId);

  if (updateError) {
    console.error('Update error:', updateError);
    throw updateError;
  }

  console.log('Join successful');
  return game;
}