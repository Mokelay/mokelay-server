ALTER TABLE `layouts`
  DROP PRIMARY KEY,
  ADD COLUMN `id` int NOT NULL AUTO_INCREMENT COMMENT '布局自增 ID' FIRST,
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_layouts_uuid` (`uuid`);
