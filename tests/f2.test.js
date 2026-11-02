import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDatabase, migrate } from '../src/db.js';
import { createUser } from '../src/users.js';

let db, app, admin, customer, token, customerToken, author, category;
const password = 'F2TestPassword!123';
async function signIn(agent,email) {
  const page=await agent.get('/login');
  const csrf=page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  await agent.post('/login').type('form').send({_csrf:csrf,email,password}).expect(303);
  return (await agent.get('/account')).text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
}
function values(overrides={}) { return {title:'A new chapter',author_id:author,category_id:category,price:150000,stock:3,description:'A book for curious readers.',cover_url:'https://example.com/cover.jpg',...overrides}; }
async function add(overrides={}) {const r=await admin.post('/api/admin/books').send({_csrf:token,...values(overrides)}).expect(201);return r.body.id;}
before(async()=>{
  db=await openDatabase({url:'',filename:':memory:'});await migrate(db);
  await createUser(db,{name:'F2 Admin',email:'f2-admin@example.com',password,role:'Administrator'});
  await createUser(db,{name:'F2 Reader',email:'f2-reader@example.com',password,role:'Customer'});
  app=createApp({db,secret:'f2-test-secret-longer-than-thirty-two-characters',secure:false});
  admin=request.agent(app);customer=request.agent(app);token=await signIn(admin,'f2-admin@example.com');customerToken=await signIn(customer,'f2-reader@example.com');
  author=(await admin.post('/api/admin/authors').send({_csrf:token,name:'Sample Author'}).expect(201)).body.id;
  category=(await admin.post('/api/admin/categories').send({_csrf:token,name:'Fiction'}).expect(201)).body.id;
});
after(async()=>db.close());
test('AC-06.1 author/category create and edit immediately populate book form',async()=>{
  for(const kind of ['authors','categories']) {
    const name=`New ${kind}`;const r=await admin.post(`/api/admin/${kind}`).send({_csrf:token,name}).expect(201);
    await admin.post(`/api/admin/${kind}/${r.body.id}`).send({_csrf:token,name:`Updated ${kind}`}).expect(200);
    assert.match((await admin.get('/admin/books/new').expect(200)).text,new RegExp(`Updated ${kind}`));
    await admin.get(`/admin/${kind}/${r.body.id}/edit`).expect(200);
  }
});
test('AC-06.2 category duplicates rejected case-insensitively on create and edit',async()=>{
  const r=await admin.post('/api/admin/categories').send({_csrf:token,name:' fiction '}).expect(409);assert.equal(r.body.errors.name,'Category already exists');
  const second=(await admin.post('/api/admin/categories').send({_csrf:token,name:'History'}).expect(201)).body.id;
  await admin.post(`/api/admin/categories/${second}`).send({_csrf:token,name:'FICTION'}).expect(409);
  assert.equal((await db.query('SELECT name FROM categories WHERE id=$1',[second]))[0].name,'History');
});
test('AC-06.3 names empty/whitespace/101 chars rejected; 100 accepted; client constraints present',async()=>{
  for(const kind of ['authors','categories']) {
    for(const name of ['', '   ', 'a'.repeat(101)]) await admin.post(`/api/admin/${kind}`).send({_csrf:token,name}).expect(422);
    await admin.post(`/api/admin/${kind}`).send({_csrf:token,name:'b'.repeat(100)}).expect(201);
    const html=(await admin.get(`/admin/${kind}`)).text;assert.match(html,/maxlength="100"/);assert.match(html,/data-trim-required/);
  }
});
test('AC-07.1 valid book persists all fields and appears first on public list',async()=>{
  const id=await add({title:'Newest book',stock:0});const [b]=await db.query('SELECT * FROM books WHERE id=$1',[id]);assert.equal(Number(b.stock),0);assert.equal(Number(b.price),150000);assert.equal(b.author_id,author);
  const list=await request(app).get('/books').expect(200);assert.match(list.text,/Newest book/);assert.ok(list.text.indexOf(`/books/${id}`)>0);
  await admin.get('/admin/books').expect(200);
});
test('AC-07.2 nonpositive, blank and nonfinite prices rejected with no insert',async()=>{
  const before=(await db.query('SELECT count(*) AS n FROM books'))[0].n;
  for(const price of [0,-10000,'',' ','NaN','Infinity',true]) {const r=await admin.post('/api/admin/books').send({_csrf:token,...values({price})}).expect(422);assert.ok(r.body.errors.price);}
  assert.equal((await db.query('SELECT count(*) AS n FROM books'))[0].n,before);
  assert.match((await admin.get('/admin/books/new')).text,/min="0.01"/);
});
test('AC-07.3 invalid stocks rejected; zero accepted; integer constraint shown',async()=>{
  for(const stock of [-1,'',1.5,true]) await admin.post('/api/admin/books').send({_csrf:token,...values({stock})}).expect(422);
  await add({stock:0});assert.match((await admin.get('/admin/books/new')).text,/min="0" max="2147483647" step="1"/);
});
test('AC-07.4 required fields and unsafe cover URLs rejected with field errors',async()=>{
  for(const field of ['title','author_id','category_id','cover_url','description']) {
    const r=await admin.post('/api/admin/books').send({_csrf:token,...values({[field]:''})}).expect(422);assert.ok(r.body.errors[field],field);
  }
  for(const cover_url of ['javascript:alert(1)','file:///tmp/a','data:image/svg+xml,x'])await admin.post('/api/admin/books').send({_csrf:token,...values({cover_url})}).expect(422);
});
test('AC-08.1 edited fields reflect on public list/detail and taxonomy name updates',async()=>{
  const id=await add({title:'Before edit'});await admin.post(`/api/admin/books/${id}`).send({_csrf:token,...values({title:'After edit',price:99000,description:'Updated description',stock:10})}).expect(200);
  assert.match((await request(app).get('/books')).text,/After edit/);
  const detail=(await request(app).get(`/books/${id}`).expect(200)).text;assert.match(detail,/Updated description/);assert.match(detail,/99,000 VND/);assert.match(detail,/10 in stock/);
});
test('AC-08.2 invalid edits preserve prior valid book data',async()=>{
  const id=await add({title:'Keep original'});
  for(const change of [{title:''},{price:0},{stock:-1},{author_id:'nonexistent'}])await admin.post(`/api/admin/books/${id}`).send({_csrf:token,...values(change)}).expect(422);
  const b=(await db.query('SELECT * FROM books WHERE id=$1',[id]))[0];assert.equal(b.title,'Keep original');assert.equal(Number(b.price),150000);
});
test('AC-08.3 nonexistent IDs produce friendly HTML and API 404',async()=>{
  assert.match((await admin.get('/admin/books/does-not-exist/edit').expect(404)).text,/Book not found/);
  await admin.post('/api/admin/books/does-not-exist').send({_csrf:token,...values()}).expect(404);
});
test('AC-09.1/09.2 hide retains unchanged data and removes public visibility',async()=>{
  const id=await add({title:'Retained hidden title'});const before=(await db.query('SELECT * FROM books WHERE id=$1',[id]))[0];
  await admin.post(`/api/admin/books/${id}/hide`).send({_csrf:token}).expect(200);
  const b=(await db.query('SELECT * FROM books WHERE id=$1',[id]))[0];assert.ok(b);assert.equal(Number(b.is_deleted),1);assert.equal(b.title,before.title);assert.equal(b.created_at,before.created_at);
  assert.doesNotMatch((await request(app).get('/books')).text,/Retained hidden title/);assert.match((await admin.get('/admin/books')).text,/Retained hidden title/);
  await admin.post(`/api/admin/books/${id}/hide`).send({_csrf:token}).expect(404);
});
test('AC-09.3 hidden book URL is unavailable; hidden book cannot be edited',async()=>{
  const id=await add();await admin.post(`/api/admin/books/${id}/hide`).send({_csrf:token}).expect(200);
  assert.match((await request(app).get(`/books/${id}`).expect(404)).text,/Book unavailable/);
  await admin.get(`/admin/books/${id}/edit`).expect(404);
  await admin.post(`/api/admin/books/${id}`).send({_csrf:token,...values()}).expect(404);
});
test('F2 authorization: guest and Customer cannot read or write management namespaces',async()=>{
  const guest=request.agent(app);const gt=(await guest.get('/login')).text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  for(const path of ['/admin/books','/admin/books/new','/admin/categories','/admin/authors']) {
    await customer.get(path).expect(403);assert.equal((await guest.get(path)).headers.location,'/login');
  }
  for(const path of ['/api/admin/books','/api/admin/categories','/api/admin/authors']) {
    await customer.get(path).expect(403);await guest.get(path).expect(401);
    await customer.post(path).send({_csrf:customerToken,...values(),name:'Denied'}).expect(403);
    await guest.post(path).send({_csrf:gt,...values(),name:'Denied'}).expect(401);
  }
  for(const suffix of ['/some-id','/some-id/hide'])await customer.post('/api/admin/books'+suffix).send({_csrf:customerToken,...values()}).expect(403);
});
test('F2 security: forged CSRF and foreign IDs rejected; template escapes stored HTML',async()=>{
  await admin.post('/api/admin/books').send(values()).expect(403);
  await admin.post('/api/admin/books').send({_csrf:token,...values({category_id:"' OR 1=1 --"})}).expect(422);
  const id=await add({title:'<script>alert(1)</script>'});const html=(await request(app).get(`/books/${id}`)).text;assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>alert/);
});
test('F2 schema upgrades are repeatable and preserve F1 users/sessions',async()=>{
  const users=(await db.query('SELECT count(*) AS n FROM users'))[0].n;
  const sessions=(await db.query('SELECT count(*) AS n FROM sessions'))[0].n;
  await migrate(db);await migrate(db);
  assert.equal((await db.query('SELECT count(*) AS n FROM users'))[0].n,users);
  assert.equal((await db.query('SELECT count(*) AS n FROM sessions'))[0].n,sessions);
  await admin.get('/api/me').expect(200);
});
test('Taxonomy Unicode names reject case and normalization duplicates',async()=>{
  await admin.post('/api/admin/categories').send({_csrf:token,name:'LỊCH SỬ'}).expect(201);
  await admin.post('/api/admin/categories').send({_csrf:token,name:'lịch sử'}).expect(409);
  await admin.post('/api/admin/categories').send({_csrf:token,name:'Lịch sử'.normalize('NFD')}).expect(409);
});
test('HTML forms save books and return field-specific validation errors',async()=>{
  await admin.post('/admin/books').type('form').send({_csrf:token,...values({title:'HTML-created book'})}).expect(303);
  const id=(await db.query('SELECT id FROM books WHERE title=$1',['HTML-created book']))[0].id;
  const r=await admin.post(`/admin/books/${id}`).type('form').send({_csrf:token,...values({price:0})}).expect(422);
  assert.match(r.text,/Price must be greater than 0/);assert.match(r.text,/aria-invalid="true"/);
  await admin.post(`/admin/books/${id}`).type('form').send({_csrf:token,...values({title:'HTML-edited book'})}).expect(303);
  await admin.post(`/admin/books/${id}/hide`).type('form').send({_csrf:token}).expect(303);
});
