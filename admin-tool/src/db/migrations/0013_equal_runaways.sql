ALTER TABLE "source_products" ADD COLUMN "shopify_sync_signature" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "shopify_image_urls" jsonb;