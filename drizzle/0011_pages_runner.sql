CREATE TABLE `pages_runner_nonces` (
	`job_id` text NOT NULL,
	`phase` text NOT NULL,
	`nonce` text NOT NULL,
	PRIMARY KEY(`job_id`, `phase`, `nonce`),
	FOREIGN KEY (`job_id`,`phase`) REFERENCES `pages_runner_phases`(`job_id`,`phase`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `pages_runner_phases` (
	`job_id` text NOT NULL,
	`phase` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`state_json` text NOT NULL,
	PRIMARY KEY(`job_id`, `phase`),
	FOREIGN KEY (`job_id`) REFERENCES `pages_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pages_runner_phase_valid" CHECK("pages_runner_phases"."phase" IN ('preview','production')),
	CONSTRAINT "pages_runner_state_bounded" CHECK(length("pages_runner_phases"."state_json")<=8192)
);
--> statement-breakpoint
CREATE TABLE `pages_runner_sources` (
	`job_id` text PRIMARY KEY NOT NULL,
	`head` text NOT NULL,
	`ref` text NOT NULL,
	`template` text NOT NULL,
	`manifest_count` integer DEFAULT 0 NOT NULL,
	`manifest_final` integer DEFAULT 0 NOT NULL,
	`safe_ready` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `pages_jobs`(`id`) ON UPDATE no action ON DELETE restrict
);
