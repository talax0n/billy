CREATE TYPE "public"."ai_provider" AS ENUM('anthropic', 'openai');--> statement-breakpoint
CREATE TABLE "integration_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ai_provider" "ai_provider" DEFAULT 'anthropic' NOT NULL,
	"ai_model" text DEFAULT '' NOT NULL,
	"anthropic_api_key" text,
	"openai_api_key" text,
	"telegram_bot_token" text,
	"telegram_bot_username" text DEFAULT '' NOT NULL,
	"telegram_webhook_secret" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;