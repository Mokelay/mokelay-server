DO $$
BEGIN
  IF to_regclass('public.docs_client_block') IS NULL AND to_regclass('public.block_component_docs') IS NOT NULL THEN
    ALTER TABLE public.block_component_docs RENAME TO docs_client_block;
  END IF;

  IF to_regclass('public.docs_server_block') IS NULL AND to_regclass('public.server_block_docs') IS NOT NULL THEN
    ALTER TABLE public.server_block_docs RENAME TO docs_server_block;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.docs_client_block_id_seq') IS NULL AND to_regclass('public.block_component_docs_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.block_component_docs_id_seq RENAME TO docs_client_block_id_seq;
  END IF;

  IF to_regclass('public.docs_server_block_id_seq') IS NULL AND to_regclass('public.server_block_docs_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.server_block_docs_id_seq RENAME TO docs_server_block_id_seq;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.docs_client_block') IS NOT NULL AND to_regclass('public.docs_client_block_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.docs_client_block_id_seq OWNED BY public.docs_client_block.id;
    ALTER TABLE public.docs_client_block ALTER COLUMN id SET DEFAULT nextval('public.docs_client_block_id_seq'::regclass);
  END IF;

  IF to_regclass('public.docs_server_block') IS NOT NULL AND to_regclass('public.docs_server_block_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.docs_server_block_id_seq OWNED BY public.docs_server_block.id;
    ALTER TABLE public.docs_server_block ALTER COLUMN id SET DEFAULT nextval('public.docs_server_block_id_seq'::regclass);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.docs_client_block') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_client_block'::regclass
        AND conname = 'block_component_docs_pkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_client_block'::regclass
        AND conname = 'docs_client_block_pkey'
    ) THEN
      ALTER TABLE public.docs_client_block RENAME CONSTRAINT block_component_docs_pkey TO docs_client_block_pkey;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_client_block'::regclass
        AND conname = 'block_component_docs_uuid_unique'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_client_block'::regclass
        AND conname = 'docs_client_block_uuid_unique'
    ) THEN
      ALTER TABLE public.docs_client_block RENAME CONSTRAINT block_component_docs_uuid_unique TO docs_client_block_uuid_unique;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_client_block'::regclass
        AND conname = 'block_component_docs_block_type_unique'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_client_block'::regclass
        AND conname = 'docs_client_block_block_type_unique'
    ) THEN
      ALTER TABLE public.docs_client_block RENAME CONSTRAINT block_component_docs_block_type_unique TO docs_client_block_block_type_unique;
    END IF;
  END IF;

  IF to_regclass('public.docs_server_block') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_server_block'::regclass
        AND conname = 'server_block_docs_pkey'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_server_block'::regclass
        AND conname = 'docs_server_block_pkey'
    ) THEN
      ALTER TABLE public.docs_server_block RENAME CONSTRAINT server_block_docs_pkey TO docs_server_block_pkey;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_server_block'::regclass
        AND conname = 'server_block_docs_uuid_unique'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_server_block'::regclass
        AND conname = 'docs_server_block_uuid_unique'
    ) THEN
      ALTER TABLE public.docs_server_block RENAME CONSTRAINT server_block_docs_uuid_unique TO docs_server_block_uuid_unique;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_server_block'::regclass
        AND conname = 'server_block_docs_function_name_unique'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.docs_server_block'::regclass
        AND conname = 'docs_server_block_function_name_unique'
    ) THEN
      ALTER TABLE public.docs_server_block RENAME CONSTRAINT server_block_docs_function_name_unique TO docs_server_block_function_name_unique;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.idx_block_component_docs_category') IS NOT NULL
    AND to_regclass('public.idx_docs_client_block_category') IS NULL THEN
    ALTER INDEX public.idx_block_component_docs_category RENAME TO idx_docs_client_block_category;
  END IF;

  IF to_regclass('public.idx_block_component_docs_source_kind') IS NOT NULL
    AND to_regclass('public.idx_docs_client_block_source_kind') IS NULL THEN
    ALTER INDEX public.idx_block_component_docs_source_kind RENAME TO idx_docs_client_block_source_kind;
  END IF;

  IF to_regclass('public.idx_server_block_docs_category') IS NOT NULL
    AND to_regclass('public.idx_docs_server_block_category') IS NULL THEN
    ALTER INDEX public.idx_server_block_docs_category RENAME TO idx_docs_server_block_category;
  END IF;

  IF to_regclass('public.idx_server_block_docs_source_kind') IS NOT NULL
    AND to_regclass('public.idx_docs_server_block_source_kind') IS NULL THEN
    ALTER INDEX public.idx_server_block_docs_source_kind RENAME TO idx_docs_server_block_source_kind;
  END IF;

  IF to_regclass('public.idx_server_block_docs_requires_datasource') IS NOT NULL
    AND to_regclass('public.idx_docs_server_block_requires_datasource') IS NULL THEN
    ALTER INDEX public.idx_server_block_docs_requires_datasource RENAME TO idx_docs_server_block_requires_datasource;
  END IF;
END $$;
