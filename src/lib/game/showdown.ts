import type { Card, GameState, Player, ShowdownSummary } from '@/types/game';
import type { HandEvaluation } from '@/lib/game/evaluator';
import { evaluateHighHand } from '@/lib/game/evaluator';
import { GameApiError, GameErrorCode } from '@/lib/game/apiErrors';
import { assertValidCards, findDuplicateCards, isValidCard } from '@/lib/game/cards';

export interface ShowdownResolution {
  highWinners: Player[];
  lowWinners: Player[];
  highPotShare: number;
  lowPotShare: number;
  evaluations: Map<string, HandEvaluation>;
  uncontested: boolean;
}

export function liveShowdownPlayers(game: GameState): Player[] {
  return game.players.filter(
    (p) =>
      p.in_current_hand &&
      (p.status === 'active' || p.status === 'all_in')
  );
}

export function assertPotMatchesContributions(game: GameState): void {
  const contributed = game.players.reduce((s, p) => s + p.contributed_this_hand, 0);
  if (contributed !== game.pot) {
    throw new GameApiError(
      GameErrorCode.INVALID_STATE,
      `Pot does not match contributions (${game.pot} vs ${contributed}).`,
      500
    );
  }
  if (game.pot < 0) {
    throw new GameApiError(GameErrorCode.INVALID_STATE, 'Pot cannot be negative.', 500);
  }
}

function boardCards(game: GameState): Card[] {
  return assertValidCards(
    game.board.top.filter((c): c is Card => c !== null),
    'top board'
  );
}

function evaluatePlayerHigh(player: Player, community: Card[]): HandEvaluation {
  const hole = assertValidCards(player.live_hole_cards, `${player.display_name} hole cards`);
  const all = [...hole, ...community];
  const dupes = findDuplicateCards(all);
  if (dupes.length > 0) {
    throw new GameApiError(
      GameErrorCode.INVALID_STATE,
      `Duplicate cards at showdown for ${player.display_name}.`,
      500
    );
  }
  return evaluateHighHand(hole, community);
}

/** A player may win the high half only with a real 5-card high hand. */
export function canWinHighPrize(evaluation: HandEvaluation): boolean {
  return evaluation.score > 0 && evaluation.cards.length === 5;
}

function pickBestByScore<T extends { seat: number }>(
  players: T[],
  scoreOf: (p: T) => number
): T[] {
  if (players.length === 0) return [];
  let best = -1;
  let winners: T[] = [];
  for (const p of players) {
    const score = scoreOf(p);
    if (score > best) {
      best = score;
      winners = [p];
    } else if (score === best) {
      winners.push(p);
    }
  }
  return winners;
}

function pickLowestPips(players: Player[]): Player[] {
  if (players.length === 0) return [];
  let best = Infinity;
  let winners: Player[] = [];
  for (const p of players) {
    const pips = p.current_pip_total;
    if (pips < best) {
      best = pips;
      winners = [p];
    } else if (pips === best) {
      winners.push(p);
    }
  }
  return winners;
}

/** Sort winners by seat ascending for display / low-half remainder priority. */
function bySeat(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.seat - b.seat);
}

/** Reverse seat order so higher seat numbers get remainder cents first (used for high-half ties = "worst position"). */
function byReverseSeat(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.seat - a.seat);
}

/**
 * Resolve high/low winners with validation.
 * - Uncontested: sole live player takes the full pot.
 * - Dead high hands (score 0) cannot win the high half.
 * - If no one qualifies for high, the high half goes to low winner(s).
 */
export function resolveShowdown(game: GameState, overridePlayers?: Player[], overridePot?: number): ShowdownResolution {
  const totalPot = overridePot ?? game.pot;
  const players = overridePlayers ?? liveShowdownPlayers(game);
  const evaluations = new Map<string, HandEvaluation>();
  const community = boardCards(game);

  if (!overridePlayers) {
    assertPotMatchesContributions(game);
  }

  if (players.length === 0) {
    return {
      highWinners: [],
      lowWinners: [],
      highPotShare: 0,
      lowPotShare: 0,
      evaluations,
      uncontested: false,
    };
  }

  if (players.length === 1) {
    const only = players[0];
    let evaluation: HandEvaluation;
    try {
      evaluation = evaluatePlayerHigh(only, community);
    } catch {
      evaluation = {
        rank: 'high_card',
        score: 0,
        cards: [],
        description: 'Hand not shown',
      };
    }
    evaluations.set(only.user_id, evaluation);
    return {
      highWinners: [only],
      lowWinners: [only],
      highPotShare: totalPot,
      lowPotShare: 0,
      evaluations,
      uncontested: true,
    };
  }

  for (const p of players) {
    evaluations.set(p.user_id, evaluatePlayerHigh(p, community));
  }

  const highEligible = players.filter((p) => {
    const ev = evaluations.get(p.user_id)!;
    return canWinHighPrize(ev);
  });

  let highWinners = pickBestByScore(highEligible, (p) => evaluations.get(p.user_id)!.score);
  const lowWinners = pickLowestPips(players);

  if (highWinners.length === 0) {
    highWinners = lowWinners;
  }

  // Per house rules: odd chip (if any) goes to the high half.
  // Within a high-half tie, extras go to "worst position" (we use reverse seat order).
  const highPotShare = Math.ceil(totalPot / 2);
  const lowPotShare = totalPot - highPotShare;

  return {
    highWinners: bySeat(highWinners),
    lowWinners: bySeat(lowWinners),
    highPotShare,
    lowPotShare,
    evaluations,
    uncontested: false,
  };
}

/**
 * Split a share among winners; leftover cents assigned in the *order of the winners array*
 * (first player in the passed list receives the first extra cent, etc.).
 * Callers control priority:
 *  - For high half: pass byReverseSeat(...) so "worst position" (higher seat) gets extras.
 *  - For low half: pass bySeat(...) (earliest seat).
 */
export function splitShare(
  shareCents: number,
  winners: Player[]
): Map<string, number> {
  const out = new Map<string, number>();
  if (shareCents <= 0 || winners.length === 0) return out;

  const base = Math.floor(shareCents / winners.length);
  let remainder = shareCents - base * winners.length;

  for (const w of winners) {
    let amount = base;
    if (remainder > 0) {
      amount += 1;
      remainder -= 1;
    }
    out.set(w.user_id, (out.get(w.user_id) ?? 0) + amount);
  }
  return out;
}

export function buildPayouts(resolution: ShowdownResolution): Map<string, number> {
  const totals = new Map<string, number>();

  const merge = (partial: Map<string, number>) => {
    for (const [id, cents] of partial) {
      totals.set(id, (totals.get(id) ?? 0) + cents);
    }
  };

  // High: reverse seat for remainder priority (worst position first per rules)
  merge(splitShare(resolution.highPotShare, byReverseSeat(resolution.highWinners)));
  merge(splitShare(resolution.lowPotShare, bySeat(resolution.lowWinners)));

  return totals;
}

export function assertPayoutsCoverPot(
  game: GameState,
  payouts: Map<string, number>
): void {
  const paid = [...payouts.values()].reduce((s, n) => s + n, 0);
  if (paid !== game.pot) {
    throw new GameApiError(
      GameErrorCode.INVALID_STATE,
      `Payout total (${paid}) does not match pot (${game.pot}).`,
      500
    );
  }
}

export function buildShowdownSummary(
  resolution: ShowdownResolution
): ShowdownSummary {
  // Use same remainder priority as buildPayouts for consistency in summary amounts
  const highPer = splitShare(resolution.highPotShare, byReverseSeat(resolution.highWinners));
  const lowPer = splitShare(resolution.lowPotShare, bySeat(resolution.lowWinners));

  return {
    high_winners: resolution.highWinners.map((p) => ({
      seat: p.seat,
      display_name: p.display_name,
      amount_cents: highPer.get(p.user_id) ?? 0,
      hand_description:
        resolution.evaluations.get(p.user_id)?.description ?? 'No high hand',
    })),
    low_winners: resolution.lowWinners.map((p) => ({
      seat: p.seat,
      display_name: p.display_name,
      amount_cents: lowPer.get(p.user_id) ?? 0,
      pips: p.current_pip_total,
    })),
  };
}

/** Preflight before awarding — surfaces invalid board cards early. */
export function assertShowdownReady(game: GameState): void {
  assertPotMatchesContributions(game);
  for (const c of game.board.top) {
    if (c !== null && !isValidCard(c)) {
      throw new GameApiError(
        GameErrorCode.INVALID_STATE,
        `Invalid card on board: ${String(c)}`,
        500
      );
    }
  }
}