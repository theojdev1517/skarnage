// app/page.tsx
'use client';

import { useState } from 'react';
import type { GameState } from '@/types/game';
import * as engine from '@/lib/game/engine';

type Step = 'idle' | 'dealt_holes' | 'flop' | 'turn' | 'river' | 'showdown';

export default function SkarneyHandStepper() {
  const [game, setGame] = useState<GameState | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [deck, setDeck] = useState<string[]>([]);   // ← keep full shuffled deck

  const addLog = (msg: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const startNewHand = () => {
    let g = engine.createNewGame("test-host", "Theo");
    g = engine.joinSeat(g, "p2", 2, "Alice");
    g = engine.joinSeat(g, "p3", 3, "Bob");

    const fullDeck = engine.shuffleDeck(engine.createStandardDeck());
    setDeck(fullDeck);

    g = engine.dealHoleCards(g, fullDeck);   // uses first 15 cards

    setGame(g);
    setStep('dealt_holes');
    setLog([]);
    addLog("New hand started — 3 players");
    addLog(`Hole cards dealt (${g.players.length} players)`);
  };

  const nextStep = () => {
    if (!game || deck.length === 0) return;

    let newGame = { ...game };
    let newDeckIndex = 15; // after hole cards

    if (step === 'dealt_holes') {
      newGame = engine.dealFlop(newGame, deck, newDeckIndex);
      setStep('flop');
      addLog("Flop + shredder dealt + auto-shred");
    } 
    else if (step === 'flop') {
      newGame = engine.dealTurn(newGame, deck, newDeckIndex + 6);
      setStep('turn');
      addLog("Turn + shredder dealt + auto-shred");
    } 
    else if (step === 'turn') {
      newGame = engine.dealRiver(newGame, deck, newDeckIndex + 8);
      setStep('river');
      addLog("River + shredder dealt + auto-shred");
    } 
    else if (step === 'river') {
      newGame = { 
        ...newGame, 
        pot: 8250, 
        status: "showdown" as any 
      };
      setStep('showdown');
      addLog("=== SHOWDOWN ===");
      
      const result = engine.determineShowdown(newGame);
      addLog(`High: ${result.highWinners.map(p => p.display_name).join(', ') || 'None'}`);
      addLog(`Low:  ${result.lowWinners.map(p => p.display_name).join(', ') || 'None'}`);
    } 
    else if (step === 'showdown') {
      newGame = engine.awardPot(newGame);
      setStep('idle');
      addLog("Pot awarded — hand complete");
    }

    setGame(newGame);
  };

  const reset = () => {
    setGame(null);
    setStep('idle');
    setLog([]);
    setDeck([]);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8 font-mono">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">Skarney Hand Stepper</h1>
        <p className="text-zinc-400 mb-8">Step through a complete hand — no duplicate cards</p>

        <div className="flex gap-4 mb-8">
          <button onClick={startNewHand} className="bg-white text-black px-6 py-3 rounded font-semibold hover:bg-zinc-200">
            Start New Hand
          </button>
          <button 
            onClick={nextStep} 
            disabled={!game || step === 'idle'}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 px-6 py-3 rounded font-semibold"
          >
            Next Step →
          </button>
          <button onClick={reset} className="border border-zinc-700 hover:bg-zinc-900 px-6 py-3 rounded">
            Reset
          </button>
        </div>

        {game && (
          <div className="space-y-8">
            <div className="flex justify-between bg-zinc-900 border border-zinc-700 p-4 rounded">
              <div>Current Step: <span className="text-emerald-400 font-bold">{step.toUpperCase().replace('_', ' ')}</span></div>
              <div>Pot: <span className="font-mono">${game.pot}</span></div>
            </div>

            {/* Players */}
<div>
  <h3 className="text-lg mb-3">Players</h3>
  {game.players.map(p => (
    <div key={p.seat} className="bg-zinc-900 border border-zinc-700 p-4 mb-3 rounded">
      <div className="flex justify-between items-start">
        <strong>{p.display_name} (Seat {p.seat})</strong>
        <span className="text-right">Stack: ${p.stack}</span>
      </div>
      
      <div className="mt-3 text-sm font-mono space-y-1 text-zinc-300">
        <div>
          Original Hole: <span className="text-white">{p.hole_cards.join(' ')}</span>
        </div>
        <div>
          Live Cards: <span className={p.live_hole_cards.length === 0 ? "line-through text-zinc-500" : "text-emerald-400"}>
            {p.live_hole_cards.join(' ') || '(all shredded — dead hand)'}
          </span>
        </div>
        <div>
          Shredded: <span className="text-amber-400">{p.shredded_cards.join(' ') || '(none yet)'}</span>
        </div>
        <div className="text-zinc-400">
          Current Pip Total: <span className="font-semibold">{p.current_pip_total}</span>
        </div>
      </div>
    </div>
  ))}
</div>

            {/* Board */}
            {game.board.top.some(Boolean) && (
              <div className="bg-zinc-900 border border-zinc-700 p-6 rounded">
                <h3 className="mb-3">Top Board</h3>
                <p className="font-mono text-xl tracking-widest">{game.board.top.filter(Boolean).join(' ')}</p>
                <h3 className="mt-6 mb-3 text-sm text-zinc-400">Shredder Board</h3>
                <p className="font-mono text-lg text-zinc-500">{game.board.shredder.filter(Boolean).join(' ')}</p>
              </div>
            )}

            {/* Log */}
            <div className="bg-zinc-900 border border-zinc-700 p-6 rounded max-h-96 overflow-auto text-sm">
              <h3 className="mb-3">Hand Log</h3>
              {log.map((line, i) => <div key={i} className="py-0.5">{line}</div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}