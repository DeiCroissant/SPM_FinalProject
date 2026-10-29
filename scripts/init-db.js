import { openDatabase, migrate } from '../src/db.js';
import { seedUsers } from '../src/users.js';
const db = await openDatabase();
try {
  await migrate(db);
  await seedUsers(db);
  console.log('Database initialized. Configured demo accounts created if absent; existing accounts kept.');
} finally { await db.close(); }
