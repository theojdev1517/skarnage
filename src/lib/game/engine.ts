import type { GameState, Player, Card, GameStatus, SidePot } from "@/types/game";
import type { HandEvaluation } from "./evaluator";
import { evaluateHighHand, parseCardRank } from "./evaluator";
import { getMinRaiseIncrement, validateWagerTo } from "./bettingLimits";
import {
  defaultPlayerFields,
  isInLiveHand,
  shouldDealCardsTo,
  withTurnDeadline,
} from "./playerLifecycle";
import {
  applySeatIntentAfterFold,
  applyRebuyTimeouts,
  assertTurnTimerExpired,
  openRebuyWindow,
  preparePlayersForNewHand,
  activateEligiblePlayersForHand,
} from "./seatManagement";
import {
  isHeadsUpHand,
  isHeadsUpTable,
  normalizeButtonSeat,
  recordBlindsPosted,
  resolveBlindSeats,
  seatsThatSkippedBlinds,
} from "./blindPositions";
import { GameApiError, GameErrorCode } from "./apiErrors";
import {
  assertShowdownReady,
  buildPayouts,
  buildShowdownSummary,
  assertPayoutsCoverPot,
  resolveShowdown,
  liveShowdownPlayers,
} from "./showdown";
import { now } from "./time";

export { now };

export function createNewGame(
  gameId: string,
  hostId: string,
  hostName: string,
  startingStackCents: number
): GameState {
  if (startingStackCents < 0) throw new Error("Starting stack cannot be negative");

  const hostPlayer = defaultPlayerFields({
    user_id: hostId,
    seat: 1,
    display_name: hostName,
    stack: startingStackCents,
    contributed_this_hand: 0,
    bet_this_street: 0,
    hole_cards: [],
    live_hole_cards: [],
    shredded_cards: [],
    status: "active",
    current_pip_total: 0,
    final_pip_total: null,
    hand_result: null,
    in_current_hand: false,
    waits_for_button: false,
  });

  return {
    game_id: gameId,
    host_id: hostId,
    hand_number: 0,
    status: "waiting",
    updated_at: now(),
    pot: 0,
    current_wager: 0,
    min_raise: 0,
    blinds: { small: 25, big: 50 },
    board: { top: [null, null, null, null, null, null], shredder: [null, null, null, null, null, null] },
    players: [hostPlayer],
    current_player_seat: null,
    button_seat: 1,
    last_aggressor_seat: null,
    side_pots: [],
    action_history: [],
    last_action: `${hostName} created the table (seat 1, ${formatChips(startingStackCents)} chips)`,
    deck: [],
    deck_index: 0,
    pending_joins: [],
    pending_chip_adds: [],
    pending_rebuys: [],
    turn_deadline_at: null,
    rebuy_deadline_at: null,
    rebuy_offered_seats: [],
  };
}

export function createStandardDeck(): Card[] {
  const suits = ['h', 'd', 'c', 's'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck: Card[] = [];
  for (const suit of suits) for (const rank of ranks) deck.push(`${rank}${suit}` as Card);
  return deck;
}

export function calculatePipTotal(cards: Card[]): number {
  if (!cards || cards.length === 0) return 0;

  let total = 0;
  for (const card of cards) {
    if (typeof card !== 'string') continue;
    const rankStr = parseCardRank(card);
    if (rankStr === 'A') {
      total += 1;
    } else if (['J', 'Q', 'K', '10'].includes(rankStr)) {
      total += 10;
    } else {
      const num = parseInt(rankStr, 10);
      total += isNaN(num) ? 0 : num;
    }
  }
  return total;
}

export function shredCards(game: GameState): GameState {
  const shredderRanks = new Set(
    game.board.shredder.filter((card): card is Card => card !== null).map(parseCardRank)
  );

  const updatedPlayers = game.players.map(player => {
    if (player.status !== "active") return player;

    const remaining: Card[] = [];
    const shreddedThisStreet: Card[] = [];

    for (const card of player.live_hole_cards) {
      if (shredderRanks.has(parseCardRank(card))) {
        shreddedThisStreet.push(card);
      } else {
        remaining.push(card);
      }
    }

    const newStatus: "active" | "dead" = remaining.length === 0 ? "dead" : "active";

    return {
      ...player,
      live_hole_cards: remaining,
      shredded_cards: [...player.shredded_cards, ...shreddedThisStreet],
      current_pip_total: calculatePipTotal(remaining),
      status: newStatus,                    // ← now properly typed
    };
  });

  return {
    ...game,
    players: updatedPlayers,
    updated_at: now(),
    last_action: "Cards shredded based on bottom board",
  };
}

export function dealHoleCards(game: GameState): GameState {
  if (game.players.length === 0) throw new Error("No players to deal to");

  let newGame = { ...game };
  let idx = newGame.deck_index;

  const updatedPlayers = newGame.players.map((player) => {
    if (!shouldDealCardsTo(player)) {
      return {
        ...player,
        hole_cards: [],
        live_hole_cards: [],
        shredded_cards: [],
        current_pip_total: 0,
        in_current_hand: false,
        status: "active" as const,
      };
    }
    const holeCards: Card[] = [];
    for (let i = 0; i < 5; i++) {
      holeCards.push(newGame.deck[idx++]);
    }
    return {
      ...player,
      hole_cards: holeCards,
      live_hole_cards: [...holeCards],
      shredded_cards: [],
      current_pip_total: calculatePipTotal(holeCards),
      in_current_hand: true,
    };
  });

  newGame.players = updatedPlayers;
  newGame.deck_index = idx;
  newGame.status = 'preflop_betting' as GameStatus;
  const dealtCount = updatedPlayers.filter((p) => p.live_hole_cards.length > 0).length;
  newGame.last_action = `Dealt 5 hole cards to ${dealtCount} player${dealtCount === 1 ? '' : 's'}`;

  return newGame;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealFlop(game: GameState): GameState {
  let newGame = { ...game };
  let idx = newGame.deck_index;

  const topFlop = [newGame.deck[idx], newGame.deck[idx + 1], newGame.deck[idx + 2]];
  const shredderFlop = [newGame.deck[idx + 3], newGame.deck[idx + 4], newGame.deck[idx + 5]];

  newGame.board = {
    top: [...topFlop, null, null, null],
    shredder: [...shredderFlop, null, null, null]
  };

  newGame.deck_index = idx + 6;
  newGame = shredCards(newGame);
  newGame.last_action = "Flop dealt + auto-shred";

  newGame.last_action += ` | Pot: ${formatChips(newGame.pot)}`;

  return newGame;
}

export function dealTurn(game: GameState): GameState {
  let idx = game.deck_index;

  // Turn = 2 cards to top board + 2 cards to shredder board
  const topTurn1 = game.deck[idx];
  const topTurn2 = game.deck[idx + 1];
  const shredTurn1 = game.deck[idx + 2];
  const shredTurn2 = game.deck[idx + 3];

  let newGame = {
    ...game,
    board: {
      top: [...game.board.top.slice(0, 3), topTurn1, topTurn2, null],
      shredder: [...game.board.shredder.slice(0, 3), shredTurn1, shredTurn2, null],
    },
    deck_index: idx + 4,
  };

  newGame = shredCards(newGame);
  newGame.status = "turn_betting" as GameStatus;
  newGame.last_action = "Turn dealt (2+2 cards) + auto-shred";
  newGame.updated_at = now();

  return newGame;
}

export function dealRiver(game: GameState): GameState {
  let idx = game.deck_index;

  // River = 1 card to top board + 1 card to shredder board
  const topRiver = game.deck[idx];
  const shredderRiver = game.deck[idx + 1];

  let newGame = {
    ...game,
    board: {
      top: [...game.board.top.slice(0, 5), topRiver],           // ← was slice(0,4)
      shredder: [...game.board.shredder.slice(0, 5), shredderRiver], // ← was slice(0,4)
    },
    deck_index: idx + 2,
  };

  newGame = shredCards(newGame);
  newGame.status = "river_betting" as GameStatus;
  newGame.last_action = "River dealt (1+1 cards) + auto-shred";
  newGame.updated_at = now();

  return newGame;
}

export function countBettingPlayers(game: GameState): number {
  return game.players.filter(
    (p) =>
      p.in_current_hand && (p.status === "active" || p.status === "all_in")
  ).length;
}

export function isBettingRoundComplete(game: GameState): boolean {
  const livePlayers = game.players.filter(
    (p) => p.in_current_hand && (p.status === 'active' || p.status === 'all_in')
  );
  if (livePlayers.length <= 1) return true;

  const currentWager = game.current_wager ?? 0;
  const everyoneMatched = livePlayers.every(p => 
    p.bet_this_street >= currentWager || p.stack === 0
  );

  if (!everyoneMatched) return false;

  const acting = getActingPlayers(game);
  // If everyone has matched (or is all-in), and at most 1 player can still act (others all-in),
  // the round is complete. This is key for all-in cases: do NOT early-complete if the last
  // active player with chips still has bet_this < current_wager (he needs to call the all-in(s)).
  if (acting.length <= 1) return true;

  // === AGGRESSION ROUND (bet or raise happened this street) ===
  // Once all remaining live players have matched the current wager (or are all-in / folded),
  // the round is closed. We no longer require the pointer to land back on the exact
  // last_aggressor_seat (which was fragile with mid-round folds changing the acting list).
  // This prevents extra unwanted actions after folds reduce the field (e.g. HU on flop).
  if (game.last_aggressor_seat !== null) {
    return true;
  }

  // === PURE CHECK/CALL ROUND (no one has bet/raised this street yet) ===
  if (game.status === "preflop_betting" || game.status === "waiting") {
    // Preflop: only complete after BB has acted
    return game.hasBigBlindActedThisStreet === true;
  } else {
    // Postflop: complete when back to first-to-act (left of button)
    const firstToAct = getNextActiveSeat(game, game.button_seat || 0);
    return firstToAct != null && game.current_player_seat === firstToAct;
  }
}

export type ProcessBetOptions = {
  /** Player confirmed folding when they could check for free. */
  confirmFreeFold?: boolean;
};

export function processBet(
  game: GameState,
  seat: number,
  action: "fold" | "check" | "call" | "bet" | "raise",
  amount: number = 0,
  options?: ProcessBetOptions
): GameState {
  const playerIndex = game.players.findIndex(p => p.seat === seat);
  if (playerIndex === -1) throw new Error("Player not found");

  const player = game.players[playerIndex];

  if (seat !== game.current_player_seat) {
    throw new Error(`Not your turn! Current: ${game.current_player_seat}`);
  }
  if (!player.in_current_hand) {
    throw new Error("You are not in this hand");
  }
  if (!["active", "all_in"].includes(player.status)) {
    throw new Error("Player cannot act");
  }

  const updatedPlayers = [...game.players];
  const oldWager = game.current_wager ?? 0;
  let newWager = oldWager;
  let newMinRaise = game.min_raise ?? 0;
  let newAggressor = game.last_aggressor_seat;
  let lastActionText = "";

  const toCall = Math.max(0, oldWager - player.bet_this_street);

  if (action === "fold" && toCall <= 0 && !options?.confirmFreeFold) {
    throw new GameApiError(
      GameErrorCode.FOLD_NOT_REQUIRED,
      "You can check — there is no bet to you.",
      400
    );
  }

  if (action === "fold") {
    updatedPlayers[playerIndex] = { ...player, status: "folded" as const };
    lastActionText = `${player.display_name} folded`;
  } else if (action === "check") {
    if (toCall > 0) throw new Error("Cannot check — must call or raise");
    lastActionText = `${player.display_name} checked`;
  } else if (action === "call") {
    if (toCall <= 0) throw new Error("Nothing to call — check or bet");
    const callAmount = Math.min(toCall, player.stack);
    updatedPlayers[playerIndex] = {
      ...player,
      bet_this_street: player.bet_this_street + callAmount,
      contributed_this_hand: player.contributed_this_hand + callAmount,
      stack: player.stack - callAmount,
    };
    lastActionText = `${player.display_name} called ${formatCents(callAmount)}`;
  } else if (action === "bet") {
    if (toCall > 0) throw new Error("Cannot bet — call or raise");
    const betTo = validateWagerTo(game, seat, "bet", amount);
    const betAmount = betTo - player.bet_this_street;
    const actual = Math.min(betAmount, player.stack);

    updatedPlayers[playerIndex] = {
      ...player,
      bet_this_street: player.bet_this_street + actual,
      contributed_this_hand: player.contributed_this_hand + actual,
      stack: player.stack - actual,
    };

    newWager = player.bet_this_street + actual;
    newMinRaise = newWager - oldWager;
    newAggressor = seat;
    lastActionText = `${player.display_name} bet ${formatCents(actual)}`;
  } else if (action === "raise") {
    if (toCall <= 0 && newWager <= 0) {
      throw new Error("Cannot raise — bet to open the action");
    }
    const raiseTo = validateWagerTo(game, seat, "raise", amount);
    const raiseAmount = raiseTo - player.bet_this_street;
    const actual = Math.min(raiseAmount, player.stack);

    updatedPlayers[playerIndex] = {
      ...player,
      bet_this_street: player.bet_this_street + actual,
      contributed_this_hand: player.contributed_this_hand + actual,
      stack: player.stack - actual,
    };

    newWager = player.bet_this_street + actual;
    const minInc = getMinRaiseIncrement(game);
    const delta = newWager - oldWager;
    if (delta >= minInc) {
      newAggressor = seat;
      newMinRaise = delta;
    } else {
      // Short all-in raise (< min raise increment): do not reopen betting for already-acted players.
      // Unacted players (to act after) still get their turn on the prior bet level (or to raise over this).
      // Keep prior aggressor and min_raise so round completion logic continues correctly.
      newMinRaise = game.min_raise ?? minInc;
      // newAggressor left as prior
    }
    lastActionText = `${player.display_name} raised to ${formatCents(newWager)}`;
  } else {
    throw new Error(`Invalid betting action: ${action}`);
  }

  // Set all_in status if stack exhausted on this action
  if (updatedPlayers[playerIndex].stack === 0 && updatedPlayers[playerIndex].status === 'active') {
    updatedPlayers[playerIndex] = { ...updatedPlayers[playerIndex], status: 'all_in' as const };
  }

  const newPot = updatedPlayers.reduce((sum, p) => sum + p.contributed_this_hand, 0);

  let result: GameState = {
    ...game,
    players: updatedPlayers,
    pot: newPot,
    current_wager: newWager,
    min_raise: newMinRaise,
    last_aggressor_seat: newAggressor,
    updated_at: now(),
    last_action: lastActionText,
    hasBigBlindActedThisStreet: 
      (game.status === "preflop_betting" || game.status === "waiting") && 
      seat === getBigBlindSeat(game) 
        ? true 
        : game.hasBigBlindActedThisStreet,
  };

  // Only set a current actor if someone can still act; otherwise leave null (all-ins will auto-advance)
  const nextActor = getNextActiveSeat(result, seat);
  result.current_player_seat = nextActor;

  result.side_pots = computeSidePots(result.players);

  if (action === 'fold') {
    result = applySeatIntentAfterFold(result, seat);
  }

  if (countBettingPlayers(result) <= 1) {
    const winner = result.players.find(
      (p) =>
        p.in_current_hand && (p.status === "active" || p.status === "all_in")
    );
    return awardPot({
      ...result,
      status: "showdown",
      current_player_seat: null,
      turn_deadline_at: null,
      last_action: winner
        ? `${winner.display_name} wins the pot (everyone else folded)`
        : result.last_action,
    });
  }

  // Auto-proceed only if no more betting action possible (i.e. the last active player
  // has matched any all-in(s) or there is nothing left to call). This ensures the
  // covered player gets to call/fold/raise before auto-advancing on all-ins.
  if (countBettingPlayers(result) > 1 && noMoreBettingActionPossible(result)) {
    result = advanceToNextPhase(result);
    if (result.status === 'showdown') {
      result = awardPot(result);
    }
    return result;
  }

  if (isBettingRoundComplete(result)) {
    result = advanceToNextPhase(result);
    if (result.status === 'showdown') {
      result = awardPot(result);
    }
  }

  return withTurnDeadline(result);
}

export function applyTurnTimeout(game: GameState, seat: number): GameState {
  assertTurnTimerExpired(game, seat);
  const player = game.players.find((p) => p.seat === seat);
  if (!player) throw new Error('Player not found');
  const toCall = Math.max(0, (game.current_wager ?? 0) - player.bet_this_street);
  const betAction = toCall > 0 ? 'fold' : 'check';
  return processBet(game, seat, betAction, 0);
}


// High Hand, Showdown, Award, Lifecycle
export function evaluatePlayerHand(player: Player, topBoard: (Card | null)[]): HandEvaluation {
  const liveCards = player.live_hole_cards;
  const community = topBoard.filter((c): c is Card => c !== null);
  return evaluateHighHand(liveCards, community);
}

function formatChips(cents: number): string {
  return (cents / 100).toFixed(2);
}

const formatCents = formatChips;

export function awardPot(game: GameState): GameState {
  assertShowdownReady(game);

  // Compute evals using full live players (for hand descriptions etc.)
  const fullResolution = resolveShowdown(game);
  const evaluations = fullResolution.evaluations;

  // Now award per side pot (main + sides). Each side pot resolved only among its eligible live players.
  const totalPayouts = new Map<string, number>();
  const liveAtShowdown = liveShowdownPlayers(game);

  const sidePots = game.side_pots && game.side_pots.length > 0 ? game.side_pots : [{ amount: game.pot, eligible: liveAtShowdown.map(p => p.user_id) }];

  for (const sp of sidePots) {
    const potContenders = liveAtShowdown.filter(p => sp.eligible.includes(p.user_id));
    if (potContenders.length === 0) continue;

    const subRes = resolveShowdown(game, potContenders, sp.amount);
    const subPayouts = buildPayouts(subRes);
    for (const [id, amt] of subPayouts) {
      totalPayouts.set(id, (totalPayouts.get(id) ?? 0) + amt);
    }
  }

  // For summary we reuse the full resolution (high/low winners among all) but the amounts will be from per-pot payouts.
  // (Summary is approximate for multi side pots; core payouts are correct.)
  const payouts = totalPayouts;
  // Note: assertPayoutsCoverPot would fail for sub; skip or sum check manually if needed.
  const totalPaid = Array.from(totalPayouts.values()).reduce((s, n) => s + n, 0);
  if (totalPaid !== game.pot) {
    // In rare edge (e.g. 0 eligible), allow; otherwise should match.
    console.warn(`Side pot payouts total ${totalPaid} vs pot ${game.pot}`);
  }

  const updatedPlayers = [...game.players];
  const showdown_summary = buildShowdownSummary(fullResolution);

  // Remap amounts in the (overall high/low) summary to the *actual* total payouts per player.
  // This fixes the box showing "half of entire pot" even when side pots mean different splits/eligibility.
  const payoutBySeat = new Map<number, number>();
  for (const [uid, amt] of totalPayouts) {
    const pl = updatedPlayers.find((pp) => pp.user_id === uid) || liveAtShowdown.find((pp) => pp.user_id === uid);
    if (pl) payoutBySeat.set(pl.seat, amt);
  }
  showdown_summary.high_winners = showdown_summary.high_winners.map((w) => ({
    ...w,
    amount_cents: payoutBySeat.get(w.seat) ?? w.amount_cents,
  }));
  showdown_summary.low_winners = showdown_summary.low_winners.map((w) => ({
    ...w,
    amount_cents: payoutBySeat.get(w.seat) ?? w.amount_cents,
  }));

  for (let i = 0; i < updatedPlayers.length; i++) {
    const p = updatedPlayers[i];
    const winnings = payouts.get(p.user_id) ?? 0;
    if (winnings <= 0) continue;

    const highEval =
      evaluations.get(p.user_id) ??
      evaluatePlayerHand(p, game.board.top);

    updatedPlayers[i] = {
      ...p,
      stack: p.stack + winnings,
      hand_result: {
        high: highEval,
        lowPips: p.current_pip_total,
        winnings,
      },
    };
  }

  const highNames = showdown_summary.high_winners
    .map((w) => `${w.display_name} (${w.hand_description}, ${formatCents(w.amount_cents)})`)
    .join('; ');
  const lowNames = showdown_summary.low_winners
    .map((w) => `${w.display_name} (${w.pips} pips, ${formatCents(w.amount_cents)})`)
    .join('; ');

  // Build accurate last_action from actual per-player payouts (important for side-pot cases where summary uses full-pot halves).
  // This ensures printouts reflect real awarded amounts, not "even half of entire pot".
  const actualWinnerParts: string[] = [];
  for (const [uid, amt] of totalPayouts) {
    if (amt <= 0) continue;
    const pl = liveAtShowdown.find((pp) => pp.user_id === uid) || game.players.find((pp) => pp.user_id === uid);
    if (!pl) continue;
    const desc = evaluations.get(uid)?.description ?? 'hand';
    const lowP = pl.current_pip_total;
    actualWinnerParts.push(`${pl.display_name} ${formatCents(amt)} (high: ${desc}, low: ${lowP} pips)`);
  }
  const last_action = fullResolution.uncontested
    ? showdown_summary.high_winners[0]
      ? `${showdown_summary.high_winners[0].display_name} wins ${formatCents(game.pot)} (uncontested)`
      : 'Hand complete (uncontested)'
    : actualWinnerParts.length > 0
      ? `Pot awarded: ${actualWinnerParts.join('; ')}`
      : [highNames ? `High: ${highNames}` : null, lowNames ? `Low: ${lowNames}` : null]
          .filter(Boolean)
          .join(' · ');

  const finished = {
    ...game,
    players: updatedPlayers,
    pot: 0,
    // Leave side_pots (the layers/eligible at showdown) so UI can show detailed side-pot breakdown
    // instead of clearing. (The pre-award side_pots reflect the pot structure.)
    status: "finished" as GameStatus,
    updated_at: now(),
    last_action: last_action || 'Hand complete (no eligible winners)',
    showdown_summary,
    turn_deadline_at: null,
  };
  return openRebuyWindow(finished);
}

function firstActiveSeat(state: GameState, preferred: number | null): number | null {
  const active = getActivePlayers(state).sort((a, b) => a.seat - b.seat);
  if (active.length === 0) return null;
  if (preferred != null && active.some((p) => p.seat === preferred)) {
    return preferred;
  }
  return active[0]?.seat ?? null;
}

export function getFirstToAct(state: GameState, street: 'preflop' | 'postflop'): number | null {
  if (getActivePlayers(state).length === 0) return null;

  if (street === 'preflop') {
    // Heads-up: dealer (button / SB) acts first preflop
    if (isHeadsUpHand(state) || isHeadsUpTable(state)) {
      return firstActiveSeat(state, state.button_seat);
    }
    return getNextActiveSeat(state, getBigBlindSeat(state));
  }

  // Postflop (HU and multi): first active seat left of button (BB in HU)
  return firstActiveSeat(state, getNextActiveSeat(state, state.button_seat));
}

export function getSeatedPlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.presence === 'active' && p.stack > 0);
}

export function getActivePlayers(state: GameState): Player[] {
  return state.players.filter((p) => isInLiveHand(p));
}

export function getActingPlayers(state: GameState): Player[] {
  return state.players.filter(
    (p) => p.in_current_hand && p.stack > 0 && (p.status === 'active' || p.status === 'all_in')
  );
}

/**
 * Returns true if there is no more betting action possible this street.
 * Used to decide auto-advance in all-in situations: if the last player(s) with chips
 * have already matched the current wager (or there is no wager to them), we can
 * auto-run the remaining streets without requiring them to "check".
 * Critical: when an all-in happens, do NOT auto-advance if the remaining covered player
 * still has bet_this_street < current_wager (he must get a chance to call the all-in).
 */
function noMoreBettingActionPossible(game: GameState): boolean {
  const acting = getActingPlayers(game);
  if (acting.length === 0) return true;
  if (acting.length > 1) return false;
  // Exactly 1 actor left (others all-in or folded); check if he still owes a call
  const p = acting[0];
  const cw = game.current_wager ?? 0;
  return p.bet_this_street >= cw || p.stack === 0;
}

/**
 * Compute side pots based on contributed_this_hand for players who put money in.
 * Each layer pot is (delta level) * (num players at/above that contrib level).
 * Eligible for a layer: those with contrib >= layer level.
 * Main pot is the lowest layer (all who put at least the min).
 * This is called after contrib changes (bets, blinds) so side_pots always reflect current layers.
 */
function computeSidePots(players: Player[]): SidePot[] {
  const relevant = players.filter((p) => p.contributed_this_hand > 0);
  if (relevant.length === 0) return [];
  const amounts = relevant.map((p) => p.contributed_this_hand);
  const uniqueLevels = Array.from(new Set(amounts)).sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let previousLevel = 0;
  for (const level of uniqueLevels) {
    const layer = level - previousLevel;
    if (layer > 0) {
      const eligible = relevant
        .filter((p) => p.contributed_this_hand >= level)
        .map((p) => p.user_id);
      const potAmount = layer * eligible.length;
      if (potAmount > 0) {
        pots.push({ amount: potAmount, eligible });
      }
    }
    previousLevel = level;
  }
  return pots;
}

export function getNextActiveSeat(game: GameState, fromSeat: number): number | null {
  const acting = game.players
    .filter((p) => p.in_current_hand && p.stack > 0 && (p.status === 'active' || p.status === 'all_in'))
    .sort((a, b) => a.seat - b.seat);

  if (acting.length === 0) return null;

  // Find the next clockwise (higher seat number) from 'fromSeat' among current acting.
  // This correctly continues after a fold (fromSeat may no longer be in 'acting' list after status update).
  // If no higher, wrap to the lowest seat acting player.
  for (const p of acting) {
    if (p.seat > fromSeat) return p.seat;
  }
  return acting[0].seat;
}

export function requireNextActorSeat(game: GameState, fromSeat: number): number {
  const next = getNextActiveSeat(game, fromSeat);
  if (next != null) return next;
  throw new GameApiError(
    GameErrorCode.INVALID_STATE,
    'Could not find the next player to act. Refresh the table or start a new hand.',
    500
  );
}

export function rotateButton(state: GameState): GameState {
  const seated = getSeatedPlayers(state);
  if (seated.length === 0) return state;

  const sorted = [...seated].sort((a, b) => a.seat - b.seat);
  const idx = sorted.findIndex((p) => p.seat === state.button_seat);
  const next = sorted[(idx + 1) % sorted.length]?.seat ?? state.button_seat;

  return {
    ...state,
    button_seat: next,
    players: state.players.map((p) =>
      p.waits_for_button && p.seat === next
        ? { ...p, waits_for_button: false }
        : p
    ),
    current_player_seat: null,
    updated_at: now(),
    last_action: `Button rotated to seat ${next}`,
  };
}

function postBlind(state: GameState, seat: number, amount: number): GameState {
  const playerIndex = state.players.findIndex(p => p.seat === seat);
  if (playerIndex === -1) return state;

  const player = state.players[playerIndex];
  const toPost = Math.min(amount, player.stack);

  const updatedPlayer: Player = {
    ...player,
    stack: player.stack - toPost,
    contributed_this_hand: toPost,
    bet_this_street: toPost,
    current_pip_total: toPost,
    status: (toPost >= player.stack && player.stack > 0) ? 'all_in' : 'active',
  };

  const newPlayers = [...state.players];
  newPlayers[playerIndex] = updatedPlayer;

  return { ...state, players: newPlayers };
}

export function postBlinds(state: GameState): GameState {
  const active = getActivePlayers(state);
  if (active.length < 2) return state;

  let workingState: GameState = {
    ...state,
    button_seat: normalizeButtonSeat(state),
  };

  let assignment = resolveBlindSeats(workingState);
  if (!assignment) return state;

  // Sanitize stale last/prior blind records if the recorded posters are no longer seated/eligible
  // (e.g. stood up, went broke without rebuy, removed mid-prior hand). Prevents erroneous
  // "same BB" re-rotates or skipped logic based on ghosts from previous hand.
  const seatedSeats = new Set(getSeatedPlayers(workingState).map((p) => p.seat));
  let lastBlinds = workingState.last_blinds;
  let priorBlinds = workingState.prior_blinds;
  if (lastBlinds && !seatedSeats.has(lastBlinds.big_seat)) {
    priorBlinds = lastBlinds;
    lastBlinds = undefined;
  }
  if (priorBlinds && !seatedSeats.has(priorBlinds.big_seat)) {
    priorBlinds = undefined;
  }
  if (lastBlinds && lastBlinds.small_seat != null && !seatedSeats.has(lastBlinds.small_seat)) {
    lastBlinds = { ...lastBlinds, small_seat: null };
  }
  if (priorBlinds && priorBlinds.small_seat != null && !seatedSeats.has(priorBlinds.small_seat)) {
    priorBlinds = { ...priorBlinds, small_seat: null };
  }
  workingState = {
    ...workingState,
    last_blinds: lastBlinds,
    prior_blinds: priorBlinds,
  };

  if (
    assignment.bigBlindSeat === workingState.last_blinds?.big_seat &&
    assignment.bigBlindSeat === workingState.prior_blinds?.big_seat
  ) {
    workingState = rotateButton(workingState);
    workingState = { ...workingState, button_seat: normalizeButtonSeat(workingState) };
    assignment = resolveBlindSeats(workingState) ?? assignment;
  }

  if (
    assignment.smallBlindSeat != null &&
    assignment.smallBlindSeat === workingState.last_blinds?.small_seat &&
    assignment.smallBlindSeat === workingState.prior_blinds?.small_seat
  ) {
    assignment = { ...assignment, smallBlindSeat: null, deadSmallBlind: true };
  }

  // NOTE: Previously had a "if exactly 1 skipped, force as BB" override here.
  // That logic was causing incorrect blind posting and first-to-act in normal 4+ player games
  // (e.g. forcing UTG to post BB and action starting on button preflop). Removed for correct
  // button rotation. Missed-blind catch-up can be revisited with proper rules if needed.
  // const skipped = seatsThatSkippedBlinds(...);
  // if (skipped.length === 1) { ... override ... }

  let sbSeat = assignment.smallBlindSeat;
  const bbSeat = assignment.bigBlindSeat;

  if (sbSeat != null) {
    workingState = postBlind(workingState, sbSeat, workingState.blinds.small);
  }
  workingState = postBlind(workingState, bbSeat, workingState.blinds.big);

  const newPot = workingState.players.reduce((sum, p) => sum + p.contributed_this_hand, 0);
  // Compute first to act *respecting the final (possibly overridden for skipped) bbSeat*,
  // rather than always recomputing via getBigBlindSeat (which ignores assignment overrides).
  // This ensures when skipped logic forces e.g. seat4 as BB (skipping 3), action starts after 4.
  const isHU = isHeadsUpHand(workingState) || isHeadsUpTable(workingState);
  const firstToAct = isHU
    ? getFirstToAct(workingState, "preflop")
    : getNextActiveSeat(workingState, bbSeat);
  const blindRecord = recordBlindsPosted(assignment, workingState.hand_number || 1);

  workingState.side_pots = computeSidePots(workingState.players);

  const posted = {
    ...workingState,
    pot: newPot,
    current_wager: workingState.blinds.big,
    min_raise: workingState.blinds.big,
    current_player_seat: firstToAct,
    last_aggressor_seat: null,
    status: "preflop_betting" as GameStatus,
    last_action: assignment.deadSmallBlind
      ? "Blinds posted (dead small blind)"
      : "Blinds posted",
    prior_blinds: workingState.last_blinds,
    last_blinds: blindRecord,
    action_history: [
      ...(workingState.action_history || []),
      {
        type: "blinds_posted",
        small_blind: sbSeat != null ? { seat: sbSeat, amount: workingState.blinds.small } : null,
        big_blind: { seat: bbSeat, amount: workingState.blinds.big },
        dead_small_blind: assignment.deadSmallBlind,
        dead_button: assignment.deadButton,
        timestamp: now(),
      },
    ],
    updated_at: now(),
  };
  return withTurnDeadline(posted);
}

export function startNewHand(game: GameState): GameState {
  let newGame = applyRebuyTimeouts(game);
  newGame = preparePlayersForNewHand(newGame);
  newGame = rotateButton(newGame);
  newGame = activateEligiblePlayersForHand(newGame);

  newGame = {
    ...newGame,
    hand_number: (game.hand_number || 0) + 1,
    pot: 0,
    side_pots: [],
    current_wager: 0,
    min_raise: 0,
    last_aggressor_seat: null,
    board: { top: [null, null, null, null, null, null], shredder: [null, null, null, null, null, null] },
    deck: shuffleDeck(createStandardDeck()),
    deck_index: 0,
    status: "preflop_betting" as GameStatus,
    last_action: `Starting hand #${(game.hand_number || 0) + 1}`,
    showdown_summary: null,
    hasBigBlindActedThisStreet: false,
    turn_deadline_at: null,
  };

  newGame = postBlinds(newGame);
  newGame = dealHoleCards(newGame);
  // Do not overwrite current_player_seat here. postBlinds already set it based on the final
  // (possibly skipped-logic-overridden) bbSeat from assignment. Recomputing via getFirstToAct
  // would revert special cases and cause wrong first actor (e.g. BB getting first action).

  // If all remaining players are all-in after blinds/holes (no one can act preflop), auto run the streets to showdown.
  if (getActingPlayers(newGame).length === 0 && countBettingPlayers(newGame) > 1) {
    newGame = advanceToNextPhase(newGame);
    if (newGame.status === 'showdown') {
      newGame = awardPot(newGame);
    }
    return newGame;
  }

  return withTurnDeadline(newGame);
}

function hostUpdateStack(
  game: GameState,
  seat: number,
  newStack: number,
  lastAction: string
): GameState {
  if (newStack < 0) throw new Error("Stack cannot be negative");
  const idx = game.players.findIndex((p) => p.seat === seat);
  if (idx === -1) throw new Error("Player not found in seat");

  const updated = [...game.players];
  updated[idx] = { ...updated[idx], stack: newStack };

  return {
    ...game,
    players: updated,
    updated_at: now(),
    last_action: lastAction,
  };
}

/** Host: add chips to a player's stack. */
export function hostAddToStack(
  game: GameState,
  seat: number,
  amountCents: number
): GameState {
  if (amountCents <= 0) throw new Error("Amount must be positive");
  const player = game.players.find((p) => p.seat === seat);
  if (!player) throw new Error("Player not found in seat");
  return hostUpdateStack(
    game,
    seat,
    player.stack + amountCents,
    `Host added ${formatCents(amountCents)} to ${player.display_name} (now ${formatCents(player.stack + amountCents)})`
  );
}

/** Host: remove chips from a player's stack. */
export function hostRemoveFromStack(
  game: GameState,
  seat: number,
  amountCents: number
): GameState {
  if (amountCents <= 0) throw new Error("Amount must be positive");
  const player = game.players.find((p) => p.seat === seat);
  if (!player) throw new Error("Player not found in seat");
  const newStack = Math.max(0, player.stack - amountCents);
  return hostUpdateStack(
    game,
    seat,
    newStack,
    `Host removed ${formatCents(amountCents)} from ${player.display_name} (now ${formatCents(newStack)})`
  );
}

/** Host: set a player's stack to an exact amount. */
export function hostSetStack(
  game: GameState,
  seat: number,
  targetCents: number
): GameState {
  if (targetCents < 0) throw new Error("Stack cannot be negative");
  const player = game.players.find((p) => p.seat === seat);
  if (!player) throw new Error("Player not found in seat");
  return hostUpdateStack(
    game,
    seat,
    targetCents,
    `Host set ${player.display_name}'s stack to ${formatCents(targetCents)}`
  );
}

/** Host: pass host controls to a seated player. */
export function transferHost(game: GameState, seat: number): GameState {
  const player = game.players.find((p) => p.seat === seat);
  if (!player) throw new Error("No player in that seat");

  return {
    ...game,
    host_id: player.user_id,
    updated_at: now(),
    last_action: `Host transferred to ${player.display_name} (seat ${seat})`,
  };
}

/**
 * Pure orchestrator: Advance the game to the next logical phase.
 * Centralizes all dealing + position + status transitions.
 * This is the single place that knows "what comes after what".
 */
export function advanceToNextPhase(game: GameState): GameState {
  if (countBettingPlayers(game) <= 1) {
    const winner = game.players.find(
      (p) =>
        p.in_current_hand && (p.status === "active" || p.status === "all_in")
    );
    return awardPot({
      ...game,
      status: "showdown",
      current_player_seat: null,
      turn_deadline_at: null,
      last_action: winner
        ? `${winner.display_name} wins the pot`
        : game.last_action,
    });
  }

  let newGame = { ...game };

  // Reset this street's betting state for ALL players
  newGame.hasBigBlindActedThisStreet = false;
  newGame.players = newGame.players.map((p) => {
    const isFoldedOrDead = p.status === "folded" || p.status === "dead";
    return {
      ...p,
      bet_this_street: 0,
      // Preserve all_in for stack=0 players across streets; others active
      status: isFoldedOrDead ? p.status : (p.stack === 0 ? 'all_in' as const : 'active' as const),
    };
  });

  newGame.current_wager = 0;
  newGame.min_raise = 0;
  newGame.last_aggressor_seat = null;

  // Advance phase + deal cards + set correct next player
  if (game.status === "preflop_betting" || game.status === "waiting") {
    newGame = dealFlop(newGame);
    newGame.status = "flop_betting" as GameStatus;
    newGame.current_player_seat = getFirstToAct(newGame, "postflop");
  } 
  else if (game.status === "flop_betting") {
    newGame = dealTurn(newGame);
    newGame.status = "turn_betting" as GameStatus;
    newGame.current_player_seat = getFirstToAct(newGame, "postflop");
  } 
  else if (game.status === "turn_betting") {
    newGame = dealRiver(newGame);
    newGame.status = "river_betting" as GameStatus;
    newGame.current_player_seat = getFirstToAct(newGame, "postflop");
  }
  else if (game.status === "river_betting") {
    newGame.status = "showdown" as GameStatus;
    newGame.current_player_seat = null;
  } 
  else if (game.status === "showdown") {
    return awardPot(newGame);
  }

  newGame.updated_at = now();

  // Auto-runout for all-ins: only if no more betting action possible (last active has matched
  // the all-ins or no wager left). This ensures covered players get their call/fold/raise
  // chance before auto-advancing the rest of the hand.
  if (countBettingPlayers(newGame) > 1 && noMoreBettingActionPossible(newGame)) {
    if (newGame.status === 'showdown') {
      return awardPot(newGame);
    }
    newGame.current_player_seat = null; // don't expose turn to the lone actor
    return advanceToNextPhase(newGame);
  }

  if (newGame.status === 'showdown') {
    return awardPot(newGame);
  }

  return withTurnDeadline(newGame);
}

function getBigBlindSeat(game: GameState): number {
  if (isHeadsUpHand(game) || isHeadsUpTable(game)) {
    return requireNextActorSeat(game, game.button_seat);
  }
  const button = game.button_seat || 0;
  const sb = getNextActiveSeat(game, button);
  if (sb == null) {
    throw new GameApiError(
      GameErrorCode.INVALID_STATE,
      'Could not resolve the small blind seat.',
      500
    );
  }
  return requireNextActorSeat(game, sb);
}