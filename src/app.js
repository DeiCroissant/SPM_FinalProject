import { catalogueRouter } from './catalogue-routes.js';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { createUser, registrationSchema, createUserSchema, loginSchema, fieldErrors } from './users.js';
import { allowAuthAttempt, cookies, digest, randomToken, sessionCookie, validToken } from './security.js';

const publicUserColumns = 'id, name, email, role, is_locked, created_at';
const sessionLifetime = 8 * 60 * 60 * 1000;
const dummyHash = await bcrypt.hash('not-a-real-account-password', 12);

export function createApp({ db, secret, secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) }) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters. Run npm run setup locally.');
  const app = express();
  app.disable('x-powered-by');
  if (process.env.VERCEL) app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('../views/', import.meta.url)));
  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': secure ? [] : null, 'img-src': ["'self'", 'data:', 'https:', 'http:'] } } }));
  app.use((req, res, next) => {
    Object.assign(res.locals, { csrf: '', user: null, path: req.path, message: null });
    next();
  });
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(express.json({ limit: '16kb' }));
  const parseCookies = cookieParser(secret);
  app.use((req, res, next) => {
    // Vercel may prepopulate req.cookies. Reparse the raw header so cookie-parser
    // also verifies signed CSRF cookies instead of skipping initialization.
    delete req.cookies;
    delete req.signedCookies;
    parseCookies(req, res, next);
  });
  app.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    let csrf = req.signedCookies.lb_csrf;
    if (typeof csrf !== 'string' || csrf.length !== 64) {
      csrf = randomToken();
      res.cookie('lb_csrf', csrf, { ...cookies(secure), signed: true, maxAge: sessionLifetime });
    }
    res.locals.csrf = csrf;
    res.locals.user = null;
    res.locals.path = req.path;
    res.locals.message = null;
    const token = req.cookies[sessionCookie];
    if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
      const rows = await db.query(`SELECT u.id, u.name, u.email, u.role, u.is_locked
        FROM sessions s JOIN users u ON s.user_id = u.id
        WHERE s.token_hash = $1 AND s.expires_at > $2`, [digest(token), Date.now()]);
      if (rows.length && !Number(rows[0].is_locked)) {
        req.user = rows[0];
        res.locals.user = rows[0];
      } else {
        await db.query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);
        res.clearCookie(sessionCookie, cookies(secure));
      }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const supplied = req.get('x-csrf-token') || req.body?._csrf;
      if (!validToken(supplied, req.signedCookies.lb_csrf)) {
        return failure(req, res, 403, 'Your form has expired. Refresh the page and try again.');
      }
    }
    next();
  });

  function failure(req, res, code, message) {
    if (req.originalUrl.startsWith('/api/')) return res.status(code).json({ error: message });
    return res.status(code).render('error', { title: code === 403 ? 'Access denied' : 'Something needs attention', code, message });
  }
  function requireUser(req, res, next) {
    if (!req.user) {
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Please log in to continue' });
      return res.redirect(303, '/login');
    }
    next();
  }
  function requireAdmin(req, res, next) {
    if (req.user.role !== 'Administrator') return failure(req, res, 403, 'Only Administrators can access this page.');
    next();
  }

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/', (req, res) => res.render('home', { title: 'A place for your next chapter' }));
  app.get('/register', (req, res) => req.user ? res.redirect('/account') : res.render('auth', { title: 'Create your account', mode: 'register', errors: {}, values: {} }));
  app.get('/login', (req, res) => req.user ? res.redirect('/account') : res.render('auth', {
    title: 'Welcome back', mode: 'login', errors: {}, values: {},
    message: req.query.registered === '1' ? 'Your account is ready. Log in to continue.' : null
  }));

  app.post('/register', async (req, res) => {
    const result = registrationSchema.safeParse(req.body);
    const values = { name: typeof req.body.name === 'string' ? req.body.name : '', email: typeof req.body.email === 'string' ? req.body.email : '' };
    if (!result.success) return res.status(422).render('auth', { title: 'Create your account', mode: 'register', errors: fieldErrors(result), values });
    if (!await allowAuthAttempt(db, 'register', result.data.email, req.ip)) return failure(req, res, 429, 'Too many attempts. Try again in 15 minutes.');
    // Ignore any role sent by a public registration request.
    const created = await createUser(db, { ...result.data, role: 'Customer' });
    if (created.duplicate) return res.status(409).render('auth', { title: 'Create your account', mode: 'register', errors: { email: 'Email is already registered' }, values });
    res.redirect(303, '/login?registered=1');
  });

  app.post('/login', async (req, res) => {
    const result = loginSchema.safeParse(req.body);
    const values = { email: typeof req.body.email === 'string' ? req.body.email : '' };
    const show = (status, errors) => res.status(status).render('auth', { title: 'Welcome back', mode: 'login', errors, values });
    if (!result.success) return show(422, fieldErrors(result));
    if (!await allowAuthAttempt(db, 'login', result.data.email, req.ip)) return failure(req, res, 429, 'Too many attempts. Try again in 15 minutes.');
    const rows = await db.query('SELECT * FROM users WHERE email = $1', [result.data.email]);
    const user = rows[0];
    const passwordMatches = await bcrypt.compare(result.data.password, user?.password_hash || dummyHash);
    if (!user || !passwordMatches) return show(401, { form: 'Invalid email or password' });
    if (Number(user.is_locked)) return show(403, { form: 'Your account has been locked' });
    const oldToken = req.cookies[sessionCookie];
    if (typeof oldToken === 'string') await db.query('DELETE FROM sessions WHERE token_hash = $1', [digest(oldToken)]);
    await db.query('DELETE FROM sessions WHERE expires_at <= $1', [Date.now()]);
    const token = randomToken();
    await db.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES($1, $2, $3)', [digest(token), user.id, Date.now() + sessionLifetime]);
    res.cookie(sessionCookie, token, { ...cookies(secure), maxAge: sessionLifetime });
    res.redirect(303, user.role === 'Administrator' ? '/admin/users' : '/account');
  });

  app.post('/logout', async (req, res) => {
    const token = req.cookies[sessionCookie];
    if (typeof token === 'string') await db.query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);
    res.clearCookie(sessionCookie, cookies(secure));
    res.redirect(303, '/');
  });
  app.get('/account', requireUser, (req, res) => res.render('account', { title: 'Your account' }));
  app.get('/api/me', requireUser, (req, res) => res.json({ user: req.user }));

  // Guard the entire namespace, including future F2 routes and unmatched API paths.
  app.use('/admin', requireUser, requireAdmin);
  app.use('/api/admin', requireUser, requireAdmin);
  async function renderUsers(res, options = {}) {
    const users = await db.query(`SELECT ${publicUserColumns} FROM users ORDER BY created_at DESC, id`);
    return res.status(options.status || 200).render('users', { title: 'Account management', users, errors: {}, values: {}, ...options });
  }
  app.get('/admin', (req, res) => res.redirect('/admin/users'));
  app.get('/admin/users', async (req, res) => renderUsers(res, {
    message: req.query.created === '1' ? 'Account created successfully.' : req.query.updated === '1' ? 'Account status updated.' : null
  }));
  app.get('/api/admin/users', async (req, res) => res.json({ users: await db.query(`SELECT ${publicUserColumns} FROM users ORDER BY created_at DESC, id`) }));

  async function addAccount(req, res) {
    const api = req.path.startsWith('/api/');
    const result = createUserSchema.safeParse(req.body);
    const values = { name: typeof req.body.name === 'string' ? req.body.name : '', email: typeof req.body.email === 'string' ? req.body.email : '', role: req.body.role === 'Administrator' ? 'Administrator' : 'Customer' };
    if (!result.success) return api ? res.status(422).json({ errors: fieldErrors(result) }) : renderUsers(res, { status: 422, errors: fieldErrors(result), values });
    const created = await createUser(db, result.data);
    if (created.duplicate) return api ? res.status(409).json({ error: 'Email is already registered' }) : renderUsers(res, { status: 409, errors: { email: 'Email is already registered' }, values });
    return api ? res.status(201).json({ id: created.id }) : res.redirect(303, '/admin/users?created=1');
  }
  app.post('/admin/users', addAccount);
  app.post('/api/admin/users', addAccount);

  async function updateLock(req, res) {
    const api = req.path.startsWith('/api/');
    if (!['lock', 'unlock'].includes(req.body?.action)) return failure(req, res, 422, 'Choose Lock or Unlock.');
    if (req.params.id === req.user.id) return failure(req, res, 422, 'You cannot lock your own account.');
    const rows = await db.query('UPDATE users SET is_locked = $1 WHERE id = $2 RETURNING id', [req.body.action === 'lock' ? 1 : 0, req.params.id]);
    if (!rows.length) return failure(req, res, 404, 'Account not found.');
    // Locking also invalidates sessions that were already active.
    if (req.body.action === 'lock') await db.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
    return api ? res.json({ id: req.params.id, is_locked: req.body.action === 'lock' }) : res.redirect(303, '/admin/users?updated=1');
  }
  app.post('/admin/users/:id/lock', updateLock);
  app.post('/api/admin/users/:id/lock', updateLock);
  app.use(catalogueRouter(db));
  app.use((req, res) => failure(req, res, 404, 'We could not find that page.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.too.large') return failure(req, res, 413, 'This request is too large.');
    if (error.type === 'entity.parse.failed') return failure(req, res, 400, 'Invalid request body.');
    // Do not log request bodies, credentials or database URLs.
    console.error('Request failed:', error.code || error.name || 'Error',
      String(error.stack || '').split('\n').slice(1, 5).join('\n'));
    failure(req, res, 500, 'Something went wrong. Please try again.');
  });
  return app;
}
