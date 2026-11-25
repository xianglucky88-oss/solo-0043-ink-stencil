import { start } from '../server.mjs';

const server = await start();
console.log(`http://127.0.0.1:${server.address().port}`);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close());
}
