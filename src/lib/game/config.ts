/** Turn timer: disabled by default so testing/debugging is easier. Set enabled to true to test (10s). */
export const GAME_CONFIG = {
  TURN_TIMER_ENABLED: false,
  TURN_TIMER_SECONDS: 10,
  REBUY_WINDOW_SECONDS: 10,
  /** Invisible timer after showdown (cards/results visible) before auto-award and rebuy window.
   *  Gives players a moment to process the outcome. Configurable for future host/player settings.
   *  Currently 5s for "in between hands" pause.
   */
  SHOWDOWN_TIMER_SECONDS: 5,
  GAME_TYPE: 'skarney',
} as const;