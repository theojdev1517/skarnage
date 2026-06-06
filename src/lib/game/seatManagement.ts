import type { GameState, PendingJoinRequest } from '@/types/game';
import { GameApiError, GameErrorCode } from '@/lib/game/apiErrors';
import { now } from '@/lib/game/time';
import { GAME_CONFIG } from '@/lib/game/config';
import { formatStack } from '@/lib/formatStack';
import {
  addSeconds,
  canApplySeatIntentNow,
  defaultPlayerFields,
  isHandInProgress,
  isRebuyWindowOpen,
  normalizeGameState,
} from '@/lib/game/playerLifecycle';

function findPlayer(game: GameState, userId: string) {
  return game.players.find((p) => p.user_id === userId);
}

function getLargestPositiveStackCents(game: GameState): number {
  const g = normalizeGameState(game);
  const positive = g.players.map((p) => p.stack).filter((s) => s > 0);
  return positive.length ? Math.max(...positive) : 0;
}

/**
 * Returns the allowed buy-in/rebuy range per the house rules.
 * Min is always exactly 10000 cents.
 * Max follows the clarified buckets:
 *   - largest <= 100: 100
 *   - 100 < largest <= 200: largest (100% match)
 *   - 200 < largest <= 266.66: 200
 *   - largest > 266.66: 75% of largest, rounded to nearest 5 dollars
 * Max is guaranteed >= 100. Works from current player stacks (post-payout for rebuys).
 */
export function getBuyInRange(game: GameState): { minCents: number; maxCents: number } {
  const MIN_CENTS = 10000;
  const largestCents = getLargestPositiveStackCents(game);
  const L = largestCents / 100; // dollars for bucket logic

  let maxD: number;
  if (L <= 100) {
    maxD = 100;
  } else if (L <= 200) {
    maxD = L;
  } else if (L <= 266.66) {
    maxD = 200;
  } else {
    const p75 = 0.75 * L;
    maxD = Math.round(p75 / 5) * 5;
  }
  maxD = Math.max(100, maxD);
  const maxCents = Math.round(maxD * 100);
  return { minCents: MIN_CENTS, maxCents };
}

export function requestJoin(
  game: GameState,
  userId: string,
  seat: number,
  displayName: string,
  startingStackCents: number
): GameState {
  const g = normalizeGameState(game);

  if (startingStackCents <= 0) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      'Starting stack must be greater than zero.',
      400
    );
  }

  const existing = findPlayer(g, userId);
  if (existing) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      `You are already in seat ${existing.seat}.`,
      409
    );
  }

  if (g.players.some((p) => p.seat === seat)) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'That seat is already taken.', 409);
  }

  if (g.pending_joins.some((j) => j.seat === seat)) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'That seat already has a pending request.', 409);
  }

  if (g.pending_joins.some((j) => j.user_id === userId)) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      'You already have a pending join request.',
      409
    );
  }

  const request: PendingJoinRequest = {
    id: crypto.randomUUID(),
    user_id: userId,
    seat,
    display_name: displayName,
    starting_stack_cents: startingStackCents,
    requested_at: now(),
  };

  return {
    ...g,
    pending_joins: [...g.pending_joins, request],
    updated_at: now(),
    last_action: `${displayName} requested seat ${seat} (awaiting host)`,
  };
}

/**
 * Direct (auto) join / take seat. Validates the starting stack against current rules
 * (exactly 100 if game not started / status==="waiting"; otherwise within getBuyInRange).
 * Seats immediately without creating a pending request or requiring host approval.
 * Reuses the same mid-hand / waits_for_button / first-host logic as approveJoin.
 */
export function directJoin(
  game: GameState,
  userId: string,
  seat: number,
  displayName: string,
  startingStackCents: number
): { game: GameState; hostId?: string } {
  const g = normalizeGameState(game);

  // Enforce buy-in rules (pre-start always 100; post-start in range)
  const isPreStart = g.status === 'waiting';
  let effectiveStack = startingStackCents;
  if (isPreStart) {
    effectiveStack = 10000;
  } else {
    const range = getBuyInRange(g);
    if (effectiveStack < range.minCents || effectiveStack > range.maxCents) {
      throw new GameApiError(
        GameErrorCode.INVALID_REQUEST,
        `Starting stack must be between ${range.minCents / 100} and ${range.maxCents / 100}.`,
        400
      );
    }
  }

  if (effectiveStack <= 0) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      'Starting stack must be greater than zero.',
      400
    );
  }

  const existing = findPlayer(g, userId);
  if (existing) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      `You are already in seat ${existing.seat}.`,
      409
    );
  }

  if (g.players.some((p) => p.seat === seat)) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'That seat is already taken.', 409);
  }

  // Note: we intentionally do NOT check/create pending_joins here — this is the direct/auto path.
  // (Old pending path via requestJoin is still available for any edge/manual use.)

  const handLive = isHandInProgress(g.status);
  const midHand = handLive;

  const newPlayer = defaultPlayerFields({
    user_id: userId,
    seat,
    display_name: displayName,
    stack: effectiveStack,
    contributed_this_hand: 0,
    bet_this_street: 0,
    hole_cards: [],
    live_hole_cards: [],
    shredded_cards: [],
    status: 'active',
    current_pip_total: 0,
    final_pip_total: null,
    hand_result: null,
    in_current_hand: !midHand,
    waits_for_button: midHand,
    presence: 'active',
    seat_intent: 'none',
  });

  let next: GameState = {
    ...g,
    players: [...g.players, newPlayer].sort((a, b) => a.seat - b.seat),
    // Do not touch pending_joins in direct path
    updated_at: now(),
    last_action: midHand
      ? `${displayName} seated in ${seat} (waits for next hand)`
      : `${displayName} joined seat ${seat}`,
  };

  let hostId: string | undefined;
  if (!g.host_id) {
    next = { ...next, host_id: userId };
    hostId = userId;
  }

  return { game: next, hostId };
}

/**
 * Applies any pending chip adds (from +add chips requests).
 * - Credits the stacks (capped so final <= current buy-in max at apply time).
 * - Clears the pending list.
 * - Appends to last_action.
 * Called post-award (so adds take effect after pot awarded, and before rebuy offers/decisions)
 * and also in prepare for between-hand requests or safety.
 */
export function applyPendingChipAdds(game: GameState): GameState {
  const g = normalizeGameState(game);
  const pendingAdds = g.pending_chip_adds || [];
  if (pendingAdds.length === 0) return g;

  const range = getBuyInRange(g);
  const maxTotal = range.maxCents;

  const updatedPlayers = g.players.map((p) => {
    const req = pendingAdds.find((r) => r.user_id === p.user_id);
    if (req) {
      const addAmt = Math.min(req.amount_cents, Math.max(0, maxTotal - p.stack));
      return { ...p, stack: p.stack + addAmt };
    }
    return p;
  });

  // Build a nice note for which adds were applied
  const appliedNotes: string[] = [];
  for (const req of pendingAdds) {
    const p = g.players.find((pp) => pp.user_id === req.user_id);
    if (p) {
      const addAmt = Math.min(req.amount_cents, Math.max(0, maxTotal - p.stack));
      if (addAmt > 0) {
        appliedNotes.push(`${p.display_name} +${formatStack(addAmt)}`);
      }
    }
  }
  const addNote = appliedNotes.length > 0 ? ` (chip adds applied: ${appliedNotes.join('; ')})` : ' (pending chip adds applied)';

  return {
    ...g,
    players: updatedPlayers,
    pending_chip_adds: [],
    last_action: `${g.last_action || ''}${addNote}`.trim(),
    updated_at: now(),
  };
}

export function approveJoin(
  game: GameState,
  hostUserId: string,
  requestId: string
): { game: GameState; hostId?: string } {
  const g = normalizeGameState(game);
  if (hostUserId !== g.host_id) {
    throw new GameApiError(GameErrorCode.HOST_ONLY, 'Host only.', 403);
  }

  const req = g.pending_joins.find((j) => j.id === requestId);
  if (!req) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Join request not found.', 404);
  }

  if (g.players.some((p) => p.seat === req.seat)) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'That seat is now taken.', 409);
  }

  const handLive = isHandInProgress(g.status);
  const midHand = handLive;

  const newPlayer = defaultPlayerFields({
    user_id: req.user_id,
    seat: req.seat,
    display_name: req.display_name,
    stack: req.starting_stack_cents,
    contributed_this_hand: 0,
    bet_this_street: 0,
    hole_cards: [],
    live_hole_cards: [],
    shredded_cards: [],
    status: 'active',
    current_pip_total: 0,
    final_pip_total: null,
    hand_result: null,
    in_current_hand: !midHand,
    waits_for_button: midHand,
    presence: 'active',
    seat_intent: 'none',
  });

  let next: GameState = {
    ...g,
    players: [...g.players, newPlayer].sort((a, b) => a.seat - b.seat),
    pending_joins: g.pending_joins.filter((j) => j.id !== requestId),
    updated_at: now(),
    last_action: midHand
      ? `${req.display_name} seated in ${req.seat} (waits for next hand)`
      : `${req.display_name} joined seat ${req.seat}`,
  };

  let hostId: string | undefined;
  if (!g.host_id) {
    next = { ...next, host_id: req.user_id };
    hostId = req.user_id;
  }

  return { game: next, hostId };
}

export function denyJoin(game: GameState, hostUserId: string, requestId: string): GameState {
  const g = normalizeGameState(game);
  if (hostUserId !== g.host_id) {
    throw new GameApiError(GameErrorCode.HOST_ONLY, 'Host only.', 403);
  }
  const req = g.pending_joins.find((j) => j.id === requestId);
  if (!req) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Join request not found.', 404);
  }
  return {
    ...g,
    pending_joins: g.pending_joins.filter((j) => j.id !== requestId),
    updated_at: now(),
    last_action: `Host declined ${req.display_name}'s seat request`,
  };
}

/** Host-only: force a seated player to be marked away (immediate). */
export function hostForceAway(game: GameState, hostUserId: string, targetSeat: number): GameState {
  const g = normalizeGameState(game);
  if (hostUserId !== g.host_id) {
    throw new GameApiError(GameErrorCode.HOST_ONLY, 'Host only.', 403);
  }

  const player = g.players.find((p) => p.seat === targetSeat);
  if (!player) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'No player in that seat.', 404);
  }

  if (player.presence === 'away') {
    return g;
  }

  return {
    ...g,
    players: g.players.map((p) =>
      p.seat === targetSeat
        ? { ...p, presence: 'away' as const, seat_intent: 'none' as const, in_current_hand: false }
        : p
    ),
    updated_at: now(),
    last_action: `Host set ${player.display_name} (seat ${targetSeat}) away`,
  };
}

/** Host-only: immediately remove a player from their seat (kick). Cannot remove the current host. */
export function hostRemovePlayer(game: GameState, hostUserId: string, targetSeat: number): GameState {
  const g = normalizeGameState(game);
  if (hostUserId !== g.host_id) {
    throw new GameApiError(GameErrorCode.HOST_ONLY, 'Host only.', 403);
  }

  const player = g.players.find((p) => p.seat === targetSeat);
  if (!player) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'No player in that seat.', 404);
  }

  if (player.user_id === g.host_id) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      'Transfer host to another player before removing the host from their seat.',
      409
    );
  }

  return removePlayerFromSeat(g, player.user_id, `Host removed ${player.display_name} from seat ${targetSeat}`);
}

export function requestSetAway(game: GameState, userId: string): GameState {
  const g = normalizeGameState(game);
  const player = findPlayer(g, userId);
  if (!player) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'You are not seated.', 400);
  }

  // Toggle: if already away (or pending away), bring them back
  if (player.presence === 'away' || player.seat_intent === 'pending_away') {
    return {
      ...g,
      players: g.players.map((p) =>
        p.user_id === userId
          ? { ...p, presence: 'active' as const, seat_intent: 'none' as const }
          : p
      ),
      updated_at: now(),
      last_action: `${player.display_name} is back`,
    };
  }

  if (canApplySeatIntentNow(player, g)) {
    return {
      ...g,
      players: g.players.map((p) =>
        p.user_id === userId
          ? { ...p, presence: 'away' as const, seat_intent: 'none' as const, in_current_hand: false }
          : p
      ),
      updated_at: now(),
      last_action: `${player.display_name} is away`,
    };
  }

  return {
    ...g,
    players: g.players.map((p) =>
      p.user_id === userId ? { ...p, seat_intent: 'pending_away' as const } : p
    ),
    updated_at: now(),
    last_action: `${player.display_name} will sit out after this hand`,
  };
}

export function requestStandUp(game: GameState, userId: string): GameState {
  const g = normalizeGameState(game);
  const player = findPlayer(g, userId);
  if (!player) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'You are not seated.', 400);
  }

  if (userId === g.host_id) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      'Transfer host to another player before leaving your seat.',
      409
    );
  }

  if (canApplySeatIntentNow(player, g)) {
    return removePlayerFromSeat(g, userId, `${player.display_name} left the table`);
  }

  return {
    ...g,
    players: g.players.map((p) =>
      p.user_id === userId ? { ...p, seat_intent: 'pending_stand' as const } : p
    ),
    updated_at: now(),
    last_action: `${player.display_name} will leave after this hand`,
  };
}

export function removePlayerFromSeat(
  game: GameState,
  userId: string,
  lastAction: string
): GameState {
  return {
    ...game,
    players: game.players.filter((p) => p.user_id !== userId),
    updated_at: now(),
    last_action: lastAction,
  };
}

export function applyPendingSeatIntents(game: GameState): GameState {
  let g = normalizeGameState(game);
  const toRemove: string[] = [];
  const players = g.players.map((p) => {
    if (p.seat_intent === 'pending_stand') {
      toRemove.push(p.user_id);
      return p;
    }
    if (p.seat_intent === 'pending_away') {
      return {
        ...p,
        presence: 'away' as const,
        seat_intent: 'none' as const,
        in_current_hand: false,
      };
    }
    return { ...p, seat_intent: 'none' as const };
  });

  g = {
    ...g,
    players: players.filter((p) => !toRemove.includes(p.user_id)),
    updated_at: now(),
  };
  return g;
}

export function preparePlayersForNewHand(game: GameState): GameState {
  let g = applyPendingSeatIntents(game);

  // Apply pending chip adds (post previous award or for between-hand requests).
  // Capping and clearing happens inside.
  g = applyPendingChipAdds(g);

  g = {
    ...g,
    players: g.players.map((p) => {
      const eligible = p.presence === 'active' && p.stack > 0;
      return {
        ...p,
        contributed_this_hand: 0,
        bet_this_street: 0,
        hole_cards: [],
        live_hole_cards: [],
        shredded_cards: [],
        status: 'active' as const,
        current_pip_total: 0,
        final_pip_total: null,
        hand_result: null,
        in_current_hand: eligible && !p.waits_for_button,
      };
    }),
    rebuy_deadline_at: null,
    rebuy_offered_seats: [],
  };

  return g;
}

/** After button rotation — seat anyone eligible who is no longer waiting. */
export function activateEligiblePlayersForHand(game: GameState): GameState {
  const g = normalizeGameState(game);
  return {
    ...g,
    players: g.players.map((p) => {
      const eligible =
        p.presence === 'active' && p.stack > 0 && !p.waits_for_button;
      return {
        ...p,
        in_current_hand: eligible,
      };
    }),
    updated_at: now(),
  };
}

export function openRebuyWindow(game: GameState): GameState {
  const g = normalizeGameState(game);
  const brokeSeats = g.players.filter((p) => p.stack <= 0).map((p) => p.seat);
  if (brokeSeats.length === 0) {
    return { ...g, rebuy_deadline_at: null, rebuy_offered_seats: [] };
  }
  const deadline = addSeconds(new Date().toISOString(), GAME_CONFIG.REBUY_WINDOW_SECONDS);
  return {
    ...g,
    status: 'finished',
    rebuy_deadline_at: deadline,
    rebuy_offered_seats: brokeSeats,
    pending_rebuys: [],
    last_action: `Rebuy window open (${GAME_CONFIG.REBUY_WINDOW_SECONDS}s) for broke players`,
  };
}

export function assertCanStartHand(game: GameState): void {
  const g = normalizeGameState(game);
  const hasPendingRebuys = (g.pending_rebuys || []).length > 0;
  if (isRebuyWindowOpen(g) || hasPendingRebuys) {
    throw new GameApiError(
      GameErrorCode.WRONG_PHASE,
      `Rebuy window open or pending rebuy approvals — wait or have host approve/deny rebuys before starting new hand.`,
      409
    );
  }
  // No minimum player count enforced (heads-up / 2+ supported per user direction)
}

export function playerRebuy(
  game: GameState,
  userId: string,
  stackCents: number
): GameState {
  const g = normalizeGameState(game);
  const player = findPlayer(g, userId);
  if (!player) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'You are not seated.', 400);
  }
  if (!g.rebuy_offered_seats.includes(player.seat)) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Rebuy is not offered to your seat.', 409);
  }
  if (!isRebuyWindowOpen(g)) {
    throw new GameApiError(GameErrorCode.WRONG_PHASE, 'Rebuy window has closed.', 409);
  }

  // Enforce auto-rebuy range (min 100, max per current post-payout largest)
  const range = getBuyInRange(g);
  if (stackCents < range.minCents || stackCents > range.maxCents) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      `Rebuy stack must be between ${range.minCents / 100} and ${range.maxCents / 100}.`,
      400
    );
  }

  if (stackCents <= 0) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Rebuy amount must be positive.', 400);
  }

  const remaining = g.rebuy_offered_seats.filter((s) => s !== player.seat);
  return {
    ...g,
    players: g.players.map((p) =>
      p.user_id === userId ? { ...p, stack: stackCents, presence: 'active' as const, seat_intent: 'none' as const } : p
    ),
    rebuy_offered_seats: remaining,
    rebuy_deadline_at: remaining.length === 0 ? null : g.rebuy_deadline_at,
    updated_at: now(),
    last_action: `${player.display_name} rebought for ${(stackCents / 100).toFixed(2)}`,
  };
}

/**
 * If the rebuy deadline has passed and there are still offered seats that didn't rebuy,
 * force those players to 'away' and clear the rebuy window. Called on mutations (esp. start hand)
 * so that "out of chips + no rebuy in 10s => away" is enforced automatically.
 */
export function applyRebuyTimeouts(game: GameState): GameState {
  const g = normalizeGameState(game);
  if (!g.rebuy_deadline_at || (g.rebuy_offered_seats?.length ?? 0) === 0) {
    return g;
  }
  const deadlineMs = new Date(g.rebuy_deadline_at).getTime();
  if (deadlineMs > Date.now()) {
    return g; // still open
  }
  // Only auto-away the seats still in offered (they didn't request within the 10s).
  // Keep any pending_rebuys (those who did request in time); host can still approve them later.
  const offeredSeats = new Set(g.rebuy_offered_seats);
  const pendingSeats = new Set((g.pending_rebuys || []).map((r) => r.seat));
  const toAutoAway = new Set([...offeredSeats].filter((s) => !pendingSeats.has(s)));
  const affectedPlayers = g.players.filter((p) => toAutoAway.has(p.seat));
  if (affectedPlayers.length === 0) {
    return { ...g, rebuy_deadline_at: null, rebuy_offered_seats: [] };
  }
  const updated = g.players.map((p) =>
    toAutoAway.has(p.seat) && p.stack <= 0
      ? { ...p, presence: 'away' as const, seat_intent: 'none' as const, in_current_hand: false }
      : p
  );
  const names = affectedPlayers.map((p) => p.display_name).join(', ');
  return {
    ...g,
    players: updated,
    rebuy_deadline_at: null,
    rebuy_offered_seats: [],
    // pending_rebuys kept for host approval
    updated_at: now(),
    last_action: `${names} did not rebuy in time — set away`,
  };
}

/** Player requests to add (top-up) chips. Creates a pending request for host approval. */
export function requestAddChips(game: GameState, userId: string, amountCents: number): GameState {
  const g = normalizeGameState(game);
  const player = findPlayer(g, userId);
  if (!player) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'You are not seated.', 400);
  }
  if (amountCents <= 0) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Add amount must be positive.', 400);
  }
  // Prevent duplicate pending request from same user
  if (g.pending_chip_adds?.some((r) => r.user_id === userId)) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'You already have a pending chip add request.', 409);
  }

  const req: import('@/types/game').PendingChipAddRequest = {
    id: crypto.randomUUID(),
    user_id: userId,
    seat: player.seat,
    display_name: player.display_name,
    amount_cents: amountCents,
    requested_at: now(),
  };

  return {
    ...g,
    pending_chip_adds: [...(g.pending_chip_adds || []), req],
    updated_at: now(),
    last_action: `${player.display_name} requested +${(amountCents / 100).toFixed(2)} chips (will apply after current hand)`,
  };
}

/** Host approves a pending chip add: credit the stack immediately (mid-hand ok for top-up). */
export function approveAddChips(game: GameState, hostUserId: string, requestId: string): GameState {
  const g = normalizeGameState(game);
  if (hostUserId !== g.host_id) {
    throw new GameApiError(GameErrorCode.HOST_ONLY, 'Host only.', 403);
  }
  const pendings = g.pending_chip_adds || [];
  const req = pendings.find((r) => r.id === requestId);
  if (!req) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Chip add request not found.', 404);
  }
  const player = g.players.find((p) => p.seat === req.seat);
  if (!player) {
    // cleanup stale
    return {
      ...g,
      pending_chip_adds: pendings.filter((r) => r.id !== requestId),
      updated_at: now(),
    };
  }

  const newStack = player.stack + req.amount_cents;
  const updatedPlayers = g.players.map((p) =>
    p.seat === req.seat ? { ...p, stack: newStack } : p
  );

  const remaining = pendings.filter((r) => r.id !== requestId);
  return {
    ...g,
    players: updatedPlayers,
    pending_chip_adds: remaining,
    updated_at: now(),
    last_action: `Host approved ${req.display_name}'s +${(req.amount_cents / 100).toFixed(2)} chip add (now ${(newStack / 100).toFixed(2)})`,
  };
}

/** Host denies a pending chip add request (no stack change). */
export function denyAddChips(game: GameState, hostUserId: string, requestId: string): GameState {
  const g = normalizeGameState(game);
  if (hostUserId !== g.host_id) {
    throw new GameApiError(GameErrorCode.HOST_ONLY, 'Host only.', 403);
  }
  const pendings = g.pending_chip_adds || [];
  const req = pendings.find((r) => r.id === requestId);
  if (!req) {
    return g;
  }
  const remaining = pendings.filter((r) => r.id !== requestId);
  return {
    ...g,
    pending_chip_adds: remaining,
    updated_at: now(),
    last_action: `Host denied ${req.display_name}'s chip add request`,
  };
}

/** Player requests a rebuy (during the rebuy window). Creates pending for host approval. */
export function requestRebuy(game: GameState, userId: string, stackCents: number): GameState {
  const g = normalizeGameState(game);
  const player = findPlayer(g, userId);
  if (!player) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'You are not seated.', 400);
  }
  if (!g.rebuy_offered_seats.includes(player.seat)) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Rebuy is not offered to your seat.', 409);
  }
  if (!isRebuyWindowOpen(g)) {
    throw new GameApiError(GameErrorCode.WRONG_PHASE, 'Rebuy window has closed.', 409);
  }
  if (stackCents <= 0) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Rebuy amount must be positive.', 400);
  }
  // Enforce range even for pending requests (defensive)
  const range = getBuyInRange(g);
  if (stackCents < range.minCents || stackCents > range.maxCents) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      `Rebuy stack must be between ${range.minCents / 100} and ${range.maxCents / 100}.`,
      400
    );
  }
  const pendings = g.pending_rebuys || [];
  if (pendings.some((r) => r.user_id === userId)) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'You already have a pending rebuy request.', 409);
  }

  const req: import('@/types/game').PendingRebuyRequest = {
    id: crypto.randomUUID(),
    user_id: userId,
    seat: player.seat,
    display_name: player.display_name,
    starting_stack_cents: stackCents,
    requested_at: now(),
  };

  // Remove from offered so player's rebuy modal closes (they have requested), countdown stops for them.
  // Pending remains for host to approve/deny. This way, approval can happen even after the original 10s window.
  const remainingOffered = g.rebuy_offered_seats.filter((s) => s !== player.seat);

  return {
    ...g,
    rebuy_offered_seats: remainingOffered,
    rebuy_deadline_at: remainingOffered.length === 0 ? null : g.rebuy_deadline_at,
    pending_rebuys: [...pendings, req],
    updated_at: now(),
    last_action: `${player.display_name} requested rebuy for ${(stackCents / 100).toFixed(2)} (pending host approval)`,
  };
}

/** Host approves a rebuy request: performs the rebuy (awards stack), cleans offered and pending. */
export function approveRebuy(game: GameState, hostUserId: string, requestId: string): GameState {
  const g = normalizeGameState(game);
  if (hostUserId !== g.host_id) {
    throw new GameApiError(GameErrorCode.HOST_ONLY, 'Host only.', 403);
  }
  const pendings = g.pending_rebuys || [];
  const req = pendings.find((r) => r.id === requestId);
  if (!req) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Rebuy request not found.', 404);
  }

  // Perform the rebuy (for requests made in time; we allow approve even after the 10s window
  // since the player requested promptly, and we removed them from offered on request).
  // No offered or window check here (unlike direct playerRebuy).
  const player = g.players.find((p) => p.seat === req.seat);
  if (!player) {
    return {
      ...g,
      pending_rebuys: pendings.filter((r) => r.id !== requestId),
      updated_at: now(),
    };
  }

  const updatedPlayers = g.players.map((p) =>
    p.user_id === req.user_id ? { ...p, stack: req.starting_stack_cents, presence: 'active' as const, seat_intent: 'none' as const } : p
  );

  const remainingPendings = pendings.filter((r) => r.id !== requestId);
  // Offered should already be cleaned on request; clean any remaining for this seat
  const remainingOffered = g.rebuy_offered_seats.filter((s) => s !== req.seat);

  return {
    ...g,
    players: updatedPlayers,
    rebuy_offered_seats: remainingOffered,
    rebuy_deadline_at: remainingOffered.length === 0 ? null : g.rebuy_deadline_at,
    pending_rebuys: remainingPendings,
    updated_at: now(),
    last_action: `Host approved ${req.display_name}'s rebuy for ${(req.starting_stack_cents / 100).toFixed(2)}`,
  };
}

/** Host denies a rebuy request. */
export function denyRebuy(game: GameState, hostUserId: string, requestId: string): GameState {
  const g = normalizeGameState(game);
  if (hostUserId !== g.host_id) {
    throw new GameApiError(GameErrorCode.HOST_ONLY, 'Host only.', 403);
  }
  const pendings = g.pending_rebuys || [];
  const req = pendings.find((r) => r.id === requestId);
  if (!req) {
    return g;
  }
  // On deny, also remove from offered so they can't re-request in this window
  const remainingOffered = g.rebuy_offered_seats.filter((s) => s !== req.seat);
  const remainingPendings = pendings.filter((r) => r.id !== requestId);
  return {
    ...g,
    rebuy_offered_seats: remainingOffered,
    rebuy_deadline_at: remainingOffered.length === 0 ? null : g.rebuy_deadline_at,
    pending_rebuys: remainingPendings,
    updated_at: now(),
    last_action: `Host denied ${req.display_name}'s rebuy request`,
  };
}

export function assertTurnTimerExpired(game: GameState, seat: number): void {
  const g = normalizeGameState(game);
  if (!GAME_CONFIG.TURN_TIMER_ENABLED) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Turn timer is disabled.', 400);
  }
  if (g.current_player_seat !== seat) {
    throw new GameApiError(GameErrorCode.NOT_YOUR_TURN, 'Not this seat turn.', 403);
  }
  if (!g.turn_deadline_at || new Date(g.turn_deadline_at).getTime() > Date.now()) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Turn timer has not expired.', 400);
  }
}

export function applySeatIntentAfterFold(game: GameState, seat: number): GameState {
  const g = normalizeGameState(game);
  const player = g.players.find((p) => p.seat === seat);
  if (!player) return g;

  if (player.seat_intent === 'pending_stand') {
    return removePlayerFromSeat(g, player.user_id, `${player.display_name} left the table`);
  }
  if (player.seat_intent === 'pending_away') {
    return {
      ...g,
      players: g.players.map((p) =>
        p.seat === seat
          ? { ...p, presence: 'away' as const, seat_intent: 'none' as const }
          : p
      ),
      updated_at: now(),
    };
  }
  return g;
}