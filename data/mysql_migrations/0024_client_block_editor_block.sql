SET @add_docs_client_block_editor_block = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND column_name = 'editor_block'),
    'SELECT 1',
    'ALTER TABLE `docs_client_block` ADD COLUMN `editor_block` tinyint(1) NOT NULL DEFAULT 0 COMMENT ''是否为编辑器专用 Block'' AFTER `toolbox_visible`'
  )
);
PREPARE stmt FROM @add_docs_client_block_editor_block;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_docs_client_block_editor_block_idx = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'docs_client_block' AND index_name = 'idx_docs_client_block_editor_block'),
    'SELECT 1',
    'CREATE INDEX `idx_docs_client_block_editor_block` ON `docs_client_block` (`editor_block`)'
  )
);
PREPARE stmt FROM @add_docs_client_block_editor_block_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
