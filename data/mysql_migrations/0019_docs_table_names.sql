SET @rename_docs_client_block = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'block_component_docs'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'docs_client_block'
    ),
    'RENAME TABLE `block_component_docs` TO `docs_client_block`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_client_block;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_server_block = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'server_block_docs'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block'
    ),
    'RENAME TABLE `server_block_docs` TO `docs_server_block`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_server_block;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_client_block_uuid = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'uk_block_component_docs_uuid'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'uk_docs_client_block_uuid'
    ),
    'ALTER TABLE `docs_client_block` RENAME INDEX `uk_block_component_docs_uuid` TO `uk_docs_client_block_uuid`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_client_block_uuid;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_client_block_type = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'uk_block_component_docs_block_type'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'uk_docs_client_block_block_type'
    ),
    'ALTER TABLE `docs_client_block` RENAME INDEX `uk_block_component_docs_block_type` TO `uk_docs_client_block_block_type`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_client_block_type;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_client_block_category = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'idx_block_component_docs_category'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'idx_docs_client_block_category'
    ),
    'ALTER TABLE `docs_client_block` RENAME INDEX `idx_block_component_docs_category` TO `idx_docs_client_block_category`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_client_block_category;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_client_block_source_kind = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'idx_block_component_docs_source_kind'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'idx_docs_client_block_source_kind'
    ),
    'ALTER TABLE `docs_client_block` RENAME INDEX `idx_block_component_docs_source_kind` TO `idx_docs_client_block_source_kind`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_client_block_source_kind;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_server_block_uuid = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'uk_server_block_docs_uuid'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'uk_docs_server_block_uuid'
    ),
    'ALTER TABLE `docs_server_block` RENAME INDEX `uk_server_block_docs_uuid` TO `uk_docs_server_block_uuid`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_server_block_uuid;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_server_block_function_name = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'uk_server_block_docs_function_name'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'uk_docs_server_block_function_name'
    ),
    'ALTER TABLE `docs_server_block` RENAME INDEX `uk_server_block_docs_function_name` TO `uk_docs_server_block_function_name`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_server_block_function_name;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_server_block_category = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'idx_server_block_docs_category'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'idx_docs_server_block_category'
    ),
    'ALTER TABLE `docs_server_block` RENAME INDEX `idx_server_block_docs_category` TO `idx_docs_server_block_category`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_server_block_category;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_server_block_source_kind = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'idx_server_block_docs_source_kind'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'idx_docs_server_block_source_kind'
    ),
    'ALTER TABLE `docs_server_block` RENAME INDEX `idx_server_block_docs_source_kind` TO `idx_docs_server_block_source_kind`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_server_block_source_kind;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @rename_docs_server_block_requires_datasource = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'idx_server_block_docs_requires_datasource'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'docs_server_block' AND index_name = 'idx_docs_server_block_requires_datasource'
    ),
    'ALTER TABLE `docs_server_block` RENAME INDEX `idx_server_block_docs_requires_datasource` TO `idx_docs_server_block_requires_datasource`',
    'DO 0'
  )
);
PREPARE stmt FROM @rename_docs_server_block_requires_datasource;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
