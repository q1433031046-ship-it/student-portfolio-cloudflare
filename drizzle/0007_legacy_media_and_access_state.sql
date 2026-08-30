CREATE TABLE IF NOT EXISTS `legacy_media_migrations` (
	`media_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`byte_size` integer NOT NULL,
	`chunk_size` integer DEFAULT 4194304 NOT NULL,
	`chunk_count` integer NOT NULL,
	`source_etag` text NOT NULL,
	`verified_chunks_json` text DEFAULT '[]' NOT NULL,
	`final_verified_chunks_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'copying' NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`media_id`) REFERENCES `portfolio_media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `legacy_media_migrations_status_idx` ON `legacy_media_migrations` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `portfolio_access_pass_state` (
	`pass_id` text PRIMARY KEY NOT NULL,
	`session_generation` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pass_id`) REFERENCES `portfolio_access_passes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `admin_login_throttle` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `admin_login_throttle_locked_until_idx` ON `admin_login_throttle` (`locked_until`);
