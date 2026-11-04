import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import express from 'express';
import { createApp } from '../src/app.js';
import { openDatabase, migrate } from '../src/db.js';
import { createUser, seedUsers } from '../src/users.js';
import { validToken } from '../src/security.js';

let db, app, admin, customer, csrfAdmin, csrfCustomer, adminId, customerId;
const password = 'TestPassword!123';
async function csrf(agent, path = '/login') {
  const response = await agent.get(path);
  const match = response.text.match(/name="_csrf" value="([a-f0-9]+)"/);
  assert.ok(match, `CSRF form present at ${path}`);
  return match[1];
}
async function login(agent, email, pwd = password) {
  const token = await csrf(agent);
  return agent.post('/login').type('form').send({ _csrf: token, email, password: pwd });
}
before(async () => {
  db = await openDatabase({ filename: ':memory:', url: '' });
  await migrate(db);
  adminId = (await createUser(db, { name: 'Admin', email: 'admin@example.com', password, role: 'Administrator' })).id;
  customerId = (await createUser(db, { name: 'Reader', email: 'reader@example.com', password, role: 'Customer' })).id;
  app = createApp({ db, secret: 'test-secret-with-more-than-32-characters', secure: false });
  admin = request.agent(app);
  customer = request.agent(app);
  assert.equal((await login(admin, 'admin@example.com')).status, 303);
  assert.equal((await login(customer, 'reader@example.com')).status, 303);
  csrfAdmin = await csrf(admin, '/admin/users');
  csrfCustomer = await csrf(customer, '/account');
});
after(async () => db.close());

test('Hosting: pre-parsed cookies still verify CSRF and support login', async () => {
  const host = express();
  host.use((req, res, next) => { req.cookies = {}; next(); });
  host.use(createApp({ db, secret: 'test-secret-with-more-than-32-characters', secure: false }));
  const agent = request.agent(host);
  const token = await csrf(agent);
  await agent.post('/login').type('form').send({ _csrf: '0'.repeat(64), email: 'reader@example.com', password }).expect(403);
  await agent.post('/login').type('form').send({ _csrf: token, email: 'reader@example.com', password }).expect(303);
  await agent.get('/account').expect(200);
});

test('AC-01.1 registration persists normalized Customer and redirects to login', async () => {
  const agent = request.agent(app);
  const token = await csrf(agent, '/register');
  const response = await agent.post('/register').type('form').send({ _csrf: token, name: 'New Reader', email: 'NEW@example.com', password, role: 'Administrator' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.location, '/login?registered=1');
  const [user] = await db.query('SELECT * FROM users WHERE email = $1', ['new@example.com']);
  assert.equal(user.role, 'Customer');
});
test('AC-01.2 case-insensitive duplicate registration rejected', async () => {
  const agent = request.agent(app);
  const token = await csrf(agent, '/register');
  const response = await agent.post('/register').type('form').send({ _csrf: token, name: 'Duplicate', email: 'READER@example.com', password });
  assert.equal(response.status, 409);
  assert.match(response.text, /Email is already registered/);
});
test('AC-01.3 7-character password rejected server-side; 8 accepted', async () => {
  const agent = request.agent(app);
  const token = await csrf(agent, '/register');
  assert.equal((await agent.post('/register').type('form').send({ _csrf: token, name: 'Short', email: 'short@example.com', password: '1234567' })).status, 422);
  assert.equal((await agent.post('/register').type('form').send({ _csrf: token, name: 'Boundary', email: 'boundary@example.com', password: '12345678' })).status, 303);
  assert.equal((await db.query('SELECT id FROM users WHERE email = $1', ['short@example.com'])).length, 0);
});
test('AC-01.4 persisted password is a valid bcrypt hash', async () => {
  const [user] = await db.query('SELECT password_hash FROM users WHERE email = $1', ['reader@example.com']);
  assert.notEqual(user.password_hash, password);
  assert.match(user.password_hash, /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare(password, user.password_hash), true);
});
test('AC-02.1 Customer and Administrator login redirect to their own pages', async () => {
  const a = request.agent(app), c = request.agent(app);
  assert.equal((await login(a, 'admin@example.com')).headers.location, '/admin/users');
  assert.equal((await login(c, 'reader@example.com')).headers.location, '/account');
  assert.equal((await c.get('/api/me')).body.user.role, 'Customer');
});
test('AC-02.2 wrong password and unknown email both fail without a session', async () => {
  const agent = request.agent(app);
  for (const email of ['admin@example.com', 'unknown@example.com']) {
    const response = await login(agent, email, 'wrong-password');
    assert.equal(response.status, 401);
    assert.match(response.text, /Invalid email or password/);
  }
  assert.equal((await agent.get('/api/me')).status, 401);
});
test('AC-02.3 locked account cannot log in; unlock restores access and old sessions remain revoked', async () => {
  const id = (await createUser(db, { name: 'Locked Reader', email: 'locked@example.com', password, role: 'Customer' })).id;
  const agent = request.agent(app);
  await login(agent, 'locked@example.com');
  await admin.post(`/api/admin/users/${id}/lock`).send({ _csrf: csrfAdmin, action: 'lock' }).expect(200);
  await agent.get('/api/me').expect(401);
  assert.match((await login(agent, 'locked@example.com')).text, /Your account has been locked/);
  await admin.post(`/api/admin/users/${id}/lock`).send({ _csrf: csrfAdmin, action: 'unlock' }).expect(200);
  await agent.get('/api/me').expect(401);
  assert.equal((await login(agent, 'locked@example.com')).status, 303);
});
test('AC-02.4 blank login input rejected by server', async () => {
  const agent = request.agent(app);
  const token = await csrf(agent);
  for (const body of [{ email: '', password }, { email: 'reader@example.com', password: '' }]) {
    await agent.post('/login').type('form').send({ _csrf: token, ...body }).expect(422);
  }
});
test('AC-03.1 logout clears cookie and invalidates stored session, including replay', async () => {
  const agent = request.agent(app);
  const response = await login(agent, 'reader@example.com');
  const cookie = response.headers['set-cookie'].find(value => value.startsWith('lb_session=')).split(';')[0];
  const token = await csrf(agent, '/account');
  const logout = await agent.post('/logout').type('form').send({ _csrf: token });
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.location, '/');
  await request(app).get('/api/me').set('Cookie', cookie).expect(401);
});
test('AC-03.2 protected pages use no-store and require login after logout', async () => {
  const agent = request.agent(app);
  await login(agent, 'reader@example.com');
  const account = await agent.get('/account');
  assert.equal(account.headers['cache-control'], 'no-store');
  const token = account.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  await agent.post('/logout').type('form').send({ _csrf: token });
  const after = await agent.get('/account');
  assert.equal(after.headers.location, '/login');
});
test('AC-03.3 logged-out header offers login/register and no logout control', async () => {
  const response = await request(app).get('/');
  assert.match(response.text, /href="\/login"/);
  assert.match(response.text, /href="\/register"/);
  assert.doesNotMatch(response.text, /action="\/logout"/);
});
test('AC-04.1 Admin creates either role with hashed password', async () => {
  for (const role of ['Administrator', 'Customer']) {
    const email = `created-${role.toLowerCase()}@example.com`;
    await admin.post('/api/admin/users').send({ _csrf: csrfAdmin, name: role, email, password, role }).expect(201);
    const [user] = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    assert.equal(user.role, role);
    assert.equal(await bcrypt.compare(password, user.password_hash), true);
  }
});
test('AC-04.2 Admin locks/unlocks account and list reflects status', async () => {
  const id = (await createUser(db, { name: 'Toggle Reader', email: 'toggle@example.com', password, role: 'Customer' })).id;
  for (const [action, expected] of [['lock', 1], ['unlock', 0]]) {
    await admin.post(`/admin/users/${id}/lock`).type('form').send({ _csrf: csrfAdmin, action }).expect(303);
    const users = (await admin.get('/api/admin/users')).body.users;
    assert.equal(Number(users.find(user => user.id === id).is_locked), expected);
  }
});
test('AC-04.3 self-lock rejected server-side even if UI is bypassed', async () => {
  const response = await admin.post(`/api/admin/users/${adminId}/lock`).send({ _csrf: csrfAdmin, action: 'lock' });
  assert.equal(response.status, 422);
  assert.match(response.body.error, /cannot lock your own/);
  assert.equal((await admin.get('/api/me')).body.user.role, 'Administrator');
});
test('AC-04.4 duplicate Admin-created email rejected', async () => {
  await admin.post('/api/admin/users').send({ _csrf: csrfAdmin, name: 'Duplicate', email: 'READER@example.com', password, role: 'Customer' }).expect(409);
});
test('AC-05.1 Administrator can access management HTML and API', async () => {
  await admin.get('/admin/users').expect(200);
  const response = await admin.get('/api/admin/users').expect(200);
  assert.ok(response.body.users.length >= 2);
  assert.ok(response.body.users.every(user => !('password_hash' in user)));
});
test('AC-05.2 Customer blocked on management pages and read/write APIs', async () => {
  await customer.get('/admin/users').expect(403);
  await customer.get('/admin/books').expect(403);
  await customer.get('/api/admin/users').expect(403);
  await customer.post('/api/admin/users').send({ _csrf: csrfCustomer, name: 'Attack', email: 'attack@example.com', password, role: 'Administrator' }).expect(403);
  await customer.post(`/api/admin/users/${adminId}/lock`).send({ _csrf: csrfCustomer, action: 'lock' }).expect(403);
});
test('AC-05.3 Guest redirected to login for pages; API returns 401 without data', async () => {
  assert.equal((await request(app).get('/admin/users')).headers.location, '/login');
  await request(app).get('/api/admin/users').expect(401);
  const agent = request.agent(app);
  const token = await csrf(agent);
  await agent.post('/api/admin/users').send({ _csrf: token }).expect(401);
});
test('AC-05.4 DB rejects unsupported roles', async () => {
  await assert.rejects(() => db.query('UPDATE users SET role = $1 WHERE id = $2', ['SuperUser', customerId]));
});
test('Security: CSRF missing/forged rejected; UTF-8 malformed token does not throw', async () => {
  await admin.post('/api/admin/users').send({}).expect(403);
  await admin.post('/api/admin/users').send({ _csrf: 'x'.repeat(64) }).expect(403);
  assert.equal(validToken('é'.repeat(64), 'a'.repeat(64)), false);
});
test('Security: invalid email, invalid role, oversized bcrypt password rejected', async () => {
  for (const values of [{ email: 'bad-email' }, { role: 'SuperUser' }, { password: 'é'.repeat(40) }]) {
    await admin.post('/api/admin/users').send({ _csrf: csrfAdmin, name: 'Invalid', email: 'invalid@example.com', password, role: 'Customer', ...values }).expect(422);
  }
});
test('Security: HTML escaping prevents stored name injection', async () => {
  await admin.post('/api/admin/users').send({ _csrf: csrfAdmin, name: '<script>alert(1)</script>', email: 'escaped@example.com', password, role: 'Customer' }).expect(201);
  const response = await admin.get('/admin/users');
  assert.match(response.text, /&lt;script&gt;/);
  assert.doesNotMatch(response.text, /<script>alert/);
});
test('Security: session expiry enforced', async () => {
  const agent = request.agent(app);
  const response = await login(agent, 'boundary@example.com', '12345678');
  assert.equal(response.status, 303);
  const [user] = await db.query('SELECT id FROM users WHERE email = $1', ['boundary@example.com']);
  await db.query('UPDATE sessions SET expires_at = $1 WHERE user_id = $2', [Date.now() - 1, user.id]);
  await agent.get('/api/me').expect(401);
});
test('Security: repeated login failures throttled in database', async () => {
  const agent = request.agent(app);
  const token = await csrf(agent);
  // Unknown email uses the same throttle without needing costly bcrypt 20 times.
  const { digest } = await import('../src/security.js');
  await db.query('INSERT INTO auth_attempts(key_hash, attempts, expires_at) VALUES($1, $2, $3)', [digest('login:email:throttle@example.com'), 20, Date.now() + 60_000]);
  await agent.post('/login').type('form').send({ _csrf: token, email: 'throttle@example.com', password: 'wrong' }).expect(429);
});
test('Seed is idempotent and does not overwrite existing passwords', async () => {
  const env = { ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'AnotherPassword!123' };
  await seedUsers(db, env);
  const [user] = await db.query('SELECT password_hash FROM users WHERE id = $1', [adminId]);
  assert.equal(await bcrypt.compare(password, user.password_hash), true);
});
