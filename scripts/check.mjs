import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const required = ['index.html', 'styles.css', 'js/app.js', 'js/models.js', 'js/storage.js', 'js/auth.js', 'js/auth-routes.js', 'js/repository.js', 'js/research-history.js', 'js/audience-review.js', 'js/client/context.js', 'js/client/intelligence.js', 'js/client/campaign.js', 'server/config.mjs', 'server/firebase-auth.mjs', 'firebase.json', 'firebase/firestore.rules', 'js/services/audience.js', 'js/prompts/audience.js', 'js/services/opportunity.js', 'js/prompts/opportunity.js', 'js/services/campaign.js', 'js/prompts/campaign.js'];
for (const file of required) {
  await access(join(process.cwd(), file));
}

const sourceFiles = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') await collect(fullPath);
    if (entry.isFile() && /\.(html|css|js|mjs)$/.test(entry.name) && !fullPath.includes('scripts')) sourceFiles.push(fullPath);
  }
}
await collect(process.cwd());

for (const file of sourceFiles) {
  const contents = await (await import('node:fs/promises')).readFile(file, 'utf8');
  if (/\bsk-[A-Za-z0-9]{20,}/.test(contents) || /AIza[A-Za-z0-9_-]{20,}/.test(contents)) {
    throw new Error(`Potential secret found in ${file}`);
  }
}

const browserFiles = ['js/app.js', 'js/storage.js', 'js/auth.js', 'js/auth-routes.js', 'js/repository.js', 'js/research-history.js', 'js/audience-review.js', 'js/client/context.js', 'js/client/intelligence.js', 'js/client/campaign.js'];
for (const file of browserFiles) {
  const contents = await (await import('node:fs/promises')).readFile(join(process.cwd(), file), 'utf8');
  if (/FIREBASE_ADMIN|PRIVATE_KEY|client_email|service_account|AI_API_KEY|SEARCH_API_KEY|service_role|api_key|X-API-KEY|google\.serper\.dev|api\.tavily\.com/i.test(contents)) {
    throw new Error(`Provider credentials or endpoints must remain server-side: ${file}`);
  }
}

console.log(`Checked ${sourceFiles.length} source files. No obvious secrets found.`);
