CREATE TYPE "public"."opname_status" AS ENUM('draft', 'posted');--> statement-breakpoint
ALTER TYPE "public"."stock_source_type" ADD VALUE 'stock_opname';--> statement-breakpoint
CREATE TABLE "stock_opname_lines" (
	"opname_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"counted_qty" integer NOT NULL,
	"system_qty" integer,
	"unit_cost" bigint,
	CONSTRAINT "stock_opname_lines_opname_id_product_id_pk" PRIMARY KEY("opname_id","product_id"),
	CONSTRAINT "stock_opname_lines_counted_non_negative" CHECK ("stock_opname_lines"."counted_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_opnames" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"category_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"status" "opname_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	CONSTRAINT "stock_opnames_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "cash_difference_threshold" bigint DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "open_time" time DEFAULT '07:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "close_time" time DEFAULT '17:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_opname_id_stock_opnames_id_fk" FOREIGN KEY ("opname_id") REFERENCES "public"."stock_opnames"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_opnames_posted_at_index" ON "stock_opnames" USING btree ("posted_at");