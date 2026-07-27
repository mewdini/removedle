-- Hand-edited after `drizzle-kit generate`. Two changes were required; do not
-- regenerate this file over them.
--
-- 1. PRAGMA foreign_keys -> defer_foreign_keys. D1 accepts foreign_keys=OFF and
--    silently ignores it: it wraps every call in an implicit transaction and
--    enforces foreign keys unconditionally. defer_foreign_keys defers the check
--    to the end of the transaction, which is what a table rebuild actually needs.
--
-- 2. The data copy selected "mode" from the OLD table, which has no such column,
--    so the statement failed with `no such column: mode` -- and because a
--    multi-statement D1 call is one transaction, the whole migration (including
--    the CREATE TABLE) rolled back. The literal 'normal' backfills every existing
--    row into the original game.
PRAGMA defer_foreign_keys=on;--> statement-breakpoint
CREATE TABLE `__new_challengeStats` (
	`mode` text DEFAULT 'normal' NOT NULL,
	`date` text NOT NULL,
	`totalGames` integer DEFAULT 0 NOT NULL,
	`totalPoints` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`mode`, `date`)
);
--> statement-breakpoint
INSERT INTO `__new_challengeStats`("mode", "date", "totalGames", "totalPoints") SELECT 'normal', "date", "totalGames", "totalPoints" FROM `challengeStats`;--> statement-breakpoint
DROP TABLE `challengeStats`;--> statement-breakpoint
ALTER TABLE `__new_challengeStats` RENAME TO `challengeStats`;--> statement-breakpoint
PRAGMA defer_foreign_keys=off;
