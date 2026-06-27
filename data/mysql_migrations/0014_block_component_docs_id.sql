ALTER TABLE `block_component_docs`
  DROP PRIMARY KEY,
  ADD COLUMN `id` bigint NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
  ADD UNIQUE KEY `uk_block_component_docs_uuid` (`uuid`);
