ALTER TABLE "apis" ADD COLUMN "fragment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apis_snapshot" ADD COLUMN "fragment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_apis_fragment_status" ON "apis" USING btree ("fragment", "status");
