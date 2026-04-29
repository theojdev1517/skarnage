// app/page.tsx
'use client';

import { useState } from 'react';
import { evaluateHighHand } from '@/lib/game/evaluator';
import type { Card } from '@/types/game';

export default function SkarneyTester() {
  const [holeInput, setHoleInput] = useState('');           // ← truly empty by default
  const [boardInput, setBoardInput] = useState('9d 4s Jh 5d Js Kc');
  const [result, setResult] = useState<any>(null);

  const evaluate = () => {
    const hole: Card[] = holeInput.trim() 
      ? holeInput.trim().split(/\s+/).map(c => c.trim() as Card)
      : [];

    const board: Card[] = boardInput.trim().split(/\s+/).map(c => c.trim() as Card);

    const evalResult = evaluateHighHand(hole, board);
    setResult(evalResult);
    console.log('🔍 Evaluation:', evalResult);
  };

  const runSanityTests = () => {
    const tests = [
      { name: "Royal Flush", hole: ["Ah", "Kh"], board: ["Qh", "Jh", "10h", "2s", "3d", "4c"] },
      { name: "Wheel Straight", hole: ["5h", "4d"], board: ["3c", "2s", "As", "Ks", "Qs", "Jd"] },
      { name: "Board Only - Three Jacks", hole: [], board: ["9d", "4s", "Jh", "5d", "Js", "Kc"] },
      { name: "Dead Hand", hole: ["Ah"], board: ["2s", "3d", "4c", "5h", "6s", "7d"] },
      { name: "Full House", hole: ["Ah", "As"], board: ["Ac", "Kd", "Ks", "Qh", "Jh"] },
    ];

    console.group('🔥 Skarney Evaluator Sanity Tests');
    tests.forEach(t => {
      const res = evaluateHighHand(t.hole, t.board);
      console.log(`${t.name}: ${res.rank} → ${res.description} (score: ${res.score})`);
    });
    console.groupEnd();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8 font-mono">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">Skarney Poker — Hand Evaluator Tester</h1>
        <p className="text-zinc-400 mb-8">Leave Hole Cards blank for board-only / post-shred tests</p>

        <div className="space-y-6">
          <div>
            <label className="block text-sm mb-2">Hole Cards (space separated — leave blank for board-only)</label>
            <input
              type="text"
              value={holeInput}
              onChange={(e) => setHoleInput(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-4 py-3 text-lg font-mono"
              placeholder="Ah Ks Qd Jc 10h"
            />
          </div>

          <div>
            <label className="block text-sm mb-2">Top Board (6 cards)</label>
            <input
              type="text"
              value={boardInput}
              onChange={(e) => setBoardInput(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-4 py-3 text-lg font-mono"
              placeholder="9d 4s Jh 5d Js Kc"
            />
          </div>

          <div className="flex gap-4">
            <button 
              onClick={evaluate} 
              className="flex-1 bg-white text-black font-semibold py-4 rounded hover:bg-zinc-200 transition"
            >
              Evaluate Hand
            </button>
            <button 
              onClick={runSanityTests} 
              className="flex-1 border border-zinc-700 hover:bg-zinc-900 py-4 rounded transition"
            >
              Run Sanity Tests (Console)
            </button>
          </div>

          {result && (
            <div className="bg-zinc-900 border border-zinc-700 rounded p-6">
              <h3 className="text-xl font-semibold mb-4">Result</h3>
              <p className="text-3xl mb-2">{result.description}</p>
              <p className="text-emerald-400">Rank: {result.rank}</p>
              <p className="text-zinc-400">Score: {result.score.toLocaleString()}</p>
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-zinc-400">Cards used</summary>
                <p className="mt-2 font-mono break-all">{result.cards.join(' ')}</p>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}