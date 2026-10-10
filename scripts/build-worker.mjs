import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(project, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'server'), { recursive: true });
cpSync(join(project, 'index.html'), join(dist, 'index.html'));
cpSync(join(project, 'styles.css'), join(dist, 'styles.css'));
cpSync(join(project, 'js'), join(dist, 'js'), { recursive: true });
cpSync(join(project, 'js'), join(dist, 'server', 'js'), { recursive: true });
cpSync(join(project, 'server', 'config.mjs'), join(dist, 'server', 'config.mjs'));
cpSync(join(project, 'server', 'firebase-auth.mjs'), join(dist, 'server', 'firebase-auth.mjs'));
cpSync(join(project, 'server', 'feedback.mjs'), join(dist, 'server', 'feedback.mjs'));
cpSync(join(project, 'server', 'worker.mjs'), join(dist, 'server', 'worker.mjs'));
const workerPath = join(dist, 'server', 'worker.mjs');
const workerSource = readFileSync(workerPath, 'utf8')
  .replaceAll("from '../js/", "from './js/")
  .replaceAll('from "../js/', 'from "./js/');
writeFileSync(workerPath, workerSource);
writeFileSync(join(dist, 'server', 'index.js'), "export { default } from './worker.mjs';\nexport * from './worker.mjs';\n");

console.log(`Worker build written to ${dist}`);
