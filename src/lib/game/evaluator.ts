import type { Card } from '@/types/game';
import { isValidCard } from '@/lib/game/cards';

export type HandRank = 
  | "high_card" | "pair" | "two_pair" | "three_kind" 
  | "straight" | "flush" | "full_house" | "four_kind" 
  | "straight_flush" | "royal_flush";

export interface HandEvaluation {
  rank: HandRank;
  score: number;
  cards: Card[];
  description: string;
}

const RANK_ORDER = "23456789TJQKA";
const RANK_VALUE = new Map(RANK_ORDER.split('').map((r, i) => [r, i + 2]));

const RANK_LABEL: Record<string, string> = {
  A: "Ace",
  K: "King",
  Q: "Queen",
  J: "Jack",
  T: "Ten",
  "9": "Nine",
  "8": "Eight",
  "7": "Seven",
  "6": "Six",
  "5": "Five",
  "4": "Four",
  "3": "Three",
  "2": "Deuce",
};

const RANK_LABEL_PLURAL: Record<string, string> = {
  A: "Aces",
  K: "Kings",
  Q: "Queens",
  J: "Jacks",
  T: "Tens",
  "9": "Nines",
  "8": "Eights",
  "7": "Sevens",
  "6": "Sixes",
  "5": "Fives",
  "4": "Fours",
  "3": "Threes",
  "2": "Deuces",
};

function rankLabel(rank: string, plural = false): string {
  return plural ? (RANK_LABEL_PLURAL[rank] ?? rank) : (RANK_LABEL[rank] ?? rank);
}

function ranksByCount(cards: Card[], count: number): string[] {
  const freq = new Map<string, number>();
  for (const card of cards) {
    const r = parseCardRank(card);
    freq.set(r, (freq.get(r) || 0) + 1);
  }
  return [...freq.entries()]
    .filter(([, c]) => c === count)
    .map(([r]) => r)
    .sort((a, b) => RANK_VALUE.get(b)! - RANK_VALUE.get(a)!);
}

/** A-2-3-4-5 straight; ace is low, so the high card is five — not ace. */
function isWheelStraight(cards: Card[]): boolean {
  const ranks = cards.map(parseCardRank);
  if (ranks.length !== 5) return false;
  const unique = new Set(ranks);
  return unique.size === 5 && ['A', '2', '3', '4', '5'].every((r) => unique.has(r));
}

function straightHighRank(cards: Card[]): string {
  return isWheelStraight(cards) ? '5' : parseCardRank(sortCardsDescending(cards)[0]);
}

function describeFiveCardHand(cards: Card[], handRank: HandRank): string {
  const sorted = sortCardsDescending(cards);
  const kickers = ranksByCount(sorted, 1);

  switch (handRank) {
    case "royal_flush":
      return "Royal Flush";
    case "straight_flush": {
      const high = straightHighRank(cards);
      return high === "5" ? "Five-high Straight Flush" : `${rankLabel(high)}-high Straight Flush`;
    }
    case "four_kind": {
      const quad = ranksByCount(sorted, 4)[0];
      const kicker = kickers[0];
      return kicker
        ? `Four ${rankLabel(quad, true)}, ${rankLabel(kicker)} kicker`
        : `Four ${rankLabel(quad, true)}`;
    }
    case "full_house": {
      const trips = ranksByCount(sorted, 3)[0];
      const pair = ranksByCount(sorted, 2)[0];
      return `${rankLabel(trips, true)} full of ${rankLabel(pair, true)}`;
    }
    case "flush":
      return `${rankLabel(parseCardRank(sorted[0]))}-high Flush`;
    case "straight": {
      const high = straightHighRank(cards);
      return high === "5" ? "Five-high Straight" : `${rankLabel(high)}-high Straight`;
    }
    case "three_kind": {
      const trips = ranksByCount(sorted, 3)[0];
      if (kickers.length >= 2) {
        return `Three ${rankLabel(trips, true)}, ${rankLabel(kickers[0])}-${rankLabel(kickers[1])} kickers`;
      }
      if (kickers.length === 1) {
        return `Three ${rankLabel(trips, true)}, ${rankLabel(kickers[0])} kicker`;
      }
      return `Three ${rankLabel(trips, true)}`;
    }
    case "two_pair": {
      const pairs = ranksByCount(sorted, 2);
      const highPair = pairs[0];
      const lowPair = pairs[1];
      const kicker = kickers[0];
      const base = `Two Pair, ${rankLabel(highPair, true)} and ${rankLabel(lowPair, true)}`;
      return kicker ? `${base}, ${rankLabel(kicker)} kicker` : base;
    }
    case "pair": {
      const pair = ranksByCount(sorted, 2)[0];
      if (kickers.length >= 2) {
        return `Pair of ${rankLabel(pair, true)}, ${rankLabel(kickers[0])}-${rankLabel(kickers[1])} kickers`;
      }
      if (kickers.length === 1) {
        return `Pair of ${rankLabel(pair, true)}, ${rankLabel(kickers[0])} kicker`;
      }
      return `Pair of ${rankLabel(pair, true)}`;
    }
    case "high_card":
    default:
      return `${rankLabel(parseCardRank(sorted[0]))} High`;
  }
}

export function parseCardRank(card: Card): string {
  let rank = card.slice(0, -1);
  return rank === "10" ? "T" : rank;
}

function getRankValue(card: Card): number {
  return RANK_VALUE.get(parseCardRank(card))!;
}

function getSuitValue(card: Card): number {
  const suit = card.slice(-1);
  return "hdcs".indexOf(suit); // deterministic tiebreaker
}

// Stronger, stable sort for best hand selection
function sortCardsDescending(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rankDiff = getRankValue(b) - getRankValue(a);
    if (rankDiff !== 0) return rankDiff;
    return getSuitValue(b) - getSuitValue(a); // stable
  });
}

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

function rankFiveCards(cards: Card[]): { rank: HandRank; score: number; cards: Card[] } {
  const sorted = sortCardsDescending(cards);
  const ranks = sorted.map(parseCardRank);
  const suits = sorted.map(c => c.slice(-1));

  const isFlush = new Set(suits).size === 1;

  const uniqueVals = [...new Set(ranks.map(r => RANK_VALUE.get(r)!))].sort((a, b) => b - a);
  let isStraight = false;
  if (uniqueVals.length === 5) {
    if (uniqueVals[0] - uniqueVals[4] === 4) isStraight = true;
    else if (uniqueVals.join(',') === '14,5,4,3,2') isStraight = true;
  }

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

  let kickerScore = sorted.reduce(
    (acc, card, idx) => acc + getRankValue(card) * Math.pow(15, 4 - idx),
    0
  );
  if (isStraight) {
    const highVal = isWheelStraight(sorted) ? 5 : uniqueVals[0];
    kickerScore = highVal * Math.pow(15, 4);
  }

  return {
    rank: handRank,
    score: baseScore + kickerScore,
    cards: sorted.slice(0, 5)
  };
}

export function evaluateHighHand(holeCards: Card[], communityCards: Card[]): HandEvaluation {
  const allCards = [...holeCards, ...communityCards].filter(
    (c): c is Card => Boolean(c) && isValidCard(c)
  );

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

  return {
    rank: best.rank,
    score: best.score,
    cards: best.cards,
    description: describeFiveCardHand(best.cards, best.rank),
  };
}