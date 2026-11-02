import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDatabase, migrate } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedCatalogue } from '../src/catalogue-seed.js';
import { listBookPage, parseCataloguePage, hideBook, saveBook } from '../src/catalogue.js';
let db,app;
beforeEach(async()=>{db=await openDatabase({url:'',filename:':memory:'});await migrate(db);await seedCatalogue(db);app=createApp({db,secret:'f3-test-secret-at-least-thirty-two-characters',secure:false});});
afterEach(async()=>db.close());
const cards=r=>(r.text.match(/data-book-id=/g)||[]).length;
test('AC-10.1 cards include cover, title, author and formatted VND price',async()=>{
 const r=await request(app).get('/books').expect(200);assert.equal(cards(r),12);
 assert.match(r.text,/One More Chapter/);assert.match(r.text,/Sam Rivers/);assert.match(r.text,/230,000 VND/);assert.match(r.text,/alt="Cover of One More Chapter"/);assert.match(r.text,/width="320" height="440"/);
});
test('AC-10.3 hidden books excluded before counting and pagination',async()=>{
 await hideBook(db,'demo-catalogue-32');const r=await request(app).get('/books').expect(200);assert.equal(cards(r),12);assert.doesNotMatch(r.text,/One More Chapter/);assert.match(r.text,/of 31 books/);assert.equal((await listBookPage(db,3)).books.length,7);
});
test('AC-11.1/11.4 32 active books yield exactly 12,12,8 with usable page controls',async()=>{
 const seen=new Set();for(const [page,count]of [[1,12],[2,12],[3,8]]){
  const r=await request(app).get(`/books?page=${page}`).expect(200);assert.equal(cards(r),count);assert.match(r.text,new RegExp(`Page ${page} of 3`));
  for(const m of r.text.matchAll(/data-book-id="([^"]+)"/g)){assert.ok(!seen.has(m[1]));seen.add(m[1]);}
 }
 assert.equal(seen.size,32);const r=await request(app).get('/books');assert.match(r.text,/aria-label="Page 3"/);assert.match(r.text,/rel="next" href="\/books\?page=2"/);
});
test('AC-11.2 newest-first sort is stable across page boundaries',async()=>{
 const first=await listBookPage(db,1),second=await listBookPage(db,2);
 assert.equal(first.books[0].id,'demo-catalogue-32');assert.equal(first.books[11].id,'demo-catalogue-21');assert.equal(second.books[0].id,'demo-catalogue-20');
 const row=first.books[0];const added=await saveBook(db,{title:'Freshly added',author_id:row.author_id,category_id:row.category_id,price:100000,stock:1,description:'New title',cover_url:'https://example.com/cover.png'});
 assert.equal((await listBookPage(db,1)).books[0].id,added.id);
});
test('Pagination rejects malformed/array/nonpositive/unsafe page inputs',async()=>{
 for(const raw of ['0','-1','1.5','abc','1e3','9007199254740992',''])await request(app).get('/books?page='+encodeURIComponent(raw)).expect(400);
 await request(app).get('/books?page=1&page=2').expect(400);
 assert.equal(parseCataloguePage(undefined),1);assert.equal(parseCataloguePage('2'),2);
});
test('Out-of-range page redirects to last page and empty catalogue remains usable',async()=>{
 await request(app).get('/books?page=999').expect(303).expect('Location','/books?page=3');
 await db.query('UPDATE books SET is_deleted=1');const r=await request(app).get('/books').expect(200);assert.equal(cards(r),0);assert.match(r.text,/No books are available yet/);assert.doesNotMatch(r.text,/aria-label="Book list pages"/);
});
test('Seed is idempotent and preserves edits and hidden state',async()=>{
 await db.query('UPDATE books SET title=$1 WHERE id=$2',['Edited sample','demo-catalogue-01']);await hideBook(db,'demo-catalogue-32');
 const before=(await db.query('SELECT count(*) AS n FROM authors'))[0].n;const result=await seedCatalogue(db);assert.equal(result.inserted,0);
 assert.equal((await db.query('SELECT count(*) AS n FROM books'))[0].n,32);assert.equal((await db.query('SELECT title FROM books WHERE id=$1',['demo-catalogue-01']))[0].title,'Edited sample');assert.equal((await listBookPage(db)).totalBooks,31);assert.equal((await db.query('SELECT count(*) AS n FROM authors'))[0].n,before);
});
test('12-book boundary disables next; 13-book boundary adds a second page',async()=>{
 await db.query('UPDATE books SET is_deleted=1');await db.query('UPDATE books SET is_deleted=0 WHERE id >= $1',['demo-catalogue-21']);
 let r=await request(app).get('/books').expect(200);assert.equal(cards(r),12);assert.match(r.text,/Page 1 of 1/);assert.doesNotMatch(r.text,/rel="next"/);
 await db.query('UPDATE books SET is_deleted=0 WHERE id=$1',['demo-catalogue-20']);r=await request(app).get('/books?page=2').expect(200);assert.equal(cards(r),1);
});
test('Equal timestamps have a deterministic id tie-break',async()=>{
 await db.query('UPDATE books SET created_at=$1',[1000]);const a=await listBookPage(db,1),b=await listBookPage(db,1);assert.deepEqual(a.books.map(x=>x.id),b.books.map(x=>x.id));assert.equal(a.books[0].id,'demo-catalogue-32');
});
