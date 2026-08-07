import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const args = process.argv.slice(2);
const titleIndex = args.indexOf('--title');
let titleArg = titleIndex >= 0 ? args.slice(titleIndex + 1).join(' ').trim() : '';
let inputPaths = (titleIndex >= 0 ? args.slice(0, titleIndex) : args).filter(Boolean);

if (titleIndex < 0 && args.length > 1 && existsSync(resolve(args[0]))) {
  const maybeFiles = args.map((item) => existsSync(resolve(item)));
  if (!maybeFiles.slice(1).every(Boolean)) {
    inputPaths = [args[0]];
    titleArg = args.slice(1).join(' ').trim();
  }
}

if (!inputPaths.length) {
  console.error('用法: node scripts/create-review-session.mjs <视频文件路径...> --title <项目标题>');
  process.exit(1);
}

const missingPaths = inputPaths.map((inputPath) => resolve(inputPath)).filter((inputPath) => !existsSync(inputPath));

if (missingPaths.length) {
  console.error(`找不到视频源文件:\n${missingPaths.join('\n')}`);
  process.exit(1);
}

const firstSourcePath = resolve(inputPaths[0]);
const firstExt = extname(firstSourcePath) || '.mp4';
const title = titleArg || basename(firstSourcePath, firstExt);
const sessionDir = resolve('public/review-sessions');

mkdirSync(sessionDir, { recursive: true });

const videos = inputPaths.map((inputPath, index) => {
  const sourcePath = resolve(inputPath);
  const ext = extname(sourcePath) || '.mp4';
  const sourceTitle = basename(sourcePath, ext);
  return {
    id: `video-${index + 1}`,
    title: sourceTitle,
    sourcePath,
    videoUrl: encodeURI(`/@fs${sourcePath}`),
    scenes: [
      {
        id: 'full',
        title: '完整预览',
        start: 0,
        end: 0,
      },
    ],
  };
});

const manifest = {
  title,
  createdAt: new Date().toISOString(),
  videos,
};

writeFileSync(resolve('public/review-sessions/current.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`已创建预览会话: ${title}`);
console.log(`视频数量: ${videos.length}`);
