CREATE TABLE "cash_shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cashier_id" uuid NOT NULL,
	"device_code" text NOT NULL,
	"account_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"opening_float" bigint NOT NULL,
	"closed_at" timestamp with time zone,
	"counted_cash" bigint,
	"expected_cash" bigint,
	"difference" bigint,
	"close_note" text,
	CONSTRAINT "cash_shifts_float_non_negative" CHECK ("cash_shifts"."opening_float" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_shifts_opened_at_index" ON "cash_shifts" USING btree ("opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_shifts_one_open" ON "cash_shifts" USING btree ("cashier_id","device_code") WHERE "cash_shifts"."closed_at" is null;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_shift_id_cash_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."cash_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_sales_shift_id_index" ON "pos_sales" USING btree ("shift_id");