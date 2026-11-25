#!/usr/bin/env node
// 成片/素材体检：对一个 mp4 做“看和听”层面的机器检查，并导出逐镜头接触表给人（或 Claude）过目。
// usage: node qc_media.mjs <video.mp4> [--out <dir>] [--no-sheet] [--min-frames 5] [--cut-th 0.6] [--cut-prom 0.2]
//        node qc_media.mjs <video.mp4> --strip 47.67,60.27 [--out <dir>]
//   --strip 秒[,秒…]  只导出这些时间点前后的逐帧条（前 4 帧 + 后 8 帧，每帧标帧号），用来核实“夹帧/黑场”到底是不是真的
// 需要 ffmpeg / ffprobe 在 PATH 里。素材（单条 AI 生成片段）和导出的成片都可以用。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { decodeGray, detectCuts, edgeCheck, findBlendFrames, findGlitchFrames, KIND_ZH } from './lib/frames.mjs';

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--out', '--min-frames', '--strip', '--cut-th', '--cut-prom'].includes(args[i - 1])));
if (!file || !fs.existsSync(file)) { console.error('用法: node qc_media.mjs <video.mp4> [--out 目录] [--no-sheet] | --strip 秒,秒'); process.exit(2); }
const CUT_T = parseFloat(opt('--cut-th', '0.6'));      // 相邻帧结构相似度低于它才可能是切点
const CUT_PROM = parseFloat(opt('--cut-prom', '0.2')); // 且要比前后各低这么多（排除连续快动作）
const MIN_FRAMES = parseInt(opt('--min-frames', '5'), 10);
const outDir = opt('--out', path.join(path.dirname(file), '_qc', path.basename(file, path.extname(file))));

const run = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: o.binary ? 'buffer' : 'utf8', maxBuffer: 1 << 30 });
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).stdout || '{}');
const v = (probe.streams || []).find((s) => s.codec_type === 'video');
const a = (probe.streams || []).find((s) => s.codec_type === 'audio');
if (!v) { console.error('没有视频流'); process.exit(2); }
const [fn, fd] = v.r_frame_rate.split('/').map(Number);
const fps = fn / (fd || 1);
const dur = parseFloat(probe.format.duration);
const F = 1 / fps;
const tc = (s) => { const f = Math.round(s * fps), r = Math.round(fps); return `${String(Math.floor(f / r / 60)).padStart(2, '0')}:${String(Math.floor(f / r) % 60).padStart(2, '0')}:${String(f % r).padStart(2, '0')}`; };
const out = [];
const add = (level, msg, at) => out.push({ level, at, msg });
// 给接触表/逐帧条上的标签找一个字体文件；一个都没有就不指定，让 ffmpeg 用它自己的默认字体
const FONT = (() => {
  const f = ['C:/Windows/Fonts/arial.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find((p) => fs.existsSync(p));
  return f ? `fontfile='${f.replace(/:/g, '\\:')}':` : '';
})();

if (args.includes('--strip')) {
  fs.mkdirSync(outDir, { recursive: true });
  const tw = v.height > v.width ? 150 : 240;
  for (const t of opt('--strip', '').split(',').map(Number).filter((x) => !Number.isNaN(x))) {
    const f0 = Math.max(0, Math.round(t * fps) - 4);
    const start = Math.max(0, (f0 - 0.4) / fps); // 略早于该帧的时间戳，保证输出的第一帧正好是 f0，帧号不偏
    const outFile = path.join(outDir, `strip_${tc(t).replace(/:/g, '-')}.jpg`);
    const sfont = FONT;
    const r = run('ffmpeg', ['-v', 'error', '-y', '-ss', start.toFixed(3), '-i', file, '-frames:v', '1', '-vf',
      `scale=${tw}:-2,drawtext=${sfont}text='%{eif\\:n+${f0}\\:d}':x=4:y=4:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6,tile=12x1:padding=2`, '-update', '1', outFile]);
    if (!fs.existsSync(outFile)) { console.error(`导出逐帧条失败：${(r.stderr || '').trim().split('\n').pop()}`); continue; }
    console.log(`${tc(t)}（第 ${Math.round(t * fps)} 帧）前 4 帧到后 8 帧，图上数字是帧号： ${outFile}`);
  }
  process.exit(0);
}

console.log(`# 成片体检 · ${path.basename(file)}`);
console.log(`${dur.toFixed(2)}s · ${v.width}x${v.height} · ${fps.toFixed(2)}fps · 视频 ${v.codec_name} ${(v.bit_rate / 1e6 || 0).toFixed(1)}Mbps · 音频 ${a ? `${a.codec_name} ${a.sample_rate}Hz ${a.channels}ch` : '无'}`);

// ---------- 画面：镜头切点、黑场、静帧
const vlog = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf',
  `scale=320:-2,cropdetect=limit=16:round=2:reset=1,blackdetect=d=${(0.9 * F).toFixed(3)}:pix_th=0.04:pic_th=0.99,freezedetect=n=-55dB:d=0.8`, '-f', 'null', '-']).stderr || '';
const blacks = [...vlog.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
const fStart = [...vlog.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => +m[1]);
const fEnd = [...vlog.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => +m[1]);

// 切点检测（lib/frames.mjs）：把每帧缩到 48 像素宽的灰度小图，比相邻两帧去掉亮度后的“画面结构相似度”。
// 相似度只在这一帧突然掉下去、前后都稳才算切点——这样暗场戏不漏（ffmpeg 自带的 scene 检测在夜戏里只找得到一两成切点），
// 连续几帧都在变的快动作/甩镜头也不会被当成一串切点。用 7 条定稿对照时间线上的真实切点校准过：找回 97–100%。
const S = decodeGray(file, v.width, v.height);
const { NF, lum, md } = S;
const { cuts: cutFrames, nbr } = detectCuts(S, { th: CUT_T, prom: CUT_PROM });
const fmarks = [0, ...cutFrames, NF];
const shots = fmarks.slice(0, -1).map((f, i) => ({ start: f / fps, end: Math.min(dur, fmarks[i + 1] / fps), dur: (fmarks[i + 1] - f) / fps, f0: f, f1: fmarks[i + 1] }));

for (const [s, e] of blacks) {
  const f = Math.round(s * fps), nB = Math.max(1, Math.round((e - s) * fps));
  const ramp = f >= 9 && lum[f - 8] > 10 && lum[f - 1] < 0.6 * lum[f - 8]; // 黑之前画面是逐帧暗下去的：渐隐，不是空洞
  if (s < 0.05) add('?', `黑场 ${nB} 帧（片头）`, s);
  else if (e > dur - 3 * F && nB <= 3) add('?', `片尾最后 ${nB} 帧是黑的（常见原因：画面比时间线短了一两帧）`, s);
  else if (e > dur - 3 * F) add('?', `片尾有 ${nB} 帧（${(nB / fps).toFixed(1)} 秒）黑场${ramp ? '，是暗下去收尾的' : ''}——确认是有意黑场收尾，而不是画面比声音先结束`, s);
  else if (ramp) add('?', `黑场 ${nB} 帧，之前画面是渐暗下去的——渐隐/黑幕转场。规则 6：转场要有理由`, s);
  else add('!', `片中黑场 ${nB} 帧，前一帧还是正常画面——画面空洞或夹了黑帧（极暗的镜头也可能被算进来，用 --strip ${s.toFixed(2)} 看）`, s);
}
{ // 画面没铺满画布：左右或上下有对称黑边（横素材放进竖画布没放大、缩放小于 100% 等）
  const sw = 320, sh = Math.round((320 * v.height) / v.width / 2) * 2;
  const cd = [...vlog.matchAll(/cropdetect.*? w:(-?\d+) h:(-?\d+) x:(-?\d+) y:(-?\d+) .*? t:([\d.]+)/g)].map((m) => ({ w: +m[1], h: +m[2], x: +m[3], y: +m[4], t: +m[5] }));
  const bad = (c) => c.w > 0 && c.h > 0
    && (c.w < sw * 0.94 || c.h < sh * 0.94) // 不要求对称：见过画面只占左半边、右边全黑的定稿
    && !blacks.some(([s, e]) => c.t >= s - F && c.t <= e + F);
  let runSeg = null;
  for (const c of [...cd, { t: 1e9, w: sw, h: sh, x: 0, y: 0 }]) {
    if (bad(c)) { runSeg = runSeg || { s: c.t, e: c.t, w: c.w, h: c.h }; runSeg.e = c.t; }
    else if (runSeg) {
      if (runSeg.e - runSeg.s >= 0.3) add('?', `约 ${(runSeg.e - runSeg.s + F).toFixed(1)}s 画面没铺满画布（有效画面约 ${Math.round((100 * runSeg.w) / sw)}%×${Math.round((100 * runSeg.h) / sh)}%，四周是黑边）——暗场也可能误报，看一眼`, runSeg.s);
      runSeg = null;
    }
  }
}
// 短于 MIN_FRAMES 的片段：把连着的几个并成一段“突变”，按亮度分三类。
// 实测（逐帧条核对过）：比前后亮得多的是镜头内的枪火/闪电；单独 1 帧、亮度正常、和前后都不像的才是真夹帧；
// 2 帧以上的多半是“切点后紧跟快动作/甩镜头”，只列为待确认。
for (let k = 0; k < shots.length; k++) {
  if (shots[k].f1 - shots[k].f0 >= MIN_FRAMES) continue;
  let k2 = k; while (k2 + 1 < shots.length && shots[k2 + 1].f1 - shots[k2 + 1].f0 < MIN_FRAMES) k2++;
  const a = shots[k].f0, b = shots[k2].f1, len = b - a, at = a / fps;
  k = k2;
  if (blacks.some(([s, e]) => at >= s - 2 * F && at <= e + 2 * F)) continue; // 已按黑场报过
  if (a === 0) { add('?', `片头最开始 ${len} 帧和后面的画面不一样，用 --strip ${at.toFixed(2)} 看`, at); continue; }
  if (b >= NF) { add('?', `片尾最后 ${len} 帧画面突变（常见原因：特效/定格比时间线早结束了一两帧），用 --strip ${at.toFixed(2)} 看`, at); continue; }
  const bright = lum[a] > Math.max(lum[a - 1], lum[b]) + 20; // 突变的第一帧比前后都亮得多：闪光起头
  // 24fps 素材进 30/60fps 成片，夹进来的 1 帧会被复制成 2–3 帧一模一样的：按“不重复的帧”数
  let uniq = 1; for (let i = a + 1; i < b; i++) if (md[i] >= 0.35) uniq++;
  const dup = uniq === 1 && len > 1 ? `（成片里被复制成 ${len} 帧）` : '';
  if (bright) add('?', `${len} 帧闪光（比前后两帧亮得多，多半是镜头内的枪火/闪电/闪白；也可能是夹进来的亮画面），确认是有意的，用 --strip ${at.toFixed(2)} 看`, at);
  // 真夹帧的特征：这一帧两侧的画面本身是稳的（相邻帧相似度 ≥0.85）。两侧也在剧烈变化的是快动作（实测第03集挥剑、第05集踩踏都属于这种）
  else if (uniq === 1 && nbr(a, -1) >= 0.85 && nbr(b, 1) >= 0.85) add('!', `夹了 1 帧别的画面${dup}（前后两侧的画面都很稳，唯独这一帧和两边都对不上）——用 --strip ${at.toFixed(2)} 看逐帧条`, at);
  else if (uniq === 1) add('?', `1 帧画面突变${dup}，但前后本身也在快速变化——多半是快动作，不放心就用 --strip ${at.toFixed(2)} 看`, at);
  else add('?', `${len} 帧画面突变：可能是夹帧，也可能是切点后紧跟快动作/甩镜头，用 --strip ${at.toFixed(2)} 看逐帧条`, at);
}
// 镜头头尾的残帧（夹帧、卡帧）：粘在一个镜头开头或结尾、没被单独切出来的 1–2 帧坏画面，以及开头/结尾停住不动的几帧。
// 上面“少于 N 帧的镜头”只抓得到单独成段的夹帧；这里抓粘在镜头上的。人工样本（混合帧、坏帧、卡帧，24/30/60fps）全部抓到；
// 22 条定稿实测抓到校园21 38 秒夹进 2 帧别的演员、校园13 35 秒带半边黑的 1 帧、第01集 48 秒眼睛和刀叠在一起的 2 帧。
const blendAt = findBlendFrames(S);
for (const bl of blendAt) add('!', `切点上有 ${bl.len} 帧是两个画面叠在一起（混合帧，AI 素材内部换镜头时最常见）——把这 ${bl.len} 帧剪掉；如果是有意做的极短叠化，说得出理由（规则 6）。用 --strip ${(bl.at / fps).toFixed(2)} 看`, bl.at / fps);
const nearBlend = (f0, f1) => blendAt.some((bl) => bl.at <= f1 + 1 && bl.at + bl.len >= f0 - 1);
for (let k = 0; k < shots.length; k++) {
  const { f0, f1 } = shots[k];
  for (const e of edgeCheck(S, f0, f1, { prev: f0 - 1, next: f1 < NF ? f1 : -1, fps })) {
    const r0 = e.side === 'head' ? f0 : f1 - e.k, at = r0 / fps;
    if (nearBlend(r0, r0 + e.k - 1)) continue; // 已按混合帧报过
    if (blacks.some(([s, en]) => at >= s - 2 * F && at <= en + 2 * F)) continue; // 已按黑场报过
    const head = e.side === 'head';
    if (e.kind === 'freeze') {
      if (!head && k === shots.length - 1) continue; // 片尾定格是惯例
      add('?', `镜头${head ? '开头' : '结尾'} ${e.k} 帧画面一模一样、停住不动，而镜头其余部分在动——卡帧（AI 起幅僵直，或素材末尾卡住），观众会看到一下顿挫。${head ? `入点往后挪 ${e.k} 帧` : `出点往前收 ${e.k} 帧`}；用 --strip ${at.toFixed(2)} 看`, at);
    } else {
      add(e.level, `镜头${head ? '开头' : '结尾'}粘着 ${e.k} 帧残帧：${KIND_ZH[e.kind]}——${head ? `这一段的左边缘向右拖 ${e.k} 帧` : `这一段的右边缘向左拖 ${e.k} 帧`}（成片帧数；24fps 素材在 30fps 时间线上多拖 1 帧保险）。用 --strip ${at.toFixed(2)} 看逐帧条`, at);
    }
  }
}
for (const g of findGlitchFrames(S, cutFrames)) add('?', `镜头中间有 ${g.len} 帧${KIND_ZH[g.kind]}——确认是不是有意的；不是就在这里分割、删掉这 ${g.len} 帧，接缝用叠盖或放大一档盖住（兜底手册 A2）。用 --strip ${(g.at / fps).toFixed(2)} 看`, g.at / fps);

fStart.forEach((s, i) => {
  const e = fEnd[i] ?? dur;
  const atEnd = e >= dur - 0.1;
  add(atEnd ? 'i' : '?', `画面静止 ${(e - s).toFixed(2)}s${atEnd ? '（片尾定格，属于惯例）' : '——确认是有意的定格，而不是素材卡住/AI 生成的僵直'}`, s);
});

// ---------- 声音
if (!a) add('!', '成片没有音轨（如果不是有意导出的无声版，检查是否整轨静音/停用）');
else {
  const alog = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'silencedetect=noise=-55dB:d=0.35,ebur128=peak=true', '-f', 'null', '-']).stderr || '';
  const sil = [...alog.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  for (const [s, e] of sil) add('!', `${(e - s).toFixed(2)}s 彻底无声（低于 -55dB）——缺环境音，或者声音被剪出了洞`, s);
  const I = alog.match(/I:\s+(-?[\d.]+) LUFS(?![\s\S]*I:\s+-?[\d.]+ LUFS)/), P = alog.match(/Peak:\s+(-?[\d.]+) dBFS(?![\s\S]*Peak:\s+-?[\d.]+ dBFS)/), LRA = alog.match(/LRA:\s+(-?[\d.]+) LU(?![\s\S]*LRA:\s+-?[\d.]+ LU\b)/);
  if (I) console.log(`响度 ${I[1]} LUFS · 真峰值 ${P ? P[1] : '?'} dBFS · 动态范围 ${LRA ? LRA[1] : '?'} LU`);
  if (P && +P[1] > 0) add('?', `真峰值 ${P[1]} dBFS，超过 0——最响处可能削波失真（已测的定稿成片普遍在 0 到 +2 dBFS，是这里的常态；交付有响度要求时以要求为准）`);
  // 硬切：有声音的地方在 30ms 内直接掉到数字静音
  const pcmBuf = run('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { binary: true }).stdout;
  const pcm = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.length >> 1);
  const hop = 80; // 10 ms
  const env = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) { let s = 0; for (let k = 0; k < hop; k++) s += pcm[i + k] * pcm[i + k]; env.push(10 * Math.log10(s / hop / (32768 * 32768) + 1e-12)); }
  const avg = (i, n) => { let s = 0, c = 0; for (let k = i; k < i + n && k < env.length; k++) { s += env[k]; c++; } return c ? s / c : -120; };
  let lastHit = -1;
  for (let i = 10; i < env.length - 8; i++) {
    if (avg(i - 6, 6) > -38 && avg(i + 3, 5) < -75 && i * 0.01 - lastHit > 0.5 && i * 0.01 < dur - 0.15) { add('!', '声音从有到无是硬切（没有淡出，直接掉到静音）——听一下是不是对白/音乐/环境音被截断', i * 0.01); lastHit = i * 0.01; }
  }
  if (avg(env.length - 6, 6) > -35) add('!', `片尾最后一刻声音还在 ${avg(env.length - 6, 6).toFixed(0)} dBFS，没有收尾——音乐/音效戛然而止`, dur - 0.06);
  if (avg(0, 3) > -30) add('?', '第一帧声音就很响，确认片头不是从声音中间硬切进来的', 0);
}

// ---------- 接触表：每个镜头取首/中/尾三帧，方便逐镜头看穿帮、接缝、景别
const sheets = [];
if (!args.includes('--no-sheet')) {
  fs.mkdirSync(outDir, { recursive: true });
  const picks = [];
  shots.forEach((sh, i) => {
    // 取每个镜头真正的第一帧、中间帧、最后一帧（接缝两侧的帧正是要看的地方）
    const n = sh.f1 - sh.f0;
    const fr = n <= 2 ? [sh.f0] : n < 12 ? [sh.f0, sh.f1 - 1] : [sh.f0, Math.floor((sh.f0 + sh.f1) / 2), sh.f1 - 1];
    fr.forEach((f, k) => picks.push({ t: Math.max(0, (f - 0.4) / fps), label: `${i + 1}${'abc'[k]} ${tc(f / fps)}` }));
  });
  const portrait = v.height > v.width;
  const cols = portrait ? 6 : 4, rows = portrait ? 2 : 4, tw = portrait ? 270 : 400;
  const per = cols * rows;
  const font = FONT;
  const tmp = path.join(outDir, '_frames'); fs.mkdirSync(tmp, { recursive: true });
  picks.forEach((p, i) => {
    run('ffmpeg', ['-v', 'error', '-y', '-ss', p.t.toFixed(3), '-i', file, '-frames:v', '1', '-vf',
      `scale=${tw}:-2,drawtext=${font}text='${p.label.replace(/:/g, '\\:')}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`,
      path.join(tmp, `f${String(i).padStart(4, '0')}.jpg`)]);
  });
  for (let s = 0; s * per < picks.length; s++) {
    const outFile = path.join(outDir, `sheet_${String(s + 1).padStart(2, '0')}.jpg`);
    run('ffmpeg', ['-v', 'error', '-y', '-start_number', String(s * per), '-i', path.join(tmp, 'f%04d.jpg'), '-frames:v', '1', '-vf', `tile=${cols}x${rows}:padding=4:color=0x202020`, '-q:v', '3', outFile]);
    if (fs.existsSync(outFile)) sheets.push(outFile);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- 输出
const n = (l) => out.filter((o) => o.level === l).length;
const q = (arr, p) => [...arr].sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const sd = shots.map((s) => s.dur);
console.log(`镜头 ${shots.length} 个 · 平均 ${(dur / shots.length).toFixed(2)}s · 中位 ${q(sd, 0.5).toFixed(2)}s · 最短 ${Math.min(...sd).toFixed(2)}s · 最长 ${Math.max(...sd).toFixed(2)}s（按画面结构相似度检测切点；叠化、同机位跳剪可能漏检，快动作偶尔多切）`);
console.log(`结果：! 疑似 ${n('!')} · ? 待确认 ${n('?')}\n`);
for (const o of out.sort((x, y) => (x.at ?? 0) - (y.at ?? 0))) console.log(`  ${o.level} ${o.at != null ? tc(o.at) + '  ' : ''}${o.msg}`);
console.log('\n## 镜头表');
shots.forEach((s, i) => console.log(`  ${String(i + 1).padStart(3)}. ${tc(s.start)}–${tc(s.end)}  ${s.dur.toFixed(2)}s`));
if (sheets.length) { console.log('\n## 接触表（每个镜头首/中/尾帧，标签 = 镜头号 + 时间码；逐张看穿帮、接缝、人物/道具连续性）'); for (const s of sheets) console.log('  ' + s); }
