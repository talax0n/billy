CREATE TYPE "public"."pos_draft_status" AS ENUM('open', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('draft', 'sent', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "pos_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"created_by" uuid NOT NULL,
	"customer_id" uuid,
	"lines" jsonb NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_kind" "discount_kind" DEFAULT 'none' NOT NULL,
	"discount_value" bigint DEFAULT 0 NOT NULL,
	"discount_amount" bigint NOT NULL,
	"total" bigint NOT NULL,
	"status" "pos_draft_status" DEFAULT 'open' NOT NULL,
	"print_count" integer DEFAULT 0 NOT NULL,
	"sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	CONSTRAINT "pos_drafts_number_unique" UNIQUE("number"),
	CONSTRAINT "pos_drafts_saleId_unique" UNIQUE("sale_id")
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"date" date NOT NULL,
	"valid_until" date NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_kind" "discount_kind" DEFAULT 'none' NOT NULL,
	"discount_value" bigint DEFAULT 0 NOT NULL,
	"discount_amount" bigint NOT NULL,
	"total" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "quotation_status" DEFAULT 'draft' NOT NULL,
	"invoice_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_number_unique" UNIQUE("number"),
	CONSTRAINT "quotations_invoiceId_unique" UNIQUE("invoice_id")
);
--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "revision_of" uuid;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "print_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_drafts" ADD CONSTRAINT "pos_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_drafts" ADD CONSTRAINT "pos_drafts_customer_id_contacts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_drafts" ADD CONSTRAINT "pos_drafts_sale_id_pos_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."pos_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_drafts" ADD CONSTRAINT "pos_drafts_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_contacts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_drafts_status_index" ON "pos_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quotations_date_index" ON "quotations" USING btree ("date");--> statement-breakpoint
CREATE INDEX "quotations_customer_id_index" ON "quotations" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_revision_of_pos_sales_id_fk" FOREIGN KEY ("revision_of") REFERENCES "public"."pos_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sales_revision_of_index" ON "pos_sales" USING btree ("revision_of");