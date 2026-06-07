import type { GameState } from '@/types/game';
import { GameApiError, GameErrorCode } from '@/lib/game/apiErrors';

export type SupabaseClient = Awaited<
  ReturnType<typeof import('@/lib/supabase').createServerClient>
>;

export async function saveGameState(
  supabase: SupabaseClient,
  gameId: string,
  previousUpdatedAt: string,
  gameState: GameState,
  extra?: { host_id?: string }
): Promise<void> {
  const row: { game_state: GameState; host_id?: string } = {
    game_state: gameState,
    ...extra,
  };

  const { data, error } = await supabase
    .from('games')
    .update(row)
    .eq('id', gameId)
    .filter('game_state->>updated_at', 'eq', previousUpdatedAt)
    .select('id');

  if (error) {
    console.error('DB update error:', error);
    throw new GameApiError(
      GameErrorCode.SAVE_FAILED,
      'Could not save the table. Try again.',
      500
    );
  }

  if (!data || data.length === 0) {
    throw new GameApiError(
      GameErrorCode.STALE_STATE,
      'Someone else updated the table first. Refreshing usually fixes this — try your action again.',
      409
    );
  }
}