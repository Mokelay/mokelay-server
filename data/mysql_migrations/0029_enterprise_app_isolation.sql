SET @default_enterprise_uuid = COALESCE(
  (SELECT uuid FROM enterprise WHERE BINARY uuid = BINARY '00000000-0000-4000-8000-000000000001' LIMIT 1),
  (SELECT uuid FROM enterprise ORDER BY id LIMIT 1)
);

ALTER TABLE apps ADD COLUMN enterprise_uuid char(36) NULL AFTER description;
ALTER TABLE layouts ADD COLUMN enterprise_uuid char(36) NULL AFTER name;
ALTER TABLE pages ADD COLUMN enterprise_uuid char(36) NULL AFTER dependencies;
ALTER TABLE apis ADD COLUMN enterprise_uuid char(36) NULL AFTER layout, ADD COLUMN app_uuid varchar(8) NULL AFTER enterprise_uuid;
UPDATE apps SET enterprise_uuid = @default_enterprise_uuid;
UPDATE layouts SET enterprise_uuid = @default_enterprise_uuid;
UPDATE pages SET enterprise_uuid = @default_enterprise_uuid;
UPDATE datasources SET enterprise_uuid = @default_enterprise_uuid WHERE enterprise_uuid IS NULL;
UPDATE pages SET app_uuid = NULL WHERE app_uuid IS NOT NULL AND BINARY app_uuid NOT IN (SELECT BINARY uuid FROM apps);
DELETE FROM apis_snapshot;
DELETE FROM apis;

ALTER TABLE apps MODIFY enterprise_uuid char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL, ADD KEY idx_apps_enterprise_uuid (enterprise_uuid), ADD CONSTRAINT fk_apps_enterprise_uuid FOREIGN KEY (enterprise_uuid) REFERENCES enterprise(uuid);
ALTER TABLE layouts MODIFY enterprise_uuid char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL, ADD KEY idx_layouts_enterprise_uuid (enterprise_uuid), ADD CONSTRAINT fk_layouts_enterprise_uuid FOREIGN KEY (enterprise_uuid) REFERENCES enterprise(uuid);
ALTER TABLE pages MODIFY enterprise_uuid char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL, MODIFY app_uuid varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL, ADD KEY idx_pages_enterprise_app (enterprise_uuid, app_uuid), ADD CONSTRAINT fk_pages_enterprise_uuid FOREIGN KEY (enterprise_uuid) REFERENCES enterprise(uuid), ADD CONSTRAINT fk_pages_app_uuid FOREIGN KEY (app_uuid) REFERENCES apps(uuid) ON DELETE SET NULL;
ALTER TABLE datasources MODIFY enterprise_uuid char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL, ADD CONSTRAINT fk_datasources_enterprise_uuid FOREIGN KEY (enterprise_uuid) REFERENCES enterprise(uuid);
ALTER TABLE apis MODIFY enterprise_uuid char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL, MODIFY app_uuid varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL, ADD KEY idx_apis_enterprise_app_fragment (enterprise_uuid, app_uuid, fragment), ADD CONSTRAINT fk_apis_enterprise_uuid FOREIGN KEY (enterprise_uuid) REFERENCES enterprise(uuid), ADD CONSTRAINT fk_apis_app_uuid FOREIGN KEY (app_uuid) REFERENCES apps(uuid);
