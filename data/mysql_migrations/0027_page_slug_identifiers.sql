SET @pages_uuid_has_single_column_unique = (
  SELECT COUNT(*)
  FROM (
    SELECT `INDEX_NAME`
    FROM `information_schema`.`STATISTICS`
    WHERE `TABLE_SCHEMA` = DATABASE()
      AND `TABLE_NAME` = 'pages'
    GROUP BY `INDEX_NAME`
    HAVING MAX(`NON_UNIQUE`) = 0
      AND COUNT(*) = 1
      AND MAX(`COLUMN_NAME` = 'uuid') = 1
  ) AS `pages_uuid_unique_indexes`
);
SET @pages_uuid_add_unique_sql = IF(
  @pages_uuid_has_single_column_unique > 0,
  'SELECT 1',
  'ALTER TABLE `pages` ADD UNIQUE KEY `uk_pages_uuid` (`uuid`)'
);
PREPARE `pages_uuid_add_unique_statement` FROM @pages_uuid_add_unique_sql;
EXECUTE `pages_uuid_add_unique_statement`;
DEALLOCATE PREPARE `pages_uuid_add_unique_statement`;

ALTER TABLE `pages`
  MODIFY COLUMN `uuid` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) COMMENT '页面唯一标识',
  ADD CONSTRAINT `chk_pages_uuid_slug` CHECK (
    CHAR_LENGTH(`uuid`) BETWEEN 1 AND 128
    AND REGEXP_LIKE(`uuid`, _ascii'^[a-z0-9_-]+$', 'c')
  );
