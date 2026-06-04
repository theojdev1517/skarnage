import type { GameState, GameStatus } from '@/types/game';

/** Strip secrets from game state before rendering (hole cards, deck). */
export function sanitizeGameStateForUser(
  game: GameState,
  userId: string | null
): GameState {
  return {
    ...game,
    deck: [],
    deck_index: 0,
    players: game.players.map((p) =>
      userId && p.user_id === userId
        ? p
        : {
            ...p,
            hole_cards: [],
            live_hole_cards: [],
          }
    ),
  };
}

export function isBettingPhase(status: GameStatus): boolean {
  return (
    status === 'preflop_betting' ||
    status === 'flop_betting' ||
    status === 'turn_betting' ||
    status === 'river_betting'
  );
}

export function formatCards(cards: string[]): string {
  if (!cards.length) return '—';
  return cards.join('  ');
}