CREATE TABLE `site_ownership` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`auth_subject` text,
	`auth_provider` text NOT NULL,
	`bound_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`onboarding_email_sent_at` text,
	`onboarding_email_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_ownership_owner_email_idx` ON `site_ownership` (`owner_email`);--> statement-breakpoint
CREATE TRIGGER `site_ownership_owner_email_immutable`
BEFORE UPDATE OF `owner_email` ON `site_ownership`
FOR EACH ROW
WHEN NEW.`owner_email` != OLD.`owner_email`
BEGIN
	SELECT RAISE(ABORT, 'owner email is immutable');
END;
