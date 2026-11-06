# نشر واجهة المحترز على Cloudflare

المجلد الفعلي للواجهة هو `web` ويحتوي index.html وملفات CSS وJavaScript جاهزة؛ لا توجد خطوة Vite أو مجلد dist/public.

إعدادات Workers Builds للمستودع:

- Root directory: جذر المستودع الذي يحتوي package.json وwrangler.jsonc.
- Build command: فارغ؛ لا يلزم بناء الواجهة.
- Deploy command: `npx wrangler deploy`.
- فرع النشر: main.

يقرأ Wrangler ملف wrangler.jsonc ويحمّل web فقط كأصول ثابتة؛ لا ترفع جذر المستودع كأصول لأنه يحتوي ملفات الخادم.

خادم server/index.js يستخدم Node وSQLite محليًا. أضيف cloudflare/api.js للدخول بالبريد وكلمة المرور عبر Supabase Auth وقراءة بيانات المنشأة باستخدام JWT المستخدم وسياسات RLS. لا يستخدم service_role لقراءة بيانات المستخدمين. الجلسة في Cookie باسم __Host-almuhtariz، مع HttpOnly وSecure وSameSite=Strict، لمدة ساعة كحد أقصى دون تجديد تلقائي. يلزم SUPABASE_URL وSUPABASE_PUBLISHABLE_KEY في Runtime Production. لا تضف أي مفتاح إداري إلى ملفات web أو المستودع.

المسارات: /api/state و/api/login و/api/logout و/api/cloud/overview. /api/cloud/health يفحص الاتصال الحقيقي بـ Auth API فقط؛ لا يعني نجاح المزامنة أو اختبار صلاحيات مستخدم. جميع الردود غير قابلة للتخزين المؤقت. المستخدم السحابي يجب أن يكون موجودًا في Auth وله organization_members نشطة؛ حساب لوحة التحكم لا يُعد حساب تطبيق. لا يوجد تسجيل عام يمنح دور المالك. تُجهز العضويات بأداة خلفية موثوقة.

واجهة السحابة تعرض حتى 100 صنف نشط وآخر 100 فاتورة وأول 100 عميل/مورد؛ لا تعرض إجماليات مالية على عينة محدودة. العامل يرى أعمدة البيع فقط. الكتابة السحابية وإصدار المستندات والمزامنة لم تُنفذ بعد؛ تظل نسخة الفرع مسؤولة عنها.

بعد رفع التغييرات إلى main أعد محاولة البناء. لا يُعد نجاح النشر دليلًا على جاهزية العمليات المحاسبية السحابية.

المرجع: https://developers.cloudflare.com/workers/static-assets/binding/
