'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase';
import type { GameState } from '@/types/game';
import { messageFromGameApi } from '@/lib/game/safeErrors';

export function useGameState(gameId: string) {
  const [game, setGame] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const fetchGame = useCallback(async () => {
    if (!gameId) return;
    const res = await fetch(`/api/game/${gameId}`, { credentials: 'include' });
    let data: { error?: string; code?: string; game?: GameState } = {};
    try {
      data = await res.json();
    } catch {
      throw new Error('Could not read table data. Try again.');
    }
    if (!res.ok) {
      throw new Error(messageFromGameApi(data, 'Failed to load game'));
    }
    if (!data.game) {
      throw new Error('Table data was missing from the server.');
    }
    setGame(data.game);
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
          fetchGame().catch((e) => {
            setError(e instanceof Error ? e.message : 'Failed to refresh table');
          });
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