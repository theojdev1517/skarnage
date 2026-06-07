import fs from 'fs';
import { reconstructHandToText } from '../src/lib/game/reconstructLedger';  // note: may need adjustment, but tsx handles ts

// Actually, for tsx, better to keep .ts import, tsx will transpile
// But to make it work, we'll write it as .ts and run with tsx

const raw = fs.readFileSync('ledger_events_fresh.json', 'utf8');
const events = JSON.parse(raw);

const normalized = events.map((e: any) => {
  let data = e.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  return {
    hand_number: parseInt(e.hand_number, 10) || 0,
    seq: parseInt(e.seq, 10) || 0,
    event_type: e.event_type,
    data,
    user_id: e.user_id || null,
    created_at: e.created_at,
  };
});

const byHand: Record<number, any[]> = {};
for (const ev of normalized) {
  if (!byHand[ev.hand_number]) byHand[ev.hand_number] = [];
  byHand[ev.hand_number].push(ev);
}

const handNumbers = Object.keys(byHand).map(Number).sort((a, b) => a - b);

let output = '# Reconstructed Ledger Logs (New Logic)\n\n';
output += `Generated from fresh export on ${new Date().toISOString()}\n\n`;

for (const h of handNumbers) {
  const handEvents = byHand[h].sort((a, b) => a.seq - b.seq);
  output += `## Hand ${h}\n\n`;
  try {
    const text = reconstructHandToText(handEvents, null);
    output += text + '\n\n---\n\n';
  } catch (err) {
    output += `Error reconstructing hand ${h}: ${err}\n\n---\n\n`;
  }
}

fs.writeFileSync('ledger_reconstructed_new.md', output, 'utf8');
console.log(`Generated ledger_reconstructed_new.md with ${handNumbers.length} hands`);

