# Skarnage Project Notes

**Last Updated:** June 2026 (post 6/4 playable milestone)

## Project Links
- Live Site: https://skarnage.vercel.app
- GitHub: https://github.com/theojdev1517/skarnage
- Supabase Project: skarnage
- MVP Roadmap: `../skarnage reference/Skarney_MVP_Roadmap.docx` (CURRENT STATUS at bottom overrides phase checklist when they conflict)

## Database Tables
(See earlier summary we made — you can paste it here later)

## Phase 0: House Rules (Skarney)

**Number of Players**: 2 minimum to start (heads-up supported), up to 8 max (8×5 hole cards + 12 board cards = 52, perfect).

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
- (Fixed 2026-06: odd cent now to high half via Math.ceil; high ties use reverse-seat order in splitShare)

**Buy-ins & Stacks** (auto / direct as of 2026):
- Initial buy-in (pre-start, while status==="waiting"): **always exactly $100.00**. Host creation and any seats taken before first hand are locked to 100 (direct seating, no host approval). Grayed/fixed in UI.
- Post-start joins and rebuys: min always exactly 100. Max per stepped rule based on current largest positive stack (computed after payouts for rebuy offers):
  - largest <= 100 → max 100
  - 100 < largest <= 200 → max = largest (100% match)
  - 200 < largest <= 266.66 → max = 200
  - largest > 266.66 → max = 75% of largest, rounded to nearest 5
- Player chooses via slider + text box (rebuy box starts with slider at 100 but text blank to avoid misclicks; "OK" uses the box value).
- All standard buy-ins and rebuys are **direct** (immediate seat or stack set, no pending request + host approval). The enforcement of the rules replaces the need for host policing of stacks.
- Rebuy offers still use the 10s window for broke players (after awardPot updates stacks). "Leave Table" option in rebuy chooser stands the player up.
- Display stacks with two decimal places (100.00)

**Host Powers (Critical for MVP)**:
- Approve/deny seat join requests — **done**
- Remove players (force stand/kick from seat) — (to be implemented or via stack=0 + stand)
- Mark players away — (player self + host support via existing)
- Transfer host rights to another player — **done**
- Manually adjust any player’s stack (add/subtract/set) — **done**
- All pot award and hand-dead decisions happen **automatically** only (via engine on folds, street completion, shred-to-zero, etc.). Manual host award/kill is a legacy idea and has been removed.
- Approve/deny seat join requests — **done**
- Undo last action (nice to have)

## Game State JSON Schema
{
  "game_id": "uuid-string",
  "host_id": "user-uuid",
  "hand_number": 7,
  "status": "flop_betting",           // Engine flow: waiting → preflop_betting → flop_betting → turn_betting → river_betting → showdown → finished. Auto-shred runs inside dealFlop/dealTurn/dealRiver (no separate player discard phase).

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
| Odd-chip split (high first, worst position on high tie) | **Done** (high gets ceil/2 share; high ties use reverse seat for remainders) |
| Host manual pot award / mark hand dead | Removed (legacy idea; all awarding and dead-hand decisions are fully automatic per engine rules) |
| Side pots / all-in edge cases | **Done** (computeSidePots in engine; per-layer resolve + payout in awardPot using eligible; fallback for old states; reuses resolveShowdown/buildPayouts/splitShare) |
| ledger_events + replay | **Todo** |
| Input-commitment shuffle | **Todo** |
| Player minimum to start hand | Removed (2+ / heads-up supported; no artificial limit) |
| $100/hand cap | **Todo** |

## Decisions Log
- 2026-06-04: Shredding is **auto-shred only**; manual discard phase removed from house rules and roadmap.
- 2026-06-04: Odd-chip assignment documented; implementation deferred (see Split Rules).
- 2026-06: Implemented (and later removed per direction) odd-chip fix (kept) + host manual award/kill powers (reverted: legacy; award/mark-dead is automatic only). Host retains: join approvals, stack adjust, transfer host, etc.
- 2026-06-05: Removed legacy `*_discard` / `*_dealt` / `buying_in` GameStatus values, `discard_submitted` (from Player), and `skip_discard_eligible` (from GameState). Purged all setters in engine.ts / seatManagement.ts and lists in validateState.ts / playerLifecycle.ts. (post-milestone type cleanup; no logic change). Also deleted obsolete "variable names.txt" reference file.
- 2026-06-05: Implemented side pots + all-in support (high prio). computeSidePots builds layers from contributed_this_hand; awardPot now resolves/pays per side pot using eligible live players + existing high/low/odd-chip logic. Updated processBet, postBlinds, startNewHand, award to maintain side_pots. Fallback for states without side_pots.
- 2026-06-xx: Live testing notes (8 items) addressed:
- 2026-06-xx: Major acting/turn + blind bugs fixed (from live "players dropped mid hand" + next-hand blind skip reports):
  - getNextActiveSeat: fixed "next after fromSeat" to always pick first seat > from (or wrap to lowest); previous -1 always reset to [0] (lowest seat) which jumped the turn order when folds removed a player mid-round. This was root of extra actions after folds and wrong "ask folded player".
  - isBettingRoundComplete: for aggression (last_aggressor != null), once everyoneMatched, return true immediately (close round). Removed the `current_player_seat === last_aggressor_seat` which forced extra laps among remaining players (esp. after field reduced by folds to HU). Pure-check and preflop BB logic untouched.
  - firstActiveSeat: now sorts active for consistent fallback.
  - postBlinds: sanitize/clear stale last_blinds/prior_blinds if the recorded poster seats are no longer seated/eligible now (stood/folded out/broke). Prevents bad re-rotate or skipped=1 override logic from ghost records of prior hand.
  - Side pots + allin still working per user note.
- 2026-06-xx: Added "add chips" (top-up) feature:
  - Player (per their seat) gets "+ add chips" button in seat UI -> opens AddChipsModal (amount input, submit posts requestAddChips).
  - New PendingChipAddRequest type + pending_chip_adds[] on GameState (defaulted in normalize/create).
  - seatManagement: requestAddChips (player, creates pending, no dupes), approveAddChips (host only: credits stack immediately, removes pending), denyAddChips.
  - actionGuards + api route + startNewHand etc paths updated (allowed broadly like rebuy).
  - New components: AddChipsModal + HostChipAddApprovals (list for host, approve/deny like joins).
  - Wired in page: button only for isMine, host approvals list if pendings, runAction for host ops, submit for player request.
  - Host still has direct stack adjust in SeatHostMenu; this is the *player request + host approve* flow.
  1. Auto-advance remaining streets + showdown when only all-ins left in pot (no manual checks on e.g. flop all-in). Updated isBettingRoundComplete (early true if getActingPlayers <=1), getNextActiveSeat (strict stack>0 acting only), processBet (early advance if 0 acting), advanceToNextPhase (recurse while 0 acting + >1 in), startNewHand guard, status all_in normalization on bet + across streets.
  2. Current bet (bet_this_street) now shown in front of every seat in table (page.tsx seat render; visible via sanitize to opponents).
  3+4. BettingControls: stack-sensitive (if facingBet && myStack <= toCall, render only Fold+Call in 2-col flex; no Raise). Call button always prints amount e.g. "Call 123.50" when active bet.
  5. Rebuy moved to ConfirmModal popup (auto opens on offer, live secs countdown, confirm posts rebuy; removed RebuyBanner from action area). 
  6. Raising edge: in processBet for raise, only update last_aggressor + min_raise on full-size delta (>=minInc); short all-in raises keep prior aggressor/min so unacted players on prior bet still get turns + can raise over. (getNext skips all-ins.)
  7. Showdown printout (last_action) now built from actual totalPayouts (per side-pot awards) instead of full-res even-half summary. "Pot awarded: name amt (desc)..." accurate even with sides.
  8. 10s rebuy timeout to away: added applyRebuyTimeouts (sets presence=away + clears offers when deadline past); wired in api POST (pre-action), startNewHand, engine import. Config already 10s. Modal + server enforce.
  All via reuse (getActing, existing modals/intents, sidepot award etc). tsc clean; eslint preexistings only.
- 2026-06-xx: Rebuy now requires host approval (like add chips): player rebuy modal confirm posts 'requestRebuy' (creates pending_rebuy), host approves via HostRebuyApprovals list (which calls approveRebuy to award stack and clean). Direct 'rebuy' kept for compat but UI uses request. Also fixed rebuy bypass.
- 2026-06-xx: Blind/position fixes (persistent "button1 SB2 BB4 action-on-button, 3 skipped" in 4p games, even on 3rd hand): Removed the "if exactly 1 skipped last hand, force as BB" override in postBlinds (it was triggering on normal rotation in 4p+ because union of last+planned posted always left exactly one "skipped" player, forcing wrong BB and first-to-act on button preflop). Blinds now strictly follow resolve from button + eligibility. firstToAct calc in postBlinds uses assignment bb directly. Matches "button correct, but blinds wrong + pre action on button".
- 2026-06-xx: All-in auto-advance fix: Reordered isBettingRoundComplete so acting<=1 complete only *after* everyoneMatched (previously early true even if last covered player bet_this < current, i.e. hadn't called the all-in). Updated noMoreBettingActionPossible helper + early guards in processBet/advanceToNextPhase to only auto when last active has matched (or no wager). Ensures remaining player gets explicit turn to call all-ins before auto streets/showdown. (Matches the 3p test: second all-in on turn no longer skips the 3rd's call.)
- 2026-06-xx: Call button label fix: when facing bet > stack, now labels "Call [min(toCall, stack)]" (the actual amount that will be called / all-in amount) instead of full bet amount. (Calc was already correct.)
- 2026-06-xx: Rebuy UX fixes: requestRebuy now removes the seat from rebuy_offered_seats (so player's modal closes immediately on refresh, countdown stops for them). applyRebuyTimeouts only auto-aways seats still in offered (keeps pending_rebuys for those who requested in time). approveRebuy no longer requires window open or offered (allows host to approve timely requests even if 10s passed before clicking approve; just cleans if no req). assertCanStartHand now also blocks if pending_rebuys (host must resolve before next hand). This addresses modal staying after request, approve after timeout doing nothing, etc.
- 2026-xx: Auto buy-ins & rebuys implemented (direct, no host approval for standard cases). Initial always exactly 100 while status==="waiting" (direct seat on create + pre-start joins). Post-start: min 100 / max per 4-bucket rule on largest positive stack (post-payout for rebuys). New directJoin + enhanced playerRebuy with getBuyInRange enforcement. Rebuy chooser: RebuyStackModal (slider starts 100, text box blank on open, "OK" uses box value, "Leave Table" does standUp). Joins use direct 'join' action. Pending approval paths bypassed for normal buy-ins/rebuys (Host*Approvals lists now empty for these). Future auto next-hand / showdown timer compatible via existing window + direct apply.
- Future (do not code): Rebuys should calculate min (constant) and max (half the largest stack at time of award, before popping rebuy modal). Requires awarding pot first to know largest stack for the calc. Add to house rules: "Rebuys allowed anytime, up to the current largest stack" (update calc). (Note: superseded by the auto 100 + stepped max rule above.)

## To-Do List
- Playtest with 4–6 players; fix UX issues found (these 8 now done)
- ledger_events + replay view
- Input-commitment shuffler
- Connection drop / browser close / disconnect detection for seated players: detect when a player closes tab, loses network, etc. (without them explicitly standing up or going away). Game should not stall waiting for a disconnected player's turn; auto-mark them away / skip / auto-fold as close to instantly as possible. (See example: phone tab closed, hand started, turn waited for them.)

- $100/hand cap
- Mobile polish, RLS, nicer visuals (medium)