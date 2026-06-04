import type { GameState } from '@/types/game';
import { requestJoin } from '@/lib/game/seatManagement';

/** Client requests a seat; host must approve before player is seated. */
export function applyJoinRequest(
  game: GameState,
  userId: string,
  seat: number,
  displayName: string,
  startingStackCents: number
): GameState {
  return requestJoin(game, userId, seat, displayName, startingStackCents);
}