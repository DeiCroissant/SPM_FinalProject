import { Router } from 'express';
import { taxonomySchema, bookSchema, listTaxonomy, saveTaxonomy, taxonomyLabel, listBooks, findBook, saveBook, hideBook, parseCataloguePage, parseCatalogueFilters, listBookPage } from './catalogue.js';
import { fieldErrors } from './users.js';

function catalogueUrl(path, filters, page) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value) params.set(name, value);
  }
  if (page !== undefined) params.set('page', page);
  return params.size ? `${path}?${params}` : path;
}

export function catalogueRouter(db) {
  const router = Router();
  const isApi = req => req.originalUrl.startsWith('/api/');
  const missing = (req, res, message = 'Book not found') => isApi(req) ? res.status(404).json({ error: message }) : res.status(404).render('error', { title: message, code: 404, message });
  for (const kind of ['categories', 'authors']) {
    const label = taxonomyLabel(kind);
    async function render(res, options = {}) {
      return res.status(options.status || 200).render('taxonomy', { title: `Manage ${kind}`, kind, label, items: await listTaxonomy(db, kind), errors: {}, values: {}, editing: null, ...options });
    }
    router.get(`/admin/${kind}`, (req, res) => render(res, { message: req.query.saved === '1' ? `${label} saved.` : null }));
    router.get(`/api/admin/${kind}`, async (req, res) => res.json({ items: await listTaxonomy(db, kind) }));
    router.get(`/admin/${kind}/:id/edit`, async (req, res) => {
      const item = (await listTaxonomy(db, kind)).find(i => i.id === req.params.id);
      if (!item) return missing(req, res, `${label} not found`);
      return render(res, { values: item, editing: item.id });
    });
    async function save(req, res) {
      const parsed = taxonomySchema.safeParse(req.body);
      const values = { name: typeof req.body.name === 'string' ? req.body.name : '' };
      let outcome = parsed.success ? await saveTaxonomy(db, kind, parsed.data, req.params.id) : { errors: fieldErrors(parsed) };
      if (outcome.missing) return missing(req, res, `${label} not found`);
      if (outcome.errors) {
        const status = outcome.errors.name?.includes('already exists') ? 409 : 422;
        return isApi(req) ? res.status(status).json({ errors: outcome.errors }) : render(res, { status, errors: outcome.errors, values, editing: req.params.id || null });
      }
      return isApi(req) ? res.status(req.params.id ? 200 : 201).json({ id: outcome.id }) : res.redirect(303, `/admin/${kind}?saved=1`);
    }
    router.post(`/admin/${kind}`, save); router.post(`/admin/${kind}/:id`, save);
    router.post(`/api/admin/${kind}`, save); router.post(`/api/admin/${kind}/:id`, save);
  }
  async function renderBook(res, options = {}) {
    return res.status(options.status || 200).render('book-form', { title: options.editing ? 'Edit book' : 'Add book',
      categories: await listTaxonomy(db, 'categories'), authors: await listTaxonomy(db, 'authors'), errors: {}, values: {}, editing: null, ...options });
  }
  router.get('/admin/books', async (req, res) => res.render('books-admin', { title: 'Book management', books: await listBooks(db, { admin: true }), message: req.query.saved === '1' ? 'Book saved.' : req.query.hidden === '1' ? 'Book hidden. The record has been kept.' : null }));
  router.get('/api/admin/books', async (req, res) => res.json({ books: await listBooks(db, { admin: true }) }));
  router.get('/admin/books/new', (req, res) => renderBook(res));
  router.get('/admin/books/:id/edit', async (req, res) => {
    const book = await findBook(db, req.params.id);
    if (!book || Number(book.is_deleted)) return missing(req, res);
    return renderBook(res, { editing: book.id, values: book });
  });
  async function save(req, res) {
    if (req.params.id) {
      const book = await findBook(db, req.params.id);
      if (!book || Number(book.is_deleted)) return missing(req, res);
    }
    const parsed = bookSchema.safeParse(req.body);
    const values = Object.fromEntries(['title','author_id','category_id','price','description','cover_url','stock'].map(k => [k, ['string','number'].includes(typeof req.body[k]) ? req.body[k] : '']));
    const result = parsed.success ? await saveBook(db, parsed.data, req.params.id) : { errors: fieldErrors(parsed) };
    if (result.missing) return missing(req, res);
    if (result.errors) return isApi(req) ? res.status(422).json({ errors: result.errors }) : renderBook(res, { status: 422, errors: result.errors, values, editing: req.params.id || null });
    return isApi(req) ? res.status(req.params.id ? 200 : 201).json({ id: result.id }) : res.redirect(303, '/admin/books?saved=1');
  }
  router.post('/admin/books', save); router.post('/admin/books/:id', save);
  router.post('/api/admin/books', save); router.post('/api/admin/books/:id', save);
  async function hide(req, res) {
    if (!await hideBook(db, req.params.id)) return missing(req, res);
    return isApi(req) ? res.json({ id: req.params.id, hidden: true }) : res.redirect(303, '/admin/books?hidden=1');
  }
  router.post('/admin/books/:id/hide', hide); router.post('/api/admin/books/:id/hide', hide);
  router.get('/books', async (req, res) => {
    const requested = parseCataloguePage(req.query.page);
    if (requested === null) return res.status(400).render('error', { title: 'Invalid page', code: 400, message: 'Choose a positive whole page number.' });
    const { filters, error } = parseCatalogueFilters(req.query);
    const result = error ? { books: [], totalBooks: 0 } : await listBookPage(db, requested, filters);
    const pageUrl = page => catalogueUrl('/books', filters, page);
    if (!error && result.page !== requested) return res.redirect(303, pageUrl(result.page));
    return res.status(error ? 400 : 200).render('books-public', {
      title: 'Browse books', ...result, filters, error, pageUrl,
      categories: await listTaxonomy(db, 'categories'),
      detailUrl: id => catalogueUrl(`/books/${encodeURIComponent(id)}`, filters, requested > 1 ? requested : undefined)
    });
  });
  router.get('/books/:id', async (req, res) => {
    const id = req.params.id;
    const book = id.includes('\0') ? undefined : await findBook(db, id);
    if (!book || Number(book.is_deleted)) {
      return res.status(404).render('error', {
        title: 'Book not found', code: 404, message: book ? 'Book unavailable.' : 'This book could not be found.'
      });
    }
    const page = parseCataloguePage(req.query.page);
    const { filters, error } = parseCatalogueFilters(req.query);
    const backUrl = error || page === null ? '/books' : catalogueUrl('/books', filters, page > 1 ? page : undefined);
    return res.render('book-detail', { title: book.title, book, backUrl });
  });
  return router;
}
