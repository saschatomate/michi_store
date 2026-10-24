ALTER TABLE "categories" ADD COLUMN "intro_text" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "title_override" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "price_override" double precision;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "description_override" text;