'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import type { GameState } from '@/types/game';

export function useGameState(gameId: string, _userId: string | null) {
  const [game, setGame] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const fetchGame = useCallback(async () => {
    if (!gameId) return;
    const res = await fetch(`/api/game/${gameId}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load game');
    }
    setGame(data.game as GameState);
  }, [gameId]);

  useEffect(() => {
    if (!gameId) {
      setLoading(false);
      return;
    }

    let subscribed = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        await fetchGame();
      } catch (e) {
        if (subscribed) {
          setError(e instanceof Error ? e.message : 'Failed to load game');
        }
      } finally {
        if (subscribed) setLoading(false);
      }
    };

    load();

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
        () => {
          fetchGame().catch(() => {});
        }
      )
      .subscribe();

    return () => {
      subscribed = false;
      supabase.removeChannel(channel);
    };
  }, [gameId, supabase, fetchGame]);

  return { game, loading, error, refresh: fetchGame };
}