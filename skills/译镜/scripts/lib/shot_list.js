#!/usr/bin/env node
// 拉片：找出所有切点，列镜头表（序号、开始、结束、时长），每个镜头抽中间一帧，拼成带编号的宫格图。需要 ffmpeg / ffprobe。
// 竖屏版：竖画面（或裁出来是竖的）按 10×2 拼，一张 20 镜；横画面照旧 5×4。
// 横屏样片想看裁成竖屏能留下什么：--crop ih*9/16:ih（裁出中间的竖条）
// 用法：node shot_list.js <视频> <输出文件夹> [--threshold 0.28] [--crop w:h:x:y] [--from 秒] [--to 秒]
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const [video, outDir] = argv;
if (!video || !outDir) { console.error('用法：node shot_list.js <视频> <输出文件夹> [--threshold 0.28] [--crop w:h:x:y] [--from 秒] [--to 秒]'); process.exit(2); }
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const T = +opt('--threshold', 0.28), crop = opt('--crop', ''), from = +opt('--from', 0), to = opt('--to', '');
fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
const abs = path.resolve(video);
const run = (args, cwd) => execFileSync('ffmpeg', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/arial.ttf':" : '';

const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', abs], { encoding: 'utf8' }));
const dur = +probe.format.duration, end = to ? Math.min(+to, dur) : dur;
// 判断拼图按竖还是横：有 --crop 就看裁出来的宽高（iw、ih 换成原片尺寸再算），否则看原片
const vs = probe.streams.find(s => s.codec_type === 'video') || {};
const evalDim = e => {
  const s = String(e).replace(/\b(iw|in_w)\b/g, vs.width).replace(/\b(ih|in_h)\b/g, vs.height);
  return /^[\d.+\-*/() ]+$/.test(s) ? Function('return (' + s + ')')() : NaN;
};
let tall = vs.height > vs.width;
if (crop) { const [cw, ch] = crop.split(':').map(evalDim); if (cw > 0 && ch > 0) tall = ch > cw; }

// 切点
const pre = crop ? `crop=${crop},` : '';
run(['-hide_banner', '-v', 'error', '-y', '-ss', String(from), '-to', String(end), '-i', abs, '-vf', `${pre}scale=320:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=scores.txt`, '-an', '-f', 'null', '-'], path.resolve(outDir));
const lines = fs.readFileSync(path.join(outDir, 'scores.txt'), 'utf8').split(/\r?\n/);
let tc = 0; const cuts = [];
for (const l of lines) {
  const m = l.match(/pts_time:([0-9.]+)/); if (m) tc = +m[1] + from;
  const s = l.match(/scene_score=([0-9.]+)/);
  if (s && +s[1] > T && tc - from > 0.1 && (!cuts.length || tc - cuts[cuts.length - 1] > 0.25)) cuts.push(tc);
}
const bounds = [from, ...cuts, end];
const shots = [];
for (let i = 0; i + 1 < bounds.length; i++) shots.push({ n: i + 1, a: bounds[i], b: bounds[i + 1], d: bounds[i + 1] - bounds[i] });

// 每镜中间一帧
for (const s of shots) {
  const mid = s.a + s.d / 2;
  const label = `#${s.n}  ${s.a.toFixed(2)}s  ${s.d.toFixed(2)}s`;
  run(['-hide_banner', '-v', 'error', '-y', '-ss', mid.toFixed(3), '-i', abs, '-frames:v', '1',
    '-vf', `${pre}${tall ? 'scale=216:-2' : 'scale=384:-2'},drawtext=${font}text='${label}':x=6:y=6:fontsize=${tall ? 16 : 20}:fontcolor=yellow:box=1:boxcolor=black@0.65`,
    path.join(outDir, 'frames', `f_${String(s.n).padStart(4, '0')}.png`)]);
}
// 拼图：一张 20 镜；横画面 5×4，竖画面 10×2
const per = 20, sheets = Math.ceil(shots.length / per);
for (let k = 0; k < sheets; k++) {
  run(['-hide_banner', '-v', 'error', '-y', '-start_number', String(k * per + 1), '-i', path.join(outDir, 'frames', 'f_%04d.png'),
    '-frames:v', '1', '-vf', `${tall ? 'tile=10x2' : 'tile=5x4'}:padding=4:color=white`, path.join(outDir, `shots_${String(k + 1).padStart(2, '0')}.png`)]);
}
// 镜头表
const csv = ['序号,开始,结束,时长'].concat(shots.map(s => `${s.n},${s.a.toFixed(2)},${s.b.toFixed(2)},${s.d.toFixed(2)}`)).join('\n');
fs.writeFileSync(path.join(outDir, 'shots.csv'), csv, 'utf8');
const ds = shots.map(s => s.d).sort((x, y) => x - y);
const med = ds[Math.floor(ds.length / 2)], avg = ds.reduce((x, y) => x + y, 0) / ds.length;
console.log(`${path.basename(video)}：${(end - from).toFixed(1)} 秒，${shots.length} 个镜头，平均 ${avg.toFixed(2)} 秒，中位 ${med.toFixed(2)} 秒，最短 ${ds[0].toFixed(2)}，最长 ${ds[ds.length - 1].toFixed(2)}`);
console.log(`宫格图 ${sheets} 张：${path.join(outDir, 'shots_01.png')} …；镜头表：${path.join(outDir, 'shots.csv')}`);
