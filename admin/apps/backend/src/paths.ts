import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
let directory = dirname(fileURLToPath(import.meta.url));
while (!existsSync(resolve(directory, 'crouton.json'))) {
  const parent = dirname(directory);
  if (parent === directory) throw new Error('Cannot locate BantuLex project root');
  directory = parent;
}
export const root = directory;
export const databasePath = resolve(root, process.env.DATABASE_PATH || 'data/bantulex.db');
