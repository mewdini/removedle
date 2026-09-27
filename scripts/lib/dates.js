// The game's day rolls over at 21:00 on a Pacific clock, not at midnight and not
// in UTC. Anything the pipeline stamps or schedules with a date has to agree with
// that, or CI (UTC) and a local run disagree about which day it is: a scan at
// 06:09 UTC is already the next UTC day, and a "new for 14 days" badge stamped on
// the wrong day flips a day early or late against the client's own reckoning.
//
// The implementation is shared with the app (src/params/date.ts) through
// src/lib/shared/game-core.js, so the reset hour and the rollover logic exist in
// exactly one place. This file only keeps the import path the scripts already use
export { RESET_HOUR_PT, addDays, gameDate } from '../../src/lib/shared/game-core.js';
