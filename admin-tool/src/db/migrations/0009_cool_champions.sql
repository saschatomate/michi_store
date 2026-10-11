CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_product_id" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"actor" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"source_product_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	CONSTRAINT "product_categories_source_product_id_category_id_pk" PRIMARY KEY("source_product_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "origin" text DEFAULT 'dg_import' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "stone_origin" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "fineness" integer;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "rhodiniert" boolean;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "cut_shape" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "main_stone_ct" double precision;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "cert_institute" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "cert_number" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "design_family_id" text;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "ring_sizes" jsonb;--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "custom_images" jsonb;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_audit_log" ADD CONSTRAINT "product_audit_log_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "product_audit_log_product_idx" ON "product_audit_log" USING btree ("source_product_id");--> statement-breakpoint
CREATE INDEX "origin_idx" ON "source_products" USING btree ("origin");--> statement-breakpoint
INSERT INTO "categories" ("name", "slug", "sort_order") VALUES
	('Lab Diamonds', 'lab-diamonds', 10),
	('Natural Diamonds', 'natural-diamonds', 20),
	('Private Jewellery', 'private-jewellery', 30)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "categories" ("parent_id", "name", "slug", "sort_order")
SELECT p."id", c."name", p."slug" || '-' || c."slug", c."sort_order"
FROM "categories" p
CROSS JOIN (VALUES ('Ringe', 'ringe', 10), ('Colliers', 'colliers', 20), ('Armschmuck', 'armschmuck', 30), ('Ohrringe', 'ohrringe', 40)) AS c("name", "slug", "sort_order")
WHERE p."parent_id" IS NULL AND p."slug" IN ('lab-diamonds', 'natural-diamonds', 'private-jewellery')
ON CONFLICT ("slug") DO NOTHING;
