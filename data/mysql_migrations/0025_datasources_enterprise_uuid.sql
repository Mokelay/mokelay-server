ALTER TABLE `datasources`
  ADD COLUMN `enterprise_uuid` char(36) DEFAULT NULL COMMENT '所属企业 UUID' AFTER `description`,
  ADD KEY `idx_datasources_enterprise_uuid` (`enterprise_uuid`);
