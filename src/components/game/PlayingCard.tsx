import type { Card } from '@/types/game';

const SUIT_SYMBOL: Record<string, string> = {
  h: '♥',
  d: '♦',
  c: '♣',
  s: '♠',
};

const SUIT_COLOR: Record<string, string> = {
  h: 'text-red-600',
  d: 'text-blue-600',
  c: 'text-green-700',
  s: 'text-black',
};

const CARD_CLASS =
  'w-14 h-[4.5rem] shrink-0 rounded border border-zinc-600 bg-white flex flex-col items-center justify-center font-bold leading-none shadow-sm';
const RANK_CLASS = 'text-xl';
const SUIT_CLASS = 'text-lg leading-none';

export function parsePlayingCard(card: Card): { rank: string; suit: string; symbol: string } {
  const suit = card.slice(-1);
  let rank = card.slice(0, -1);
  if (rank === '10') rank = '10';
  return {
    rank,
    suit,
    symbol: SUIT_SYMBOL[suit] ?? suit,
  };
}

type PlayingCardProps = {
  card: Card;
  faded?: boolean;
};

export function PlayingCard({ card, faded = false }: PlayingCardProps) {
  const { rank, suit, symbol } = parsePlayingCard(card);
  const color = SUIT_COLOR[suit] ?? 'text-white';

  return (
    <div
      className={`${CARD_CLASS} ${color} ${faded ? 'opacity-40' : ''}`}
      title={card}
    >
      <span className={RANK_CLASS}>{rank}</span>
      <span className={SUIT_CLASS}>{symbol}</span>
    </div>
  );
}

/** Split cards into two rows (2+3, 2+2, 2+1, etc.). */
export function splitSeatCardRows(cards: Card[]): Card[][] {
  const n = cards.length;
  if (n === 0) return [];
  if (n === 1) return [[cards[0]]];
  if (n === 2) return [[cards[0], cards[1]]];
  if (n === 3) return [cards.slice(0, 2), [cards[2]]];
  if (n === 4) return [cards.slice(0, 2), cards.slice(2, 4)];
  if (n === 5) return [cards.slice(0, 2), cards.slice(2, 5)];
  const mid = Math.ceil(n / 2);
  return [cards.slice(0, mid), cards.slice(mid)];
}

export function CardGrid({
  cards,
  faded = false,
}: {
  cards: Card[];
  faded?: boolean;
}) {
  const rows = splitSeatCardRows(cards);
  if (!rows.length) return null;

  return (
    <div className="flex flex-col gap-0.5 items-center">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-0.5 justify-center">
          {row.map((c, i) => (
            <PlayingCard key={`${c}-${rowIndex}-${i}`} card={c} faded={faded} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardRow({
  cards,
  faded = false,
}: {
  cards: Card[];
  faded?: boolean;
}) {
  if (!cards.length) return <span className="text-zinc-500 text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-0.5">
      {cards.map((c, i) => (
        <PlayingCard key={`${c}-${i}`} card={c} faded={faded} />
      ))}
    </div>
  );
}