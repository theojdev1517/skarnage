'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import * as engine from '@/lib/game/engine';
import { JoinSeatModal } from '@/components/game/JoinSeatModal';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const supabase = createClient();

  const createNewGame = async (displayName: string, stackCents: number) => {
    setLoading(true);
    setCreateError(null);

    let {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      const { data, error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) {
        console.error('Sign-in error:', signInError);
        setCreateError('Could not sign in. Check Supabase anonymous auth is enabled.');
        setLoading(false);
        return;
      }
      user = data.user;
    }

    if (!user) {
      setCreateError('Could not sign in. Check Supabase anonymous auth is enabled.');
      setLoading(false);
      return;
    }

    const gameId = crypto.randomUUID();
    const name = displayName.trim() || 'Player';

    try {
      const initialState = engine.createNewGame(gameId, user.id, name, stackCents);
      const { error } = await supabase.from('games').insert({
        id: gameId,
        game_state: initialState,
        host_id: user.id,
        status: 'waiting',
      });

      if (error) {
        console.error('Insert error:', error);
        setCreateError('Could not create table. Try again.');
        setLoading(false);
        return;
      }

      window.location.href = `/game/${gameId}`;
    } catch (e) {
      console.error('Create error:', e);
      setCreateError(e instanceof Error ? e.message : 'Could not create table');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a1f0a]">
      <div className="text-center">
        <h1 className="text-7xl font-bold mb-8 text-emerald-400 tracking-wider">SKARNEY</h1>
        <p className="text-xl text-gray-300 mb-12 max-w-md mx-auto">
          Friends-only Icelandic poker with automatic shredding
        </p>

        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setShowCreateModal(true);
          }}
          disabled={loading}
          className="px-12 py-5 bg-emerald-600 hover:bg-emerald-500 text-2xl font-semibold rounded-xl transition-all disabled:opacity-50"
        >
          {loading ? 'Creating Table...' : 'Create New Game'}
        </button>
      </div>

      <JoinSeatModal
        open={showCreateModal}
        title="Create a table"
        subtitle="You will be seated in seat 1 as host."
        seat={1}
        submitLabel="Create table"
        busy={loading}
        error={createError}
        onClose={() => !loading && setShowCreateModal(false)}
        onSubmit={createNewGame}
      />
    </div>
  );
}