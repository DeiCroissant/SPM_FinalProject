import { runtimeApp } from '../src/runtime.js';
export default async function handler(req, res) {
  try { return (await runtimeApp())(req, res); }
  catch { res.statusCode = 503; res.end('Service is not configured. Check database and session settings.'); }
}
