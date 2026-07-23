ALTER TABLE "import_runs" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "new_arrival_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "missing_from_stock_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "new_arrival_at_idx" ON "source_products" USING btree ("new_arrival_at");--> statement-breakpoint
CREATE INDEX "missing_from_stock_at_idx" ON "source_products" USING btree ("missing_from_stock_at");