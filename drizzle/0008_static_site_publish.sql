ALTER TABLE `portfolio_documents` ADD `static_published_source_revision` integer;
--> statement-breakpoint
CREATE TABLE `static_site_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'netlify' NOT NULL,
	`account_identity_hash` text NOT NULL,
	`site_id` text NOT NULL,
	`site_slug` text NOT NULL,
	`production_url` text,
	`build_branch` text DEFAULT 'static-build/v1.3.1-b' NOT NULL,
	`expected_commit_sha` text NOT NULL,
	`status` text DEFAULT 'configured' NOT NULL,
	`current_deploy_id` text,
	`previous_deploy_id` text,
	`current_public_revision` integer DEFAULT 0 NOT NULL,
	`last_verified_at` text,
	`last_error_code` text,
	`last_error_summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`first_published_at` text,
	`last_success_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `static_site_bindings_site_id_idx` ON `static_site_bindings` (`site_id`);
--> statement-breakpoint
CREATE TABLE `static_publish_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_binding_id` text DEFAULT 'default' NOT NULL,
	`source_document_revision` integer NOT NULL,
	`public_revision` integer NOT NULL,
	`candidate_json` text NOT NULL,
	`candidate_sha256` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'FROZEN' NOT NULL,
	`phase` text DEFAULT 'freeze' NOT NULL,
	`provider_request_key` text NOT NULL,
	`deploy_id` text,
	`deploy_permalink` text,
	`artifact_manifest_json` text,
	`artifact_sha256` text,
	`artifact_manifest_file_sha256` text,
	`export_generation` integer DEFAULT 1 NOT NULL,
	`bootstrap_token_sha256` text NOT NULL,
	`bootstrap_expires_at` text NOT NULL,
	`bootstrap_consumed_at` text,
	`lease_id_sha256` text,
	`lease_expires_at` text,
	`error_code` text,
	`error_summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`site_binding_id`) REFERENCES `static_site_bindings`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `static_publish_jobs_idempotency_idx` ON `static_publish_jobs` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `static_publish_jobs_status_idx` ON `static_publish_jobs` (`site_binding_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `static_publish_job_media` (
	`job_id` text NOT NULL,
	`media_id` text NOT NULL,
	`object_key` text NOT NULL,
	`public_path` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`storage_backend` text NOT NULL,
	`source_etag` text NOT NULL,
	`sha256` text,
	`provider_sha1` text,
	`artifact_verified_at` text,
	`status` text DEFAULT 'frozen' NOT NULL,
	PRIMARY KEY(`job_id`, `media_id`),
	FOREIGN KEY (`job_id`) REFERENCES `static_publish_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `static_publish_job_media_path_idx` ON `static_publish_job_media` (`job_id`,`public_path`);
