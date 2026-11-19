ALTER TABLE "integration_settings" ADD COLUMN "chatgpt_session" text;--> statement-breakpoint
ALTER TABLE "integration_settings" ADD COLUMN "chatgpt_host_id" text;--> statement-breakpoint
ALTER TABLE "integration_settings" DROP COLUMN "ai_provider";--> statement-breakpoint
ALTER TABLE "integration_settings" DROP COLUMN "anthropic_api_key";--> statement-breakpoint
DROP TYPE "public"."ai_provider";
