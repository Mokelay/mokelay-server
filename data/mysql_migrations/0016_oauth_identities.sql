CREATE TABLE `employee_auth_identities` (
  `id` char(36) NOT NULL DEFAULT (uuid()) COMMENT '第三方身份绑定唯一标识',
  `employee_id` char(36) NOT NULL COMMENT '员工 ID',
  `provider` varchar(32) NOT NULL COMMENT 'OAuth Provider，例如 google、github',
  `provider_user_id` varchar(255) NOT NULL COMMENT 'Provider 用户唯一 ID',
  `provider_email` varchar(255) NOT NULL COMMENT 'Provider 返回的邮箱',
  `email_verified` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Provider 邮箱是否已验证',
  `profile` json NOT NULL COMMENT 'Provider 原始公开资料',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `employee_auth_identity_provider_user_unique` (`provider`, `provider_user_id`),
  UNIQUE KEY `employee_auth_identity_provider_employee_unique` (`provider`, `employee_id`),
  KEY `idx_employee_auth_identities_employee_id` (`employee_id`),
  CONSTRAINT `fk_employee_auth_identities_employee_id` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工第三方 OAuth 身份绑定表';
