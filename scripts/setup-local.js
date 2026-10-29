import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('.env already exists; kept unchanged.');
} else {
  writeFileSync('.env', `PORT=3000\nAPP_ORIGIN=http://localhost:3000\nSESSION_SECRET=${randomBytes(32).toString('hex')}\nSQLITE_PATH=data/bookstore.sqlite\nADMIN_EMAIL=admin@lebookstore.local\nADMIN_PASSWORD=Admin!${randomBytes(12).toString('base64url')}\nCUSTOMER_EMAIL=customer@lebookstore.local\nCUSTOMER_PASSWORD=Reader!${randomBytes(12).toString('base64url')}\n`, { mode: 0o600 });
  console.log('Created .env. Local demo credentials are in .env (never commit this file).');
}
