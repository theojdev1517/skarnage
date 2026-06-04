// src/lib/game/engine.ts
import type { GameState, Player, Card, GameStatus, ShowdownSummary } from "@/types/game";
import type { HandEvaluation } from "./evaluator";
import { evaluateHighHand, parseCardRank } from "./evaluator";
import { validateWagerTo } from "./bettingLimits";

export function now(): string {
  return new Date().toISOString();
}

// Game Creation & Joining

/** Empty table — no players; first seated player becomes host (set in join flow). */
export function createEmptyTable(gameId: string): GameState {
  return {
    game_id: gameId,
    host_id: "",
    hand_number: 0,
    status: "waiting",
    updated_at: now(),
    pot: 0,
    current_wager: 0,
    min_raise: 0,
    blinds: { small: 25, big: 50 },
    board: { top: [null, null, null, null, null, null], shredder: [null, null, null, null, null, null] },
    players: [],
    current_player_seat: null,
    button_seat: 1,
    last_aggressor_seat: null,
    skip_discard_eligible: false,
    side_pots: [],
    action_history: [],
    last_action: "Table open — take a seat to play",
    deck: [],
    deck_index: 0,
  };
}

export function createNewGame(
  gameId: string,
  hostId: string,
  hostName: string,
  startingStackCents: number
): GameState {
  if (startingStackCents < 0) throw new Error("Starting stack cannot be negative");

  const hostPlayer: Player = {
    user_id: hostId,
    seat: 1,
    display_name: hostName,
    stack: startingStackCents,
    contributed_this_hand: 0,
    bet_this_street: 0,
    hole_cards: [],
    live_hole_cards: [],
    shredded_cards: [],
    discard_submitted: false,
    status: "active",
    current_pip_total: 0,
    final_pip_total: null,
    hand_result: null,
  };

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
    skip_discard_eligible: false,
    side_pots: [],
    action_history: [],
    last_action: `${hostName} created the table (seat 1, ${formatChips(startingStackCents)} chips)`,
    deck: [],
    deck_index: 0,
  };
}

export function joinSeat(
  game: GameState,
  userId: string,
  seat: number,
  displayName: string,
  startingStackCents: number
): GameState {
  if (startingStackCents < 0) throw new Error("Starting stack cannot be negative");
  if (game.players.some(p => p.seat === seat)) throw new Error("Seat already taken");

  const newPlayer: Player = {
    user_id: userId,
    seat,
    display_name: displayName,
    stack: startingStackCents,
    contributed_this_hand: 0,
    bet_this_street: 0,
    hole_cards: [],
    live_hole_cards: [],
    shredded_cards: [],
    discard_submitted: false,
    status: "active",
    current_pip_total: 0,
    final_pip_total: null,
    hand_result: null,
  };

  return {
    ...game,
    players: [...game.players, newPlayer].sort((a, b) => a.seat - b.seat),
    updated_at: now(),
    last_action: `${displayName} joined seat ${seat}`,
  };
}

// Card Utilities & Dealing
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

  const updatedPlayers = newGame.players.map(player => {
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
      discard_submitted: false,
    };
  });

  newGame.players = updatedPlayers;
  newGame.deck_index = idx;
  newGame.status = 'preflop_betting' as GameStatus;
  newGame.last_action = `Dealt 5 hole cards to ${newGame.players.length} players`;

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

// Betting System
export function getNextPlayerSeat(game: GameState, currentSeat: number): number | null {
  const active = game.players.filter(p => p.status === "active").sort((a, b) => a.seat - b.seat);
  if (active.length === 0) return null;
  const idx = active.findIndex(p => p.seat === currentSeat);
  if (idx === -1) return active[0].seat;
  return active[(idx + 1) % active.length].seat;
}

// src/lib/game/engine.ts  (update these functions)

export function isBettingRoundComplete(game: GameState): boolean {
  const activePlayers = game.players.filter(p => 
    p.status === 'active' || p.status === 'all_in'
  );

  if (activePlayers.length <= 1) return true;

  const currentWager = game.current_wager ?? 0;
  const everyoneMatched = activePlayers.every(p => 
    p.bet_this_street >= currentWager || p.stack === 0
  );

  if (!everyoneMatched) return false;

  // === AGGRESSION ROUND ===
  if (game.last_aggressor_seat !== null) {
    return game.current_player_seat === game.last_aggressor_seat;
  }

  // === PURE CHECK/CALL ROUND ===
  if (game.status === "preflop_betting" || game.status === "waiting") {
    // Preflop: only complete after BB has acted
    return game.hasBigBlindActedThisStreet === true;
  } else {
    // Postflop: complete when back to first-to-act (left of button)
    const firstToAct = getNextActiveSeat(game, game.button_seat || 0)!;
    return game.current_player_seat === firstToAct;
  }
}

export function processBet(
  game: GameState,
  seat: number,
  action: "fold" | "check" | "call" | "bet" | "raise",
  amount: number = 0
): GameState {
  const playerIndex = game.players.findIndex(p => p.seat === seat);
  if (playerIndex === -1) throw new Error("Player not found");

  const player = game.players[playerIndex];

  if (seat !== game.current_player_seat) {
    throw new Error(`Not your turn! Current: ${game.current_player_seat}`);
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
    newMinRaise = newWager - oldWager;
    newAggressor = seat;
    lastActionText = `${player.display_name} raised to ${formatCents(newWager)}`;
  }

  const newPot = updatedPlayers.reduce((sum, p) => sum + p.contributed_this_hand, 0);

  let result: GameState = {
    ...game,
    players: updatedPlayers,
    pot: newPot,
    current_wager: newWager,
    min_raise: newMinRaise,
    last_aggressor_seat: newAggressor,
    current_player_seat: getNextActiveSeat(game, seat)!,
    updated_at: now(),
    last_action: lastActionText,
    hasBigBlindActedThisStreet: 
      (game.status === "preflop_betting" || game.status === "waiting") && 
      seat === getBigBlindSeat(game) 
        ? true 
        : game.hasBigBlindActedThisStreet,
  };

  if (isBettingRoundComplete(result)) {
    result = advanceToNextPhase(result);
    if (result.status === 'showdown') {
      result = awardPot(result);
    }
  }

  return result;
}


// High Hand, Showdown, Award, Lifecycle
export function evaluatePlayerHand(player: Player, topBoard: (Card | null)[]): HandEvaluation {
  const liveCards = player.live_hole_cards;
  const community = topBoard.filter((c): c is Card => c !== null);
  return evaluateHighHand(liveCards, community);
}

export interface ShowdownResult {
  highWinners: Player[];
  lowWinners: Player[];
  highEvaluation?: HandEvaluation;
  lowPips: number;
  highPotShare: number;
  lowPotShare: number;
}

export function determineShowdown(game: GameState): ShowdownResult {
  const activePlayers = game.players.filter(p => 
    isHandLive(p) && p.live_hole_cards.length > 0
  );
  if (activePlayers.length === 0) return { highWinners: [], lowWinners: [], lowPips: Infinity, highPotShare: 0, lowPotShare: 0 };

  let bestHighScore = -1;
  let highWinners: Player[] = [];
  let bestLow = Infinity;
  let lowWinners: Player[] = [];
  let bestHighEval: HandEvaluation | undefined;

  for (const player of activePlayers) {
    const highEval = evaluatePlayerHand(player, game.board.top);
    const lowPips = player.current_pip_total;

    if (highEval.score > bestHighScore) {
      highWinners = [player];
      bestHighScore = highEval.score;
      bestHighEval = highEval;
    } else if (highEval.score === bestHighScore) highWinners.push(player);

    if (lowPips < bestLow) {
      lowWinners = [player];
      bestLow = lowPips;
    } else if (lowPips === bestLow) lowWinners.push(player);
  }

  const totalPot = game.pot;
  const highShare = Math.floor(totalPot / 2);
  const lowShare = totalPot - highShare;

  return {
    highWinners,
    lowWinners,
    highEvaluation: bestHighEval,
    lowPips: bestLow,
    highPotShare: highShare,
    lowPotShare: lowShare,
  };
}

function formatChips(cents: number): string {
  return (cents / 100).toFixed(2);
}

const formatCents = formatChips;

export function awardPot(game: GameState): GameState {
  const result = determineShowdown(game);
  const updatedPlayers = [...game.players];

  const highWinnersSet = new Set(result.highWinners.map((p) => p.user_id));
  const lowWinnersSet = new Set(result.lowWinners.map((p) => p.user_id));
  const highPerWinner =
    result.highWinners.length > 0
      ? Math.floor(result.highPotShare / result.highWinners.length)
      : 0;
  const lowPerWinner =
    result.lowWinners.length > 0
      ? Math.floor(result.lowPotShare / result.lowWinners.length)
      : 0;

  const showdown_summary: ShowdownSummary = {
    high_winners: result.highWinners.map((p) => ({
      seat: p.seat,
      display_name: p.display_name,
      amount_cents: highPerWinner,
      hand_description: evaluatePlayerHand(p, game.board.top).description,
    })),
    low_winners: result.lowWinners.map((p) => ({
      seat: p.seat,
      display_name: p.display_name,
      amount_cents: lowPerWinner,
      pips: p.current_pip_total,
    })),
  };

  for (let i = 0; i < updatedPlayers.length; i++) {
    const p = updatedPlayers[i];
    let winnings = 0;
    if (highWinnersSet.has(p.user_id)) winnings += highPerWinner;
    if (lowWinnersSet.has(p.user_id)) winnings += lowPerWinner;

    if (winnings > 0) {
      updatedPlayers[i] = {
        ...p,
        stack: p.stack + winnings,
        hand_result: {
          high: evaluatePlayerHand(p, game.board.top),
          lowPips: p.current_pip_total,
          winnings,
        },
      };
    }
  }

  const highNames = showdown_summary.high_winners
    .map((w) => `${w.display_name} (${w.hand_description}, ${formatCents(w.amount_cents)})`)
    .join('; ');
  const lowNames = showdown_summary.low_winners
    .map((w) => `${w.display_name} (${w.pips} pips, ${formatCents(w.amount_cents)})`)
    .join('; ');

  const last_action = [
    highNames ? `High: ${highNames}` : null,
    lowNames ? `Low: ${lowNames}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    ...game,
    players: updatedPlayers,
    pot: 0,
    status: "finished" as GameStatus,
    updated_at: now(),
    last_action: last_action || 'Hand complete (no eligible winners)',
    showdown_summary,
  };
}

export function nextHand(game: GameState): GameState {
  const newHandNumber = game.hand_number + 1;
  const resetPlayers = game.players.map(p => ({
    ...p,
    hole_cards: [],
    live_hole_cards: [],
    shredded_cards: [],
    contributed_this_hand: 0,
    bet_this_street: 0,
    discard_submitted: false,
    status: "active" as const,
    current_pip_total: 0,
    final_pip_total: null,
    hand_result: null,
  }));

  return {
    ...game,
    players: resetPlayers,
    hand_number: newHandNumber,
    pot: 0,
    current_wager: 0,
    min_raise: 0,
    board: { top: [null, null, null, null, null, null], shredder: [null, null, null, null, null, null] },
    current_player_seat: null,
    last_aggressor_seat: null,
    status: "waiting" as GameStatus,
    updated_at: now(),
    last_action: `Hand ${newHandNumber} reset`,
    action_history: [],
  };
}

// probably not needed from an older iteration
/* export function advanceStreet(game: GameState): GameState {
  let newGame = { ...game };

  // Reset street bets
  newGame.players = newGame.players.map(p => ({
    ...p,
    bet_this_street: 0,
  }));

  newGame.current_wager = 0;
  newGame.last_aggressor_seat = null;

  const isPostflop = ['flop_betting', 'turn_betting', 'river_betting'].includes(newGame.status);

  if (newGame.status === 'preflop_betting') {
    newGame.status = 'flop_betting' as GameStatus;
    newGame.current_player_seat = getFirstToAct(newGame, 'postflop');
    newGame.last_action = 'Advanced to flop betting';
  } 
  else if (newGame.status === 'flop_betting') {
    newGame.status = 'turn_betting' as GameStatus;
    newGame.current_player_seat = getFirstToAct(newGame, 'postflop');
    newGame.last_action = 'Advanced to turn betting';
  } 
  else if (newGame.status === 'turn_betting') {
    newGame.status = 'river_betting' as GameStatus;
    newGame.current_player_seat = getFirstToAct(newGame, 'postflop');
    newGame.last_action = 'Advanced to river betting';
  } 
  else if (newGame.status === 'river_betting') {
    newGame.status = 'showdown' as GameStatus;
    newGame.current_player_seat = null;
    newGame.last_action = 'Advanced to showdown';
  }

  newGame.updated_at = now();
  return newGame;
}
  */

// ======================
// NEW: BUTTON ROTATION + BLIND POSTING (pure functions added at the end)
// ======================

// ======================
// POSITION HELPERS (add these)
// ======================

export function getFirstToAct(state: GameState, street: 'preflop' | 'postflop'): number | null {
  if (getActivePlayers(state).length === 0) return null;

  if (street === 'preflop') {
    // Preflop: after the Big Blind
    const bbSeat = state.players.find(p => 
      p.bet_this_street === state.blinds.big && p.contributed_this_hand > 0
    )?.seat ?? state.button_seat;
    return getNextActiveSeat(state, bbSeat);
  } 

  // POSTFLOP: Always the player to the LEFT of the button (Small Blind position)
  // This is the key fix — we were sometimes landing on the button itself
  return getNextActiveSeat(state, state.button_seat);
}

export function isActive(player: Player): boolean {
  return player.status === 'active';
}

export function getActivePlayers(state: GameState): Player[] {
  return state.players.filter(isActive);
}

export function getNextActiveSeat(game: GameState, fromSeat: number): number | null {
  const active = game.players
    .filter(p => p.status === 'active' || p.status === 'all_in')
    .sort((a, b) => a.seat - b.seat);

  if (active.length === 0) return null;

  const idx = active.findIndex(p => p.seat === fromSeat);
  if (idx === -1) return active[0]?.seat ?? null;

  return active[(idx + 1) % active.length].seat;
}

export function rotateButton(state: GameState): GameState {
  if (getActivePlayers(state).length === 0) return state;

  const nextButtonSeat = getNextActiveSeat(state, state.button_seat) ?? state.button_seat;

  return {
    ...state,
    button_seat: nextButtonSeat,
    current_player_seat: null,
    updated_at: now(),
    last_action: `Button rotated to seat ${nextButtonSeat}`,
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

  let workingState = { ...state };

  const buttonIndex = workingState.players.findIndex(p => p.seat === workingState.button_seat);
  let sbSeat: number | null = null;
  let bbSeat: number | null = null;

  for (let i = 1; i <= workingState.players.length; i++) {
    const idx = (buttonIndex + i) % workingState.players.length;
    const p = workingState.players[idx];
    if (isActive(p)) {
      if (sbSeat === null) sbSeat = p.seat;
      else if (bbSeat === null) { bbSeat = p.seat; break; }
    }
  }

  if (!sbSeat || !bbSeat) return workingState;

  workingState = postBlind(workingState, sbSeat, workingState.blinds.small);
  workingState = postBlind(workingState, bbSeat, workingState.blinds.big);

  const newPot = workingState.players.reduce((sum, p) => sum + p.contributed_this_hand, 0);
 const firstToAct = getFirstToAct(workingState, 'preflop');
  return {
    ...workingState,
    pot: newPot,
    current_wager: workingState.blinds.big,
    min_raise: workingState.blinds.big,
    current_player_seat: firstToAct,
    last_aggressor_seat: null,
    status: 'preflop_betting' as GameStatus,
    last_action: 'blinds_posted',
    action_history: [
      ...(workingState.action_history || []),
      {
        type: 'blinds_posted',
        small_blind: { seat: sbSeat, amount: workingState.blinds.small },
        big_blind: { seat: bbSeat, amount: workingState.blinds.big },
        timestamp: now(),
      },
    ],
    updated_at: now(),
  };
}

export function startNewHand(game: GameState): GameState {
  let newGame = rotateButton(game);

  newGame = {
    ...newGame,
    hand_number: (game.hand_number || 0) + 1,
    pot: 0,
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
  };

  newGame.players = newGame.players.map((p) => ({
    ...p,
    contributed_this_hand: 0,
    bet_this_street: 0,
    hole_cards: [],
    live_hole_cards: [],
    shredded_cards: [],
    discard_submitted: false,
    status: "active" as const,
    current_pip_total: 0,
    final_pip_total: null,
    hand_result: null,
  }));

  newGame = postBlinds(newGame);
  newGame = dealHoleCards(newGame);

  const bbSeat =
    newGame.players.find((p) => p.bet_this_street === newGame.blinds.big)?.seat ??
    newGame.button_seat;
  newGame.current_player_seat = getNextActiveSeat(newGame, bbSeat);

  return newGame;
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
  let newGame = { ...game };

  // Reset this street's betting state for ALL players
  newGame.hasBigBlindActedThisStreet = false;
  newGame.players = newGame.players.map((p) => ({
    ...p,
    bet_this_street: 0,
    // Reactivate non-folded/non-dead players for the next street
    status: (p.status === "folded" || p.status === "dead") 
      ? p.status 
      : "active" as const,
  }));

  newGame.current_wager = 0;
  newGame.min_raise = 0;
  newGame.last_aggressor_seat = null;

  // Advance phase + deal cards + set correct next player
  if (game.status === "preflop_betting" || game.status === "waiting") {
    newGame = dealFlop(newGame);
    newGame.status = "flop_betting" as GameStatus;
    newGame.current_player_seat = getNextActiveSeat(newGame, newGame.button_seat);
  } 
  else if (game.status === "flop_betting") {
    newGame = dealTurn(newGame);
    newGame.status = "turn_betting" as GameStatus;
    newGame.current_player_seat = getNextActiveSeat(newGame, newGame.button_seat);
  } 
  else if (game.status === "turn_betting") {
    newGame = dealRiver(newGame);
    newGame.status = "river_betting" as GameStatus;
    newGame.current_player_seat = getNextActiveSeat(newGame, newGame.button_seat);
  } 
  else if (game.status === "river_betting") {
    newGame.status = "showdown" as GameStatus;
    newGame.current_player_seat = null;
  } 
  else if (game.status === "showdown") {
    return awardPot(newGame);
  }

  newGame.updated_at = now();
  return newGame;
}

export function isHandLive(player: Player): boolean {
  return player.status === "active" || player.status === "all_in";
}

export function isDeadHand(player: Player): boolean {
  return player.live_hole_cards.length === 0 || player.status === "dead";
}

function getBigBlindSeat(game: GameState): number {
  const button = game.button_seat || 0;
  const sb = getNextActiveSeat(game, button);
  return getNextActiveSeat(game, sb!)!;
}