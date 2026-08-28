CREATE TABLE `portfolio_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portfolio_audit_time_idx` ON `portfolio_audit_logs` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `portfolio_audit_actor_time_idx` ON `portfolio_audit_logs` (`actor_email`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `portfolio_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`draft_json` text NOT NULL,
	`published_json` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE TABLE `portfolio_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`event_type` text NOT NULL,
	`path` text NOT NULL,
	`project_id` text,
	`media_version` text,
	`referrer` text,
	`device_type` text,
	`browser` text,
	`operating_system` text,
	`country` text,
	`region` text,
	`city` text,
	`asn` integer,
	`as_organization` text,
	`network_hash` text,
	`risk_level` text DEFAULT 'low' NOT NULL,
	`risk_reason` text,
	`action` text DEFAULT 'allow' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `portfolio_events_time_idx` ON `portfolio_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `portfolio_events_project_time_idx` ON `portfolio_events` (`project_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `portfolio_events_network_time_idx` ON `portfolio_events` (`network_hash`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `portfolio_events_risk_time_idx` ON `portfolio_events` (`risk_level`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `portfolio_media` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`project_id` text NOT NULL,
	`slot` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_media_object_key_idx` ON `portfolio_media` (`object_key`);--> statement-breakpoint
CREATE INDEX `portfolio_media_project_idx` ON `portfolio_media` (`project_id`,`created_at`);