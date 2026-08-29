ALTER TABLE `admin_credentials` ADD `auth_scheme` text DEFAULT 'v1' NOT NULL;
--> statement-breakpoint
ALTER TABLE `admin_credentials` ADD `security_version` text DEFAULT 'legacy' NOT NULL;
