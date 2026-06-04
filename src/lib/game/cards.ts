import type { Card } from '@/types/game';

const CARD_PATTERN = /^(A|[2-9]|10|[JQK])[hdcs]$/;

export function isValidCard(card: unknown): card is Card {
  return typeof card === 'string' && CARD_PATTERN.test(card);
}

export function assertValidCards(cards: unknown[], context: string): Card[] {
  const out: Card[] = [];
  for (const c of cards) {
    if (!isValidCard(c)) {
      throw new Error(`Invalid card in ${context}: ${String(c)}`);
    }
    out.push(c);
  }
  return out;
}

/** Detect duplicate cards across hole + board (should never happen). */
export function findDuplicateCards(cards: Card[]): Card[] {
  const seen = new Set<string>();
  const dupes: Card[] = [];
  for (const c of cards) {
    if (seen.has(c)) dupes.push(c);
    else seen.add(c);
  }
  return dupes;
}