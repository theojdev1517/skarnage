import { NextRequest, NextResponse } from 'next/server';
import * as engine from '@/lib/game/engine';
import { createServerClient } from '@/lib/supabase';
import { GameApiError, GameErrorCode } from '@/lib/game/apiErrors';
import { mapThrownError } from '@/lib/game/safeErrors';
import { parseCents, parseDisplayName } from '@/lib/game/validateState';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const displayName = parseDisplayName(body.displayName);
    const startingStackCents = parseCents(body.startingStackCents, 'Starting stack');

    if (startingStackCents <= 0) {
      throw new GameApiError(
        GameErrorCode.INVALID_REQUEST,
        'Starting stack must be greater than zero.',
        400
      );
    }

    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Sign in required.', code: GameErrorCode.SIGN_IN_REQUIRED },
        { status: 401 }
      );
    }

    const gameId = crypto.randomUUID();
    // createNewGame forces exactly 100 for the host (initial buy-in rule); the passed value is ignored.
    const initialState = engine.createNewGame(
      gameId,
      user.id,
      displayName,
      startingStackCents
    );

    const { error: insertError } = await supabase.from('games').insert({
      id: gameId,
      game_state: initialState,
      host_id: user.id,
      status: 'waiting',
    });

    if (insertError) {
      console.error('Create game insert error:', insertError);
      throw new GameApiError(
        GameErrorCode.SAVE_FAILED,
        'Could not create the table. Try again.',
        500
      );
    }

    return NextResponse.json({ gameId });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid request body.', code: GameErrorCode.INVALID_REQUEST },
        { status: 400 }
      );
    }
    return mapThrownError(error);
  }
}