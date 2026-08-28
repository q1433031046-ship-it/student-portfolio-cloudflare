CREATE TABLE `portfolio_access_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`max_uses` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portfolio_access_passes_status_idx` ON `portfolio_access_passes` (`enabled`,`expires_at`);--> statement-breakpoint
CREATE INDEX `portfolio_access_passes_created_idx` ON `portfolio_access_passes` (`created_at`);--> statement-breakpoint
CREATE TABLE `portfolio_access_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`restriction_enabled` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL
);
