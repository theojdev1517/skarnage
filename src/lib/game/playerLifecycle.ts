import type { GameState, GameStatus, Player, PlayerPresence, SeatIntent } from '@/types/game';
import { GAME_CONFIG } from '@/lib/game/config';

export const HAND_IN_PROGRESS_STATUSES: GameStatus[] = [
  'preflop_betting',
  'flop_betting',
  'turn_betting',
  'river_betting',
  'showdown',
];

export function isHandInProgress(status: GameStatus): boolean {
  return HAND_IN_PROGRESS_STATUSES.includes(status);
}

export function defaultPlayerFields(
  partial: Omit<
    Player,
    | 'in_current_hand'
    | 'waits_for_button'
    | 'presence'
    | 'seat_intent'
  > &
    Partial<Pick<Player, 'in_current_hand' | 'waits_for_button' | 'presence' | 'seat_intent'>>
): Player {
  return {
    in_current_hand: partial.in_current_hand ?? true,
    waits_for_button: partial.waits_for_button ?? false,
    presence: partial.presence ?? 'active',
    seat_intent: partial.seat_intent ?? 'none',
    ...partial,
  };
}

export function normalizePlayer(raw: Player): Player {
  return defaultPlayerFields({
    ...raw,
    in_current_hand: raw.in_current_hand ?? true,
    waits_for_button: raw.waits_for_button ?? false,
    presence: (raw.presence as PlayerPresence) ?? 'active',
    seat_intent: (raw.seat_intent as SeatIntent) ?? 'none',
  });
}

export function normalizeGameState(game: GameState): GameState {
  return {
    ...game,
    pending_joins: game.pending_joins ?? [],
    pending_chip_adds: game.pending_chip_adds ?? [],
    pending_rebuys: game.pending_rebuys ?? [],
    turn_deadline_at: game.turn_deadline_at ?? null,
    rebuy_deadline_at: game.rebuy_deadline_at ?? null,
    rebuy_offered_seats: game.rebuy_offered_seats ?? [],
    showdown_deadline_at: game.showdown_deadline_at ?? null,
    players: game.players.map(normalizePlayer),
  };
}

export function isInLiveHand(player: Player): boolean {
  return (
    player.in_current_hand &&
    player.presence === 'active' &&
    (player.status === 'active' || player.status === 'all_in')
  );
}

export function shouldDealCardsTo(player: Player): boolean {
  return player.in_current_hand && player.presence === 'active' && !player.waits_for_button;
}

export function canPostBlindFor(player: Player): boolean {
  return shouldDealCardsTo(player) && player.stack > 0;
}

export function isEligibleForNextHand(player: Player): boolean {
  return (
    player.presence === 'active' &&
    player.seat_intent !== 'pending_stand' &&
    player.stack > 0
  );
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function isRebuyWindowOpen(game: GameState): boolean {
  if (!game.rebuy_deadline_at) return false;
  return new Date(game.rebuy_deadline_at).getTime() > Date.now();
}

export function withTurnDeadline(game: GameState): GameState {
  if (!GAME_CONFIG.TURN_TIMER_ENABLED || game.current_player_seat == null) {
    return { ...game, turn_deadline_at: null };
  }
  return {
    ...game,
    turn_deadline_at: addSeconds(new Date().toISOString(), GAME_CONFIG.TURN_TIMER_SECONDS),
  };
}

export function playerHasPendingAction(player: Player, game: GameState): boolean {
  if (!isHandInProgress(game.status) || !player.in_current_hand) return false;
  if (player.status !== 'active' && player.status !== 'all_in') return false;
  if (game.current_player_seat === player.seat) return true;
  return false;
}

export function canApplySeatIntentNow(player: Player, game: GameState): boolean {
  if (player.seat_intent === 'none') return true;
  if (!isHandInProgress(game.status)) return true;
  if (!player.in_current_hand) return true;
  if (player.status === 'folded' || player.status === 'dead') return true;
  return !playerHasPendingAction(player, game);
}