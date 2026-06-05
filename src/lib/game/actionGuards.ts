import type { GameState, GameStatus } from '@/types/game';
import { GameApiError, GameErrorCode } from '@/lib/game/apiErrors';
import { isBetAction, type BetAction } from '@/lib/game/validateState';

const BETTING_PHASES: GameStatus[] = [
  'preflop_betting',
  'flop_betting',
  'turn_betting',
  'river_betting',
];

export type GameMutationAction =
  | 'startHand'
  | 'bet'
  | 'advance'
  | 'hostAddStack'
  | 'hostRemoveStack'
  | 'hostSetStack'
  | 'hostTransfer'
  | 'hostForceAway'
  | 'hostRemovePlayer'
  | 'requestJoin'
  | 'approveJoin'
  | 'denyJoin'
  | 'setAway'
  | 'standUp'
  | 'rebuy'
  | 'requestAddChips'
  | 'approveAddChips'
  | 'denyAddChips'
  | 'requestRebuy'
  | 'approveRebuy'
  | 'denyRebuy'
  | 'turnTimeout';

export function assertPhaseAllows(game: GameState, mutation: GameMutationAction): void {
  const status = game.status;

  switch (mutation) {
    case 'startHand':
      if (status !== 'waiting' && status !== 'finished') {
        throw new GameApiError(
          GameErrorCode.WRONG_PHASE,
          'A hand is already in progress. Finish it before starting a new one.',
          409
        );
      }
      return;

    case 'bet':
    case 'turnTimeout':
      if (!BETTING_PHASES.includes(status)) {
        throw new GameApiError(
          GameErrorCode.WRONG_PHASE,
          'Betting is only allowed during a betting round.',
          409
        );
      }
      return;

    case 'requestJoin':
    case 'approveJoin':
    case 'denyJoin':
      return;

    case 'setAway':
    case 'standUp':
    case 'rebuy':
    case 'requestAddChips':
    case 'approveAddChips':
    case 'denyAddChips':
    case 'requestRebuy':
    case 'approveRebuy':
    case 'denyRebuy':
      return;

    case 'hostTransfer':
    case 'hostForceAway':
    case 'hostRemovePlayer':
      return;

    case 'hostAddStack':
    case 'hostRemoveStack':
    case 'hostSetStack':
      if (status !== 'waiting' && status !== 'finished') {
        throw new GameApiError(
          GameErrorCode.WRONG_PHASE,
          'Host stack edits are only allowed between hands.',
          409
        );
      }
      return;

    case 'advance':
      if (status === 'showdown') {
        throw new GameApiError(
          GameErrorCode.WRONG_PHASE,
          'Cannot advance manually during showdown.',
          409
        );
      }
      return;

    default:
      return;
  }
}

export function parseBetAction(value: unknown): BetAction {
  if (!isBetAction(value)) {
    throw new GameApiError(
      GameErrorCode.INVALID_REQUEST,
      'Invalid betting action.',
      400
    );
  }
  return value;
}

/** Seat must belong to the user and be the current actor in a live hand. */
export function assertActorOnTurn(
  game: GameState,
  seat: number,
  userId: string
): void {
  const actor = game.players.find((p) => p.seat === seat);
  if (!actor || actor.user_id !== userId) {
    throw new GameApiError(
      GameErrorCode.NOT_YOUR_SEAT,
      'That seat is not yours.',
      403
    );
  }
  if (game.current_player_seat !== seat) {
    throw new GameApiError(GameErrorCode.NOT_YOUR_TURN, 'Not your turn.', 403);
  }
  if (!actor.in_current_hand) {
    throw new GameApiError(
      GameErrorCode.RULE_VIOLATION,
      'You are not in this hand.',
      403
    );
  }
  if (!['active', 'all_in'].includes(actor.status)) {
    throw new GameApiError(
      GameErrorCode.RULE_VIOLATION,
      'You cannot act right now.',
      403
    );
  }
}