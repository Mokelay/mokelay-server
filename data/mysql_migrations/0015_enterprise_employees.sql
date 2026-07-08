CREATE TABLE `enterprise` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `uuid` char(36) NOT NULL DEFAULT (uuid()) COMMENT '企业唯一标识',
  `name` varchar(120) NOT NULL COMMENT '企业名称',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_enterprise_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='企业表';

INSERT INTO `enterprise` (`name`) VALUES ('默认企业');

RENAME TABLE `users` TO `employees`;

ALTER TABLE `employees`
  DROP PRIMARY KEY,
  DROP COLUMN `id`,
  RENAME COLUMN `uuid` TO `id`,
  RENAME INDEX `uk_users_email` TO `uk_employees_email`;

ALTER TABLE `employees`
  DROP INDEX `uk_users_uuid`,
  ADD COLUMN `enterprise_uuid` char(36) NULL COMMENT '所属企业 UUID' AFTER `id`,
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_employees_enterprise_uuid` (`enterprise_uuid`);

UPDATE `employees`
SET `enterprise_uuid` = (
  SELECT `uuid`
  FROM `enterprise`
  ORDER BY `id`
  LIMIT 1
)
WHERE `enterprise_uuid` IS NULL;

ALTER TABLE `employees`
  MODIFY COLUMN `enterprise_uuid` char(36) NOT NULL COMMENT '所属企业 UUID',
  ADD CONSTRAINT `fk_employees_enterprise_uuid` FOREIGN KEY (`enterprise_uuid`) REFERENCES `enterprise` (`uuid`),
  COMMENT='员工表';
