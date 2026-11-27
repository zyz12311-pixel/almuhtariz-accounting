-- ربط وحدة الإصدار EGS بالفواتير وسلسلة ICV/PIH لكل وحدة EGS
-- Migration 027: EGS Unit Chain

-- إضافة عمود issuer_profile_id لجدول invoices لربط الفاتورة بوحدة EGS
-- نستخدم local_id من ملف وحدة الإصدار (مخزن في compliance_state key='issuer_profile')
-- لا نضع foreign key لأن مفتاح compliance_state هو 'issuer_profile' وليس local_id
ALTER TABLE invoices ADD COLUMN issuer_profile_id TEXT;

-- إنشاء جدول سلسلة ICV/PIH لكل وحدة EGS (بدلاً من كل فرع)
CREATE TABLE egs_unit_chain (
  issuer_profile_id TEXT PRIMARY KEY,
  icv INTEGER NOT NULL DEFAULT 0,
  last_hash TEXT NOT NULL DEFAULT ''
);

-- فهرس للاستعلامات السريعة
CREATE INDEX IF NOT EXISTS ix_invoices_issuer_profile ON invoices(issuer_profile_id);
CREATE INDEX IF NOT EXISTS ix_invoices_issuer_icv ON invoices(issuer_profile_id, icv);

UPDATE local_meta SET value='27' WHERE key='schema_version';