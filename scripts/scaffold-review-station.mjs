import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const targetArg = process.argv[2];

if (!targetArg) {
  console.error('用法: node scripts/scaffold-review-station.mjs <目标目录>');
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(scriptDir, '../assets/review-station');
const targetDir = resolve(targetArg);

if (!existsSync(sourceDir)) {
  console.error(`找不到审片台模板: ${sourceDir}`);
  process.exit(1);
}

if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
  console.error(`目标目录不是空目录，已停止以避免覆盖: ${targetDir}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });

console.log(`审片台已建立: ${targetDir}`);
console.log('下一步: cd 到目标目录，运行 npm install、npm run build、npm run station。');
