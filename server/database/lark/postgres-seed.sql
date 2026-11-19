INSERT INTO reimbursement_categories (value, label, position) VALUES
  ('travel', '差旅费', 1), ('office', '办公费', 2), ('other', '其他', 3) ON CONFLICT (value) DO NOTHING;
