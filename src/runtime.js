import { openDatabase, migrate } from './db.js';
import { createApp } from './app.js';

// Initialization is shared within an instance; migrations and seeding are explicit commands.
let ready;
export function runtimeApp() {
  ready ||= (async () => {
    const db = await openDatabase();
    if (!process.env.DATABASE_URL) await migrate(db);
    return createApp({ db, secret: process.env.SESSION_SECRET });
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}
