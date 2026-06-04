import { NextResponse } from 'next/server';

export const GameErrorCode = {
  SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
  GAME_NOT_FOUND: 'GAME_NOT_FOUND',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_STATE: 'INVALID_STATE',
  HOST_ONLY: 'HOST_ONLY',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  NOT_YOUR_SEAT: 'NOT_YOUR_SEAT',
  WRONG_PHASE: 'WRONG_PHASE',
  STALE_STATE: 'STALE_STATE',
  SAVE_FAILED: 'SAVE_FAILED',
  RULE_VIOLATION: 'RULE_VIOLATION',
  FOLD_NOT_REQUIRED: 'FOLD_NOT_REQUIRED',
} as const;

export type GameErrorCode = (typeof GameErrorCode)[keyof typeof GameErrorCode];

export class GameApiError extends Error {
  readonly code: GameErrorCode;
  readonly status: number;

  constructor(code: GameErrorCode, message: string, status: number) {
    super(message);
    this.name = 'GameApiError';
    this.code = code;
    this.status = status;
  }
}

export function gameErrorResponse(code: GameErrorCode, message: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}