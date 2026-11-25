# التشغيل المحلي على ويندوز

1. فك ضغط حزمة التطبيق في مجلد ثابت على الجهاز الرئيسي للفرع.
2. يلزم Node.js 22.13 أو أحدث؛ لا توجد حزم npm مطلوبة للتشغيل.
3. افتح start-windows.cmd. ينشئ الخادم قاعدة SQLite والجداول وهوية تثبيت مستقلة عند أول تشغيل.
4. افتح http://localhost:3000 وأكمل حساب المالك. لا توجد كلمة مرور افتراضية.
5. أضف المحاسب والموظفين ونقاط البيع وحدد صلاحياتهم. يستخدم عامل الكاشير حساب موظف مرتبطًا بنقطة البيع.
6. من أجهزة الفرع افتح عنوان الشبكة الذي يظهر في نافذة الخادم. أبق الجهاز الرئيسي والشبكة الداخلية يعملان؛ انقطاع الإنترنت يختلف عن انقطاع الشبكة المحلية.
7. افتح backup-windows.cmd لحفظ نسخة متسقة من قاعدة البيانات وفحص سلامتها. تحفظ في backups دون استبدال النسخ السابقة. يوجد أيضًا تنزيل نسخة احتياطية من حساب المالك داخل التطبيق.

يمكن ضبط ALMUHTARIZ_DATA لتحديد مجلد البيانات وALMUHTARIZ_BACKUPS لتحديد مجلد النسخ. لا تستبدل قاعدة مستخدمة بقاعدة جديدة، ولا تنقل نسخة بيانات عميل إلى عميل آخر.

## تشغيل HTTPS داخل الشبكة المحلية (LAN)

استخدم هذا المسار فقط داخل شبكة موثوقة. أنشئ الشهادات على جهاز المسؤول بصلاحيات تسمح بتشغيل سكربتات PowerShell المحلية.

1. أنشئ جذرًا داخليًا عامًا/خاصًا (المفتاح الخاص يبقى على جهاز الإنشاء فقط):
   `powershell -ExecutionPolicy Bypass -File tools\tls-new-root-ca.ps1 -DnsNames almuhtariz-pos.local -OutDir data\tls`
2. اعرض بصمة SHA-256 للجذر قبل أي تثبيت على أجهزة الفروع:
   `powershell -ExecutionPolicy Bypass -File tools\tls-check.ps1 -RootCer data\tls\almuhtariz-root-ca.cer`
3. أنشئ شهادة خادم موقعة من الجذر، مع SAN للأسماء/العناوين التي سيستخدمها الفرع:
   `powershell -ExecutionPolicy Bypass -File tools\tls-new-server-cert.ps1 -RootThumbprint <ROOT_THUMBPRINT> -DnsNames almuhtariz-pos.local,<اسم-الجهاز> -IpAddresses <IP-ثابت-اختياري> -OutDir data\tls`
4. شغّل الخادم مع متغيري TLS (لا تضع المفتاح الخاص في Git):
   `set ALMUHTARIZ_TLS_CERT=data\tls\almuhtariz-pos-server.pem`
   `set ALMUHTARIZ_TLS_KEY=data\tls\almuhtariz-pos-server.key.pem`
   عند وجود TLS، يستمع HTTPS على `0.0.0.0:PORT` لأجهزة LAN، ويستمع HTTP على `127.0.0.1:PORT+1` للجهاز الرئيسي فقط.
5. وزّع فقط ملف الجذر العام (`almuhtariz-root-ca.cer`/`.pem`) على أجهزة POS، وبعد التحقق من البصمة ثبّته **من حساب Windows الذي يستخدمه موظف نقطة البيع** (السكربت يثبت في `CurrentUser\Root`):
   `powershell -ExecutionPolicy Bypass -File tools\tls-install-root.ps1 -RootCerPath \\share\almuhtariz-root-ca.cer -ExpectedSha256 <SHA256>`
6. تحقق من الربط والمنافذ على الجهاز الرئيسي:
   `powershell -ExecutionPolicy Bypass -File tools\tls-check.ps1 -HttpsPort 3000 -HttpPort 3001 -RootCer data\tls\almuhtariz-root-ca.cer`

### معيار قبول TLS LAN
- من جهاز POS آخر، وبحساب موظف نقطة البيع نفسه بعد تثبيت الجذر، افتح `https://<الاسم-في-SAN>:PORT` وسجّل الدخول بدون تحذير شهادة.
- من جهاز POS نفسه، تأكد أن `http://<IP-الجهاز-الرئيسي>:PORT+1` غير قابل للوصول (HTTP المحلي مقيد بـ `127.0.0.1` فقط).
- لا توزع `*.key.pem` أو مفتاح الجذر الخاص. إذا كان HTTPS يستمع على `0.0.0.0:3000` فلا يمكن استخدام نفس المنفذ لـ HTTP المحلي؛ الإعداد الحالي يستخدم `PORT+1` لـ HTTP المحلي.

النسخة تجريبية: المزامنة السحابية والربط الإنتاجي بالهيئة غير مفعلين. قائمة ما قبل الربط في BEFORE-ZATCA.md. فتح الوصول من أجهزة الشبكة يعتمد أيضًا على إعدادات جدار الحماية؛ ملفات التشغيل لا تغيرها تلقائيًا.
