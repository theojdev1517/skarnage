// src/lib/game/engine.ts
import type { GameState, Player, Card, GameStatus } from "@/types/game";
import type { HandEvaluation } from "./evaluator";
import { evaluateHighHand } from "./evaluator";

// Simple helper to get current timestamp as ISO string
export function now(): string {
  return new Date().toISOString();
}

// Create a brand new game
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
  if (game.players.some(p => p.seat === seat)) {
    throw new Error("Seat already taken");
  }

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

// ─────────────────────────────────────────────────────────────
// Card Utilities
// ─────────────────────────────────────────────────────────────

export function createStandardDeck(): Card[] {
  const suits = ['h', 'd', 'c', 's'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck: Card[] = [];
  
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}` as Card);
    }
  }
  return deck;
}

export function parseCardRank(card: Card): string {
  return card.slice(0, -1);
}

export function calculatePipTotal(cards: Card[]): number {
  let total = 0;
  for (const card of cards) {
    const rank = parseCardRank(card);
    if (rank === 'A') total += 1;
    else if (['J', 'Q', 'K'].includes(rank)) total += 10;
    else total += parseInt(rank);
  }
  return total;
}

// Auto-shred
export function shredCards(game: GameState): GameState {
  const shredderRanks = new Set(
    game.board.shredder
      .filter((card): card is Card => card !== null)
      .map(parseCardRank)
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

// ─────────────────────────────────────────────────────────────
// Dealing Functions
// ─────────────────────────────────────────────────────────────

export function dealHoleCards(game: GameState, shuffledDeck: Card[]): GameState {
  if (game.players.length === 0) throw new Error("No players to deal to");

  let deckIndex = 0;
  const updatedPlayers = game.players.map(player => {
    const holeCards: Card[] = [];
    for (let i = 0; i < 5; i++) {
      holeCards.push(shuffledDeck[deckIndex++]);
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
    board: {
      top: [...topFlop, null, null, null],
      shredder: [...shredderFlop, null, null, null]
    },
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

// ─────────────────────────────────────────────────────────────
// Betting
// ─────────────────────────────────────────────────────────────

export function processBet(
  game: GameState,
  seat: number,
  action: "fold" | "call" | "raise",
  amount: number = 0
): GameState {
  const playerIndex = game.players.findIndex(p => p.seat === seat);
  if (playerIndex === -1) throw new Error("Player not found");

  const player = game.players[playerIndex];
  if (player.status !== "active") throw new Error("Player cannot act");

  const updatedPlayers = [...game.players];
  let lastActionText = "";

  if (action === "fold") {
    updatedPlayers[playerIndex] = { ...player, status: "folded" as const };
    lastActionText = `${player.display_name} folded`;
  } else if (action === "call") {
    updatedPlayers[playerIndex] = { 
      ...player, 
      bet_this_street: game.current_wager,
      contributed_this_hand: player.contributed_this_hand + game.current_wager 
    };
    lastActionText = `${player.display_name} called`;
  } else if (action === "raise") {
    const actualRaise = Math.max(amount, game.min_raise || 1000);
    updatedPlayers[playerIndex] = { 
      ...player, 
      bet_this_street: actualRaise,
      contributed_this_hand: player.contributed_this_hand + actualRaise 
    };
    lastActionText = `${player.display_name} raised to ${actualRaise}`;
  }

  return {
    ...game,
    players: updatedPlayers,
    updated_at: now(),
    last_action: lastActionText,
  };
}

// ─────────────────────────────────────────────────────────────
// High Hand Evaluation
// ─────────────────────────────────────────────────────────────

export function evaluatePlayerHand(player: Player, topBoard: (Card | null)[]): HandEvaluation {
  const liveCards = player.live_hole_cards;
  const community = topBoard.filter((c): c is Card => c !== null);
  return evaluateHighHand(liveCards, community);
}