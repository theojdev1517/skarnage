'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useGameState } from '@/hooks/useGameState';
import { useAuth } from '@/hooks/useAuth';
import { isBettingPhase } from '@/lib/game/clientView';
import { evaluateHighHand } from '@/lib/game/evaluator';
import { CardGrid, CardRow } from '@/components/game/PlayingCard';
import { BettingControls } from '@/components/game/BettingControls';
import { JoinSeatModal } from '@/components/game/JoinSeatModal';
import { SeatHostMenu } from '@/components/game/SeatHostMenu';
import { formatStack } from '@/lib/formatStack';
import type { Card, Player } from '@/types/game';

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { userId, loading: authLoading } = useAuth();
  const { game, loading: gameLoading, refresh } = useGameState(gameId || '', userId);
  const [actionBusy, setActionBusy] = useState(false);

  const loading = authLoading || gameLoading;

  const myPlayer = game?.players?.find((p) => p.user_id === userId) ?? null;
  const currentActor = game?.players?.find((p) => p.seat === game?.current_player_seat);
  const isMyTurn =
    !!game &&
    !!myPlayer &&
    !!currentActor &&
    currentActor.user_id === userId &&
    isBettingPhase(game.status);
  const [seatMenu, setSeatMenu] = useState<{
    player: Player;
    x: number;
    y: number;
  } | null>(null);
  const [joinModal, setJoinModal] = useState<{ seat: number } | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const isHost = !!game?.host_id && userId === game.host_id;

  const myHighHand = useMemo(() => {
    if (!myPlayer || !game) return null;
    const community = game.board.top.filter((c): c is Card => c !== null);
    const live = myPlayer.live_hole_cards;
    if (live.length + community.length < 5) return null;
    return evaluateHighHand(live, community);
  }, [myPlayer, game?.board.top]);

  const postGameAction = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/game/${gameId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Action failed');
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
      const { joinSeat: joinAction } = await import('./actions');
      await joinAction(gameId, joinModal.seat, displayName, stackCents);
      setJoinModal(null);
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Join failed');
    } finally {
      setJoinBusy(false);
    }
  };

  const handleAction = async (
    betAction: 'fold' | 'check' | 'call' | 'bet' | 'raise',
    amount: number = 0
  ) => {
    if (!game || !myPlayer) return alert('Take a seat first');
    if (!isMyTurn) return alert('Not your turn');
    setActionBusy(true);
    try {
      await postGameAction({
        action: 'bet',
        seat: myPlayer.seat,
        betAction,
        amount,
      });
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Action failed';
      if (betAction === 'bet' || betAction === 'raise') {
        throw new Error(message);
      }
      alert(message);
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <div className="p-4 text-center text-white">Loading table…</div>;
  if (!game) return <div className="p-4 text-center text-white">Game not found</div>;

  const topBoard = game.board.top.filter((c): c is Card => c !== null);
  const shredderBoard = game.board.shredder.filter((c): c is Card => c !== null);
  const hasHoleCards =
    (myPlayer?.hole_cards?.length ?? 0) > 0 || (myPlayer?.live_hole_cards?.length ?? 0) > 0;
  const showShowdown = game.status === 'finished' && game.showdown_summary;

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
          {isHost && (
            <button
              type="button"
              onClick={() => postGameAction({ action: 'startHand' }).catch((e) => alert(e.message))}
              className="bg-emerald-600 hover:bg-emerald-500 px-3 py-1 rounded font-medium"
            >
              New Hand
            </button>
          )}
        </div>
      </header>

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
              const canJoin = !player && !!userId && !myPlayer;
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
                      {isMine && myPlayer && myPlayer.live_hole_cards.length > 0 && (
                        <div className="mt-0.5 pb-0.5">
                          <CardGrid cards={myPlayer.live_hole_cards} />
                        </div>
                      )}
                      {player.status === 'dead' && (
                        <span className="text-[9px] text-red-400">DEAD</span>
                      )}
                    </>
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
            <p className="text-center text-emerald-400 text-xs mb-2">
              {currentActor
                ? `${currentActor.display_name} to act`
                : 'Waiting…'}
            </p>
            {!myPlayer && (
              <p className="text-center text-zinc-500 text-xs">Join a seat</p>
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

      <JoinSeatModal
        open={!!joinModal}
        title="Join the table"
        subtitle="Choose a display name and starting stack."
        seat={joinModal?.seat}
        submitLabel="Take seat"
        busy={joinBusy}
        error={joinError}
        onClose={() => !joinBusy && setJoinModal(null)}
        onSubmit={submitJoin}
      />

      {seatMenu && isHost && (
        <SeatHostMenu
          game={game}
          player={seatMenu.player}
          x={seatMenu.x}
          y={seatMenu.y}
          onClose={() => setSeatMenu(null)}
          onHostAction={postGameAction}
        />
      )}
    </div>
  );
}