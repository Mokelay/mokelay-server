CREATE TABLE IF NOT EXISTS reimbursement_categories (
  value varchar(40) PRIMARY KEY,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reimbursement_applications (
  id varchar(19) PRIMARY KEY,
  enterprise_uuid uuid NOT NULL,
  employee_id uuid NOT NULL,
  version integer NOT NULL,
  status text NOT NULL,
  show_help text NOT NULL DEFAULT 'no',
  category varchar(40) REFERENCES reimbursement_categories(value),
  fiat numeric(16,2) NOT NULL DEFAULT 0,
  crypto numeric(16,2) NOT NULL DEFAULT 0,
  loan numeric(16,2) NOT NULL DEFAULT 0,
  settlement numeric(17,2) GENERATED ALWAYS AS (fiat + crypto - loan) STORED,
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reimbursement_state CHECK (status = 'draft' OR (status = 'submitted' AND category IS NOT NULL)),
  CONSTRAINT reimbursement_amounts CHECK (fiat >= 0 AND crypto >= 0 AND loan >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS reimbursement_open_draft ON reimbursement_applications (enterprise_uuid, employee_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS reimbursement_write_locks (
  id varchar(73) PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now()
);
