// src/hooks/useGameState.ts
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import type { GameState } from '@/types/game';

export function useGameState(gameId: string) {
  const [game, setGame] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    if (!gameId) {
      setLoading(false);
      return;
    }

    let subscribed = true;

    const fetchInitial = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('games')
        .select('game_state')
        .eq('id', gameId)
        .single();

      if (error) {
        console.error('Fetch error:', error);
        setError(error.message);
      } else if (data?.game_state && subscribed) {
        setGame(data.game_state as GameState);
      }
      setLoading(false);
    };

    fetchInitial();

    // Realtime subscription
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
          console.log('🔄 Realtime update received:', payload.eventType);
          if (payload.new?.game_state) {
            setGame(payload.new.game_state as GameState);
          }
        }
      )
      .subscribe((status, err) => {
        console.log('📡 Subscription status:', status, err);
      });

    return () => {
      subscribed = false;
      supabase.removeChannel(channel);
    };
  }, [gameId, supabase]);

  return { game, loading, error };
}