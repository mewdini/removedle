import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const challengeStats = sqliteTable(
    'challengeStats',
    {
        // Game mode. Defaults to 'normal' so rows written before modes existed
        // (and any writer that predates this column) land in the original game.
        mode: text('mode').notNull().default('normal'),
        date: text('date').notNull(),
        totalGames: integer('totalGames').default(0).notNull(),
        totalPoints: integer('totalPoints').default(0).notNull(),
    },
    // Each mode is a separate game, so a day's totals are per (mode, date).
    (t) => [primaryKey({ columns: [t.mode, t.date] })]
);
