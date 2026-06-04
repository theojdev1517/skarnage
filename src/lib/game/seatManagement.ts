import type { GameState, PendingJoinRequest } from '@/types/game';
import { GameApiError, GameErrorCode } from '@/lib/game/apiErrors';
import { now } from '@/lib/game/time';
import { GAME_CONFIG } from '@/lib/game/config';
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
    discard_submitted: false,
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

export function requestSetAway(game: GameState, userId: string): GameState {
  const g = normalizeGameState(game);
  const player = findPlayer(g, userId);
  if (!player) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'You are not seated.', 400);
  }

  if (player.presence === 'away' && player.seat_intent !== 'pending_away') {
    return g;
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
        discard_submitted: false,
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
    last_action: `Rebuy window open (${GAME_CONFIG.REBUY_WINDOW_SECONDS}s) for broke players`,
  };
}

export function assertCanStartHand(game: GameState): void {
  const g = normalizeGameState(game);
  if (isRebuyWindowOpen(g)) {
    throw new GameApiError(
      GameErrorCode.WRONG_PHASE,
      `Rebuy window open — wait ${GAME_CONFIG.REBUY_WINDOW_SECONDS}s or until broke players rebuy.`,
      409
    );
  }
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
  if (stackCents <= 0) {
    throw new GameApiError(GameErrorCode.INVALID_REQUEST, 'Rebuy amount must be positive.', 400);
  }

  const remaining = g.rebuy_offered_seats.filter((s) => s !== player.seat);
  return {
    ...g,
    players: g.players.map((p) =>
      p.user_id === userId ? { ...p, stack: stackCents, presence: 'active' as const } : p
    ),
    rebuy_offered_seats: remaining,
    rebuy_deadline_at: remaining.length === 0 ? null : g.rebuy_deadline_at,
    updated_at: now(),
    last_action: `${player.display_name} rebought for ${(stackCents / 100).toFixed(2)}`,
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