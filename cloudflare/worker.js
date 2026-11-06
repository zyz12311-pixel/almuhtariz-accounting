// Static hosting only. Never import the local Node/SQLite server into Workers.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return Response.json({
        error: 'الربط السحابي قيد الإعداد. استخدم نسخة الفرع المحلية لإدارة الحسابات حاليًا.',
        code: 'CLOUD_BACKEND_NOT_READY'
      }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    return env.ASSETS.fetch(request);
  }
};
