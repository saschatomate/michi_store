ALTER TABLE "categories" ADD COLUMN "rule_stone_origin" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "rule_product_type" text;--> statement-breakpoint
UPDATE "categories" SET "rule_stone_origin" = 'lab_grown' WHERE "slug" = 'lab-diamonds';--> statement-breakpoint
UPDATE "categories" SET "rule_stone_origin" = 'natural' WHERE "slug" = 'natural-diamonds';--> statement-breakpoint
UPDATE "categories" SET "rule_product_type" = 'ring' WHERE "slug" IN ('lab-diamonds-ringe', 'natural-diamonds-ringe');--> statement-breakpoint
UPDATE "categories" SET "rule_product_type" = 'collier,anhaenger' WHERE "slug" IN ('lab-diamonds-colliers', 'natural-diamonds-colliers');--> statement-breakpoint
UPDATE "categories" SET "rule_product_type" = 'armband,armreif' WHERE "slug" IN ('lab-diamonds-armschmuck', 'natural-diamonds-armschmuck');--> statement-breakpoint
UPDATE "categories" SET "rule_product_type" = 'ohrschmuck' WHERE "slug" IN ('lab-diamonds-ohrringe', 'natural-diamonds-ohrringe');
