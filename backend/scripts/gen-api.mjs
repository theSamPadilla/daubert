import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(__dirname, '../../contracts/openapi.yaml');
const outputPath = resolve(__dirname, '../src/generated/api-types.ts');

execSync(`npx openapi-typescript ${contractPath} -o ${outputPath}`, {
  stdio: 'inherit',
});

console.log('Backend API types generated at src/generated/api-types.ts');
