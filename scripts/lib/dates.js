// The game's calendar day is Pacific, not UTC -- it rolls over at PT midnight.
// Anything the pipeline stamps with a date has to agree with that, or a scan run
// from CI (UTC) and one run locally would disagree about which day a song was
// added on, and a "new for 14 days" badge would flip a day early or late.
//
// Deliberately a duplicate of getTodayDate() in src/params/date.ts rather than an
// import: that file is TypeScript behind the $params alias and pulls in
// @sveltejs/kit types, the same reason scripts/lib/modes.js duplicates
// src/lib/modes.ts. Six lines with no configuration in them, so there is nothing
// here that can drift out of sync in a way that matters.
export function todayPacific() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}
