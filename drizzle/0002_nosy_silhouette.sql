ALTER TABLE `portfolio_events` ADD `dedupe_key` text;--> statement-breakpoint
ALTER TABLE `portfolio_events` ADD `event_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolio_events` ADD `last_seen_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_events_dedupe_idx` ON `portfolio_events` (`dedupe_key`);