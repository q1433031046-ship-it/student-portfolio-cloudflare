CREATE TABLE `pages_files` (
	`job_id` text NOT NULL,
	`path` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_type` text NOT NULL,
	`inline_base64` text,
	`object_key` text,
	`storage_backend` text,
	`source_etag` text,
	`sha256` text,
	`asset_key` text,
	`uploaded` integer DEFAULT 0 NOT NULL,
	`upload_attempts` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`job_id`, `path`),
	FOREIGN KEY (`job_id`) REFERENCES `pages_jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `pages_files_media_reference` ON `pages_files` (`object_key`);--> statement-breakpoint
CREATE TABLE `pages_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_revision` integer NOT NULL,
	`candidate_json` text NOT NULL,
	`candidate_hash` text NOT NULL,
	`template_hash` text NOT NULL,
	`artifact_hash` text,
	`status` text NOT NULL,
	`lock_token` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`preview_attempted` integer DEFAULT 0 NOT NULL,
	`production_attempted` integer DEFAULT 0 NOT NULL,
	`preview_id` text,
	`preview_url` text,
	`production_id` text,
	`production_url` text,
	`lookup_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_summary` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_one_active_job` ON `pages_jobs` ((1)) WHERE "pages_jobs"."status" NOT IN ('PUBLISHED','FAILED_FINAL');--> statement-breakpoint
CREATE TABLE `pages_site` (
	`id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`production_branch` text NOT NULL,
	`production_url` text NOT NULL,
	`current_job` text,
	`previous_job` text,
	`current_deploy` text,
	`previous_deploy` text,
	`public_revision` integer DEFAULT 0 NOT NULL,
	`last_success_at` text
);
