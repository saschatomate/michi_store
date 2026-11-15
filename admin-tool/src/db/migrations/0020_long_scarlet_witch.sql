CREATE TABLE "image_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_product_id" integer NOT NULL,
	"background_id" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "image_jobs" ADD CONSTRAINT "image_jobs_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_jobs_status_idx" ON "image_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "image_jobs_product_idx" ON "image_jobs" USING btree ("source_product_id");