import type { Tip } from './interfaces';

export const TIPS: Tip[] = [
    {
        segments: [
            { text: 'You can browse ' },
            { text: 'every song', bold: true },
            {
                text: ' that can appear in daily challenges from the catalog icon in the header, streaming links included!',
            },
        ],
    },
    {
        segments: [
            { text: 'Once you finish a challenge, ' },
            { text: "click a song's title", bold: true },
            { text: ' in your results to reveal streaming links for it!' },
        ],
    },
    {
        segments: [
            { text: 'You can ' },
            { text: 'change themes', bold: true },
            { text: ' and ' },
            { text: "adjust the audio's volume", bold: true },
            { text: ' in Settings!' },
        ],
    },
    {
        segments: [
            { text: "There's a second daily game, " },
            { text: 'Challenger', bold: true, internal: true },
            {
                text: ', with a completely different catalog of obscure songs!',
            },
        ],
    },
    {
        segments: [
            { text: 'Are you an ' },
            { text: 'underscores', bold: true },
            { text: ' fan? Check out ' },
            { text: 'underscordle', href: 'https://underscordle.org', bold: true },
            { text: ', the game removedle is forked from!' },
        ],
    },
];

// `exclude` keeps a re-trigger (the debug preview can rebuild repeatedly
// without this component ever unmounting) from landing on the same tip twice
// in a row. Reference equality is enough since TIPS entries are stable
// singletons, never copied
export function chooseTip(exclude?: Tip | null) {
    if (TIPS.length <= 1) return TIPS[0];

    let pick: Tip;
    do {
        pick = TIPS[Math.floor(Math.random() * TIPS.length)];
    } while (pick === exclude);
    return pick;
}
