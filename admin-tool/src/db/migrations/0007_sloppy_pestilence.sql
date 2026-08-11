CREATE TABLE "api_usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"purpose" text NOT NULL,
	"source_product_id" integer,
	"variant_index" integer,
	"model" text NOT NULL,
	"usage" jsonb,
	"cost_usd" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"total_budget_usd" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_usage_events" ADD CONSTRAINT "api_usage_events_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_usage_events_source_product_idx" ON "api_usage_events" USING btree ("source_product_id");--> statement-breakpoint
CREATE INDEX "api_usage_events_created_at_idx" ON "api_usage_events" USING btree ("created_at");