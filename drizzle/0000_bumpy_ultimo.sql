CREATE TABLE `works` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`student` text NOT NULL,
	`category` text NOT NULL,
	`year` text NOT NULL,
	`duration` text DEFAULT '00:00' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`palette` text DEFAULT '#3b5bff' NOT NULL,
	`accent` text DEFAULT '#d9ff55' NOT NULL,
	`video_key` text,
	`cover_key` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE INDEX `works_status_created_idx` ON `works` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `works_uploaded_by_idx` ON `works` (`uploaded_by`);