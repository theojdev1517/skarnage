'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useGameState } from '@/hooks/useGameState';
import { useAuth } from '@/hooks/useAuth';
import { isBettingPhase } from '@/lib/game/clientView';
import { evaluateHighHand } from '@/lib/game/evaluator';
import { CardGrid, CardRow } from '@/components/game/PlayingCard';
import { BettingControls } from '@/components/game/BettingControls';
import { JoinSeatModal } from '@/components/game/JoinSeatModal';
import { SeatHostMenu } from '@/components/game/SeatHostMenu';
import { HostJoinApprovals } from '@/components/game/HostJoinApprovals';
import { HostRebuyApprovals } from '@/components/game/HostRebuyApprovals';
import { TablePlayerControls } from '@/components/game/TablePlayerControls';
import { TurnTimer } from '@/components/game/TurnTimer';
import { AddChipsModal } from '@/components/game/AddChipsModal';
import { TableBanner } from '@/components/game/TableBanner';
import { RebuyStackModal } from '@/components/game/RebuyStackModal';
import { messageFromGameApi } from '@/lib/game/safeErrors';
import { formatStack } from '@/lib/formatStack';
import { getBuyInRange } from '@/lib/game/seatManagement';
import type { Card, Player } from '@/types/game';

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { userId, loading: authLoading, authError } = useAuth();
  const { game, loading: gameLoading, error: loadError, refresh } = useGameState(
    gameId || ''
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [tableMessage, setTableMessage] = useState<{
    text: string;
    variant: 'error' | 'info';
  } | null>(null);

  const loading = authLoading || gameLoading;

  const myPlayer = game?.players?.find((p) => p.user_id === userId) ?? null;
  const currentActor = game?.players?.find((p) => p.seat === game?.current_player_seat);
  const isMyTurn =
    !!game &&
    !!myPlayer &&
    myPlayer.in_current_hand &&
    !!currentActor &&
    currentActor.user_id === userId &&
    isBettingPhase(game.status);

  const myPendingJoin = game?.pending_joins?.find((j) => j.user_id === userId);
  const turnTimeoutSent = useRef(false);
  const [seatMenu, setSeatMenu] = useState<{
    player: Player;
    x: number;
    y: number;
  } | null>(null);
  const [joinModal, setJoinModal] = useState<{ seat: number } | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Rebuy modal (popup) + live countdown (instead of RebuyBanner in action area). open derived to avoid set-in-effect.
  const [rebuySecondsLeft, setRebuySecondsLeft] = useState(0);
  const [justRequestedRebuy, setJustRequestedRebuy] = useState(false);
  const [rebuyInteracting, setRebuyInteracting] = useState(false); // pause countdown + keep modal open while user is typing/editing

  // Per-player "add chips" request (for the seated player's own seat)
  const [addChipsModal, setAddChipsModal] = useState<{ seat: number; displayName?: string } | null>(null);
  const [addChipsBusy, setAddChipsBusy] = useState(false);
  const [addChipsError, setAddChipsError] = useState<string | null>(null);

  const isHost = !!game?.host_id && userId === game.host_id;

  const buyInRange = game ? getBuyInRange(game) : { minCents: 10000, maxCents: 10000 };

  const myHighHand = useMemo(() => {
    if (!myPlayer || !game) return null;
    const community = game.board.top.filter((c): c is Card => c !== null);
    const live = myPlayer.live_hole_cards;
    if (live.length + community.length < 5) return null;
    return evaluateHighHand(live, community);
  }, [myPlayer, game?.board.top]);

  // Live rebuy countdown + control modal open (rebuy is now a popup, not banner in action section)
  const rebuyOffered =
    !!myPlayer &&
    !!game &&
    game.rebuy_offered_seats?.includes(myPlayer.seat) &&
    !!game.rebuy_deadline_at;
  const rebuyModalOpen = rebuyOffered && (rebuySecondsLeft > 0 || rebuyInteracting) && !justRequestedRebuy;
  useEffect(() => {
    if (!rebuyOffered || !game?.rebuy_deadline_at) {
      setRebuySecondsLeft(0);
      setJustRequestedRebuy(false);
      setRebuyInteracting(false);
      return;
    }
    const tick = () => {
      if (rebuyInteracting) return; // pause the displayed countdown while user is interacting (typing etc.)
      const ms = new Date(game.rebuy_deadline_at!).getTime() - Date.now();
      const secs = Math.max(0, Math.ceil(ms / 1000));
      setRebuySecondsLeft(secs);
    };
    // Avoid sync setState inside effect body (lint); use micro timeout for first update.
    const t0 = window.setTimeout(tick, 5);
    const id = window.setInterval(tick, 400);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(id);
    };
  }, [rebuyOffered, game?.rebuy_deadline_at, game, rebuyInteracting]);

  // Client-side nudge: after known deadlines (showdown or rebuy timers), force a refresh.
  // This triggers server-side apply*Timeout + auto-advance even with no other user actions/POSTs.
  // Ensures "auto" without requiring interaction after timers expire (e.g. no rebuys needed, or after window).
  useEffect(() => {
    if (!game) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const scheduleNudge = (deadline: string | null | undefined) => {
      if (!deadline) return;
      const target = new Date(deadline).getTime();
      const ms = Math.max(0, target - Date.now() + 500);
      const t = setTimeout(() => {
        refresh().catch(() => {});
      }, ms);
      timers.push(t);
    };
    scheduleNudge(game.showdown_deadline_at);
    scheduleNudge(game.rebuy_deadline_at);
    // If already past on mount, nudge soon
    if (game.showdown_deadline_at && new Date(game.showdown_deadline_at).getTime() < Date.now()) {
      const t = setTimeout(() => refresh().catch(() => {}), 0);
      timers.push(t);
    }
    if (game.rebuy_deadline_at && new Date(game.rebuy_deadline_at).getTime() < Date.now()) {
      const t = setTimeout(() => refresh().catch(() => {}), 0);
      timers.push(t);
    }
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [game?.showdown_deadline_at, game?.rebuy_deadline_at, refresh]);

  const postGameAction = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/game/${gameId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    let data: { error?: string; code?: string } = {};
    try {
      data = await res.json();
    } catch {
      throw new Error('Server returned an invalid response. Try again.');
    }
    if (!res.ok) {
      if (data.code === 'STALE_STATE') {
        await refresh();
      }
      throw new Error(messageFromGameApi(data));
    }
  };

  const openJoinModal = (seat: number) => {
    if (!userId) {
      setJoinError('Still signing in…');
      setJoinModal({ seat });
      return;
    }
    if (myPlayer && myPlayer.seat !== seat) {
      setJoinError(`You are already in seat ${myPlayer.seat}`);
      setJoinModal({ seat });
      return;
    }
    setJoinError(null);
    setJoinModal({ seat });
  };

  const submitJoin = async (displayName: string, stackCents: number) => {
    if (!joinModal) return;
    setJoinBusy(true);
    setJoinError(null);
    try {
      // Use direct 'join' (auto buy-in with server enforcement of 100 pre-start or range post-start).
      // No host approval step for standard buy-ins.
      const res = await fetch(`/api/game/${gameId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'join',
          seat: joinModal.seat,
          displayName,
          startingStackCents: stackCents,
        }),
      });
      let data: { error?: string; code?: string } = {};
      try {
        data = await res.json();
      } catch {
        setJoinError('Server returned an invalid response. Try again.');
        return;
      }
      if (!res.ok) {
        setJoinError(messageFromGameApi(data, 'Could not join seat'));
        return;
      }
      setJoinModal(null);
      await refresh();
    } catch {
      setJoinError('Could not join seat. Check your connection and try again.');
    } finally {
      setJoinBusy(false);
    }
  };

  const submitAddChips = async (amountCents: number) => {
    if (!addChipsModal) return;
    setAddChipsBusy(true);
    setAddChipsError(null);
    try {
      // Direct add chips (bounded by buy-in range minus current stack; no request or host approval).
      const res = await fetch(`/api/game/${gameId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'addChips', amountCents }),
      });
      let data: { error?: string; code?: string } = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        setAddChipsError(messageFromGameApi(data, 'Could not add chips'));
        return;
      }
      setAddChipsModal(null);
      await refresh();
    } catch {
      setAddChipsError('Could not add chips. Check your connection and try again.');
    } finally {
      setAddChipsBusy(false);
    }
  };

  const runAction = async (body: Record<string, unknown>) => {
    setActionBusy(true);
    setTableMessage(null);
    try {
      await postGameAction(body);
      await refresh();
    } catch (e) {
      setTableMessage({
        text: e instanceof Error ? e.message : 'Action failed',
        variant: 'error',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleTurnTimeout = useCallback(
    async (seat: number) => {
      if (turnTimeoutSent.current) return;
      turnTimeoutSent.current = true;
      try {
        await postGameAction({ action: 'turnTimeout', seat });
        await refresh();
      } catch {
        /* ignore duplicate timeout */
      }
    },
    [gameId, refresh]
  );

  const handleAction = async (
    betAction: 'fold' | 'check' | 'call' | 'bet' | 'raise',
    amount: number = 0,
    options?: { confirmFreeFold?: boolean }
  ) => {
    if (!game || !myPlayer) {
      throw new Error('Take a seat first.');
    }
    if (!isMyTurn) {
      throw new Error('Not your turn.');
    }
    setActionBusy(true);
    setTableMessage(null);
    try {
      await postGameAction({
        action: 'bet',
        seat: myPlayer.seat,
        betAction,
        amount,
        ...(options?.confirmFreeFold ? { confirmFreeFold: true } : {}),
      });
      await refresh();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <div className="p-4 text-center text-white">Loading table…</div>;
  if (loadError) {
    return (
      <div className="p-4 text-center text-white space-y-3">
        <p>{loadError}</p>
        <button
          type="button"
          onClick={() => refresh()}
          className="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!game) return <div className="p-4 text-center text-white">Game not found</div>;

  const topBoard = game.board.top.filter((c): c is Card => c !== null);
  const shredderBoard = game.board.shredder.filter((c): c is Card => c !== null);
  const hasHoleCards =
    (myPlayer?.hole_cards?.length ?? 0) > 0 || (myPlayer?.live_hole_cards?.length ?? 0) > 0;
  // Show results during the invisible showdown timer (status 'showdown' with precomputed summary)
  // as well as after award (finished). This gives the 10s pause for players to process.
  const showShowdown = (game.status === 'showdown' || game.status === 'finished') && !!game.showdown_summary;

  const toCall =
    myPlayer && isBettingPhase(game.status)
      ? Math.max(0, (game.current_wager ?? 0) - myPlayer.bet_this_street)
      : 0;
  const facingBet = toCall > 0;

  return (
    <div className="min-h-screen max-h-screen overflow-hidden bg-[#0a1f0a] text-white flex flex-col">
      {/* Top bar */}
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-emerald-900 bg-[#071407]">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold text-emerald-400">Skarney</h1>
          <span className="text-emerald-200 font-medium">
            Pot {formatStack(game.pot)}
          </span>
          <span className="text-zinc-500 text-xs">{game.status.replace(/_/g, ' ')}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {myPlayer && (
            <span className="text-amber-300">
              {myPlayer.display_name} · seat {myPlayer.seat}
            </span>
          )}
            {isHost && <span className="text-emerald-500">Host</span>}

          <button
            type="button"
            onClick={() => (window.location.href = '/')}
            title="Open home page to create a new table link"
            className="bg-zinc-700 hover:bg-zinc-600 px-3 py-1 rounded"
          >
            New Game
          </button>
          {isHost && game.status === 'waiting' && (
            <button
              type="button"
              onClick={() => void runAction({ action: 'startHand' })}
              className="bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded font-medium"
            >
              Start Game
            </button>
          )}
        </div>
      </header>

      {authError && (
        <TableBanner message={authError} variant="error" />
      )}
      {tableMessage && (
        <TableBanner
          message={tableMessage.text}
          variant={tableMessage.variant}
          onDismiss={() => setTableMessage(null)}
        />
      )}

      <div className="flex-1 min-h-0 grid lg:grid-cols-12 gap-2 p-2 overflow-hidden">
        {/* Left: boards + table */}
        <div className="lg:col-span-7 flex flex-col min-h-0 gap-2 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2 shrink-0">
            <div className="bg-zinc-900 rounded-lg px-2 py-1.5">
              <div className="text-emerald-500 text-[10px] uppercase">Top board</div>
              <CardRow cards={topBoard} />
            </div>
            <div className="bg-zinc-900 rounded-lg px-2 py-1.5">
              <div className="text-red-400 text-[10px] uppercase">Shredder</div>
              <CardRow cards={shredderBoard} />
            </div>
          </div>

          <div className="relative flex-1 min-h-[220px] max-h-[320px] bg-emerald-950 rounded-[50%] border-4 border-emerald-800 mx-auto w-full max-w-2xl">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((seat) => {
              const player = game.players.find((p) => p.seat === seat);
              const isMine = player?.user_id === userId;
              const isActionSeat =
                !!player && game.current_player_seat === seat && isBettingPhase(game.status);
              const pendingRequest = game.pending_joins?.find((j) => j.seat === seat);
              const canJoin = !player && !!userId && !myPlayer && !pendingRequest;
              const isButton = game.button_seat === seat;
              const angle = (seat - 1) * (360 / 8) - 90;

              return (
                <div
                  key={seat}
                  className={`absolute rounded-lg flex flex-col items-center justify-start pt-1 px-0.5 border ${
                    player && isMine && myPlayer?.live_hole_cards.length
                      ? 'w-max max-w-[12rem] min-h-[3.5rem]'
                      : 'w-[4.5rem] min-h-[3.5rem]'
                  } ${
                    isActionSeat
                      ? 'bg-zinc-800 border-amber-400 ring-2 ring-amber-400/80'
                      : canJoin
                        ? 'bg-zinc-900 border-zinc-600 cursor-pointer hover:border-zinc-500'
                        : 'bg-zinc-900 border-zinc-700'
                  }`}
                  style={{
                    left: `calc(50% + ${38 * Math.cos((angle * Math.PI) / 180)}%)`,
                    top: `calc(50% + ${30 * Math.sin((angle * Math.PI) / 180)}%)`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onClick={() => canJoin && openJoinModal(seat)}
                  onContextMenu={(e) => {
                    if (!isHost || !player) return;
                    e.preventDefault();
                    setSeatMenu({ player, x: e.clientX, y: e.clientY });
                  }}
                >
                  {isButton && (
                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">
                      D
                    </span>
                  )}
                  {player ? (
                    <>
                      <div className="text-[10px] font-bold leading-tight text-center px-0.5 truncate w-full">
                        {player.display_name}
                      </div>
                      <div className="text-[10px] text-emerald-300">
                        {formatStack(player.stack)}
                      </div>
                      {player.bet_this_street > 0 && (
                        <div className="text-[9px] text-amber-300 tabular-nums" title="Current bet this street (visible to all)">
                          {formatStack(player.bet_this_street)}
                        </div>
                      )}
                      {isMine && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddChipsModal({ seat: player.seat, displayName: player.display_name });
                          }}
                          className="mt-0.5 text-[9px] px-1.5 py-0.5 rounded bg-emerald-800/70 hover:bg-emerald-700 text-emerald-200 border border-emerald-700/50"
                          title="Add chips (direct, up to current table maximum total stack)"
                        >
                          + add chips
                        </button>
                      )}
                      {isMine && myPlayer && myPlayer.live_hole_cards.length > 0 && (
                        <div className="mt-0.5 pb-0.5">
                          <CardGrid cards={myPlayer.live_hole_cards} />
                        </div>
                      )}
                      {player.presence === 'away' && (
                        <span className="text-[9px] text-zinc-400">AWAY</span>
                      )}
                      {!player.in_current_hand && player.presence === 'active' && (
                        <span className="text-[9px] text-amber-400/90">WAIT</span>
                      )}
                      {player.status === 'dead' && player.in_current_hand && (
                        <span className="text-[9px] text-red-400">OUT</span>
                      )}
                    </>
                  ) : pendingRequest ? (
                    <span className="text-[9px] text-amber-400" title={`Pending approval for ${pendingRequest.display_name}`}>
                      request pending
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-500">+ join</span>
                  )}
                </div>
              );
            })}
          </div>

          {game.last_action && (
            <p className="text-center text-zinc-500 text-xs truncate shrink-0">
              {game.last_action}
            </p>
          )}
        </div>

        {/* Right: hand, showdown, host, actions */}
        <div className="lg:col-span-5 flex flex-col min-h-0 gap-2 overflow-y-auto">
          {myPlayer && (
            <>
              <TablePlayerControls
                game={game}
                myPlayer={myPlayer}
                busy={actionBusy}
                onSetAway={() => void runAction({ action: 'setAway' })}
                onStandUp={() => void runAction({ action: 'standUp' })}
              />
            </>
          )}

          {myPlayer && (
            <div className="bg-zinc-900 border border-amber-700/50 rounded-lg p-2 shrink-0">
              <div className="text-amber-400 text-[10px] font-medium uppercase mb-1">
                Your hand
              </div>
              {hasHoleCards ? (
                <div className="space-y-1.5">
                  <div>
                    <span className="text-zinc-500 text-[10px] block mb-1">Live</span>
                    <CardRow cards={myPlayer.live_hole_cards} />
                  </div>
                  {myPlayer.shredded_cards.length > 0 && (
                    <div>
                      <span className="text-zinc-500 text-[10px] block mb-1">Shredded</span>
                      <CardRow cards={myPlayer.shredded_cards} faded />
                    </div>
                  )}
                  <div className="text-[11px] text-emerald-300/90 flex flex-wrap gap-x-3">
                    <span>Pips: {myPlayer.current_pip_total}</span>
                    {myHighHand && myHighHand.score > 0 && (
                      <span>
                        High: <span className="text-amber-200">{myHighHand.description}</span>
                      </span>
                    )}
                  </div>
                  {myHighHand && myHighHand.cards.length > 0 && (
                    <div>
                      <span className="text-zinc-500 text-[10px] block mb-1">Best 5</span>
                      <CardRow cards={myHighHand.cards} />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-zinc-500 text-xs">Waiting for deal…</p>
              )}
            </div>
          )}

          {showShowdown && (
            <div className="bg-emerald-950/90 border border-emerald-600/40 rounded-lg p-2 text-xs shrink-0 space-y-1">
              <div className="text-emerald-300 font-medium">Showdown</div>
              {/* Detailed side-pot aware display: uses (now-remapped) summary amounts + the side_pots layers kept at finished for eligibility/amounts. */}
              {game.side_pots && game.side_pots.length > 0 && (
                <div className="text-[10px] text-zinc-400 mb-1">
                  {game.side_pots.map((sp, i) => {
                    const names = (sp.eligible || []).map((uid: string) => {
                      const p = game.players.find((pp) => pp.user_id === uid);
                      return p ? p.display_name : uid.substring(0, 6);
                    }).join(', ');
                    return <div key={i}>Pot {i + 1}: {formatStack(sp.amount)} — eligible: {names || '—'}</div>;
                  })}
                </div>
              )}
              <div>
                <span className="text-zinc-500">High: </span>
                {game.showdown_summary!.high_winners.map((w) => (
                  <span key={w.seat} className="mr-2">
                    {w.display_name} {w.hand_description}{' '}
                    {formatStack(w.amount_cents)}
                  </span>
                ))}
              </div>
              <div>
                <span className="text-zinc-500">Low: </span>
                {game.showdown_summary!.low_winners.map((w) => (
                  <span key={w.seat} className="mr-2">
                    {w.display_name} ({w.pips} pips){' '}
                    {formatStack(w.amount_cents)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="bg-zinc-900 rounded-lg p-2 mt-auto shrink-0">
            <TurnTimer
              deadline={game.turn_deadline_at}
              isMyTurn={isMyTurn}
              seat={myPlayer?.seat ?? 0}
              onTimeout={handleTurnTimeout}
            />
            <p className="text-center text-emerald-400 text-xs mb-2">
              {currentActor
                ? `${currentActor.display_name} to act`
                : 'Waiting…'}
            </p>
            {!myPlayer && !myPendingJoin && (
              <p className="text-center text-zinc-500 text-xs">Join a seat</p>
            )}
            {myPendingJoin && (
              <p className="text-center text-amber-300 text-xs">
                Seat {myPendingJoin.seat} requested — waiting for host
              </p>
            )}
            {myPlayer && !isMyTurn && isBettingPhase(game.status) && (
              <p className="text-center text-zinc-500 text-xs">Your turn soon</p>
            )}
            {isMyTurn && myPlayer && (
              <BettingControls
                game={game}
                player={myPlayer}
                facingBet={facingBet}
                busy={actionBusy}
                onAction={handleAction}
              />
            )}
          </div>
        </div>
      </div>

      {isHost && (game.pending_joins?.length ?? 0) > 0 && (
        <HostJoinApprovals
          game={game}
          busy={actionBusy}
          onApprove={(requestId) => void runAction({ action: 'approveJoin', requestId })}
          onDeny={(requestId) => void runAction({ action: 'denyJoin', requestId })}
        />
      )}

      {isHost && (game.pending_rebuys?.length ?? 0) > 0 && (
        <HostRebuyApprovals
          game={game}
          busy={actionBusy}
          onApprove={(requestId) => void runAction({ action: 'approveRebuy', requestId })}
          onDeny={(requestId) => void runAction({ action: 'denyRebuy', requestId })}
        />
      )}

      <JoinSeatModal
        open={!!joinModal}
        title="Take a seat"
        subtitle={
          game?.status === 'waiting'
            ? 'Initial buy-in is fixed at 100. You will be seated immediately (no host approval).'
            : `Choose stack within current table limits (${(buyInRange.minCents/100).toFixed(2)}–${(buyInRange.maxCents/100).toFixed(2)}). Seated immediately (no host approval).`
        }
        seat={joinModal?.seat}
        submitLabel="Take seat"
        busy={joinBusy}
        error={joinError}
        fixedStackCents={game?.status === 'waiting' ? 10000 : undefined}
        minStackCents={game?.status === 'waiting' ? undefined : buyInRange.minCents}
        maxStackCents={game?.status === 'waiting' ? undefined : buyInRange.maxCents}
        onClose={() => !joinBusy && setJoinModal(null)}
        onSubmit={submitJoin}
      />

      <AddChipsModal
        open={!!addChipsModal}
        seat={addChipsModal?.seat}
        displayName={addChipsModal?.displayName}
        busy={addChipsBusy}
        error={addChipsError}
        maxAddCents={(() => {
          if (!game || !myPlayer) return undefined;
          const range = buyInRange;
          return Math.max(0, range.maxCents - myPlayer.stack);
        })()}
        currentStack={myPlayer?.stack}
        onClose={() => !addChipsBusy && setAddChipsModal(null)}
        onSubmit={submitAddChips}
      />

      {seatMenu && isHost && (
        <SeatHostMenu
          game={game}
          player={seatMenu.player}
          x={seatMenu.x}
          y={seatMenu.y}
          onClose={() => setSeatMenu(null)}
          onHostAction={async (payload) => {
            await postGameAction(payload);
            await refresh();
          }}
        />
      )}

      {/* Rebuy modal (direct, no host approval). Slider + text with blank box on open (no prepopulate).
          OK uses the value in the text box. Leave Table stands the player up. */}
      {myPlayer && game && (
        <RebuyStackModal
          open={rebuyModalOpen}
          minCents={buyInRange.minCents}
          maxCents={buyInRange.maxCents}
          busy={actionBusy}
          secondsLeft={rebuySecondsLeft}
          error={null}
          onInteraction={() => setRebuyInteracting(true)}
          onConfirm={(amt) => {
            setJustRequestedRebuy(true);
            setRebuyInteracting(false);
            // Direct rebuy (validated server-side against current post-payout range).
            void runAction({ action: 'rebuy', startingStackCents: amt });
          }}
          onLeaveTable={() => {
            setRebuyInteracting(false);
            void runAction({ action: 'standUp' });
          }}
          onCancel={() => {
            setRebuyInteracting(false);
            /* just hide; server timeout will set away if no rebuy */
          }}
        />
      )}
    </div>
  );
}