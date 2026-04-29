# Skarnage Project Notes

**Last Updated:** April 28, 2026

## Project Links
- Live Site: https://skarnage.vercel.app
- GitHub: https://github.com/theojdev1517/skarnage
- Supabase Project: skarnage

## Database Tables
(See earlier summary we made — you can paste it here later)

## Phase 0: House Rules (Skarney)

**Number of Players**: 4 minimum to start, up to 8 max (8×5 hole cards + 12 board cards = 52, perfect).

**Hole Cards**: 5 per player.

**Betting Structure**:
- Pot Limit (with optional $100/hand/player cap)
- Blinds (default 0.25/0.50)
- 4 betting rounds: Preflop → Flop → Turn → River
- Host should eventually be able to set blinds/structure when creating game.

**Community Cards (Dual Board)**:
- Top board (High hand builder) + Bottom board (Discard / Low pip board)
- Dealt in stages: Flop (3 each), Turn (2 each), River (1 each)

**Discard Phase**:
- After each street is dealt (after flop, after turn, after river)
- Players discard any cards in their hand that match the bottom board cards (face up, on top of matching card)
- Players choose which cards to discard
- Hand is dead if they miss a discard (host manually kills for MVP)
- Optional smart logic: skip discard round if no possible cards left to discard

**Hand Ranking & Scoring**:
- **High**: Best 5-card hand using remaining hole cards + 6 cards on Top board
- **Low**: Pip count on remaining cards (A=1, 2-10=face value, J/Q/K=10)
- Always split pot (High / Low) — no qualifier
- Ties split accordingly (quarters, sixths, eighths as needed)

**Split Rules**:
- Half pot to best high, half to best low
- Exact ties on high or low split that half
- Extra odd chips go to high hand first, then to worst position if needed

**Buy-ins & Stacks**:
- Initial buy-in: exactly $100.00
- Rebuys allowed anytime, up to the current largest stack
- Display stacks with two decimal places (100.00)

**Host Powers (Critical for MVP)**:
- Manually award pot (with split options: full, half, quarter, sixth, eighth)
- Kill/dead a hand at showdown if player missed discard
- Transfer host rights to another player
- Manually adjust any player’s stack (add/subtract for mistakes)
- Undo last action (nice to have)

## Game State JSON Schema
{
  "game_id": "uuid-string",
  "host_id": "user-uuid",
  "hand_number": 7,
  "status": "flop_discard",           // Full enum: "waiting" | "buying_in" | "preflop_betting" | "flop_dealt" | "flop_discard" | "flop_betting" | "turn_dealt" | "turn_discard" | "turn_betting" | "river_dealt" | "river_discard" | "river_betting" | "showdown" | "finished"

  "updated_at": "2026-04-28T20:16:00Z",

  // ── Money (all values in cents) ─────────────────────────────
  "pot": 24550,
  "current_wager": 1000,              // Highest bet this street (used to calculate amount to call)
  "min_raise": 2000,
  "blinds": { "small": 25, "big": 50 },

  // ── Boards ──────────────────────────────────────────────────
  "board": {
    "top": ["Ah", "Kd", "Qs", null, null, null],        // High hand builder
    "shredder": ["5d", "5h", "3s", null, null, null]    // Triggers automatic shredding
  },

  // ── Players ─────────────────────────────────────────────────
  "players": [
    {
      "user_id": "uuid",
      "seat": 1,
      "display_name": "Theo",
      "stack": 14275,                    // Total stack in cents ($142.75)
      "contributed_this_hand": 1250,     // For $100 cap enforcement
      "bet_this_street": 1000,           // Amount bet this street
      "hole_cards": ["As", "Ks", "Qd", "Jd", "10h"],     // Original 5 cards (for history/showdown)
      "live_hole_cards": ["As", "Ks", "10h"],            // Cards still in hand after shredding
      "shredded_cards": ["5c", "5s"],                    // Auto-shredded this street
      "discard_submitted": true,
      "status": "active",                // "active" | "folded" | "all_in"
      "current_pip_total": 24,
      "final_pip_total": null,
      "hand_result": null
    }
  ],

  // ── Game Flow ───────────────────────────────────────────────
  "current_player_seat": 3,
  "button_seat": 5,
  "last_aggressor_seat": 2,
  "skip_discard_eligible": false,

  // ── Side Pots ───────────────────────────────────────────────
  "side_pots": [],

  // ── History & Auditing ──────────────────────────────────────
  "action_history": [
    {
      "street": "flop",
      "seat": 2,
      "action": "raise",
      "amount": 2500,
      "timestamp": "2026-04-28T20:15:30Z"
    }
  ],

  "last_action": "Theo raised 25.00"
}

## Decisions Log
- 

## To-Do List
- 
