ALTER TABLE `admin_credentials` ADD `auth_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admin_credentials` ADD `confirmed_program_version` text;
--> statement-breakpoint
CREATE TABLE `system_secrets` (
  `purpose` text PRIMARY KEY NOT NULL,
  `secret_value` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
