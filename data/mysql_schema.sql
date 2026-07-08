
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `__drizzle_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `__drizzle_migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `hash` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` bigint DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `api_domains`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `api_domains` (
  `uuid` varchar(128) NOT NULL COMMENT '域名唯一ID',
  `alias` varchar(120) NOT NULL COMMENT '域名的描述名称',
  `host` varchar(512) NOT NULL COMMENT '域名主机地址',
  PRIMARY KEY (`uuid`),
  UNIQUE KEY `uk_api_domains_host` (`host`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='API 域名列表表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `api_builder_samples`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `api_builder_samples` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `uuid` varchar(128) NOT NULL COMMENT '样例唯一标识',
  `title` varchar(120) NOT NULL COMMENT '样例标题',
  `description` text NOT NULL COMMENT '样例说明',
  `method` varchar(16) NOT NULL COMMENT 'HTTP 请求方法',
  `api_json` json NOT NULL COMMENT 'API DSL 定义 JSON',
  `status` varchar(32) NOT NULL DEFAULT 'active' COMMENT '样例状态',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '排序值',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_api_builder_samples_uuid` (`uuid`),
  KEY `idx_api_builder_samples_status_sort` (`status`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API Builder 内置样例表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `apis`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `apis` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `uuid` varchar(128) NOT NULL COMMENT 'API 唯一标识（业务键，如 save_api）',
  `name` varchar(120) NOT NULL COMMENT 'API 名称',
  `method` varchar(16) NOT NULL COMMENT 'HTTP 请求方法',
  `status` varchar(32) NOT NULL DEFAULT 'draft' COMMENT '发布状态',
  `api_json` json NOT NULL COMMENT 'API DSL 定义 JSON',
  `layout` json NOT NULL COMMENT 'API Builder 布局 JSON',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_apis_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='API 定义表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `apis_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `apis_snapshot` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `api_uuid` varchar(128) NOT NULL COMMENT '关联 API 业务标识',
  `name` varchar(120) NOT NULL COMMENT 'API 名称（快照时点）',
  `method` varchar(16) NOT NULL COMMENT 'HTTP 请求方法（快照时点）',
  `status` varchar(32) NOT NULL COMMENT '发布状态（快照时点）',
  `api_json` json NOT NULL COMMENT 'API DSL 定义 JSON（快照时点）',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '快照创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_apis_snapshot_api_uuid` (`api_uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='API 定义快照表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `apps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `apps` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `uuid` varchar(8) NOT NULL COMMENT 'App 唯一ID',
  `alias` varchar(120) NOT NULL COMMENT 'App 名称',
  `description` text NOT NULL COMMENT 'App 描述',
  `default_layout_uuid` varchar(128) DEFAULT NULL COMMENT '默认布局 UUID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_apps_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='App 定义表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `block_component_docs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `block_component_docs` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `uuid` varchar(128) NOT NULL COMMENT '文档唯一 ID',
  `block_type` varchar(128) NOT NULL COMMENT 'Block 类型，例如 MInput',
  `display_name` varchar(120) NOT NULL COMMENT '展示名称',
  `category` varchar(64) NOT NULL DEFAULT 'custom' COMMENT 'Block 分类',
  `source_kind` varchar(64) NOT NULL DEFAULT 'mokelay-editor' COMMENT '来源类型',
  `source_file` text NOT NULL COMMENT '源码来源文件',
  `description` text NOT NULL COMMENT 'Block 描述',
  `status` varchar(32) NOT NULL DEFAULT 'active' COMMENT '状态',
  `toolbox` json NOT NULL COMMENT '工具栏信息',
  `initial_props` json NOT NULL COMMENT '初始属性',
  `property_schema` json NOT NULL COMMENT '属性信息',
  `event_schema` json NOT NULL COMMENT '事件信息',
  `method_schema` json NOT NULL COMMENT '方法信息',
  `data_fields_schema` json NOT NULL COMMENT '可读取数据字段信息',
  `examples` json NOT NULL COMMENT '示例 DSL',
  `source_refs` json NOT NULL COMMENT '源码引用',
  `raw_meta` json NOT NULL COMMENT '抽取元信息',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_block_component_docs_uuid` (`uuid`),
  UNIQUE KEY `uk_block_component_docs_block_type` (`block_type`),
  KEY `idx_block_component_docs_category` (`category`),
  KEY `idx_block_component_docs_source_kind` (`source_kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Block 组件文档表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `datasources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `datasources` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `uuid` varchar(8) NOT NULL COMMENT '数据源唯一ID及数据库连接标识',
  `alias` varchar(120) NOT NULL COMMENT '数据源名称',
  `description` text NOT NULL COMMENT '数据源描述',
  `schema` json NOT NULL DEFAULT (json_array()) COMMENT '数据库表和字段 Schema JSON',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_datasources_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='数据源定义表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `layouts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `layouts` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '布局自增 ID',
  `uuid` varchar(128) NOT NULL COMMENT '布局唯一标识',
  `name` varchar(120) NOT NULL COMMENT '布局名称',
  `layout_json` json NOT NULL COMMENT '布局 DSL JSON',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_layouts_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='布局定义表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `uuid` char(36) NOT NULL DEFAULT (uuid()) COMMENT '页面唯一标识',
  `name` varchar(120) NOT NULL COMMENT '页面名称',
  `blocks` json NOT NULL COMMENT '页面 Block 配置 JSON',
  `app_uuid` varchar(8) DEFAULT NULL COMMENT '所属 App UUID',
  `layout_uuid` varchar(128) DEFAULT NULL COMMENT '页面布局 UUID',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pages_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='页面定义表';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `employees`;
DROP TABLE IF EXISTS `enterprise`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `enterprise` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `uuid` char(36) NOT NULL DEFAULT (uuid()) COMMENT '企业唯一标识',
  `name` varchar(120) NOT NULL COMMENT '企业名称',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_enterprise_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='企业表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employees` (
  `id` char(36) NOT NULL DEFAULT (uuid()) COMMENT '员工唯一标识',
  `enterprise_uuid` char(36) NOT NULL COMMENT '所属企业 UUID',
  `name` varchar(120) NOT NULL COMMENT '员工名称',
  `email` varchar(255) NOT NULL COMMENT '登录邮箱',
  `password_hash` text NOT NULL COMMENT '密码哈希',
  `plan` varchar(32) NOT NULL DEFAULT 'free' COMMENT '订阅计划',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_employees_email` (`email`),
  KEY `idx_employees_enterprise_uuid` (`enterprise_uuid`),
  CONSTRAINT `fk_employees_enterprise_uuid` FOREIGN KEY (`enterprise_uuid`) REFERENCES `enterprise` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='员工表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
