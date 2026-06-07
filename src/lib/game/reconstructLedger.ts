import React from 'react';

export function reconstructHand(handEvents: any[], viewerUserId: string | null = null): React.ReactNode {
  if (!handEvents || handEvents.length === 0) return 'No events for this hand.';

  const sorted = [...handEvents].sort((a: any, b: any) => (a.seq || 0) - (b.seq || 0));
  const parts: React.ReactNode[] = [];

  const playerNames: Record<string, string> = {};
  for (const ev of sorted) {
    const d = ev.data || {};
    if (ev.user_id && d.display_name) playerNames[ev.user_id] = d.display_name;
    if (ev.user_id && d.player) playerNames[ev.user_id] = d.player;
    if (d.user_id && d.display_name) playerNames[d.user_id] = d.display_name;
    if (d.user_id && d.player) playerNames[d.user_id] = d.player;
  }

  let currentPotCents = 0;
  let isPreflop = true;

  // 4-color scheme matching the table's PlayingCard (adjusted for dark ledger bg;
  // colors both rank and suit emoji).
  function renderColoredCard(card: string, key: React.Key): React.ReactNode {
    if (typeof card !== 'string' || card.length < 2) return card;
    const rank = card.slice(0, -1);
    const s = card.slice(-1).toLowerCase();
    const symbol = s === 's' ? '♠' : s === 'h' ? '♥' : s === 'd' ? '♦' : s === 'c' ? '♣' : s;
    const color =
      s === 'h' ? 'text-red-400' :
      s === 'd' ? 'text-blue-400' :
      s === 'c' ? 'text-emerald-400' :
      s === 's' ? 'text-zinc-200' : '';
    return React.createElement('span', { key, className: color }, rank + symbol);
  }

  for (const ev of sorted) {
    const d = ev.data || {};
    const ts = new Date(ev.created_at).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const prefix = `[${ts}] `;

    if (ev.event_type === 'hand_start') {
      parts.push(`${prefix}Start Hand #${ev.hand_number} ${d.game_type || ''}`);
      isPreflop = true;
      if (d.seats && Array.isArray(d.seats)) {
        d.seats.forEach((s: any) => {
          let pos = '';
          if (d.button_seat === s.seat) pos = ' (button)';
          else if (d.small_blind_seat === s.seat) pos = ' (small blind)';
          else if (d.big_blind_seat === s.seat) pos = ' (big blind)';
          parts.push(`  Seat ${s.seat}${pos}: ${s.display_name}, ${(s.stack_cents / 100).toFixed(2)}`);
        });
      }
      if (d.small_blind_cents !== undefined) {
        parts.push(`  Blinds: ${(d.small_blind_cents / 100).toFixed(2)} / ${(d.big_blind_cents / 100).toFixed(2)}`);
      }
      if (d.small_blind_cents) currentPotCents += d.small_blind_cents;
      if (d.big_blind_cents) currentPotCents += d.big_blind_cents;
      // Synthesize blind post lines right under the blinds summary (using data from hand_start payload)
      if (d.small_blind_seat != null && d.small_blind_cents != null) {
        const sb = (d.seats || []).find((s: any) => s.seat === d.small_blind_seat);
        if (sb) {
          parts.push(`${prefix}${sb.display_name} posts the small blind of ${(d.small_blind_cents / 100).toFixed(2)}`);
        }
      }
      if (d.big_blind_seat != null && d.big_blind_cents != null) {
        const bb = (d.seats || []).find((s: any) => s.seat === d.big_blind_seat);
        if (bb) {
          parts.push(`${prefix}${bb.display_name} posts the big blind of ${(d.big_blind_cents / 100).toFixed(2)}`);
        }
      }
    } else if (ev.event_type === 'meta') {
      const type = d.type || '';
      if (type === 'seat') {
        parts.push(`${prefix}${d.display_name} seated in seat ${d.seat} with ${(d.stack_cents / 100).toFixed(2)}`);
      } else if (type === 'request_rebuy' || type === 'rebuy') {
        parts.push(`${prefix}${d.display_name || 'Player'} rebuy for ${(d.stack_cents / 100).toFixed(2)}`);
      } else if (type === 'add_chips') {
        parts.push(`${prefix}${d.display_name || 'Player'} adds ${(d.amount_cents / 100).toFixed(2)}`);
      } else if (type === 'set_away') {
        parts.push(`${prefix}Player set to away`);
      } else if (type === 'stand_up') {
        let name = d.display_name || (ev.user_id && playerNames[ev.user_id]) || 'Player';
        if (d.stack_cents !== undefined && d.stack_cents != null && !isNaN(d.stack_cents)) {
          parts.push(`${prefix}${name} leaves table with a stack of ${(d.stack_cents / 100).toFixed(2)}`);
        } else {
          parts.push(`${prefix}${name} leaves the table`);
        }
      } else if (type === 'host_add_stack') {
        parts.push(`${prefix}Host added ${(d.amount_cents / 100).toFixed(2)} to seat ${d.seat}`);
      } else if (type === 'seat_request') {
        parts.push(`${prefix}${d.display_name} requests seat ${d.seat} and will be seated on the next hand`);
      } else if (type === 'blind_post') {
        const b = d.blind === 'small' ? 'small' : 'big';
        parts.push(`${prefix}${d.display_name} posts the ${b} blind of ${(d.amount_cents / 100).toFixed(2)}`);
        if (d.amount_cents) currentPotCents += d.amount_cents;
      } else {
        parts.push(`${prefix}Meta event: ${type}`);
      }
    } else if (ev.event_type === 'action') {
      // Grammar fix: "call" -> "calls", etc. (matches table narrative style like "Theo calls")
      let verb = d.action || 'acts';
      if (verb === 'call') verb = 'calls';
      else if (verb === 'fold') verb = 'folds';
      else if (verb === 'check') verb = 'checks';
      else if (verb === 'bet') verb = 'bets';
      else if (verb === 'raise') verb = 'raises';
      let text = `${d.player || 'Player'} ${verb}`;
      if (d.action === 'raise') {
        const target = d.to_cents || d.amount_cents || 0;
        text = `${d.player} raises to ${(target / 100).toFixed(2)}`;
        if (d.all_in) {
          text += ' and is all in';
        }
      } else if (d.action === 'bet' && isPreflop) {
        const target = d.to_cents || d.amount_cents || 0;
        text = `${d.player} raises to ${(target / 100).toFixed(2)}`;
        if (d.all_in) {
          text += ' and is all in';
        }
      } else if (d.amount_cents) {
        text += ` ${(d.amount_cents / 100).toFixed(2)}`;
        if (d.all_in && (d.action === 'bet' || d.action === 'call')) {
          text += ' and is all in';
        }
      } else if (d.all_in) {
        text += ' and is all in';
      }
      parts.push(`${prefix}${text}`);
      if (d.added_cents) {
        currentPotCents += d.added_cents;
      } else if (d.amount_cents) {
        if (d.action === 'call' || d.action === 'bet') {
          currentPotCents += d.amount_cents;
        } else if (d.action === 'raise') {
          currentPotCents += d.amount_cents;
        }
      }
    } else if (ev.event_type === 'street') {
      isPreflop = false;
      const streetName = d.street ? d.street.charAt(0).toUpperCase() + d.street.slice(1) : 'Street';
      const boardCards = (d.board || []).map((c: string, i: number) => renderColoredCard(c, `b-${i}`));
      const potStr = currentPotCents > 0 ? ` (Pot: $${(currentPotCents / 100).toFixed(2)})` : '';
      const boardLine = React.createElement(React.Fragment, { key: `streetboard-${parts.length}` },
        `${prefix}${streetName}: `,
        ...boardCards.flatMap((node: React.ReactNode, i: number) => i === 0 ? [node] : [' ', node]),
        potStr
      );
      parts.push(boardLine);
      if (d.shredder && d.shredder.length) {
        const shredCards = (d.shredder || []).map((c: string, i: number) => renderColoredCard(c, `sh-${i}`));
        const shredLine = React.createElement(React.Fragment, { key: `shredboard-${parts.length}` },
          `${prefix}Shredder ${d.street}: `,
          ...shredCards.flatMap((node: React.ReactNode, i: number) => i === 0 ? [node] : [' ', node])
        );
        parts.push(shredLine);
      }
    } else if (ev.event_type === 'shred') {
      const num = d.shredded ? d.shredded.length : 0;
      const shredCards = (d.shredded || []).map((c: string, i: number) => renderColoredCard(c, `sd-${i}`));
      const shredLine = React.createElement(React.Fragment, { key: `shred-${parts.length}` },
        `${prefix}${d.player} gets ${num} card(s) shredded: `,
        ...shredCards.flatMap((node: React.ReactNode, i: number) => i === 0 ? [node] : [', ', node])
      );
      parts.push(shredLine);
      if (d.live && d.live.length === 0) {
        parts.push(`${prefix}${d.player} has all cards shredded and hand is marked dead`);
      }
    } else if (ev.event_type === 'deal_hole') {
      const isViewer = viewerUserId && (d.user_id === viewerUserId || d.player_user_id === viewerUserId);
      if (isViewer) {
        const holeCards = (d.hole_cards || []).map((c: string, i: number) => renderColoredCard(c, `h-${i}`));
        const handLine = React.createElement(React.Fragment, { key: `yourhand-${parts.length}` },
          `${prefix}Your hand: `,
          ...holeCards.flatMap((node: React.ReactNode, i: number) => i === 0 ? [node] : [' ', node])
        );
        parts.push(handLine);
      }
    } else if (ev.event_type === 'showdown') {
      const shown = d.shown_hands || [];
      if (shown.length === 1) {
        // uncontested: no full opposing hand reached showdown
        const s = shown[0];
        const highWin = (d.high_winners || []).find((w: any) => w.seat === s.seat || w.display_name === s.display_name);
        const amt = highWin && highWin.amount_cents ? (highWin.amount_cents / 100).toFixed(2) : '0.00';
        parts.push(`${prefix}${s.display_name} wins uncontested — $${amt}`);
        // suppress show lines
      } else {
        parts.push(`${prefix}SHOWDOWN`);
        if (shown.length > 0) {
          // side pot summary if multi
          if (d.side_pots && Array.isArray(d.side_pots) && d.side_pots.length > 1) {
            const summary = d.side_pots.map((p: any, idx: number) => {
              const amt = p.amount ? (p.amount / 100).toFixed(2) : '0.00';
              const el = (p.eligible || []).length;
              return `SP${idx + 1} $${amt} (${el} elig.)`;
            }).join(', ');
            parts.push(`${prefix}Side pots: ${summary}`);
          }
          shown.forEach((s: any) => {
            const cardNodes = (s.hole_cards || []).map((c: string, i: number) => renderColoredCard(c, `sh-${parts.length}-${i}`));
            const cardsPart = cardNodes.length
              ? React.createElement(React.Fragment, { key: `sh-cards-${parts.length}` },
                  ' ',
                  ...cardNodes.flatMap((n: React.ReactNode, i: number) => i === 0 ? [n] : [' ', n])
                )
              : '';
            const desc = s.hand_description || '';
            const basePrefix = `${prefix}${s.display_name} shows`;
            const highWin = (d.high_winners || []).find((w: any) => w.seat === s.seat || w.display_name === s.display_name);
            const lowWin = (d.low_winners || []).find((w: any) => w.seat === s.seat || w.display_name === s.display_name);
            if (highWin && highWin.amount_cents > 0) {
              const highAmt = (highWin.amount_cents / 100).toFixed(2);
              let lineText = `${basePrefix}${cardsPart}${desc ? ` (${desc})` : ''} and wins ${highAmt} from high pot`;
              if (lowWin && lowWin.amount_cents > 0) {
                lineText += ` (scoops low ${(lowWin.amount_cents / 100).toFixed(2)})`;
              }
              const line = React.createElement(React.Fragment, { key: `sh-high-${parts.length}` }, lineText);
              parts.push(line);
            } else if (lowWin && lowWin.amount_cents > 0) {
              const lowAmt = (lowWin.amount_cents / 100).toFixed(2);
              const pips = lowWin.pips || 0;
              const line = React.createElement(React.Fragment, { key: `sh-low-${parts.length}` },
                `${basePrefix}${cardsPart} (${desc}) (${pips} pips) and wins ${lowAmt} from low pot`
              );
              parts.push(line);
            } else {
              const line = React.createElement(React.Fragment, { key: `sh-${parts.length}` },
                `${basePrefix}${cardsPart}${desc ? ` (${desc})` : ''}`
              );
              parts.push(line);
            }
          });
        } else {
          // Legacy fallback for older showdown events without shown_hands
          if (d.side_pots && Array.isArray(d.side_pots) && d.side_pots.length > 0) {
            const pots = [...d.side_pots].sort((a: any, b: any) => (b.pot || 0) - (a.pot || 0));
            pots.forEach((p: any) => {
              const winnerName = p.winner || p.display_name || '';
              if (!winnerName || winnerName === 'Player') return;
              const potType = p.type || 'high';
              const amt = p.amount_cents ? (p.amount_cents / 100).toFixed(2) : '';
              parts.push(`${prefix}${winnerName} shows hand and wins ${amt} from ${potType} side pot ${p.pot || ''}`);
            });
          }
          if (d.high_winners && Array.isArray(d.high_winners)) {
            d.high_winners.forEach((w: any) => {
              const amt = w.amount_cents ? (w.amount_cents / 100).toFixed(2) : '';
              const cardNodes = (w.hole_cards || []).map((c: string, i: number) => renderColoredCard(c, `hw-${parts.length}-${i}`));
              const cardsPart = cardNodes.length
                ? React.createElement(React.Fragment, { key: `hw-cards-${parts.length}` },
                    ' ',
                    ...cardNodes.flatMap((n: React.ReactNode, i: number) => i === 0 ? [n] : [' ', n])
                  )
                : '';
              const hand = w.hand_description || '';
              const line = React.createElement(React.Fragment, { key: `hw-line-${parts.length}` },
                `${prefix}${w.display_name} shows`,
                cardsPart,
                hand ? ` (${hand})` : '',
                ` and wins ${amt} from high pot`
              );
              parts.push(line);
            });
          }
          if (d.low_winners && Array.isArray(d.low_winners)) {
            d.low_winners.forEach((w: any) => {
              const amt = w.amount_cents ? (w.amount_cents / 100).toFixed(2) : '';
              const cardNodes = (w.hole_cards || []).map((c: string, i: number) => renderColoredCard(c, `lw-${parts.length}-${i}`));
              const cardsPart = cardNodes.length
                ? React.createElement(React.Fragment, { key: `lw-cards-${parts.length}` },
                    ' ',
                    ...cardNodes.flatMap((n: React.ReactNode, i: number) => i === 0 ? [n] : [' ', n])
                  )
                : '';
              const pips = w.pips || 0;
              const line = React.createElement(React.Fragment, { key: `lw-line-${parts.length}` },
                `${prefix}${w.display_name} shows`,
                cardsPart,
                ` (${pips} pips)`,
                ` and wins ${amt} from low pot`
              );
              parts.push(line);
            });
          }
        }
      }
    } else if (ev.event_type === 'hand_end') {
      parts.push(`${prefix}End Hand #${ev.hand_number}`);
    } else {
      parts.push(`${prefix}${ev.event_type}`);
    }
  }

  // Join parts with newlines. Cards are React spans with color classes (both rank + suit).
  const joined: React.ReactNode[] = [];
  parts.forEach((p, i) => {
    joined.push(p);
    if (i < parts.length - 1) joined.push('\n');
  });
  return React.createElement(React.Fragment, null, ...joined);
}

function formatCardText(c: string): string {
  if (typeof c !== 'string' || c.length < 2) return c;
  const rank = c.slice(0, -1);
  const s = c.slice(-1).toLowerCase();
  const symbol = s === 's' ? '♠' : s === 'h' ? '♥' : s === 'd' ? '♦' : s === 'c' ? '♣' : s;
  return rank + symbol;
}

export function reconstructHandToText(handEvents: any[], viewerUserId: string | null = null): string {
  if (!handEvents || handEvents.length === 0) return 'No events for this hand.';

  const sorted = [...handEvents].sort((a: any, b: any) => (a.seq || 0) - (b.seq || 0));
  const lines: string[] = [];

  const playerNames: Record<string, string> = {};
  for (const ev of sorted) {
    const d = ev.data || {};
    if (ev.user_id && d.display_name) playerNames[ev.user_id] = d.display_name;
    if (ev.user_id && d.player) playerNames[ev.user_id] = d.player;
    if (d.user_id && d.display_name) playerNames[d.user_id] = d.display_name;
    if (d.user_id && d.player) playerNames[d.user_id] = d.player;
  }

  let currentPotCents = 0;
  let isPreflop = true;

  for (const ev of sorted) {
    const d = ev.data || {};
    const ts = new Date(ev.created_at).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const prefix = `[${ts}] `;

    if (ev.event_type === 'hand_start') {
      lines.push(`${prefix}Start Hand #${ev.hand_number} ${d.game_type || ''}`);
      isPreflop = true;
      if (d.seats && Array.isArray(d.seats)) {
        d.seats.forEach((s: any) => {
          let pos = '';
          if (d.button_seat === s.seat) pos = ' (button)';
          else if (d.small_blind_seat === s.seat) pos = ' (small blind)';
          else if (d.big_blind_seat === s.seat) pos = ' (big blind)';
          lines.push(`  Seat ${s.seat}${pos}: ${s.display_name}, ${(s.stack_cents / 100).toFixed(2)}`);
        });
      }
      if (d.small_blind_cents !== undefined) {
        lines.push(`  Blinds: ${(d.small_blind_cents / 100).toFixed(2)} / ${(d.big_blind_cents / 100).toFixed(2)}`);
      }
      if (d.small_blind_cents) currentPotCents += d.small_blind_cents;
      if (d.big_blind_cents) currentPotCents += d.big_blind_cents;
      if (d.small_blind_seat != null && d.small_blind_cents != null) {
        const sb = (d.seats || []).find((s: any) => s.seat === d.small_blind_seat);
        if (sb) {
          lines.push(`${prefix}${sb.display_name} posts the small blind of ${(d.small_blind_cents / 100).toFixed(2)}`);
        }
      }
      if (d.big_blind_seat != null && d.big_blind_cents != null) {
        const bb = (d.seats || []).find((s: any) => s.seat === d.big_blind_seat);
        if (bb) {
          lines.push(`${prefix}${bb.display_name} posts the big blind of ${(d.big_blind_cents / 100).toFixed(2)}`);
        }
      }
    } else if (ev.event_type === 'meta') {
      const type = d.type || '';
      if (type === 'seat') {
        lines.push(`${prefix}${d.display_name} seated in seat ${d.seat} with ${(d.stack_cents / 100).toFixed(2)}`);
      } else if (type === 'request_rebuy' || type === 'rebuy') {
        lines.push(`${prefix}${d.display_name || 'Player'} rebuy for ${(d.stack_cents / 100).toFixed(2)}`);
      } else if (type === 'add_chips') {
        lines.push(`${prefix}${d.display_name || 'Player'} adds ${(d.amount_cents / 100).toFixed(2)}`);
      } else if (type === 'set_away') {
        lines.push(`${prefix}Player set to away`);
      } else if (type === 'stand_up') {
        let name = d.display_name || (ev.user_id && playerNames[ev.user_id]) || 'Player';
        if (d.stack_cents !== undefined && d.stack_cents != null && !isNaN(d.stack_cents)) {
          lines.push(`${prefix}${name} leaves table with a stack of ${(d.stack_cents / 100).toFixed(2)}`);
        } else {
          lines.push(`${prefix}${name} leaves the table`);
        }
      } else if (type === 'host_add_stack') {
        lines.push(`${prefix}Host added ${(d.amount_cents / 100).toFixed(2)} to seat ${d.seat}`);
      } else if (type === 'seat_request') {
        lines.push(`${prefix}${d.display_name} requests seat ${d.seat} and will be seated on the next hand`);
      } else if (type === 'blind_post') {
        const b = d.blind === 'small' ? 'small' : 'big';
        lines.push(`${prefix}${d.display_name} posts the ${b} blind of ${(d.amount_cents / 100).toFixed(2)}`);
        if (d.amount_cents) currentPotCents += d.amount_cents;
      } else {
        lines.push(`${prefix}Meta event: ${type}`);
      }
    } else if (ev.event_type === 'action') {
      let verb = d.action || 'acts';
      if (verb === 'call') verb = 'calls';
      else if (verb === 'fold') verb = 'folds';
      else if (verb === 'check') verb = 'checks';
      else if (verb === 'bet') verb = 'bets';
      else if (verb === 'raise') verb = 'raises';
      let text = `${d.player || 'Player'} ${verb}`;
      if (d.action === 'raise') {
        const target = d.to_cents || d.amount_cents || 0;
        text = `${d.player} raises to ${(target / 100).toFixed(2)}`;
        if (d.all_in) {
          text += ' and is all in';
        }
      } else if (d.action === 'bet' && isPreflop) {
        const target = d.to_cents || d.amount_cents || 0;
        text = `${d.player} raises to ${(target / 100).toFixed(2)}`;
        if (d.all_in) {
          text += ' and is all in';
        }
      } else if (d.amount_cents) {
        text += ` ${(d.amount_cents / 100).toFixed(2)}`;
        if (d.all_in && (d.action === 'bet' || d.action === 'call')) {
          text += ' and is all in';
        }
      } else if (d.all_in) {
        text += ' and is all in';
      }
      lines.push(`${prefix}${text}`);
      if (d.added_cents) {
        currentPotCents += d.added_cents;
      } else if (d.amount_cents) {
        if (d.action === 'call' || d.action === 'bet') {
          currentPotCents += d.amount_cents;
        } else if (d.action === 'raise') {
          currentPotCents += d.amount_cents;
        }
      }
    } else if (ev.event_type === 'street') {
      isPreflop = false;
      const streetName = d.street ? d.street.charAt(0).toUpperCase() + d.street.slice(1) : 'Street';
      const boardStr = (d.board || []).map(formatCardText).join(' ');
      const potStr = currentPotCents > 0 ? ` (Pot: $${(currentPotCents / 100).toFixed(2)})` : '';
      lines.push(`${prefix}${streetName}: ${boardStr}${potStr}`);
      if (d.shredder && d.shredder.length) {
        const shredStr = (d.shredder || []).map(formatCardText).join(' ');
        lines.push(`${prefix}Shredder ${d.street}: ${shredStr}`);
      }
    } else if (ev.event_type === 'shred') {
      const num = d.shredded ? d.shredded.length : 0;
      const shredStr = (d.shredded || []).map(formatCardText).join(', ');
      lines.push(`${prefix}${d.player} gets ${num} card(s) shredded: ${shredStr}`);
      if (d.live && d.live.length === 0) {
        lines.push(`${prefix}${d.player} has all cards shredded and hand is marked dead`);
      }
    } else if (ev.event_type === 'deal_hole') {
      const isViewer = viewerUserId && (d.user_id === viewerUserId || d.player_user_id === viewerUserId);
      if (isViewer) {
        const holeStr = (d.hole_cards || []).map(formatCardText).join(' ');
        lines.push(`${prefix}Your hand: ${holeStr}`);
      }
    } else if (ev.event_type === 'showdown') {
      const shown = d.shown_hands || [];
      if (shown.length === 1) {
        // uncontested: no full opposing hand reached showdown
        const s = shown[0];
        const highWin = (d.high_winners || []).find((w: any) => w.seat === s.seat || w.display_name === s.display_name);
        const amt = highWin && highWin.amount_cents ? (highWin.amount_cents / 100).toFixed(2) : '0.00';
        lines.push(`${prefix}${s.display_name} wins uncontested — $${amt}`);
        // suppress show lines
      } else {
        lines.push(`${prefix}SHOWDOWN`);
        if (shown.length > 0) {
          // side pot summary if multi
          if (d.side_pots && Array.isArray(d.side_pots) && d.side_pots.length > 1) {
            const summary = d.side_pots.map((p: any, idx: number) => {
              const amt = p.amount ? (p.amount / 100).toFixed(2) : '0.00';
              const el = (p.eligible || []).length;
              return `SP${idx + 1} $${amt} (${el} elig.)`;
            }).join(', ');
            lines.push(`${prefix}Side pots: ${summary}`);
          }
          shown.forEach((s: any) => {
            const cardsStr = (s.hole_cards || []).map(formatCardText).join(' ');
            const desc = s.hand_description || '';
            const highWin = (d.high_winners || []).find((w: any) => w.seat === s.seat || w.display_name === s.display_name);
            const lowWin = (d.low_winners || []).find((w: any) => w.seat === s.seat || w.display_name === s.display_name);
            if (highWin && highWin.amount_cents > 0) {
              const highAmt = (highWin.amount_cents / 100).toFixed(2);
              let lineText = `${prefix}${s.display_name} shows ${cardsStr} (${desc}) and wins ${highAmt} from high pot`;
              if (lowWin && lowWin.amount_cents > 0) {
                lineText += ` (scoops low ${(lowWin.amount_cents / 100).toFixed(2)})`;
              }
              lines.push(lineText);
            } else if (lowWin && lowWin.amount_cents > 0) {
              const lowAmt = (lowWin.amount_cents / 100).toFixed(2);
              const pips = lowWin.pips || 0;
              lines.push(`${prefix}${s.display_name} shows ${cardsStr} (${desc}) (${pips} pips) and wins ${lowAmt} from low pot`);
            } else {
              lines.push(`${prefix}${s.display_name} shows ${cardsStr} (${desc})`);
            }
          });
        } else {
          // legacy fallback
          if (d.side_pots && Array.isArray(d.side_pots) && d.side_pots.length > 0) {
            const pots = [...d.side_pots].sort((a: any, b: any) => (b.pot || 0) - (a.pot || 0));
            pots.forEach((p: any) => {
              const winnerName = p.winner || p.display_name || '';
              if (!winnerName || winnerName === 'Player') return;
              const potType = p.type || 'high';
              const amt = p.amount_cents ? (p.amount_cents / 100).toFixed(2) : '';
              lines.push(`${prefix}${winnerName} shows hand and wins ${amt} from ${potType} side pot ${p.pot || ''}`);
            });
          }
          if (d.high_winners && Array.isArray(d.high_winners)) {
            d.high_winners.forEach((w: any) => {
              const amt = w.amount_cents ? (w.amount_cents / 100).toFixed(2) : '';
              const cardsStr = (w.hole_cards || []).map(formatCardText).join(' ');
              const hand = w.hand_description || '';
              lines.push(`${prefix}${w.display_name} shows ${cardsStr}${hand ? ` (${hand})` : ''} and wins ${amt} from high pot`);
            });
          }
          if (d.low_winners && Array.isArray(d.low_winners)) {
            d.low_winners.forEach((w: any) => {
              const amt = w.amount_cents ? (w.amount_cents / 100).toFixed(2) : '';
              const cardsStr = (w.hole_cards || []).map(formatCardText).join(' ');
              const pips = w.pips || 0;
              lines.push(`${prefix}${w.display_name} shows ${cardsStr} (${pips} pips) and wins ${amt} from low pot`);
            });
          }
        }
      }
    } else if (ev.event_type === 'hand_end') {
      lines.push(`${prefix}End Hand #${ev.hand_number}`);
    } else {
      lines.push(`${prefix}${ev.event_type}`);
    }
  }

  return lines.join('\n');
}
