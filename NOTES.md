# Skarnage Project Notes

**Last Updated:** June 4, 2026

## Project Links
- Live Site: https://skarnage.vercel.app
- GitHub: https://github.com/theojdev1517/skarnage
- Supabase Project: skarnage
- MVP Roadmap: `../skarnage reference/Skarney_MVP_Roadmap.docx` (CURRENT STATUS at bottom overrides phase checklist when they conflict)

## Database Tables
(See earlier summary we made — you can paste it here later)

## Phase 0: House Rules (Skarney)

**Number of Players**: 4 minimum to start, up to 8 max (8×5 hole cards + 12 board cards = 52, perfect).

**Hole Cards**: 5 per player.

**Betting Structure**:
- Pot Limit (with optional $100/hand/player cap — not enforced in code yet)
- Blinds (default 0.25/0.50)
- 4 betting rounds: Preflop → Flop → Turn → River
- Host should eventually be able to set blinds/structure when creating game.

**Community Cards (Dual Board)**:
- Top board (high hand builder) + shredder board (low pip / auto-shred trigger)
- Dealt in stages: Flop (3 each), Turn (2 each), River (1 each)

**Auto-Shred (not manual discard)**:
- After each street is dealt (flop, turn, river), the engine automatically removes from each player’s hand any hole cards whose **rank** matches a rank on the shredder board
- Shredded cards accumulate in `shredded_cards`; remaining cards are `live_hole_cards`
- No player discard UI and no “choose which cards to shred” step
- If a player has no live hole cards left after shredding, status becomes `dead` for that hand
- Pip total is recalculated from live hole cards after each shred

**Hand Ranking & Scoring**:
- **High**: Best 5-card hand using remaining hole cards + 6 cards on top board
- **Low**: Pip count on remaining live hole cards (A=1, 2–10=face value, J/Q/K=10)
- Always split pot (high / low) — no qualifier
- Ties split that half (quarters, sixths, eighths as needed)

**Split Rules**:
- Half pot to best high, half to best low
- Exact ties on high or low split that half evenly
- **Odd chips:** if the pot is an odd number of cents, the extra cent goes to the **high half** (not low)
- **High half tie:** extra cent(s) within that half go to **worst position** (not earliest seat)
- *Code todo:* `awardPot` / `splitShare` still assign odd pot cents to the low half and use earliest seat for tie-breaks

**Buy-ins & Stacks**:
- Target: initial buy-in exactly $100.00 (join flow defaults to 100; strict enforcement todo)
- Rebuys allowed anytime, up to the current largest stack
- Display stacks with two decimal places (100.00)

**Host Powers (Critical for MVP)**:
- Manually award pot (with split options: full, half, quarter, sixth, eighth) — **todo**
- Mark hand dead at showdown (discretionary host override) — **todo** (auto-`dead` when shredded to zero cards is implemented)
- Transfer host rights to another player — **done**
- Manually adjust any player’s stack (add/subtract/set) — **done**
- Approve/deny seat join requests — **done**
- Undo last action (nice to have)

## Game State JSON Schema
{
  "game_id": "uuid-string",
  "host_id": "user-uuid",
  "hand_number": 7,
  "status": "flop_betting",           // Engine flow: waiting → preflop_betting → flop_betting → turn_betting → river_betting → showdown → finished. Auto-shred runs inside dealFlop/dealTurn/dealRiver (no separate player discard phase). Legacy enum values flop_discard / turn_discard / river_discard exist in types but are unused.

  "updated_at": "2026-06-04T20:16:00Z",

  // ── Money (all values in cents) ─────────────────────────────
  "pot": 24550,
  "current_wager": 1000,
  "min_raise": 2000,
  "blinds": { "small": 25, "big": 50 },

  // ── Boards ──────────────────────────────────────────────────
  "board": {
    "top": ["Ah", "Kd", "Qs", null, null, null],
    "shredder": ["5d", "5h", "3s", null, null, null]
  },

  // ── Players ─────────────────────────────────────────────────
  "players": [
    {
      "user_id": "uuid",
      "seat": 1,
      "display_name": "Theo",
      "stack": 14275,
      "contributed_this_hand": 1250,
      "bet_this_street": 1000,
      "hole_cards": ["As", "Ks", "Qd", "Jd", "10h"],
      "live_hole_cards": ["As", "Ks", "10h"],
      "shredded_cards": ["5c", "5s"],
      "status": "active",
      "current_pip_total": 24,
      "final_pip_total": null,
      "hand_result": null
    }
  ],

  // ── Game Flow ───────────────────────────────────────────────
  "current_player_seat": 3,
  "button_seat": 5,
  "last_aggressor_seat": 2,

  // ── Side Pots ───────────────────────────────────────────────
  "side_pots": [],

  // ── History & Auditing ──────────────────────────────────────
  "action_history": [],

  "last_action": "Theo raised 25.00"
}

## Implementation Notes (code vs rules)

| Rule / feature | Status |
|----------------|--------|
| Auto-shred on deal | Done |
| Pot-limit betting, auto-advance streets | Done |
| Per-player hole card privacy | Done |
| Supabase Realtime + API persistence | Done (RLS off) |
| Automatic showdown `awardPot` | Done |
| Odd-chip split (high first, worst position on high tie) | **Todo** |
| Host manual pot award | **Todo** |
| Host mark hand dead | **Todo** |
| Side pots / all-in edge cases | **Todo** |
| ledger_events + replay | **Todo** |
| Input-commitment shuffle | **Todo** |
| 4-player minimum to start hand | **Todo** |
| $100/hand cap | **Todo** |

## Decisions Log
- 2026-06-04: Shredding is **auto-shred only**; manual discard phase removed from house rules and roadmap.
- 2026-06-04: Odd-chip assignment documented; implementation deferred (see Split Rules).

## To-Do List
- Fix odd-chip logic in `awardPot` / `splitShare` (high half first; high ties → worst position)
- Host: manual pot award, mark hand dead
- Side pots; playtest with 4–6 players
- Align or remove legacy `*_discard` statuses and `discard_submitted` field in types