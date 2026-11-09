import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seedCatalogue } from '../src/catalogue-seed.js';
import { listTaxonomy } from '../src/catalogue.js';
import { migrate, openDatabase } from '../src/db.js';

let db, app;
beforeEach(async () => {
  db = await openDatabase({ url: '', filename: ':memory:' });
  await migrate(db);
  await seedCatalogue(db);
  app = createApp({ db, secret: 'a-test-secret-with-more-than-32-characters' });
});
afterEach(() => db.close());

const cards = response => [...response.text.matchAll(/data-book-id="([^"]+)"/g)].map(match => match[1]);
const url = (path, params) => path + '?' + new URLSearchParams(params);

test('F4 detail renders catalogue fields, zero stock, and friendly 404s', async () => {
  const id = 'demo-catalogue-32';
  await db.query('UPDATE books SET stock=0 WHERE id=$1', [id]);
  const detail = await request(app).get(`/books/${id}`).expect(200);
  for (const value of ['One More Chapter', 'Sam Rivers', 'Personal Growth', '230,000 VND',
    'Sample catalogue title 32', 'Cover of One More Chapter', 'Out of Stock']) {
    assert.ok(detail.text.includes(value), value);
  }
  await db.query('UPDATE books SET is_deleted=1 WHERE id=$1', [id]);
  for (const invalidId of [id, '99999', 'abc', '%00']) {
    const missing = await request(app).get(`/books/${invalidId}`).expect(404);
    assert.match(missing.text, /<h1>Book not found<\/h1>/);
    assert.match(missing.text, /href="\/">Back to home/);
    assert.doesNotMatch(missing.text, /Sample catalogue title 32/);
  }
});

test('F5 matches title and author regardless of case, treating SQL wildcards literally', async () => {
  await db.query('UPDATE books SET title=$1 WHERE id=$2', ['ĐƯỜNG 100%_!', 'demo-catalogue-32']);
  const title = await request(app).get(url('/books', { q: '  đường  ' })).expect(200);
  assert.deepEqual(cards(title), ['demo-catalogue-32']);
  const author = await request(app).get(url('/books', { q: 'mAi NgU' })).expect(200);
  assert.equal(cards(author).length, 8);
  const literal = await request(app).get(url('/books', { q: '%_!' })).expect(200);
  assert.deepEqual(cards(literal), ['demo-catalogue-32']);
  const empty = await request(app).get(url('/books', { q: "%' OR 1=1 --" })).expect(200);
  assert.deepEqual(cards(empty), []);
  assert.match(empty.text, /No books found matching your search/);
});

test('F5 filters category and inclusive prices and rejects malformed ranges', async () => {
  const { id } = (await listTaxonomy(db, 'categories')).find(category => category.name === 'Fiction');
  const filtered = await request(app).get(url('/books', { category: id, min: 95000, max: 115000 })).expect(200);
  assert.deepEqual(cards(filtered), ['demo-catalogue-09', 'demo-catalogue-05']);
  const reversed = await request(app).get('/books?min=300000&max=100000').expect(400);
  assert.match(reversed.text, /Minimum price must be less than or equal to maximum price/);
  assert.deepEqual(cards(reversed), []);
  for (const query of ['min=-1', 'max=1e6', 'max=1.001', 'q=a&q=b', 'category=%00']) {
    await request(app).get(`/books?${query}`).expect(400);
  }
});

test('F4/F5 combined filters paginate 12 and 6, preserve list state and reset cleanly', async () => {
  const { id } = (await listTaxonomy(db, 'categories')).find(category => category.name === 'Fiction');
  const matching = 'demo-catalogue-14';
  await db.query('UPDATE books SET title=$1 || title, category_id=$2, price=$3 WHERE id >= $4',
    ['Trial ', id, 120000, matching]);
  await db.query('UPDATE books SET is_deleted=1 WHERE id=$1', ['demo-catalogue-32']);
  const filters = { q: 'trial', category: id, min: 100000, max: 200000 };
  const first = await request(app).get(url('/books', filters)).expect(200);
  assert.equal(cards(first).length, 12);
  assert.match(first.text, /Showing 1–12 of 18 books/);
  const nextUrl = first.text.match(/rel="next" href="([^"]+)"/)[1].replaceAll('&amp;', '&');
  const second = await request(app).get(nextUrl).expect(200);
  assert.equal(cards(second).length, 6);
  assert.equal(new Set([...cards(first), ...cards(second)]).size, 18);
  assert.match(second.text, /Showing 13–18 of 18 books/);
  const detailUrl = second.text.match(/class="catalogue-cover" href="([^"]+)"/)[1].replaceAll('&amp;', '&');
  const detail = await request(app).get(detailUrl).expect(200);
  const back = detail.text.match(/class="back-link" href="([^"]+)"/)[1].replaceAll('&amp;', '&');
  assert.equal(back, nextUrl);
  assert.deepEqual(cards(await request(app).get(back).expect(200)), cards(second));
  await request(app).get(url('/books', { ...filters, page: 99 })).expect(303).expect('Location', nextUrl);
  assert.match(second.text, /href="\/books">Clear filters<\/a>/);
  assert.match((await request(app).get('/books').expect(200)).text, /Showing 1–12 of 31 books/);
});
