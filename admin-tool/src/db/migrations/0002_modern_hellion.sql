CREATE TABLE "product_generated_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_product_id" integer NOT NULL,
	"variant_index" integer NOT NULL,
	"hand_preset" text NOT NULL,
	"image_url" text,
	"storage_path" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"approved_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	"generation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_generated_images" ADD CONSTRAINT "product_generated_images_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_generated_images_product_idx" ON "product_generated_images" USING btree ("source_product_id");