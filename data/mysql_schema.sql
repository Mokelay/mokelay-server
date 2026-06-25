
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
  `uuid` varchar(128) NOT NULL COMMENT '布局唯一标识',
  `name` varchar(120) NOT NULL COMMENT '布局名称',
  `layout_json` json NOT NULL COMMENT '布局 DSL JSON',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`uuid`)
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
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `uuid` char(36) NOT NULL DEFAULT (uuid()) COMMENT '用户唯一标识',
  `name` varchar(120) NOT NULL COMMENT '用户名称',
  `email` varchar(255) NOT NULL COMMENT '登录邮箱',
  `password_hash` text NOT NULL COMMENT '密码哈希',
  `plan` varchar(32) NOT NULL DEFAULT 'free' COMMENT '订阅计划',
  `created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_uuid` (`uuid`),
  UNIQUE KEY `uk_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='用户表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
