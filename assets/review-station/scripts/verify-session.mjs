import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {extname, resolve} from 'node:path';
import {toViteFsUrl} from './path-utils.mjs';

const manifestPath = resolve('public/review-sessions/current.json');
if (!existsSync(manifestPath)) {
  console.error('缺少 public/review-sessions/current.json，请先运行 npm run load。');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest.videos) || manifest.videos.length === 0) {
  console.error('审片清单中没有视频。');
  process.exit(1);
}

for (const video of manifest.videos) {
  if (!video.sourcePath || !existsSync(video.sourcePath)) {
    console.error(`视频源路径无效：${video.sourcePath || '未填写'}`);
    process.exit(1);
  }
  const expectedUrl = toViteFsUrl(video.sourcePath);
  if (video.videoUrl !== expectedUrl) {
    console.error(`视频访问地址与当前平台路径不一致：${video.videoUrl}`);
    process.exit(1);
  }
}

const mediaExtensions = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi']);
const mediaCopies = [];
const walk = (directory) => {
  if (!existsSync(directory)) return;
  for (const name of readdirSync(directory)) {
    const target = resolve(directory, name);
    if (statSync(target).isDirectory()) walk(target);
    else if (mediaExtensions.has(extname(name).toLowerCase())) mediaCopies.push(target);
  }
};
walk(resolve('public/review-sessions'));

if (mediaCopies.length > 0) {
  console.error('审片会话目录中不应保存视频副本：');
  for (const file of mediaCopies) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`审片会话检查通过，共 ${manifest.videos.length} 条视频，均使用源文件路径。`);
