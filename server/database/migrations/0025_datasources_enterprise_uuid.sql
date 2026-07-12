ALTER TABLE "datasources" ADD COLUMN "enterprise_uuid" uuid;
--> statement-breakpoint
ALTER TABLE "datasources" ADD CONSTRAINT "datasources_enterprise_uuid_enterprise_uuid_fk" FOREIGN KEY ("enterprise_uuid") REFERENCES "enterprise"("uuid") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_datasources_enterprise_uuid" ON "datasources" USING btree ("enterprise_uuid");
