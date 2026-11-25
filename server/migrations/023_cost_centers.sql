CREATE TABLE IF NOT EXISTS cost_centers(
 id INTEGER PRIMARY KEY,
 code TEXT UNIQUE NOT NULL CHECK(length(TRIM(code))>0 AND length(code)<=30),
 name_ar TEXT NOT NULL CHECK(length(TRIM(name_ar))>0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- البعد التحليلي على سطور القيد (يستقل عن الفرع ولا يؤثر على توازن مدين/دائن)
ALTER TABLE journal_lines ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);

-- مركز التكلفة على المستند المصدر ينتقل إلى القيد المحاسبي المرتبط عند الترحيل
ALTER TABLE invoices ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);
ALTER TABLE purchases ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);
ALTER TABLE cash_vouchers ADD COLUMN cost_center_id INTEGER REFERENCES cost_centers(id);

CREATE INDEX IF NOT EXISTS ix_jl_cost_center ON journal_lines(cost_center_id);

-- منع حذف مركز التكلفة المرتبط بحركات محاسبية سابقة (تصحيح بإلغاء التفعيل وليس الحذف)
CREATE TRIGGER IF NOT EXISTS cc_nd BEFORE DELETE ON cost_centers
WHEN EXISTS(SELECT 1 FROM journal_lines WHERE cost_center_id=OLD.id LIMIT 1)
BEGIN SELECT RAISE(ABORT,'لا يمكن حذف مركز التكلفة لأنه مرتبط بحركات محاسبية سابقة؛ ألغِ تفعيله بدلاً من الحذف'); END;

UPDATE local_meta SET value='23' WHERE key='schema_version';
