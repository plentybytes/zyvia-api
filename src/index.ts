import { buildApp } from './app.js';
import { config } from './config/index.js';

async function start() {
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`Zyvia API listening on port ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
