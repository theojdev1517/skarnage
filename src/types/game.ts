// src/types/game.ts
export type Card = string; // e.g. "Ah", "2d", "Ks", "10h"

export type GameStatus =
  | "waiting"
  | "buying_in"
  | "preflop_betting"
  | "flop_dealt"
  | "flop_discard"
  | "flop_betting"
  | "turn_dealt"
  | "turn_discard"
  | "turn_betting"
  | "river_dealt"
  | "river_discard"
  | "river_betting"
  | "showdown"
  | "finished";

export interface Player {
  user_id: string;
  seat: number;
  display_name: string;
  stack: number;           // in cents
  contributed_this_hand: number;
  bet_this_street: number;
  hole_cards: Card[];           // original 5 cards
  live_hole_cards: Card[];      // after shredding
  shredded_cards: Card[];
  discard_submitted: boolean;
  status: "active" | "folded" | "all_in" | "dead";
  current_pip_total: number;
  final_pip_total: number | null;
  hand_result: any; // TODO: we'll define proper hand result later
}

export interface Board {
  top: (Card | null)[];
  shredder: (Card | null)[];
}

export interface GameState {
  game_id: string;
  host_id: string;
  hand_number: number;
  status: GameStatus;
  updated_at: string;
  pot: number;
  current_wager: number;
  min_raise: number;
  blinds: { small: number; big: number };
  board: Board;
  players: Player[];
  current_player_seat: number | null;
  button_seat: number;
  last_aggressor_seat: number | null;
  skip_discard_eligible: boolean;
  side_pots: any[]; // TODO later
  action_history: any[];
  last_action: string;
  deck: Card[];
  deck_index: number;
}