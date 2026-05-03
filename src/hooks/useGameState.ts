'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import type { GameState } from '@/types/game';

export function useGameState(gameId: string) {
  const [game, setGame] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (!gameId) {
      setLoading(false);
      return;
    }

    const fetchGame = async () => {
      const { data } = await supabase
        .from('games')
        .select('game_state')
        .eq('id', gameId)
        .single();

      setGame(data?.game_state as GameState);
      setLoading(false);
    };

    fetchGame();

    // Real-time
    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => setGame((payload.new as any)?.game_state as GameState)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, supabase]);

  return { game, loading };
}