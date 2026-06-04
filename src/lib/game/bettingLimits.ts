import type { GameState, Player } from '@/types/game';

export interface WagerBounds {
  /** Amount needed to call (cents). */
  toCall: number;
  /** Minimum total wager this street (cents) for bet or raise. */
  minWagerTo: number;
  /** Pot-limit cap on total wager this street (cents), including all-in. */
  maxWagerTo: number;
  pot: number;
}

/** Minimum amount the table wager must increase by for a legal raise. */
export function getMinRaiseIncrement(game: GameState): number {
  const big = game.blinds?.big ?? 50;
  const stored = game.min_raise ?? 0;
  return stored > 0 ? stored : big;
}

export function getToCall(game: GameState, player: Player): number {
  return Math.max(0, (game.current_wager ?? 0) - player.bet_this_street);
}

/** Pot-limit max total wager for this street (raise/bet *to* amount). */
export function getPotLimitMaxWager(game: GameState, player: Player): number {
  const pot = game.pot ?? 0;
  const currentWager = game.current_wager ?? 0;
  const toCall = getToCall(game, player);
  const potLimitTo = currentWager + pot + toCall;
  const allInTo = player.bet_this_street + player.stack;
  return Math.min(potLimitTo, allInTo);
}

export function getWagerBounds(
  game: GameState,
  seat: number,
  action: 'bet' | 'raise'
): WagerBounds {
  const player = game.players.find((p) => p.seat === seat);
  if (!player) throw new Error('Player not found');

  const toCall = getToCall(game, player);
  const maxWagerTo = getPotLimitMaxWager(game, player);
  const currentWager = game.current_wager ?? 0;
  const minIncrement = getMinRaiseIncrement(game);
  const big = game.blinds?.big ?? 50;

  let minWagerTo: number;
  if (action === 'bet') {
    if (toCall > 0) throw new Error('Cannot bet — facing a wager');
    if (currentWager === 0) {
      minWagerTo = big;
    } else {
      minWagerTo = currentWager + minIncrement;
    }
  } else {
    if (toCall <= 0 && currentWager <= 0) {
      throw new Error('Cannot raise — open with a bet');
    }
    minWagerTo = currentWager + minIncrement;
  }

  if (minWagerTo > maxWagerTo) {
    minWagerTo = maxWagerTo;
  }

  return {
    toCall,
    minWagerTo,
    maxWagerTo,
    pot: game.pot ?? 0,
  };
}

export function validateWagerTo(
  game: GameState,
  seat: number,
  action: 'bet' | 'raise',
  wagerTo: number
): number {
  const bounds = getWagerBounds(game, seat, action);
  if (!Number.isFinite(wagerTo) || wagerTo <= 0) {
    throw new Error('Enter a valid bet amount');
  }
  const rounded = Math.round(wagerTo);
  if (rounded < bounds.minWagerTo) {
    throw new Error(
      `Minimum ${action} is ${(bounds.minWagerTo / 100).toFixed(2)} (total wager this street)`
    );
  }
  if (rounded > bounds.maxWagerTo) {
    throw new Error(
      `Pot limit: maximum ${action} is ${(bounds.maxWagerTo / 100).toFixed(2)} (total wager this street)`
    );
  }
  return rounded;
}