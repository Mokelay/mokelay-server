CREATE TABLE "enterprise" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	CONSTRAINT "enterprise_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
INSERT INTO "enterprise" ("uuid", "name")
SELECT gen_random_uuid(), '默认企业'
WHERE NOT EXISTS (SELECT 1 FROM "enterprise");
--> statement-breakpoint
ALTER TABLE "users" RENAME TO "employees";
--> statement-breakpoint
ALTER TABLE "employees" RENAME CONSTRAINT "users_pkey" TO "employees_pkey";
--> statement-breakpoint
ALTER TABLE "employees" RENAME CONSTRAINT "users_email_unique" TO "employees_email_unique";
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "enterprise_uuid" uuid;
--> statement-breakpoint
UPDATE "employees"
SET "enterprise_uuid" = (
	SELECT "uuid"
	FROM "enterprise"
	ORDER BY "id"
	LIMIT 1
)
WHERE "enterprise_uuid" IS NULL;
--> statement-breakpoint
ALTER TABLE "employees" ALTER COLUMN "enterprise_uuid" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_enterprise_uuid_enterprise_uuid_fk" FOREIGN KEY ("enterprise_uuid") REFERENCES "enterprise"("uuid") ON DELETE no action ON UPDATE no action;
