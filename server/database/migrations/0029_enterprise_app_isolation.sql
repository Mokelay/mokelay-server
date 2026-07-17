DO $$
DECLARE default_enterprise_uuid uuid;
BEGIN
  SELECT uuid INTO default_enterprise_uuid FROM enterprise
  ORDER BY CASE WHEN uuid = '00000000-0000-4000-8000-000000000001'::uuid THEN 0 ELSE 1 END, id LIMIT 1;
  IF default_enterprise_uuid IS NULL THEN RAISE EXCEPTION 'Cannot migrate tenant-owned resources without an enterprise'; END IF;

  ALTER TABLE apps ADD COLUMN enterprise_uuid uuid;
  ALTER TABLE layouts ADD COLUMN enterprise_uuid uuid;
  ALTER TABLE pages ADD COLUMN enterprise_uuid uuid;
  ALTER TABLE apis ADD COLUMN enterprise_uuid uuid;
  ALTER TABLE apis ADD COLUMN app_uuid varchar(8);

  UPDATE apps SET enterprise_uuid = default_enterprise_uuid;
  UPDATE layouts SET enterprise_uuid = default_enterprise_uuid;
  UPDATE pages SET enterprise_uuid = default_enterprise_uuid;
  UPDATE datasources SET enterprise_uuid = default_enterprise_uuid WHERE enterprise_uuid IS NULL;
  UPDATE pages SET app_uuid = NULL WHERE app_uuid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM apps WHERE apps.uuid = pages.app_uuid);
  DELETE FROM apis_snapshot;
  DELETE FROM apis;

  ALTER TABLE apps ALTER COLUMN enterprise_uuid SET NOT NULL;
  ALTER TABLE layouts ALTER COLUMN enterprise_uuid SET NOT NULL;
  ALTER TABLE pages ALTER COLUMN enterprise_uuid SET NOT NULL;
  ALTER TABLE datasources ALTER COLUMN enterprise_uuid SET NOT NULL;
  ALTER TABLE apis ALTER COLUMN enterprise_uuid SET NOT NULL;
  ALTER TABLE apis ALTER COLUMN app_uuid SET NOT NULL;
END $$;

ALTER TABLE apps ADD CONSTRAINT apps_enterprise_uuid_enterprise_uuid_fk FOREIGN KEY (enterprise_uuid) REFERENCES enterprise(uuid);
ALTER TABLE layouts ADD CONSTRAINT layouts_enterprise_uuid_enterprise_uuid_fk FOREIGN KEY (enterprise_uuid) REFERENCES enterprise(uuid);
ALTER TABLE pages ADD CONSTRAINT pages_enterprise_uuid_enterprise_uuid_fk FOREIGN KEY (enterprise_uuid) REFERENCES enterprise(uuid);
ALTER TABLE apis ADD CONSTRAINT apis_enterprise_uuid_enterprise_uuid_fk FOREIGN KEY (enterprise_uuid) REFERENCES enterprise(uuid);
ALTER TABLE apis ADD CONSTRAINT apis_app_uuid_apps_uuid_fk FOREIGN KEY (app_uuid) REFERENCES apps(uuid);
CREATE INDEX idx_apps_enterprise_uuid ON apps(enterprise_uuid);
CREATE INDEX idx_layouts_enterprise_uuid ON layouts(enterprise_uuid);
CREATE INDEX idx_pages_enterprise_app ON pages(enterprise_uuid, app_uuid);
CREATE INDEX idx_apis_enterprise_app_fragment ON apis(enterprise_uuid, app_uuid, fragment);
