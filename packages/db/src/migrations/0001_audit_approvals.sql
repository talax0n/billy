CREATE TYPE "public"."approval_kind" AS ENUM('void', 'discount', 'below_cost', 'revisi_lower', 'refund', 'cancel_printed_draft', 'foreign_or_past_revisi');--> statement-breakpoint
CREATE TYPE "public"."approval_method" AS ENUM('pin', 'remote');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'used', 'expired');--> statement-breakpoint
CREATE TYPE "public"."audit_source" AS ENUM('web', 'kasir', 'kasir_offline', 'system');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "approval_kind" NOT NULL,
	"status" "approval_status" NOT NULL,
	"method" "approval_method" NOT NULL,
	"requested_by" uuid NOT NULL,
	"device_code" text,
	"subject" jsonb NOT NULL,
	"summary" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_role" "user_role",
	"source" "audit_source" NOT NULL,
	"device_code" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"approval_id" uuid
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "kasir_max_discount_bp" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "allow_below_cost" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approval_pin_hash" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_status_created_at_index" ON "approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "approvals_requested_by_index" ON "approvals" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "audit_events_at_index" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_id_action_at_index" ON "audit_events" USING btree ("actor_id","action","at");--> statement-breakpoint
CREATE FUNCTION "audit_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_update_delete" BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_truncate" BEFORE TRUNCATE ON "audit_events" FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_append_only"();
