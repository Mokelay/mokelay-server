CREATE TABLE IF NOT EXISTS `reimbursement_categories` (
  `value` varchar(40) COLLATE utf8mb4_bin NOT NULL,
  `label` varchar(120) NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `position` int NOT NULL,
  PRIMARY KEY (`value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报销类别';

CREATE TABLE IF NOT EXISTS `reimbursement_applications` (
  `id` varchar(19) COLLATE utf8mb4_bin NOT NULL,
  `enterprise_uuid` char(36) NOT NULL,
  `employee_id` char(36) NOT NULL,
  `version` int NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `show_help` varchar(3) NOT NULL DEFAULT 'no',
  `category` varchar(40) COLLATE utf8mb4_bin NULL,
  `fiat` decimal(16,2) NOT NULL DEFAULT 0,
  `crypto` decimal(16,2) NOT NULL DEFAULT 0,
  `loan` decimal(16,2) NOT NULL DEFAULT 0,
  `settlement` decimal(17,2) GENERATED ALWAYS AS (`fiat` + `crypto` - `loan`) STORED,
  `note` text NOT NULL DEFAULT (''),
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  -- NULL exempts submitted applications from the one-draft-per-applicant rule.
  `open_draft` tinyint GENERATED ALWAYS AS (CASE WHEN `status` = 'draft' THEN 1 END) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reimbursement_open_draft` (`enterprise_uuid`, `employee_id`, `open_draft`),
  CONSTRAINT `fk_reimbursement_category` FOREIGN KEY (`category`) REFERENCES `reimbursement_categories` (`value`),
  CONSTRAINT `reimbursement_state` CHECK (`status` = 'draft' OR (`status` = 'submitted' AND `category` IS NOT NULL)),
  CONSTRAINT `reimbursement_amounts` CHECK (`fiat` >= 0 AND `crypto` >= 0 AND `loan` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报销申请';

CREATE TABLE IF NOT EXISTS `reimbursement_write_locks` (
  `id` varchar(73) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  `updated_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
