import { execSync } from 'child_process';
import { cpSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(__dirname, '../../contracts/openapi.yaml');
const outputPath = resolve(__dirname, '../src/generated/api-types.ts');

execSync(`npx openapi-typescript ${contractPath} -o ${outputPath}`, {
  stdio: 'inherit',
});

console.log('Backend API types generated at src/generated/api-types.ts');

// Copy shared TS modules from `shared/` (repo root) into `src/generated/shared/`.
// `shared/` is the single source of truth — both packages get their own compiled copy
// via this gen step so each side compiles normally against its own filesystem.
const sharedSrc = resolve(__dirname, '../../shared');
const sharedDst = resolve(__dirname, '../src/generated/shared');
mkdirSync(sharedDst, { recursive: true });
for (const file of readdirSync(sharedSrc)) {
  if (!file.endsWith('.ts')) continue;
  cpSync(join(sharedSrc, file), join(sharedDst, file));
}
console.log('Backend shared modules copied to src/generated/shared/');
