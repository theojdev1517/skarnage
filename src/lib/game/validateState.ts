import type { GameState, GameStatus, Player } from '@/types/game';
import { GameApiError, GameErrorCode } from '@/lib/game/apiErrors';
import { normalizeGameState } from '@/lib/game/playerLifecycle';

const VALID_STATUSES: GameStatus[] = [
  'waiting',
  'buying_in',
  'preflop_betting',
  'flop_dealt',
  'flop_discard',
  'flop_betting',
  'turn_dealt',
  'turn_discard',
  'turn_betting',
  'river_dealt',
  'river_discard',
  'river_betting',
  'showdown',
  'finished',
];

const BET_ACTIONS = ['fold', 'check', 'call', 'bet', 'raise'] as const;
export type BetAction = (typeof BET_ACTIONS)[number];

export function isBetAction(value: unknown): value is BetAction {
  return typeof value === 'string' && (BET_ACTIONS as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePlayer(raw: unknown, index: number): Player {
  if (!raw || typeof raw !== 'object') {
    throw new GameApiError(
      GameErrorCode.INVALID_STATE,
      `Player ${index + 1} data is invalid.`,
      500
    );
  }
  const p = raw as Record<string, unknown>;
  const seat = p.seat;
  if (!isFiniteNumber(seat) || seat < 1 || seat > 8 || !Number.isInteger(seat)) {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Invalid seat in saved game.', 500);
  }
  if (typeof p.user_id !== 'string' || typeof p.display_name !== 'string') {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Invalid player identity in saved game.', 500);
  }
  if (!isFiniteNumber(p.stack) || p.stack < 0) {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Invalid stack in saved game.', 500);
  }
  return p as unknown as Player;
}

/** Minimal runtime validation before engine touches DB JSON. */
export function parseGameState(raw: unknown, gameId: string): GameState {
  if (!raw || typeof raw !== 'object') {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Saved game data is missing.', 500);
  }

  const g = raw as Record<string, unknown>;

  if (typeof g.game_id !== 'string' || g.game_id !== gameId) {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Saved game id does not match table.', 500);
  }
  if (typeof g.updated_at !== 'string' || !g.updated_at) {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Saved game is missing a version timestamp.', 500);
  }
  if (typeof g.status !== 'string' || !VALID_STATUSES.includes(g.status as GameStatus)) {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Saved game has an unknown phase.', 500);
  }
  if (!Array.isArray(g.players)) {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Saved game has no players list.', 500);
  }

  const players = g.players.map((p, i) => parsePlayer(p, i));

  const board = g.board as Record<string, unknown> | undefined;
  if (!board || !Array.isArray(board.top) || !Array.isArray(board.shredder)) {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Saved game board is invalid.', 500);
  }

  if (!isFiniteNumber(g.pot) || g.pot < 0) {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Saved game pot is invalid.', 500);
  }

  return normalizeGameState({ ...g, players } as GameState);
}

export function parseSeat(value: unknown): number {
  if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 1 || value > 8) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Seat must be a number from 1 to 8.', 400);
  }
  return value;
}

export function parseCents(value: unknown, fieldName: string): number {
  if (!isFiniteNumber(value) || !Number.isInteger(value)) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      `${fieldName} must be a whole number of cents.`,
      400
    );
  }
  return value;
}

export function parseDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Display name is required.', 400);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 24) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      'Display name must be 1–24 characters.',
      400
    );
  }
  return trimmed;
}