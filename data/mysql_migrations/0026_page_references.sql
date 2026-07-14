ALTER TABLE `pages`
  ADD COLUMN `sub_page` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否为被其他页面直接引用的子页面' AFTER `blocks`,
  ADD COLUMN `quotes` json NOT NULL DEFAULT (JSON_ARRAY()) COMMENT '直接引用当前页面的页面 UUID 数组' AFTER `sub_page`,
  ADD COLUMN `dependencies` json NOT NULL DEFAULT (JSON_ARRAY()) COMMENT '当前页面直接依赖的子页面 UUID 数组' AFTER `quotes`,
  ADD KEY `idx_pages_sub_page` (`sub_page`);

CREATE TABLE `page_reference_graph_state` (
  `id` tinyint unsigned NOT NULL DEFAULT 1 COMMENT '单例记录 ID，固定为 1',
  `revision` bigint unsigned NOT NULL DEFAULT 0 COMMENT '页面引用图提交修订号',
  `version` int unsigned NOT NULL DEFAULT 0 COMMENT '关系回填版本',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '最近一次图变更时间',
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_page_reference_graph_state_singleton` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='页面引用图全局事务锁与版本状态';

INSERT IGNORE INTO `page_reference_graph_state` (`id`, `revision`, `version`) VALUES (1, 0, 0);
