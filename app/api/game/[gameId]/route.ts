// app/api/game/[gameId]/action/route.ts
import { NextRequest, NextResponse } from 'next/server';
import type { GameState } from '../src/types/game';
import * as engine from '../src/lib/game/engine';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params; // ← This is the fix
    const body = await request.json();
    const { action, seat, betAction, amount = 0, game: clientGame } = body;

    if (!clientGame) {
      return NextResponse.json({ error: "Game state is required" }, { status: 400 });
    }

    let game: GameState = { ...clientGame };

    let result: GameState;

    switch (action) {
      case 'bet':
        if (!betAction) {
          return NextResponse.json({ error: "betAction required" }, { status: 400 });
        }
        result = engine.processBet(game, seat, betAction, amount);
        break;

      case 'advance':
        result = engine.advanceToNextPhase(game);
        break;

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      game: result,
    });

  } catch (error: any) {
    console.error("API Action Error:", error);
    return NextResponse.json({
      error: error.message || "Internal server error"
    }, { status: 500 });
  }
}