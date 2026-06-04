import type { GameState, Player } from '@/types/game';
import { canPostBlindFor, shouldDealCardsTo } from '@/lib/game/playerLifecycle';

function getSeatedPlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.presence === 'active' && p.stack > 0);
}

export interface BlindSeats {
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  /** Button seat empty — blinds still advance from next occupied seats. */
  deadButton: boolean;
  /** No eligible SB poster — only BB is posted. */
  deadSmallBlind: boolean;
}

export interface LastBlindsPosted {
  small_seat: number | null;
  big_seat: number;
  hand_number: number;
}

function sortedSeated(state: GameState): Player[] {
  return [...getSeatedPlayers(state)].sort((a, b) => a.seat - b.seat);
}

/** Button must point at a seated player; otherwise use first seat clockwise. */
export function normalizeButtonSeat(state: GameState): number {
  const seated = sortedSeated(state);
  if (seated.length === 0) return state.button_seat;
  if (seated.some((p) => p.seat === state.button_seat)) return state.button_seat;
  return seated[0].seat;
}

export function countHandParticipants(state: GameState): number {
  return state.players.filter(
    (p) =>
      p.in_current_hand &&
      p.presence === 'active' &&
      (p.status === 'active' || p.status === 'all_in')
  ).length;
}

export function isHeadsUpHand(state: GameState): boolean {
  return countHandParticipants(state) === 2;
}

/** Two (or more) seated active stacks eligible this hand — used before cards are dealt. */
export function isHeadsUpTable(state: GameState): boolean {
  const eligible = state.players.filter(
    (p) => p.presence === 'active' && p.stack > 0 && !p.waits_for_button
  );
  return eligible.length === 2;
}

function nextEligibleClockwise(
  seated: Player[],
  fromSeat: number,
  skipSeat?: number
): Player | null {
  const idx = seated.findIndex((p) => p.seat === fromSeat);
  const start = idx === -1 ? 0 : idx;
  for (let i = 1; i <= seated.length; i++) {
    const p = seated[(start + i) % seated.length];
    if (skipSeat != null && p.seat === skipSeat) continue;
    if (canPostBlindFor(p)) return p;
  }
  return null;
}

/**
 * Resolve blind seats for the upcoming hand.
 * HU: button posts SB, opponent posts BB.
 * 3+: SB left of button, BB left of SB; supports dead SB / empty button seat.
 */
export function resolveBlindSeats(state: GameState): BlindSeats | null {
  const seated = sortedSeated(state);
  if (seated.length < 2) return null;

  const buttonSeat = normalizeButtonSeat(state);
  const deadButton = !seated.some((p) => p.seat === state.button_seat);

  if (seated.length === 2) {
    const bbPlayer = seated.find((p) => p.seat !== buttonSeat)!;
    if (!canPostBlindFor(bbPlayer)) return null;
    const buttonPlayer = seated.find((p) => p.seat === buttonSeat);
    const sbSeat =
      buttonPlayer && canPostBlindFor(buttonPlayer) ? buttonSeat : null;
    return {
      buttonSeat,
      smallBlindSeat: sbSeat,
      bigBlindSeat: bbPlayer.seat,
      deadButton,
      deadSmallBlind: sbSeat === null,
    };
  }

  const sbPlayer = nextEligibleClockwise(seated, buttonSeat);
  if (!sbPlayer) return null;

  const bbPlayer = nextEligibleClockwise(seated, sbPlayer.seat);
  if (!bbPlayer) return null;

  return {
    buttonSeat,
    smallBlindSeat: sbPlayer.seat,
    bigBlindSeat: bbPlayer.seat,
    deadButton,
    deadSmallBlind: false,
  };
}

export function recordBlindsPosted(
  assignment: BlindSeats,
  handNumber: number
): LastBlindsPosted {
  return {
    small_seat: assignment.smallBlindSeat,
    big_seat: assignment.bigBlindSeat,
    hand_number: handNumber,
  };
}

/** Active seated players who were eligible but did not post either blind last hand. */
export function seatsThatSkippedBlinds(
  state: GameState,
  last: LastBlindsPosted | undefined,
  assignment: BlindSeats
): number[] {
  if (!last) return [];

  const posted = new Set<number>();
  if (last.small_seat != null) posted.add(last.small_seat);
  posted.add(last.big_seat);
  if (assignment.smallBlindSeat != null) posted.add(assignment.smallBlindSeat);
  posted.add(assignment.bigBlindSeat);

  return state.players
    .filter(
      (p) =>
        p.presence === 'active' &&
        p.stack > 0 &&
        !p.waits_for_button &&
        shouldDealCardsTo(p) &&
        !posted.has(p.seat)
    )
    .map((p) => p.seat);
}