CREATE TABLE `admin_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`recovery_hash` text NOT NULL,
	`recovery_salt` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`initialized_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`password_changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`recovery_code_created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`user_agent_hash` text
);
--> statement-breakpoint
CREATE INDEX `admin_sessions_expiry_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `media_upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`object_key` text NOT NULL,
	`replaced_object_key` text,
	`project_id` text NOT NULL,
	`slot` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`chunk_size` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`uploaded_chunks_json` text DEFAULT '[]' NOT NULL,
	`uploaded_by` text NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_upload_sessions_expiry_idx` ON `media_upload_sessions` (`status`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_upload_sessions_object_key_idx` ON `media_upload_sessions` (`object_key`);--> statement-breakpoint
ALTER TABLE `portfolio_media` ADD `replaced_object_key` text;--> statement-breakpoint
ALTER TABLE `portfolio_media` ADD `storage_backend` text DEFAULT 'r2' NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolio_media` ADD `chunk_size` integer;--> statement-breakpoint
ALTER TABLE `portfolio_media` ADD `chunk_count` integer DEFAULT 1 NOT NULL;
