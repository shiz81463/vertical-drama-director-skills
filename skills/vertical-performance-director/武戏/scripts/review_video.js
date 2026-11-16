#!/usr/bin/env node
// 看片：读参数、找实际切点、每 0.5 秒拼一张宫格图、切点前后每 0.125 秒拼一张图。需要 ffmpeg / ffprobe。
// 竖屏版：竖画面按 8×2 拼（一张 8 秒）、切点前后按 8×1 拼，图不会太高；成片不是竖的会提醒。横屏片也照样能看。
// 用法：node review_video.js <视频.mp4> <输出文件夹> [--frames 0,6,11]   （--frames：再抽这些秒的全分辨率单帧）
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [video, outDir, ...rest] = process.argv.slice(2);
if (!video || !outDir) { console.error('用法：node review_video.js <视频.mp4> <输出文件夹> [--frames 0,6,11]'); process.exit(2); }
const fi = rest.indexOf('--frames');
const singles = fi >= 0 ? (rest[fi + 1] || '').split(',').map(Number).filter(x => !isNaN(x)) : [];
fs.mkdirSync(outDir, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/arial.ttf':" : '';
const stamp = (offset = 0) => `drawtext=${font}text='%{eif\\:t+${offset}\\:d}.%{eif\\:mod((t+${offset})*100\\,100)\\:d\\:2}s':x=8:y=8:fontsize=24:fontcolor=yellow:box=1:boxcolor=black@0.6`;

// 1. 参数
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', video]));
const vs = probe.streams.find(s => s.codec_type === 'video');
const dur = +probe.format.duration;
const tall = vs.height > vs.width;
console.log(`时长 ${dur.toFixed(2)} 秒，${vs.width}×${vs.height}，${vs.r_frame_rate} 帧，${tall ? '竖画面' : '横画面'}`);
if (!tall) console.log(`⚠️ 这条成片不是竖的（${vs.width}×${vs.height}）：竖屏要在平台把画面比例设成 9:16`);
else if (Math.abs(vs.width / vs.height - 9 / 16) > 0.02) console.log(`⚠️ 画面比例 ${vs.width}:${vs.height} 不是 9:16`);
const shortSide = Math.min(vs.width, vs.height);
if (shortSide < 720) console.log(`⚠️ 分辨率只有 ${shortSide}p，雨丝、颗粒、毛孔会出不来；正式出片选 720p 或 1080p`);

// 2. 切点
const scoreFile = path.join(outDir, 'scene_scores.txt');
// 滤镜里的盘符冒号很难转义，所以在输出文件夹里运行、用相对文件名
execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', path.resolve(video), '-vf', "select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=scene_scores.txt", '-an', '-f', 'null', '-'],
  { cwd: path.resolve(outDir), stdio: ['ignore', 'pipe', 'pipe'] });
const lines = fs.readFileSync(scoreFile, 'utf8').split(/\r?\n/);
let tcur = 0; const cuts = [];
for (const l of lines) {
  const m = l.match(/pts_time:([0-9.]+)/); if (m) tcur = +m[1];
  const s = l.match(/scene_score=([0-9.]+)/);
  if (s && +s[1] > 0.2 && tcur > 0.2 && (!cuts.length || tcur - cuts[cuts.length - 1].t > 0.4)) cuts.push({ t: tcur, s: +s[1] });
}
console.log('实际切点：' + (cuts.map(c => `${c.t.toFixed(2)}s（${c.s.toFixed(2)}）`).join('、') || '没找到'));

// 3. 每 0.5 秒的宫格图（一张 8 秒：横画面 4×4；竖画面 8×2，每排 4 秒）
const perSheet = 16, step = 0.5, sheets = Math.ceil(dur / step / perSheet);
const sheetVf = tall ? 'scale=240:-2' : 'scale=480:-2', sheetTile = tall ? 'tile=8x2:padding=4:color=white' : 'tile=4x4:padding=4:color=white';
for (let i = 0; i < sheets; i++) {
  const ss = i * perSheet * step;
  const out = path.join(outDir, `sheet_${String(i + 1).padStart(2, '0')}.png`);
  run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-ss', String(ss), '-t', String(perSheet * step), '-i', video,
    '-vf', `fps=${1 / step},${sheetVf},${stamp(ss)},${sheetTile}`, '-frames:v', '1', out]);
  console.log('宫格图：' + out);
}

// 4. 切点前后的密集帧（每个切点前后 0.5 秒，每 0.125 秒一张）
const parts = [];
cuts.forEach((c, i) => {
  const ss = Math.max(0, c.t - 0.5);
  const out = path.join(outDir, `cut_${i + 1}.png`);
  run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-ss', ss.toFixed(3), '-t', '1', '-i', video,
    '-vf', `fps=8,${tall ? 'scale=200:-2' : 'scale=360:-2'},${stamp(+ss.toFixed(3))},${tall ? 'tile=8x1' : 'tile=4x2'}:padding=3:color=white`, '-frames:v', '1', out]);
  parts.push(out);
});
if (parts.length) {
  const all = path.join(outDir, 'cuts_all.png');
  const args = ['-hide_banner', '-v', 'error', '-y'];
  parts.forEach(p => args.push('-i', p));
  args.push('-filter_complex', parts.length > 1 ? `vstack=inputs=${parts.length}` : 'null', all);
  run('ffmpeg', args);
  console.log('切点前后：' + all);
}

// 5. 全分辨率单帧
for (const s of singles) {
  const out = path.join(outDir, `frame_${s}.png`);
  run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-ss', String(s), '-i', video, '-frames:v', '1', out]);
  console.log('单帧：' + out);
}
