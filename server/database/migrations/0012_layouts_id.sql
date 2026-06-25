ALTER TABLE "layouts" ADD COLUMN "id" serial NOT NULL;--> statement-breakpoint
ALTER TABLE "layouts" DROP CONSTRAINT "layouts_pkey";--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_pkey" PRIMARY KEY("id");--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_uuid_unique" UNIQUE("uuid");
