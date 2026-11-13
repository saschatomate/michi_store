CREATE TABLE "image_backgrounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_url" text NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
