import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const text = (label, max) => z.string().trim().min(1, `${label} is required`).max(max, `${label} must be ${max} characters or fewer`);
export const taxonomySchema = z.object({ name: text('Name', 100).transform(v => v.normalize('NFC')) });
const amount = z.union([z.number(), z.string().trim().min(1, 'Price is required')]).pipe(z.coerce.number().finite().positive('Price must be greater than 0').max(9999999999.99).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.0001, 'Use at most 2 decimal places'));
const stock = z.union([z.number(), z.string().trim().min(1, 'Stock is required')]).pipe(z.coerce.number().int('Stock must be a whole number').min(0, 'Stock must be 0 or greater').max(2147483647));
export const bookSchema = z.object({
  title: text('Title', 200), author_id: text('Author', 100), category_id: text('Category', 100), price: amount,
  description: text('Description', 5000), cover_url: text('Cover image URL', 2048).url('Enter a valid cover image URL').refine(v => /^https?:\/\//i.test(v), 'Use an http or https cover image URL'), stock
});
const entities = { categories: 'Category', authors: 'Author' };
export function taxonomyLabel(kind) {
  if (!Object.hasOwn(entities, kind)) throw new Error('Invalid taxonomy');
  return entities[kind];
}
export async function migrateCatalogue(db) {
  for (const table of Object.keys(entities)) {
    await db.query(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100))`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_name_unique ON ${table} (lower(name))`);
  }
  await db.query(`CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
    author_id TEXT NOT NULL REFERENCES authors(id), category_id TEXT NOT NULL REFERENCES categories(id),
    price NUMERIC(12,2) NOT NULL CHECK (price > 0), description TEXT NOT NULL,
    cover_url TEXT NOT NULL, stock INTEGER NOT NULL CHECK (stock >= 0),
    is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS books_active_created ON books(is_deleted, created_at, id)');
}
export async function listTaxonomy(db, kind) {
  taxonomyLabel(kind);
  return db.query(`SELECT id, name FROM ${kind} ORDER BY lower(name), id`);
}
export async function saveTaxonomy(db, kind, data, id) {
  const label = taxonomyLabel(kind);
  try {
    if (id) {
      const rows = await db.query(`UPDATE ${kind} SET name = $1, name_key = $2 WHERE id = $3 RETURNING id`, [data.name, data.name.toLowerCase(), id]);
      return rows.length ? { id } : { missing: true };
    }
    const newId = randomUUID();
    await db.query(`INSERT INTO ${kind}(id,name,name_key) VALUES($1,$2,$3)`, [newId, data.name, data.name.toLowerCase()]);
    return { id: newId };
  } catch (e) {
    if (e.code === '23505' || String(e.message).includes('UNIQUE constraint failed')) return { errors: { name: `${label} already exists` } };
    throw e;
  }
}
const bookSource = 'FROM books b JOIN authors a ON a.id=b.author_id JOIN categories c ON c.id=b.category_id';
const selectBook = `SELECT b.*, a.name AS author_name, c.name AS category_name ${bookSource}`;
export async function listBooks(db, { admin = false } = {}) {
  return db.query(`${selectBook}${admin ? '' : ' WHERE b.is_deleted = 0'} ORDER BY b.created_at DESC, b.id DESC`);
}
export async function findBook(db, id) {
  return (await db.query(`${selectBook} WHERE b.id = $1`, [id]))[0];
}
export async function saveBook(db, data, id) {
  const errors = {};
  for (const [field, table, label] of [['author_id', 'authors', 'Author'], ['category_id', 'categories', 'Category']]) {
    if (!(await db.query(`SELECT id FROM ${table} WHERE id = $1`, [data[field]])).length) errors[field] = `${label} does not exist`;
  }
  if (Object.keys(errors).length) return { errors };
  const values = [data.title, data.author_id, data.category_id, data.price, data.description, data.cover_url, data.stock];
  if (id) {
    const rows = await db.query(`UPDATE books SET title=$1, author_id=$2, category_id=$3, price=$4, description=$5, cover_url=$6, stock=$7, updated_at=$8 WHERE id=$9 AND is_deleted=0 RETURNING id`, [...values, Date.now(), id]);
    return rows.length ? { id } : { missing: true };
  }
  const newId = randomUUID(), now = Date.now();
  await db.query(`INSERT INTO books(title,author_id,category_id,price,description,cover_url,stock,updated_at,id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [...values, now, newId, now]);
  return { id: newId };
}
export async function hideBook(db, id) {
  return (await db.query('UPDATE books SET is_deleted=1, updated_at=$1 WHERE id=$2 AND is_deleted=0 RETURNING id', [Date.now(), id])).length > 0;
}

export const BOOKS_PER_PAGE = 12;
export function parseCataloguePage(raw) {
  if (raw === undefined) return 1;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return null;
  return Number(raw);
}
export function parseCatalogueFilters(query) {
  const limits = { q: 200, category: 100, min: 13, max: 13 };
  const filters = {};
  for (const [name, limit] of Object.entries(limits)) {
    const raw = query[name] ?? '';
    if (typeof raw !== 'string' || raw.includes('\0')) {
      return { filters, error: 'Use one value for each search or filter field.' };
    }
    const value = raw.trim();
    if (value.length > limit) return { filters, error: 'A search or filter value is too long.' };
    filters[name] = value;
  }
  const validPrice = value => value === '' ||
    (/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value) && Number(value) <= 9999999999.99);
  if (!validPrice(filters.min) || !validPrice(filters.max)) {
    return { filters, error: 'Enter a non-negative price with up to two decimal places.' };
  }
  if (filters.min && filters.max && Number(filters.min) > Number(filters.max)) {
    return { filters, error: 'Minimum price must be less than or equal to maximum price.' };
  }
  return { filters };
}

export async function listBookPage(db, requestedPage = 1, filters = {}) {
  const conditions = ['b.is_deleted=0'];
  const params = [];
  const bind = value => '$' + params.push(value);
  if (filters.q) {
    const lower = db.dialect === 'sqlite' ? 'unicode_lower' : 'lower';
    const pattern = '%' + filters.q.toLowerCase().replace(/[!%_]/g, '!$&') + '%';
    conditions.push(`(${lower}(b.title) LIKE ${bind(pattern)} ESCAPE '!' OR ${lower}(a.name) LIKE ${bind(pattern)} ESCAPE '!')`);
  }
  if (filters.category) conditions.push(`b.category_id = ${bind(filters.category)}`);
  if (filters.min) conditions.push(`b.price >= ${bind(Number(filters.min))}`);
  if (filters.max) conditions.push(`b.price <= ${bind(Number(filters.max))}`);
  const where = 'WHERE ' + conditions.join(' AND ');
  const [{ total }] = await db.query(`SELECT count(*) AS total ${bookSource} ${where}`, params);
  const totalBooks = Number(total);
  const totalPages = Math.max(1, Math.ceil(totalBooks / BOOKS_PER_PAGE));
  const page = Math.min(requestedPage, totalPages);
  const limit = bind(BOOKS_PER_PAGE);
  const offset = bind((page - 1) * BOOKS_PER_PAGE);
  const books = await db.query(`${selectBook} ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  return { books, page, totalPages, totalBooks, pageSize: BOOKS_PER_PAGE };
}
