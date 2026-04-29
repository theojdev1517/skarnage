// src/lib/game/evaluator.ts
import type { Card } from "@/types/game";

export type HandRank = 
  | "high_card" | "pair" | "two_pair" | "three_kind" 
  | "straight" | "flush" | "full_house" | "four_kind" 
  | "straight_flush" | "royal_flush";

export interface HandEvaluation {
  rank: HandRank;
  score: number;           // Higher = better hand
  cards: Card[];           // The 5 cards used for this hand
  description: string;
}

// Basic high hand evaluator (best 5 out of up to 11 cards)
export function evaluateHighHand(holeCards: Card[], communityCards: Card[]): HandEvaluation {
  const allCards = [...holeCards, ...communityCards].filter(Boolean) as Card[];

  // Sort by rank (A high)
  const rankOrder = "23456789TJQKA";
  const sorted = [...allCards].sort((a, b) => {
    return rankOrder.indexOf(parseCardRank(b)) - rankOrder.indexOf(parseCardRank(a));
  });

  const best5 = sorted.slice(0, 5);

  return {
    rank: "high_card",           // TODO: Expand to full poker rankings later
    score: 100,                  // Placeholder
    cards: best5,
    description: `High card ${parseCardRank(best5[0])}`
  };
}

function parseCardRank(card: Card): string {
  const rank = card.slice(0, -1);
  return rank === "10" ? "T" : rank;
}