CREATE TABLE "availability_rules" (
	"key" text PRIMARY KEY NOT NULL,
	"unit" text NOT NULL,
	"min_value" integer NOT NULL,
	"max_value" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_products" ADD COLUMN "discontinued" boolean DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO "availability_rules" ("key", "unit", "min_value", "max_value") VALUES
	('in_stock', 'days', 5, 7),
	('lab_grown', 'weeks', 3, 4),
	('natural', 'weeks', 5, 6),
	('shipping', 'workdays', 1, 3)
ON CONFLICT ("key") DO NOTHING;
