import { cloudApi } from './api.js';
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return cloudApi(request, env);
    return env.ASSETS.fetch(request);
  }
};
