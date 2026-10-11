ALTER TABLE "source_products" ADD COLUMN "shopify_snapshot" jsonb;--> statement-breakpoint
CREATE INDEX "product_audit_log_created_idx" ON "product_audit_log" USING btree ("created_at");