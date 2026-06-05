import { NextResponse } from 'next/server';
import {
  GameApiError,
  GameErrorCode,
  gameErrorResponse,
} from '@/lib/game/apiErrors';

/** Stable user-facing copy when the API returns a known code. */
const CODE_MESSAGES: Partial<Record<GameErrorCode, string>> = {
  [GameErrorCode.SIGN_IN_REQUIRED]: 'Sign in required. Refresh the page.',
  [GameErrorCode.GAME_NOT_FOUND]: 'This table could not be found.',
  [GameErrorCode.INVALID_REQUEST]: 'That request was invalid. Try again.',
  [GameErrorCode.INVALID_STATE]:
    'The table data looks inconsistent. Refresh and try again.',
  [GameErrorCode.HOST_ONLY]: 'Only the host can do that.',
  [GameErrorCode.NOT_YOUR_TURN]: 'Not your turn.',
  [GameErrorCode.NOT_YOUR_SEAT]: 'That seat is not yours.',
  [GameErrorCode.WRONG_PHASE]: 'That action is not allowed in this phase.',
  [GameErrorCode.STALE_STATE]:
    'Someone else updated the table first. Refreshing — try your action again.',
  [GameErrorCode.SAVE_FAILED]: 'Could not save the table. Try again.',
  [GameErrorCode.RULE_VIOLATION]: 'That action is not allowed right now.',
  [GameErrorCode.FOLD_NOT_REQUIRED]: 'You can check — there is no bet to you.',
};

export type GameApiErrorPayload = {
  error?: string;
  code?: string;
};

export function messageFromGameApi(
  data: GameApiErrorPayload,
  fallback = 'That action is not allowed right now.'
): string {
  // Prefer the specific error message from server (e.g. "That seat already has a pending request.")
  // even for generic codes like INVALID_REQUEST. The map is only fallback.
  if (data.error) {
    const fromErr = toUserFacingMessage(new Error(data.error), fallback);
    if (fromErr !== fallback) return fromErr;
    return data.error; // surface the exact server message
  }
  if (data.code && data.code in CODE_MESSAGES) {
    return CODE_MESSAGES[data.code as GameErrorCode] ?? fallback;
  }
  return fallback;
}

/** Engine/API messages safe to show players as-is. */
const USER_FACING = [
  /^not your turn/i,
  /^you can check/i,
  /^you are not in this hand/i,
  /^player cannot act/i,
  /^cannot /i,
  /^nothing to /i,
  /^invalid betting/i,
  /^that seat is not yours/i,
  /^host only/i,
  /^transfer host/i,
  /^amount must/i,
  /^stack cannot/i,
  /^starting stack/i,
  /^seat must/i,
  /^rebuy/i,
  /^turn timer/i,
  /^fold when/i,
  /^enter a valid/i,
  /^minimum raise/i,
  /^maximum /i,
  /^pot limit/i,
  /^a hand is already/i,
  /^betting is only/i,
  /^host stack edits/i,
  /^join request/i,
  /seat.*pending|pending.*request|already have a pending/i,
  /^someone else updated/i,
  /^could not /i,
  /^table /i,
  /^game not found/i,
  /^sign in required/i,
  /^waiting for/i,
];

export function toUserFacingMessage(
  error: unknown,
  fallback = 'That action is not allowed right now.'
): string {
  if (error instanceof GameApiError) return error.message;
  if (error instanceof Error) {
    const msg = error.message.trim();
    if (msg && USER_FACING.some((re) => re.test(msg))) return msg;
  }
  return fallback;
}

export function mapThrownError(error: unknown): NextResponse {
  if (error instanceof GameApiError) {
    return gameErrorResponse(error.code, error.message, error.status);
  }
  if (error instanceof Error) {
    console.error('Unhandled game error:', error.message, error.stack);
    return gameErrorResponse(
      GameErrorCode.RULE_VIOLATION,
      toUserFacingMessage(error),
      400
    );
  }
  return gameErrorResponse(
    GameErrorCode.SAVE_FAILED,
    'Something went wrong. Try again.',
    500
  );
}