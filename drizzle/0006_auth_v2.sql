ALTER TABLE `admin_credentials` ADD `auth_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admin_credentials` ADD `confirmed_program_version` text;
