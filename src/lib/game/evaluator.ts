// src/lib/game/evaluator.ts
import type { Card } from "@/types/game";

export type HandRank = 
  | "high_card" | "pair" | "two_pair" | "three_kind" 
  | "straight" | "flush" | "full_house" | "four_kind" 
  | "straight_flush" | "royal_flush";

export interface HandEvaluation {
  rank: HandRank;
  score: number;           // Higher = better (direct comparison)
  cards: Card[];           // The exact 5 cards that make the hand
  description: string;
}

const RANK_ORDER = "23456789TJQKA";
const RANK_VALUE = new Map(RANK_ORDER.split('').map((r, i) => [r, i + 2])); // 2→2 ... A→14

function parseCardRank(card: Card): string {
  let rank = card.slice(0, -1);
  return rank === "10" ? "T" : rank;
}

function getRankValue(card: Card): number {
  return RANK_VALUE.get(parseCardRank(card))!;
}

function getSuit(card: Card): string {
  return card.slice(-1);
}

// Brute-force combinations (C(11,5) = 462 — negligible)
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k > n || k === 0) return;
  const indices = Array.from({ length: k }, (_, i) => i);
  yield indices.map(i => arr[i]);

  while (true) {
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) i--;
    if (i < 0) return;
    indices[i]++;
    for (let j = i + 1; j < k; j++) {
      indices[j] = indices[j - 1] + 1;
    }
    yield indices.map(idx => arr[idx]);
  }
}

// Rank a single 5-card hand
function rankFiveCards(cards: Card[]): { rank: HandRank; score: number; cards: Card[] } {
  const sorted = [...cards].sort((a, b) => getRankValue(b) - getRankValue(a));
  const ranks = sorted.map(parseCardRank);
  const suits = sorted.map(getSuit);

  const isFlush = new Set(suits).size === 1;

  // Straight (including wheel A-5)
  const uniqueRankVals = [...new Set(ranks.map(r => RANK_VALUE.get(r)!))].sort((a, b) => b - a);
  let isStraight = false;
  if (uniqueRankVals.length === 5) {
    if (uniqueRankVals[0] - uniqueRankVals[4] === 4) isStraight = true;
    else if (uniqueRankVals.join(',') === '14,5,4,3,2') isStraight = true; // Wheel
  }

  // Frequency
  const freq = new Map<string, number>();
  ranks.forEach(r => freq.set(r, (freq.get(r) || 0) + 1));
  const freqSorted = Array.from(freq.values()).sort((a, b) => b - a);

  let handRank: HandRank = "high_card";
  let baseScore = 0;

  if (isFlush && isStraight) {
    const isRoyal = ranks[0] === 'A' && ranks[1] === 'K' && ranks[2] === 'Q';
    handRank = isRoyal ? "royal_flush" : "straight_flush";
    baseScore = isRoyal ? 9_000_000 : 8_000_000;
  } else if (freqSorted[0] === 4) {
    handRank = "four_kind";
    baseScore = 7_000_000;
  } else if (freqSorted[0] === 3 && freqSorted[1] === 2) {
    handRank = "full_house";
    baseScore = 6_000_000;
  } else if (isFlush) {
    handRank = "flush";
    baseScore = 5_000_000;
  } else if (isStraight) {
    handRank = "straight";
    baseScore = 4_000_000;
  } else if (freqSorted[0] === 3) {
    handRank = "three_kind";
    baseScore = 3_000_000;
  } else if (freqSorted[0] === 2 && freqSorted[1] === 2) {
    handRank = "two_pair";
    baseScore = 2_000_000;
  } else if (freqSorted[0] === 2) {
    handRank = "pair";
    baseScore = 1_000_000;
  }

  // Kicker tiebreaker
  const kickerScore = sorted.reduce((acc, card, idx) => 
    acc + getRankValue(card) * Math.pow(15, 4 - idx), 0
  );

  return {
    rank: handRank,
    score: baseScore + kickerScore,
    cards: sorted.slice(0, 5)
  };
}

// Main entry point
export function evaluateHighHand(holeCards: Card[], communityCards: Card[]): HandEvaluation {
  const allCards = [...holeCards, ...communityCards].filter(Boolean) as Card[];

  if (allCards.length < 5) {
    return {
      rank: "high_card",
      score: 0,
      cards: [],
      description: `Dead hand (${allCards.length} cards)`
    };
  }

  let best = { rank: "high_card" as HandRank, score: -1, cards: [] as Card[] };

  for (const combo of combinations(allCards, 5)) {
    const result = rankFiveCards(combo);
    if (result.score > best.score) {
      best = result;
    }
  }

  const desc = `${best.rank.replace(/_/g, ' ').toUpperCase()} ${parseCardRank(best.cards[0])}`;

  return {
    rank: best.rank,
    score: best.score,
    cards: best.cards,
    description: desc
  };
}