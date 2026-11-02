import { saveTaxonomy, listTaxonomy } from './catalogue.js';

// Explicit, additive demo seed. Never overwrites, unhides or resets existing records.
export async function seedCatalogue(db, { baseUrl = 'http://localhost:3000' } = {}) {
  const cover = new URL('/book-cover-placeholder.svg', baseUrl);
  if (!['http:', 'https:'].includes(cover.protocol)) throw new Error('Seed base URL must use http or https.');
  const categories = ['Fiction', 'Science', 'History', 'Personal Growth'];
  const authors = ['Mai Nguyen', 'Alex Morgan', 'Linh Tran', 'Sam Rivers'];
  const ids = {};
  for (const [kind, names] of [['categories', categories], ['authors', authors]]) {
    ids[kind] = [];
    for (const name of names) {
      const result = await saveTaxonomy(db, kind, { name });
      const existing = result.id || (await listTaxonomy(db, kind)).find(v => v.name.normalize('NFC').toLowerCase() === name.toLowerCase())?.id;
      if (!existing) throw new Error('Could not resolve sample taxonomy');
      ids[kind].push(existing);
    }
  }
  const titles = ['The Quiet Library','A Map of Tomorrow','Small Wonders','Letters from Home','The Art of Beginning','Beyond the Horizon','A Curious Mind','The Last Orchard','Notes on a Changing World','The Long Way Back','Light through the Leaves','A Practical Kind of Hope','The Hidden Garden','Under the Same Sky','Learning to Listen','The Shape of Time','Everyday Discoveries','Between Two Rivers','A History of Simple Things','Where Stories Begin','The Patient Observer','Wild Ideas','The Open Window','The Joy of Making','Cities and Their Secrets','A Walk through Science','The Memory of Rain','Thinking in New Directions','The Paper Trail','Days of Possibility','The World Next Door','One More Chapter'];
  let inserted = 0;
  for (let i = 0; i < titles.length; i++) {
    const id = `demo-catalogue-${String(i + 1).padStart(2,'0')}`;
    const time = Date.UTC(2026, 9, 1) + i * 60000;
    const rows = await db.query(`INSERT INTO books(id,title,author_id,category_id,price,description,cover_url,stock,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [id,titles[i],ids.authors[i % authors.length],ids.categories[i % categories.length],75000+i*5000,`Sample catalogue title ${i+1}. A demonstration book for browsing and acceptance testing.`,cover.href,5+i,time,time]);
    inserted += rows.length;
  }
  return { inserted, sampleSize: titles.length };
}
