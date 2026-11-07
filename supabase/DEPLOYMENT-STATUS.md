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

## 2026-11-07 — استقبال لقطات الفروع

طُبقت 20261107000600_branch_snapshots.sql عبر SQL Editor في معاملة واحدة؛ أصبح العدد 26 جدولًا. أضيف branch_devices وbranch_snapshots مع RLS ومنع وصول العملاء إلى بيانات رموز الأجهزة. نُفذ supabase/tests/snapshot_checks.sql على PostgreSQL ونجح: استقبال ذري، إعادة طلب ثابتة، رفض رمز خاطئ، رفض تعارض التسلسل، ومنع RPC عن authenticated. بيانات الاختبار تراجعت بـ ROLLBACK. لم يُربط جهاز حقيقي أو تُرفع بيانات فرع في هذا الاختبار. تنفيذ يدوي دون CLI migration history.
### T10 — الترحيل 007

نجح فحص عزل المنشأتين والفروع وصلاحيات العامل والجلسات مباشرة على مشروع المحترز في معاملة انتهت بالتراجع. بعد ذلك طُبّق الترحيل 20261107000700_cloud_administration.sql بصورة دائمة عبر SQL Editor. تاريخ Supabase CLI يحتاج إلى تسوية قبل تشغيل db push على هذا المشروع.
