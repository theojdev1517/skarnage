// app/page.tsx
'use client';

import { useState } from 'react';
import type { GameState } from '../src/types/game';
import * as engine from '../src/lib/game/engine';

type Step = 'idle' | 'dealt_holes' | 'preflop_betting' | 'flop_betting' | 
            'turn_betting' | 'river_betting' | 'showdown';

export default function SkarneyHandStepper() {
  const [game, setGame] = useState<GameState | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const startNewHandFull = () => {
    let g = engine.createNewGame("test-host", "Theo");
    g = engine.joinSeat(g, "p2", 2, "Alice");
    g = engine.joinSeat(g, "p3", 3, "Bob");

    g = engine.startNewHand(g);
    g = engine.dealHoleCards(g);

    setGame(g);
    setStep('dealt_holes');
    setLog([]);
    addLog(`🚀 New hand #${g.hand_number} started | Button on seat ${g.button_seat} | First to act: seat ${g.current_player_seat}`);
  };

  const doBet = (seat: number, betAction: "fold" | "call" | "check" | "raise", amount = 0) => {
    if (!game) return;
    if (seat !== game.current_player_seat) {
      addLog(`❌ Not your turn! Seat ${game.current_player_seat} should act.`);
      return;
    }
    try {
      const newGame = engine.processBet(game, seat, betAction, amount);
      setGame(newGame);
      addLog(`Seat ${seat} → ${betAction}${amount ? ` $${amount}` : ''}`);
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const nextStep = () => {
    if (!game) return;
    try {
      const newGame = engine.advanceToNextPhase(game);
      setGame(newGame);
      setStep(newGame.status as Step);
      addLog(newGame.last_action);
    } catch (e: any) {
      addLog(`ERROR: ${e.message}`);
    }
  };

  const reset = () => {
    setGame(null);
    setStep('idle');
    setLog([]);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8 font-mono">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">Skarney Hand Stepper</h1>
        <p className="text-zinc-400 mb-8">Back to direct engine calls</p>

        <div className="flex gap-4 mb-8 flex-wrap">
          <button onClick={startNewHandFull} className="bg-green-600 hover:bg-green-500 px-6 py-3 rounded font-semibold">
            🚀 Start New Hand (Button + Blinds)
          </button>
          <button onClick={nextStep} disabled={!game} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 px-6 py-3 rounded font-semibold">
            Next Step →
          </button>
          <button onClick={reset} className="border border-zinc-700 hover:bg-zinc-900 px-6 py-3 rounded">
            Reset
          </button>
        </div>

        {game && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h3 className="text-lg mb-3">Players — Click to Act</h3>
              {game.players.map(p => {
                const toCall = game.current_wager - p.bet_this_street;
                return (
                  <div 
                    key={`player-${p.seat}`} 
                    className={`bg-zinc-900 border-2 p-4 rounded transition-all ${
                      p.seat === game.current_player_seat ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-zinc-700'
                    }`}
                  >
                    <div className="flex justify-between">
                      <strong>{p.display_name} (Seat {p.seat}) {p.seat === game.current_player_seat && '← ACTING'}</strong>
                      <span>Stack: ${p.stack}</span>
                    </div>
                    <div className="text-sm font-mono mt-3 space-y-1">
                      <div>Original: {p.hole_cards.join(' ')}</div>
                      <div>Live: {p.live_hole_cards.join(' ') || '(all shredded)'}</div>
                      <div>Shredded: {p.shredded_cards.join(' ') || '(none)'}</div>
                      <div>Pip: {p.current_pip_total}</div>
                    </div>
                    {p.status === "active" && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button onClick={() => doBet(p.seat, "fold")} className="text-xs bg-red-900 hover:bg-red-800 px-4 py-1 rounded">Fold</button>
                        <button onClick={() => doBet(p.seat, "check")} className="text-xs bg-zinc-700 hover:bg-zinc-600 px-4 py-1 rounded">Check</button>
                        <button onClick={() => doBet(p.seat, "call")} className="text-xs bg-blue-900 hover:bg-blue-800 px-4 py-1 rounded">Call ${toCall}</button>
                        <button onClick={() => doBet(p.seat, "raise", 200)} className="text-xs bg-amber-900 hover:bg-amber-800 px-4 py-1 rounded">Raise $200</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-6">
              {game.board.top.some(Boolean) && (
                <div className="bg-zinc-900 border border-zinc-700 p-6 rounded">
                  <h3>Top Board</h3>
                  <p className="font-mono text-xl tracking-widest">{game.board.top.filter(Boolean).join(' ')}</p>
                  <h4 className="mt-4 text-sm text-zinc-400">Shredder Board</h4>
                  <p className="font-mono">{game.board.shredder.filter(Boolean).join(' ')}</p>
                </div>
              )}

              <div className="bg-zinc-900 border border-zinc-700 p-6 rounded max-h-96 overflow-auto">
                <h3>Action Log</h3>
                {log.map((line, i) => <div key={i} className="text-sm py-0.5">{line}</div>)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}