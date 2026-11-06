# سجل تطبيق مخطط Supabase

المشروع: tdpozajnzuaevtwmtrzo
تاريخ التنفيذ: 2026-11-06

تم إنشاء مخطط الترحيلات الخمسة (20261106000100 إلى 20261106000500) عبر SQL Editor داخل معاملة واحدة. جُمعت أوامر RLS والمنح المتكررة في حلقات مكافئة، وأضيف فحص schema_checks.sql قبل COMMIT. اختير Run and enable RLS في لوحة Supabase.

النتيجة الظاهرة: tables_created = 24 و tables_with_rls = 24.
نجح فحص وجود الجداول وRLS، ومنع SELECT المجهول، ومنع INSERT/UPDATE/DELETE لحساب authenticated، ومنع استدعاء ingest_branch_event منه.
لم تُرفع بيانات محاسبية محلية أو سجلات أجياد. لم تُنشأ عضويات أو حسابات تطبيق ولم تُفعّل المزامنة. فحص العزل الوظيفي بمنشأتين وأدوار متعددة لم يُنفذ بعد.

تم حفظ SQL كـ Untitled query في:
https://supabase.com/dashboard/project/tdpozajnzuaevtwmtrzo/sql/aa109ec6-d28d-4bf9-8a9e-8837bebbaaf8

تنبيه للصيانة: التنفيذ يدوي عبر SQL Editor؛ لم يُسجل تاريخ الترحيلات بواسطة Supabase CLI. لا تشغّل db push لهذه الترحيلات على المشروع نفسه قبل مطابقة المخطط وتسوية migration history بأداة CLI. إعادة تنفيذ CREATE TABLE ستفشل لأن الجداول موجودة.
