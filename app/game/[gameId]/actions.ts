'use server';

import { createServerClient } from '@/lib/supabase';
import * as engine from '@/lib/game/engine';

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