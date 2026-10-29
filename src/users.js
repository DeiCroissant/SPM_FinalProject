import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const name = z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer');
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const password = z.string().min(8, 'Password must have at least 8 characters')
  .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be 72 UTF-8 bytes or fewer');
export const registrationSchema = z.object({ name, email, password });
export const createUserSchema = registrationSchema.extend({ role: z.enum(['Administrator', 'Customer']) });
export const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(200) });

export function fieldErrors(result) {
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map(issue => [issue.path[0] || 'form', issue.message]));
}

export async function createUser(db, values) {
  const id = randomUUID();
  const hash = await bcrypt.hash(values.password, 12);
  try {
    await db.query(`INSERT INTO users(id, name, email, password_hash, role, is_locked, created_at)
      VALUES($1, $2, $3, $4, $5, $6, $7)`, [id, values.name, values.email.toLowerCase(), hash, values.role || 'Customer', 0, Date.now()]);
  } catch (error) {
    if (error.code === '23505' || String(error.message).includes('UNIQUE constraint failed: users.email')) {
      return { duplicate: true };
    }
    throw error;
  }
  return { id };
}

export async function seedUsers(db, env = process.env) {
  const seeds = [
    { name: 'Bookstore Administrator', email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, role: 'Administrator' },
    { name: 'Demo Reader', email: env.CUSTOMER_EMAIL, password: env.CUSTOMER_PASSWORD, role: 'Customer' }
  ];
  for (const values of seeds) {
    if (!values.email || !values.password) continue;
    const result = createUserSchema.safeParse(values);
    if (!result.success) throw new Error('Invalid seed account configuration; check email and password requirements.');
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [result.data.email]);
    if (!existing.length) await createUser(db, result.data);
  }
}
