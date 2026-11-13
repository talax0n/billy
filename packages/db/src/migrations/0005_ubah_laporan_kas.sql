ALTER TABLE "expenses" ADD COLUMN "revision_of" uuid;--> statement-breakpoint
ALTER TABLE "invoice_bundles" ADD COLUMN "revision_of" uuid;--> statement-breakpoint
ALTER TABLE "invoice_bundles" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice_bundles" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "revision_of" uuid;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "revision_of" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_revision_of_expenses_id_fk" FOREIGN KEY ("revision_of") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_bundles" ADD CONSTRAINT "invoice_bundles_revision_of_invoice_bundles_id_fk" FOREIGN KEY ("revision_of") REFERENCES "public"."invoice_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_bundles" ADD CONSTRAINT "invoice_bundles_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_revision_of_purchase_invoices_id_fk" FOREIGN KEY ("revision_of") REFERENCES "public"."purchase_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_revision_of_sales_invoices_id_fk" FOREIGN KEY ("revision_of") REFERENCES "public"."sales_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_entries_date_created_at_index" ON "cash_entries" USING btree ("date","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_revision_of_index" ON "expenses" USING btree ("revision_of");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_bundles_revision_of_index" ON "invoice_bundles" USING btree ("revision_of");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_revision_of_index" ON "purchase_invoices" USING btree ("revision_of");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_revision_of_index" ON "sales_invoices" USING btree ("revision_of");