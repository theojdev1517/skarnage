'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import * as engine from '@/lib/game/engine';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const createNewGame = async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      await supabase.auth.signInAnonymously();
    }

    const gameId = crypto.randomUUID();

    try {
      const initialState = engine.createNewGame(user?.id || 'anonymous', 'Theo'); // use your engine!
      const { error } = await supabase
        .from('games')
        .insert({ 
          id: gameId, 
          game_state: initialState, 
          host_id: user?.id, 
          status: 'waiting' 
        });

      if (error) console.error('Insert error:', error);
      else console.log('✅ Game saved to Supabase');
    } catch (e) {
      console.error('Create error:', e);
    }

    window.location.href = `/game/${gameId}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a1f0a]">
      <div className="text-center">
        <h1 className="text-7xl font-bold mb-8 text-emerald-400 tracking-wider">SKARNEY</h1>
        <p className="text-xl text-gray-300 mb-12 max-w-md mx-auto">
          Friends-only Icelandic poker with automatic shredding
        </p>

        <button
          onClick={createNewGame}
          disabled={loading}
          className="px-12 py-5 bg-emerald-600 hover:bg-emerald-500 text-2xl font-semibold rounded-xl transition-all disabled:opacity-50"
        >
          {loading ? 'Creating Table...' : 'Create New Game'}
        </button>
      </div>
    </div>
  );
}