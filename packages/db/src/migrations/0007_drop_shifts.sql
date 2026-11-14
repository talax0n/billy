ALTER TABLE "pos_sales" DROP CONSTRAINT "pos_sales_shift_id_cash_shifts_id_fk";--> statement-breakpoint
DROP INDEX "pos_sales_shift_id_index";--> statement-breakpoint
ALTER TABLE "pos_sales" DROP COLUMN "shift_id";--> statement-breakpoint
DROP TABLE "cash_shifts";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "cash_difference_threshold";
