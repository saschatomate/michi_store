ALTER TABLE "source_products" ADD COLUMN "gen_product_name_de" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "gen_short_desc_de" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "gen_long_desc_de" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "gen_short_desc_en" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "gen_long_desc_en" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "gen_seo_title" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "gen_seo_description" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "content_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "content_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "content_generation_error" text;