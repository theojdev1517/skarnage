// src/lib/game/engine.ts
import type { GameState, Player, Card, GameStatus } from "@/types/game";
import type { HandEvaluation } from "./evaluator";
import { evaluateHighHand } from "./evaluator";

export function now(): string {
  return new Date().toISOString();
}

// Game Creation & Joining
export function createNewGame(hostId: string, hostName: string): GameState {
  const gameId = `game_${Date.now()}`;

  const hostPlayer: Player = {
    user_id: hostId,
    seat: 1,
    display_name: hostName,
    stack: 10000,
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
    last_action: "Game created",
  };
}

export function joinSeat(game: GameState, userId: string, seat: number, displayName: string): GameState {
  if (game.players.some(p => p.seat === seat)) throw new Error("Seat already taken");

  const newPlayer: Player = {
    user_id: userId,
    seat,
    display_name: displayName,
    stack: 10000,
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

export function parseCardRank(card: Card): string {
  if (typeof card !== 'string') return '';
  let rank = card.slice(0, -1);
  return rank === "10" ? "T" : rank;
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
      if (shredderRanks.has(parseCardRank(card))) shreddedThisStreet.push(card);
      else remaining.push(card);
    }
    return {
      ...player,
      live_hole_cards: remaining,
      shredded_cards: [...player.shredded_cards, ...shreddedThisStreet],
      current_pip_total: calculatePipTotal(remaining),
    };
  });

  return {
    ...game,
    players: updatedPlayers,
    updated_at: now(),
    last_action: "Cards shredded based on bottom board",
  };
}

export function dealHoleCards(game: GameState, shuffledDeck: Card[]): GameState {
  if (game.players.length === 0) throw new Error("No players to deal to");
  let deckIndex = 0;
  const updatedPlayers = game.players.map(player => {
    const holeCards: Card[] = [];
    for (let i = 0; i < 5; i++) holeCards.push(shuffledDeck[deckIndex++]);
    return {
      ...player,
      hole_cards: holeCards,
      live_hole_cards: [...holeCards],
      shredded_cards: [],
      current_pip_total: calculatePipTotal(holeCards),
      discard_submitted: false,
    };
  });

  return {
    ...game,
    players: updatedPlayers,
    status: "preflop_betting" as GameStatus,
    updated_at: now(),
    last_action: `Dealt 5 hole cards to ${game.players.length} players`,
  };
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealFlop(game: GameState, shuffledDeck: Card[], deckIndex: number): GameState {
  const topFlop = [shuffledDeck[deckIndex], shuffledDeck[deckIndex+1], shuffledDeck[deckIndex+2]];
  const shredderFlop = [shuffledDeck[deckIndex+3], shuffledDeck[deckIndex+4], shuffledDeck[deckIndex+5]];

  let newGame = {
    ...game,
    board: { top: [...topFlop, null, null, null], shredder: [...shredderFlop, null, null, null] },
    status: "flop_betting" as GameStatus,
    updated_at: now(),
    last_action: "Flop dealt + auto-shredded",
  };
  return shredCards(newGame);
}

export function dealTurn(game: GameState, shuffledDeck: Card[], deckIndex: number): GameState {
  let newGame = {
    ...game,
    board: {
      top: [...game.board.top.slice(0, 3), shuffledDeck[deckIndex], null, null],
      shredder: [...game.board.shredder.slice(0, 3), shuffledDeck[deckIndex+1], null, null]
    },
    status: "turn_betting" as GameStatus,
    updated_at: now(),
    last_action: "Turn dealt + auto-shredded",
  };
  return shredCards(newGame);
}

export function dealRiver(game: GameState, shuffledDeck: Card[], deckIndex: number): GameState {
  let newGame = {
    ...game,
    board: {
      top: [...game.board.top.slice(0, 4), shuffledDeck[deckIndex]],
      shredder: [...game.board.shredder.slice(0, 4), shuffledDeck[deckIndex+1]]
    },
    status: "showdown" as GameStatus,
    updated_at: now(),
    last_action: "River dealt + auto-shredded",
  };
  return shredCards(newGame);
}

// Betting System
export function getNextPlayerSeat(game: GameState, currentSeat: number): number | null {
  const active = game.players.filter(p => p.status === "active").sort((a, b) => a.seat - b.seat);
  if (active.length === 0) return null;
  const idx = active.findIndex(p => p.seat === currentSeat);
  if (idx === -1) return active[0].seat;
  return active[(idx + 1) % active.length].seat;
}

export function isBettingRoundComplete(game: GameState): boolean {
  const activePlayers = game.players.filter(p => p.status === "active");
  if (activePlayers.length === 0) return true;
  const currentWager = game.current_wager;
  return activePlayers.every(p => p.bet_this_street >= currentWager || p.status === "folded");
}

export function processBet(
  game: GameState,
  seat: number,
  action: "fold" | "call" | "check" | "raise",
  amount: number = 0
): GameState {
  const playerIndex = game.players.findIndex(p => p.seat === seat);
  if (playerIndex === -1) throw new Error("Player not found");

  const player = game.players[playerIndex];
  if (player.status !== "active") throw new Error("Player cannot act");

  const updatedPlayers = [...game.players];
  let lastActionText = "";

  const toCall = game.current_wager - player.bet_this_street;

  if (action === "fold") {
    updatedPlayers[playerIndex] = { ...player, status: "folded" as const };
    lastActionText = `${player.display_name} folded`;
  } 
  else if (action === "check") {
    if (toCall > 0) throw new Error("Cannot check — must call or raise");
    lastActionText = `${player.display_name} checked`;
  } 
  else if (action === "call") {
    const callAmount = Math.min(toCall, player.stack);
    updatedPlayers[playerIndex] = {
      ...player,
      bet_this_street: player.bet_this_street + callAmount,
      contributed_this_hand: player.contributed_this_hand + callAmount,
      stack: player.stack - callAmount,
    };
    lastActionText = `${player.display_name} called $${callAmount}`;
  } 
  else if (action === "raise") {
    const minRaiseAmount = game.min_raise || game.blinds.big * 2;
    const raiseTo = Math.max(game.current_wager + minRaiseAmount, amount);
    const raiseAmount = raiseTo - player.bet_this_street;
    const actual = Math.min(raiseAmount, player.stack);

    updatedPlayers[playerIndex] = {
      ...player,
      bet_this_street: player.bet_this_street + actual,
      contributed_this_hand: player.contributed_this_hand + actual,
      stack: player.stack - actual,
    };

    return {
      ...game,
      players: updatedPlayers,
      current_wager: player.bet_this_street + actual,
      min_raise: actual,
      last_aggressor_seat: seat,
      updated_at: now(),
      last_action: `${player.display_name} raised to $${player.bet_this_street + actual}`,
    };
  }

  return {
    ...game,
    players: updatedPlayers,
    updated_at: now(),
    last_action: lastActionText,
  };
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
  const activePlayers = game.players.filter(p => p.status === "active" && p.live_hole_cards.length > 0);
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

export function awardPot(game: GameState): GameState {
  const result = determineShowdown(game);
  const updatedPlayers = [...game.players];

  const highWinnersSet = new Set(result.highWinners.map(p => p.user_id));
  const lowWinnersSet = new Set(result.lowWinners.map(p => p.user_id));

  for (let i = 0; i < updatedPlayers.length; i++) {
    const p = updatedPlayers[i];
    let winnings = 0;
    if (highWinnersSet.has(p.user_id)) winnings += Math.floor(result.highPotShare / result.highWinners.length);
    if (lowWinnersSet.has(p.user_id)) winnings += Math.floor(result.lowPotShare / result.lowWinners.length);

    if (winnings > 0) {
      updatedPlayers[i] = {
        ...p,
        stack: p.stack + winnings,
        hand_result: {
          high: result.highEvaluation,
          lowPips: p.current_pip_total,
          winnings,
        },
      };
    }
  }

  return {
    ...game,
    players: updatedPlayers,
    pot: 0,
    status: "finished" as GameStatus,
    updated_at: now(),
    last_action: `Hand complete`,
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
    hand_number: newHandNumber,
    status: "waiting",
    pot: 0,
    current_wager: 0,
    min_raise: 0,
    board: { top: [null, null, null, null, null, null], shredder: [null, null, null, null, null, null] },
    players: resetPlayers,
    current_player_seat: null,
    last_aggressor_seat: null,
    action_history: [],
    last_action: `Hand ${newHandNumber} started — ready to deal`,
    updated_at: now(),
  };
}

export function advanceStreet(game: GameState): GameState {
  let newStatus: GameStatus = game.status;
  if (game.status === "preflop_betting") newStatus = "flop_betting";
  else if (game.status === "flop_betting") newStatus = "turn_betting";
  else if (game.status === "turn_betting") newStatus = "river_betting";
  else if (game.status === "river_betting") newStatus = "showdown";

  return {
    ...game,
    status: newStatus,
    current_wager: 0,
    last_aggressor_seat: null,
    updated_at: now(),
    last_action: `Advanced to ${newStatus.replace('_', ' ')}`,
  };
}