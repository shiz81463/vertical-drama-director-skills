#!/usr/bin/env node
// v4（2026-11-09）审片拼图：同一场戏、同一方向的镜头，各段各抽一帧拼成一张，看背景和光有没有跳。规则 X8。
// 用法：node scene_sheet.js <提示词文件夹> <成片文件夹> <输出文件夹> [--ffmpeg <ffmpeg.exe 路径>]
//   提示词文件名和成片文件名都要有"段N"。按提示词里写的镜头时间取每镜正中那一帧（成片实际切点可能差一点）。
//   没写"方向N"的旧提示词，按机位方括号的前 12 个字分组。
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--ffmpeg');
const [pdir, vdir, odir] = pos;
if (!pdir || !vdir || !odir) { console.log('用法：node scene_sheet.js <提示词文件夹> <成片文件夹> <输出文件夹> [--ffmpeg 路径]'); process.exit(2); }
const fi = args.indexOf('--ffmpeg');
let ff = fi >= 0 ? args[fi + 1] : 'ffmpeg';
if (fi < 0) { try { cp.execFileSync(ff, ['-version'], { stdio: 'ignore' }); } catch { console.log('找不到 ffmpeg：加 --ffmpeg <ffmpeg.exe 的完整路径>'); process.exit(2); } }
fs.mkdirSync(odir, { recursive: true });
const tmp = path.join(odir, '_帧'); fs.mkdirSync(tmp, { recursive: true });

const segNo = f => { const m = f.match(/段(\d+)/); return m ? +m[1] : null; };
const vids = fs.readdirSync(vdir).filter(f => /\.(mp4|mov)$/i.test(f));
const prompts = fs.readdirSync(pdir).filter(f => /段\d+.*提示词.*\.txt$/.test(f));
const groups = {};
for (const f of prompts) {
  const n = segNo(f);
  const v = vids.find(x => segNo(x) === n);
  if (!v) { console.log(`段${n}：成片文件夹里没有对应的视频，跳过`); continue; }
  const t = fs.readFileSync(path.join(pdir, f), 'utf8').replace(/\r\n/g, '\n');
  const scene = ((t.match(/【场景[:：]([^】]*)】/) || [])[1] || '未知场景').trim();
  const re = /^镜头(\d+)｜\s*([\d.]+)\s*[–\-]\s*([\d.]+)\s*s[^\n]*\n(\[[^\]\n]*\])?/gm; let m;
  while ((m = re.exec(t))) {
    const shot = +m[1], a = +m[2], b = +m[3], br = m[4] || '';
    const d = (br.match(/方向\s*(\d+)/) || [])[1];
    const key = `${scene}｜${d ? '方向' + d : br.slice(1, 13)}`;
    (groups[key] = groups[key] || []).push({ seg: n, shot, t: ((a + b) / 2).toFixed(2), video: path.join(vdir, v) });
  }
}

const safe = s => s.replace(/[\\/:*?"<>|，,。\s]+/g, '_').slice(0, 60);
let made = 0;
for (const [key, list] of Object.entries(groups)) {
  list.sort((x, y) => x.seg - y.seg || x.shot - y.shot);
  const frames = [];
  for (const it of list) {
    const o = path.join(tmp, `${safe(key)}_S${it.seg}_C${it.shot}.png`);
    try {
      cp.execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', it.t, '-i', it.video, '-frames:v', '1', '-vf',
        `scale=360:-2,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='S${it.seg} C${it.shot} @${it.t}':x=8:y=8:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6`, o]);
      frames.push(o);
    } catch (e) { console.log(`抽帧失败：段${it.seg} 镜${it.shot}`); }
  }
  // 每张最多 6 帧
  for (let i = 0; i < frames.length; i += 6) {
    const chunk = frames.slice(i, i + 6);
    const out = path.join(odir, `${safe(key)}${frames.length > 6 ? '_' + (i / 6 + 1) : ''}.png`);
    const inputs = chunk.flatMap(c => ['-i', c]);
    const filter = chunk.length > 1 ? `hstack=inputs=${chunk.length}` : 'null';
    cp.execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, out]);
    made++;
    console.log(`${key}：${chunk.length} 帧 → ${out}`);
  }
}
console.log(`\n拼了 ${made} 张。同一张图里背景认得出是同一处、光的方向和软硬一样，才算过（规则 X8）。`);
