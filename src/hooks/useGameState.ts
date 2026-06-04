'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import { sanitizeGameStateForUser } from '@/lib/game/clientView';
import type { GameState } from '@/types/game';

export function useGameState(gameId: string, userId: string | null) {
  const [rawGame, setRawGame] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const game = useMemo(
    () => (rawGame ? sanitizeGameStateForUser(rawGame, userId) : null),
    [rawGame, userId]
  );

  useEffect(() => {
    if (!gameId) {
      setLoading(false);
      return;
    }

    let subscribed = true;

    const applyState = (state: GameState) => {
      if (subscribed) setRawGame(state);
    };

    const fetchInitial = async () => {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('games')
        .select('game_state')
        .eq('id', gameId)
        .single();

      if (fetchError) {
        console.error('Fetch error:', fetchError);
        setError(fetchError.message);
      } else if (data?.game_state) {
        applyState(data.game_state as GameState);
      }
      setLoading(false);
    };

    fetchInitial();

    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`,
        },
        (payload) => {
          const row = payload.new as { game_state?: GameState } | undefined;
          if (row?.game_state) {
            applyState(row.game_state);
          }
        }
      )
      .subscribe();

    return () => {
      subscribed = false;
      supabase.removeChannel(channel);
    };
  }, [gameId, supabase]);

  return { game, loading, error };
}