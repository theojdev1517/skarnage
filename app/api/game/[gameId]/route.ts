// app/api/game/[gameId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import type { GameState } from '@/types/game';
import * as engine from '@/lib/game/engine';
import { createServerClient } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const body = await request.json();
    const { action, seat, betAction, amount = 0 } = body;

    const supabase = await createServerClient();

    // Fetch latest game state from DB
    const { data: gameRow, error: fetchError } = await supabase
      .from('games')
      .select('game_state')
      .eq('id', gameId)
      .single();

    if (fetchError || !gameRow?.game_state) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    let game: GameState = gameRow.game_state as GameState;

    let result: GameState;

    switch (action) {
      case 'startHand':
        result = engine.startNewHand(game);
        break;

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

    // Save updated state back to DB
    const { error: updateError } = await supabase
      .from('games')
      .update({ game_state: result })
      .eq('id', gameId);

    if (updateError) {
      console.error("DB update error:", updateError);
      return NextResponse.json({ error: "Failed to save game state" }, { status: 500 });
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