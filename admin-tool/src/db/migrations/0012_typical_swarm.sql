ALTER TABLE "categories" ADD COLUMN "shopify_collection_id" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "shopify_status" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "shopify_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "shopify_sync_error" text;