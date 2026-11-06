# نشر واجهة المحترز على Cloudflare

المجلد الفعلي للواجهة هو `web` ويحتوي index.html وملفات CSS وJavaScript جاهزة؛ لا توجد خطوة Vite أو مجلد dist/public.

إعدادات Workers Builds للمستودع:

- Root directory: جذر المستودع الذي يحتوي package.json وwrangler.jsonc.
- Build command: فارغ؛ لا يلزم بناء الواجهة.
- Deploy command: `npx wrangler deploy`.
- فرع النشر: main.

يقرأ Wrangler ملف wrangler.jsonc ويحمّل web فقط كأصول ثابتة؛ لا ترفع جذر المستودع كأصول لأنه يحتوي ملفات الخادم.

هذا الإصلاح يجهز استضافة ملفات الواجهة فقط. خادم server/index.js يستخدم Node وSQLite محليًا. إنشاء جداول Supabase لا يحول هذا الخادم إلى Worker ولا يفعّل المزامنة. تعيد مسارات /api استجابة JSON برمز 503 ورسالة واضحة حتى يُنفذ الخادم السحابي والمصادقة. لا تضف service_role إلى ملفات web أو المستودع.

بعد رفع التغييرات إلى main أعد محاولة البناء. لا يُعد نجاح النشر دليلًا على جاهزية العمليات المحاسبية السحابية.

المرجع: https://developers.cloudflare.com/workers/static-assets/binding/
