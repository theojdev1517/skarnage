import type { SupabaseClient } from '@/lib/game/persistGame';

export async function logLedgerEvent(
  supabase: SupabaseClient | undefined,
  gameId: string,
  handNumber: number,
  eventType: string,
  data: Record<string, any>,
  userId: string | null = null
) {
  if (!supabase) return;

  try {
    // Compute next sequence for this (game, hand)
    const { data: maxData, error: maxError } = await supabase
      .from('ledger_events')
      .select('seq')
      .eq('game_id', gameId)
      .eq('hand_number', handNumber)
      .order('seq', { ascending: false })
      .limit(1);

    let nextSequence = 1;
    if (!maxError && maxData && maxData.length > 0 && typeof maxData[0].seq === 'number') {
      nextSequence = maxData[0].seq + 1;
    }

    const row = {
      game_id: gameId,
      hand_number: handNumber,
      seq: nextSequence,
      event_type: eventType,
      data,
      user_id: userId,
    };

    const { error } = await supabase.from('ledger_events').insert(row);
    if (error) {
      console.error(`[ledger] Failed to log ${eventType} for game ${gameId} hand ${handNumber}:`, error);
    }
  } catch (err) {
    console.error('[ledger] Unexpected error logging event:', err);
  }
}
