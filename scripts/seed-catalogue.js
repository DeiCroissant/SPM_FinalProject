import { openDatabase, migrate } from '../src/db.js';
import { seedCatalogue } from '../src/catalogue-seed.js';
const db = await openDatabase();
try {
  await migrate(db);
  const result = await seedCatalogue(db, { baseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000' });
  console.log(`Sample catalogue: ${result.inserted} books added; existing records preserved. Seed contains ${result.sampleSize} titles.`);
} finally { await db.close(); }
