ALTER TABLE `pages_files` ADD `preview_verified` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pages_files` ADD `production_verified` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pages_files` ADD `canonical_verified` integer DEFAULT 0 NOT NULL;