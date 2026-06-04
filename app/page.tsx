'use client';

import { useState } from 'react';
import { JoinSeatModal } from '@/components/game/JoinSeatModal';
import { messageFromGameApi } from '@/lib/game/safeErrors';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const createNewGame = async (displayName: string, stackCents: number) => {
    setLoading(true);
    setCreateError(null);

    try {
      const res = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          displayName,
          startingStackCents: stackCents,
        }),
      });
      let data: { error?: string; code?: string; gameId?: string } = {};
      try {
        data = await res.json();
      } catch {
        setCreateError('Server returned an invalid response. Try again.');
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setCreateError(messageFromGameApi(data, 'Could not create the table.'));
        setLoading(false);
        return;
      }
      window.location.href = `/game/${data.gameId}`;
    } catch {
      setCreateError('Could not create the table. Check your connection and try again.');
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