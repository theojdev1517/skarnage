import fs from 'fs';
import { reconstructHandToText } from '../src/lib/game/reconstructLedger';

const raw = fs.readFileSync('ledger_events.json', 'utf8');
const events = JSON.parse(raw);

// Normalize events
const normalized = events.map((e: any) => {
  let data = e.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch {}
  }
  return {
    hand_number: parseInt(e.hand_number, 10),
    seq: parseInt(e.seq, 10),
    event_type: e.event_type,
    data,
    user_id: e.user_id || null,
    created_at: e.created_at,
  };
});

// Group by hand
const byHand: Record<number, any[]> = {};
for (const ev of normalized) {
  if (!byHand[ev.hand_number]) byHand[ev.hand_number] = [];
  byHand[ev.hand_number].push(ev);
}

const handNumbers = Object.keys(byHand).map(Number).sort((a,b) => a-b);

let output = '# Reconstructed Ledger Logs\n\n';

for (const h of handNumbers) {
  const handEvents = byHand[h].sort((a,b) => a.seq - b.seq);
  output += `## Hand ${h}\n\n`;
  const text = reconstructHandToText(handEvents, null);
  output += text + '\n\n---\n\n';
}

fs.writeFileSync('ledger_reconstructed.md', output, 'utf8');
console.log('Generated ledger_reconstructed.md with', handNumbers.length, 'hands');
