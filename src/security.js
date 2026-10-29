import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('hex');
export const sessionCookie = 'lb_session';
export function cookies(secure) {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/' };
}
export function validToken(a, b) {
  return typeof a === 'string' && typeof b === 'string' && /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b)
    && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Database-backed so login throttling survives process restarts and multiple instances.
export async function allowAuthAttempt(db, kind, email, ip) {
  const now = Date.now();
  await db.query('DELETE FROM auth_attempts WHERE expires_at < $1', [now]);
  for (const [key, max] of [[`${kind}:email:${email}`, 20], [`${kind}:ip:${ip}`, 200]]) {
    const rows = await db.query(`INSERT INTO auth_attempts(key_hash, attempts, expires_at)
      VALUES($1, 1, $2) ON CONFLICT(key_hash) DO UPDATE SET attempts = auth_attempts.attempts + 1
      RETURNING attempts`, [digest(key), now + 15 * 60 * 1000]);
    if (Number(rows[0].attempts) > max) return false;
  }
  return true;
}
