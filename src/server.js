import { runtimeApp } from './runtime.js';
const app = await runtimeApp();
const port = Number(process.env.PORT || 3000);
app.listen(port, '127.0.0.1', () => console.log(`Le Bookstore: http://localhost:${port}`));
