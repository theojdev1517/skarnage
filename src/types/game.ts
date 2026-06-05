
export type Card = string; // e.g. "Ah", "2d", "Ks", "10h"

export type GameStatus =
  | "waiting"
  | "preflop_betting"
  | "flop_betting"
  | "turn_betting"
  | "river_betting"
  | "showdown"
  | "finished";

export type PlayerPresence = "active" | "away";
export type SeatIntent = "none" | "pending_away" | "pending_stand";

export interface Player {
  user_id: string;
  seat: number;
  display_name: string;
  stack: number; // in cents
  contributed_this_hand: number;
  bet_this_street: number;
  hole_cards: Card[];
  live_hole_cards: Card[];
  shredded_cards: Card[];
  status: "active" | "folded" | "all_in" | "dead";
  current_pip_total: number;
  final_pip_total: number | null;
  hand_result: unknown;
  /** In this hand's pot / betting / cards. */
  in_current_hand: boolean;
  /** Joined mid-hand or between button and blinds — skip until next hand / button passes. */
  waits_for_button: boolean;
  presence: PlayerPresence;
  seat_intent: SeatIntent;
}

export interface PendingJoinRequest {
  id: string;
  user_id: string;
  seat: number;
  display_name: string;
  starting_stack_cents: number;
  requested_at: string;
}

export interface PendingChipAddRequest {
  id: string;
  user_id: string;
  seat: number;
  display_name: string;
  amount_cents: number;
  requested_at: string;
}

export interface PendingRebuyRequest {
  id: string;
  user_id: string;
  seat: number;
  display_name: string;
  starting_stack_cents: number;
  requested_at: string;
}

export interface Board {
  top: (Card | null)[];
  shredder: (Card | null)[];
}

export interface ShowdownWinnerSummary {
  seat: number;
  display_name: string;
  amount_cents: number;
}

export interface ShowdownSummary {
  high_winners: (ShowdownWinnerSummary & { hand_description: string })[];
  low_winners: (ShowdownWinnerSummary & { pips: number })[];
}

export interface SidePot {
  amount: number; // cents in this pot layer
  eligible: string[]; // user_ids of players who can win this pot (contributed at/above the layer)
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
  side_pots: SidePot[];
  action_history: unknown[];
  last_action: string;
  showdown_summary?: ShowdownSummary | null;
  deck: Card[];
  deck_index: number;
  hasBigBlindActedThisStreet?: boolean;
  pending_joins: PendingJoinRequest[];
  pending_chip_adds: PendingChipAddRequest[];
  pending_rebuys: PendingRebuyRequest[];
  turn_deadline_at: string | null;
  rebuy_deadline_at: string | null;
  rebuy_offered_seats: number[];
  /** Previous hand blind seats — used to prevent skip / triple blind posts. */
  last_blinds?: {
    small_seat: number | null;
    big_seat: number;
    hand_number: number;
  };
  prior_blinds?: {
    small_seat: number | null;
    big_seat: number;
    hand_number: number;
  };
}