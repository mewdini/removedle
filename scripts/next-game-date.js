// Prints the date of the NEXT challenge, for the daily workflow to generate.
//
// Derived from the game clock rather than the runner's UTC date. The runner is
// UTC and the game rolls over at 21:00 Pacific, so `date -d tomorrow` only
// happened to agree with this while the cron sat in a particular window -- it
// would have drifted silently the first time the schedule or DST moved it.
//
// The invariant: this must run AFTER the reset for the day it is generating, so
// that gameDate() is already the live day and +1 is genuinely unreleased.
import { addDays, gameDate } from './lib/dates.js';

process.stdout.write(addDays(gameDate(), 1));
