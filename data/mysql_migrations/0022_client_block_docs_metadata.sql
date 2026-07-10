SET @add_docs_client_block_source_package = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'source_package'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `source_package` varchar(128) NOT NULL DEFAULT ''mokelay-editor'' COMMENT ''来源包名'' AFTER `source_kind`'
  )
);
PREPARE stmt FROM @add_docs_client_block_source_package;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_component_name = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'component_name'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `component_name` varchar(128) NOT NULL DEFAULT '''' COMMENT ''Vue 组件名'' AFTER `source_file`'
  )
);
PREPARE stmt FROM @add_docs_client_block_component_name;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_tool_symbol = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'tool_symbol'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `tool_symbol` varchar(128) NOT NULL DEFAULT '''' COMMENT ''Editor tool 导出符号'' AFTER `component_name`'
  )
);
PREPARE stmt FROM @add_docs_client_block_tool_symbol;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_editor_enabled = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'editor_enabled'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `editor_enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT ''是否可注册到编辑器'' AFTER `status`'
  )
);
PREPARE stmt FROM @add_docs_client_block_editor_enabled;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_toolbox_visible = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'toolbox_visible'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `toolbox_visible` tinyint(1) NOT NULL DEFAULT 1 COMMENT ''是否显示在工具箱'' AFTER `editor_enabled`'
  )
);
PREPARE stmt FROM @add_docs_client_block_toolbox_visible;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_sort_order = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'sort_order'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `sort_order` int NOT NULL DEFAULT 0 COMMENT ''工具箱排序'' AFTER `toolbox_visible`'
  )
);
PREPARE stmt FROM @add_docs_client_block_sort_order;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_registration = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'registration'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `registration` json NULL COMMENT ''编辑器注册信息'' AFTER `sort_order`'
  )
);
PREPARE stmt FROM @add_docs_client_block_registration;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_default_data = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'default_data'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `default_data` json NULL COMMENT ''默认 block.data'' AFTER `initial_props`'
  )
);
PREPARE stmt FROM @add_docs_client_block_default_data;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_save_schema = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'save_schema'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `save_schema` json NULL COMMENT ''保存规则'' AFTER `data_fields_schema`'
  )
);
PREPARE stmt FROM @add_docs_client_block_save_schema;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE `docs_client_block`
SET
  `registration` = COALESCE(`registration`, JSON_OBJECT()),
  `default_data` = COALESCE(`default_data`, `initial_props`, JSON_OBJECT()),
  `save_schema` = COALESCE(`save_schema`, JSON_ARRAY());

ALTER TABLE `docs_client_block`
  MODIFY COLUMN `registration` json NOT NULL COMMENT '编辑器注册信息',
  MODIFY COLUMN `default_data` json NOT NULL COMMENT '默认 block.data',
  MODIFY COLUMN `save_schema` json NOT NULL COMMENT '保存规则';

SET @add_docs_client_block_editor_enabled_idx = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'idx_docs_client_block_editor_enabled'),
    'SELECT 1',
    'CREATE INDEX `idx_docs_client_block_editor_enabled` ON `docs_client_block` (`editor_enabled`)'
  )
);
PREPARE stmt FROM @add_docs_client_block_editor_enabled_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_toolbox_visible_idx = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'idx_docs_client_block_toolbox_visible'),
    'SELECT 1',
    'CREATE INDEX `idx_docs_client_block_toolbox_visible` ON `docs_client_block` (`toolbox_visible`)'
  )
);
PREPARE stmt FROM @add_docs_client_block_toolbox_visible_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
