CREATE TYPE "public"."delivery_courier" AS ENUM('toko', 'ojol');--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "courier" "delivery_courier" DEFAULT 'toko' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "shipping_fee" bigint DEFAULT 0 NOT NULL;