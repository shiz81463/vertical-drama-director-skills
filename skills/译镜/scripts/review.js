#!/usr/bin/env node
// v5 看片：成片下载回来以后跑一次，机器先把三样查了，人再看片。只读成片，不改任何东西。
// 用法：node review.js <提示词文件夹> <成片文件夹> [输出文件夹] [--ffmpeg <ffmpeg.exe>] [--asr-model <模型文件夹>] [--no-asr]
//   成片文件名里要有"段N"。输出：<输出文件夹>\审片报告.md 和 按方向拼好的审片拼图。
//   1. 背景和光：同一场戏、同一个方向的镜头各抽一帧拼成一张，看跳没跳（规则 X8）；
//   2. 切点：成片里实际切了几刀、和提示词写的切点对不对得上（少切 = 最后几镜没演到）；
//   3. 台词：语音识别，每句说没说、有没有多出来的话、有没有中文（要装 Python 的 faster-whisper，没有就跳过）。
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const argv = process.argv.slice(2);
const valued = ['--ffmpeg', '--asr-model'];
const opt = k => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : '');
const pos = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]));
const [pdir, vdir] = pos;
if (!pdir || !vdir) { console.error('用法：node review.js <提示词文件夹> <成片文件夹> [输出文件夹] [--ffmpeg 路径] [--asr-model 模型文件夹] [--no-asr]'); process.exit(2); }
const odir = pos[2] || path.join(pdir, '审片');
fs.mkdirSync(odir, { recursive: true });
const ffmpeg = opt('--ffmpeg') || 'ffmpeg';
try { cp.execFileSync(ffmpeg, ['-version'], { stdio: 'ignore' }); } catch { console.error('找不到 ffmpeg：加 --ffmpeg <ffmpeg.exe 的完整路径>'); process.exit(2); }
const segNo = f => { const m = f.match(/段(\d+)/); return m ? +m[1] : null; };
const prompts = fs.readdirSync(pdir).filter(f => /段\d+.*提示词.*\.txt$/.test(f)).sort((a, b) => segNo(a) - segNo(b));
const videos = fs.readdirSync(vdir).filter(f => /\.(mp4|mov)$/i.test(f) && segNo(f) !== null && !/历史/.test(f));
const md = ['# 审片报告', '', `提示词：${pdir}`, `成片：${vdir}`, '', '机器只是先筛一遍、指个路，定论要人看片。', ''];

// ---------- 1. 按方向的拼图 ----------
console.log('1/3 拼图……');
const sh = cp.spawnSync(process.execPath, [path.join(__dirname, 'lib', 'scene_sheet.js'), pdir, vdir, odir, '--ffmpeg', ffmpeg], { encoding: 'utf8' });
const sheets = (sh.stdout || '').split('\n').filter(l => l.includes('→'));
md.push('## 一、背景和光（看拼图）', '', '同一张图里是同一场戏、同一个方向的镜头。背景认得出是同一处（同样两三样东西、在同一边）、光的方向和软硬一样，才算过。', '');
for (const l of sheets) md.push('- ' + l.replace(/ → .*[\\/]/, ' → '));
if (!sheets.length) md.push('没拼出图：' + ((sh.stdout || '') + (sh.stderr || '')).trim().split('\n').slice(-2).join(' '));

// ---------- 2. 切点 ----------
console.log('2/3 切点……');
md.push('', '## 二、切点', '', '实际切点是按画面变化找的，慢推、甩镜头会有误差。"少切"的段重点看最后几镜有没有演到。', '', '| 段 | 写了几镜 | 写的切点（秒） | 成片里的切点（秒） | 对上几个 | 要看的 |', '|---|---|---|---|---|---|');
const cutRows = [];
for (const f of prompts) {
  const n = segNo(f); const v = videos.find(x => segNo(x) === n);
  if (!v) { md.push(`| ${n} | — | — | 没有成片 | — | — |`); continue; }
  const t = fs.readFileSync(path.join(pdir, f), 'utf8');
  const starts = [...t.matchAll(/^镜头\d+｜\s*([\d.]+)\s*[–-]/gm)].map(m => +m[1]);
  const planned = starts.slice(1);
  const r = cp.spawnSync(ffmpeg, ['-hide_banner', '-i', path.join(vdir, v), '-vf', "select='gt(scene,0.25)',showinfo", '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const real = [];
  for (const m of (r.stderr || '').matchAll(/pts_time:([\d.]+)/g)) { const x = Math.round(+m[1] * 100) / 100; if (!real.length || x - real[real.length - 1] > 0.2) real.push(x); }
  const hit = planned.filter(p => real.some(x => Math.abs(x - p) <= 0.75)).length;
  const flags = [];
  if (real.length < planned.length) flags.push(`少切 ${planned.length - real.length} 刀`);
  if (hit < planned.length && real.length >= planned.length) flags.push('切点偏了');
  cutRows.push({ n, flags });
  md.push(`| ${n} | ${starts.length} | ${planned.join('、') || '—'} | ${real.join('、') || '没找到'} | ${hit}/${planned.length} | ${flags.join('；') || '—'} |`);
}

// ---------- 3. 台词 ----------
md.push('', '## 三、台词', '');
const model = opt('--asr-model') || process.env.ASR_MODEL || 'D:\\优质精品真人剧拉片素材\\拉片工具\\asr-models\\faster-whisper-medium';
let asr = null, why = '';
if (argv.includes('--no-asr')) why = '加了 --no-asr，没跑。';
else if (!fs.existsSync(model)) why = `找不到语音模型（${model}）。用 --asr-model 指到 faster-whisper 的模型文件夹。`;
else {
  console.log('3/3 语音识别（每段十几秒到一分钟）……');
  const r = cp.spawnSync('python', ['-I', path.join(__dirname, 'lib', 'asr_lines.py'), pdir, vdir, model, ffmpeg], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status === 0) { try { asr = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { why = '识别结果读不出来。'; } }
  else why = '语音识别没跑起来（要装 Python 和 faster-whisper）：' + (r.stderr || '').trim().split('\n').pop();
}
if (!asr) md.push('没有查台词：' + why);
else {
  let all = 0, said = 0;
  md.push('识别会漏掉 hi、no 这种很短的词，也分不清"说错一两个词"。"没听到"和"像不像"低于 0.9 的句子，自己听一遍。', '', '| 段 | 台词 | 写在几秒 | 听到了吗 | 像不像（0–1） |', '|---|---|---|---|---|');
  for (const s of asr) for (const l of s.lines) { all++; if (l.said) said++; md.push(`| ${s.seg} | ${l.text.replace(/\|/g, '/')} | ${l.t0 ? l.t0 + '–' + l.t1 : '—'} | ${l.said ? (l.ratio < 0.9 ? '⚠️ 听到了，可能说错词' : '✅') : (l.words <= 2 ? '⚠️ 没听到（短词，识别常漏）' : '❌ 没听到')} | ${l.ratio} |`); }
  md.push('', `台词 ${all} 句，听到 ${said} 句。`);
  const ex = asr.filter(s => s.extra.length), zh = asr.filter(s => s.zh.length);
  if (ex.length) { md.push('', '**多出来的话（提示词里没写）**', ''); for (const s of ex) for (const e of s.extra) md.push(`- 段${s.seg} 第 ${e.at} 秒：${e.text}`); }
  if (zh.length) { md.push('', '**听着像中文**', ''); for (const s of zh) for (const e of s.zh) md.push(`- 段${s.seg} 第 ${e.at} 秒：${e.text}`); }
  md.push('', '**每段识别到的原话**', ''); for (const s of asr) md.push(`- 段${s.seg}：${s.heard || '（没识别到人声）'}`);
}
const rep = path.join(odir, '审片报告.md');
fs.writeFileSync(rep, md.join('\n') + '\n', 'utf8');
console.log(`\n审片报告：${rep}\n拼图 ${sheets.length} 张；少切或切点偏的段：${cutRows.filter(r => r.flags.length).map(r => r.n).join('、') || '没有'}${asr ? '；台词见报告' : '；台词没查（' + why + '）'}`);
