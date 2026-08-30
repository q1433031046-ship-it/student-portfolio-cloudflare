CREATE TABLE IF NOT EXISTS `admin_auth_state` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_version` integer DEFAULT 1 NOT NULL,
	`confirmed_program_version` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `admin_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
