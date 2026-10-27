CREATE TABLE `integration_credentials` (
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`company_id` text NOT NULL,
	`iv` text NOT NULL,
	`ciphertext` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `provider`, `company_id`)
);
--> statement-breakpoint
CREATE TABLE `integration_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`company_id` text NOT NULL,
	`iv` text NOT NULL,
	`ciphertext` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `integration_oauth_expiry_idx` ON `integration_oauth_states` (`expires_at`);