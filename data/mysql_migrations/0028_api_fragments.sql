ALTER TABLE `apis`
  ADD COLUMN `fragment` boolean NOT NULL DEFAULT false COMMENT '是否为逻辑片段' AFTER `method`,
  ADD KEY `idx_apis_fragment_status` (`fragment`, `status`);

ALTER TABLE `apis_snapshot`
  ADD COLUMN `fragment` boolean NOT NULL DEFAULT false COMMENT '是否为逻辑片段（快照时点）' AFTER `method`;
