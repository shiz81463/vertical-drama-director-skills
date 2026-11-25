#!/usr/bin/env node
/**
 * 把一份剪辑方案（JSON）写成真正的剪映草稿：画面用原素材（带前后余量）、声音分轨、字幕分轨，在剪映里能接着改。
 * 只新建草稿，不改、不覆盖任何已有草稿。方案格式和完整流程见 references/write-draft.md。
 *
 *   node write_draft.mjs <方案.json>                写草稿，并加进剪映的草稿列表（剪映开着时只写草稿，列表留到关掉后）
 *   node write_draft.mjs <方案.json> --name 草稿名   用这个名字（默认用方案里的 name）
 *   node write_draft.mjs <方案.json> --dry-run      只检查方案，不写任何文件
 *   node write_draft.mjs <方案.json> --no-register  只写草稿，不碰草稿列表
 *   node write_draft.mjs --register <草稿名或文件夹>  关掉剪映后，把写好的草稿加进列表
 *   --root <文件夹>  草稿目录（默认用剪映现在的）   --index <文件>  指定列表文件（测试用）
 *
 * 只需要 Node 18+ 和 ffmpeg / ffprobe。格式按剪映专业版 11.8 验证（2026-11-21）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { draftIndexPath, BACKUP_ROOT } from './lib/draft.mjs';

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--name', '--root', '--index', '--register']);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const has = (n) => args.includes(n);
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]));

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const fwd = (p) => p.replace(/\\/g, '/');
const hid = () => crypto.randomBytes(16).toString('hex');
const uid = () => crypto.randomUUID().toUpperCase();
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
// Node 24 的 fs.rmSync 碰到中文路径会直接崩（退出码 3221226505），这里逐个删
function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) removeDir(p); else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}
function dirSize(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
    const p = path.join(dir, e.name);
    return n + (e.isDirectory() ? dirSize(p) : fs.statSync(p).size);
  }, 0);
}
const VERIFIED_APP = '11.8';
const DRAFT_NEW_VERSION = '145.0.0';

// ---------- 剪映在哪、什么版本、开着没有 ----------
function readIndex(file) {
  if (!fs.existsSync(file)) die(`找不到剪映的草稿列表：${file}。用 --root 指定草稿目录，并加 --no-register`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function draftRoot(indexFile) {
  if (flag('--root')) return fwd(path.resolve(flag('--root')));
  const all = readIndex(indexFile).all_draft_store || [];
  const newest = [...all].sort((a, b) => (b.tm_draft_modified || 0) - (a.tm_draft_modified || 0)).find((d) => d.draft_root_path);
  if (!newest) die('草稿列表里没有可参考的草稿目录，用 --root 指定');
  return fwd(newest.draft_root_path);
}

function appInfo() {
  const apps = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'JianyingPro', 'Apps');
  const versions = fs.existsSync(apps) ? fs.readdirSync(apps).filter((d) => /^\d+\.\d+\.\d+/.test(d)) : [];
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const full = versions.at(-1);
  if (!full) return { version: `${VERIFIED_APP}.0`, font: '' };
  const font = path.join(apps, full, 'Resources', 'Font', 'SystemFont', 'zh-hans.ttf');
  return { version: full.split('.').slice(0, 3).join('.'), font: fs.existsSync(font) ? fwd(font) : '' };
}

function jianyingRunning() {
  try {
    if (process.platform === 'win32') {
      return /JianyingPro\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq JianyingPro.exe', '/NH'], { encoding: 'utf8' }));
    }
    return spawnSync('pgrep', ['-x', 'JianyingPro']).status === 0;
  } catch { return true; } // 判断不了就当开着，不去碰列表
}

// ---------- 加进草稿列表 ----------
function register(folder, indexFile, customIndex) {
  const metaFile = path.join(folder, 'draft_meta_info.json');
  if (!fs.existsSync(metaFile)) die(`这个文件夹不是草稿：${folder}`);
  const rawMeta = fs.readFileSync(metaFile, 'utf8');
  if (rawMeta.trimStart()[0] !== '{') die('这条草稿已经被剪映打开过，不需要再加进列表');
  if (!customIndex && jianyingRunning()) return 'running';
  const meta = JSON.parse(rawMeta);
  const index = readIndex(indexFile);
  if ((index.all_draft_store || []).some((d) => d.draft_id === meta.draft_id || fwd(d.draft_fold_path || '') === fwd(folder))) return 'listed';
  const keep = path.join(BACKUP_ROOT, '_草稿列表备份');
  fs.mkdirSync(keep, { recursive: true });
  fs.copyFileSync(indexFile, path.join(keep, `root_meta_info_${stamp()}.json`));
  const fold = fwd(folder);
  index.all_draft_store.unshift({
    cloud_draft_cover: false, cloud_draft_sync: false, draft_cloud_last_action_download: false, draft_cloud_purchase_info: '', draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '', draft_cloud_videocut_purchase_info: '', draft_cover: '', draft_fold_path: fold, draft_id: meta.draft_id,
    draft_is_ai_shorts: false, draft_is_cloud_temp_draft: false, draft_is_infinite_canvas_draft: false, draft_is_invisible: false, draft_is_pippit_draft: false,
    draft_is_web_article_video: false, draft_json_file: `${fold}\\draft_content.json`, draft_name: meta.draft_name, draft_new_version: '',
    draft_root_path: meta.draft_root_path, draft_timeline_materials_size: meta.draft_timeline_materials_size_, draft_type: '', draft_web_article_video_enter_from: '',
    pippit_avatar_url: '', pippit_extra_info: '', pippit_id: '', pippit_user_name: '', streaming_edit_draft_ready: true, tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1, tm_draft_cloud_modified: 0, tm_draft_cloud_parent_entry_id: -1, tm_draft_cloud_space_id: -1, tm_draft_cloud_user_id: -1,
    tm_draft_create: meta.tm_draft_create, tm_draft_modified: meta.tm_draft_modified, tm_draft_removed: 0, tm_duration: meta.tm_duration,
  });
  if (Number.isInteger(index.draft_ids)) index.draft_ids += 1;
  const tmp = `${indexFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index), 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, indexFile);
  return 'added';
}

const indexFile = flag('--index') ? path.resolve(flag('--index')) : draftIndexPath();

if (has('--register')) {
  const target = flag('--register');
  if (!target) die('--register 后面要写草稿名或文件夹');
  const folder = fs.existsSync(target) ? path.resolve(target) : path.join(draftRoot(indexFile), target);
  const r = register(folder, indexFile, !!flag('--index'));
  if (r === 'running') die('剪映还开着。它退出时会用内存里的列表盖掉改动，先关掉剪映（托盘图标可以留着）再跑一次');
  console.log(r === 'listed' ? `已经在列表里：${path.basename(folder)}` : `✓ 已加进草稿列表：${path.basename(folder)}。打开剪映就能看到`);
  process.exit(0);
}

// ---------- 读方案 ----------
if (positional.length !== 1) die('用法：node write_draft.mjs <方案.json> [--name 草稿名] [--dry-run] [--no-register]');
const planFile = path.resolve(positional[0]);
if (!fs.existsSync(planFile)) die(`找不到方案：${planFile}`);
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8').replace(/^﻿/, ''));
const name = flag('--name') || plan.name;
if (!name) die('方案里要有 name（草稿名），或者用 --name');
if (/[\\/:*?"<>|]/.test(name)) die(`草稿名里不能有 \\ / : * ? " < > |：${name}`);
const fps = plan.fps || 30;
const [W, H] = plan.canvas || [1080, 1920];
const usAt = (frame) => Math.ceil(frame * 1000000 / fps);
const frameOf = (o, fk, sk, what) => {
  if (o[fk] != null) return o[fk];
  if (o[sk] == null) die(`${what} 缺少 ${fk} 或 ${sk}`);
  return Math.round(o[sk] * fps);
};
const root = draftRoot(indexFile);
const finalDir = `${root}/${name}`;
const problems = [];
if (fs.existsSync(finalDir)) die(`已经有同名草稿：${finalDir}。这个脚本不覆盖草稿，换个名字（比如加 -v2）`);
if (!plan.video?.length) die('方案里没有画面（video）');

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.error) die('找不到 ffprobe：需要 ffmpeg / ffprobe 在 PATH 里');
  if (r.status) return null;
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  const d = (v || a)?.duration ?? j.format?.duration;
  return { width: v?.width, height: v?.height, dur: Math.trunc(Number(d) * 1000000), hasVideo: !!v };
}

// 同一个文件只算一份素材；文件名撞车时加序号
const media = { video: new Map(), audio: new Map() };
function addMedia(kind, file, as, where) {
  if (!file) { problems.push(`${where}：没写 file`); return null; }
  const abs = path.resolve(file);
  if (media[kind].has(abs)) return media[kind].get(abs);
  if (!fs.existsSync(abs)) { problems.push(`${where}：找不到文件 ${file}`); return null; }
  const info = probe(abs);
  if (!info || !info.dur) { problems.push(`${where}：读不出这个文件 ${file}`); return null; }
  if (kind === 'video' && !info.hasVideo) { problems.push(`${where}：这个文件没有画面 ${file}`); return null; }
  const base = as || path.basename(abs);
  const taken = new Set([...media[kind].values()].map((m) => m.name));
  let fileName = base;
  for (let i = 2; taken.has(fileName); i++) fileName = `${i}_${base}`;
  const entry = { abs, name: fileName, ...info };
  media[kind].set(abs, entry);
  return entry;
}

// ---------- 检查方案 ----------
const vPieces = [];
let cursor = 0;
plan.video.forEach((v, i) => {
  const where = `画面第 ${i + 1} 段${v.label ? `（${v.label}）` : ''}`;
  if (v.black != null) {
    if (!Number.isInteger(v.black) || v.black <= 0) { problems.push(`${where}：black 要写正整数帧数`); return; }
    vPieces.push({ black: true, t0: cursor, t1: cursor + v.black });
    cursor += v.black;
    return;
  }
  const m = addMedia('video', v.file, v.as, where);
  const fa = frameOf(v, 'inFrame', 'in', where), fb = frameOf(v, 'outFrame', 'out', where);
  if (fb <= fa) { problems.push(`${where}：出点要在入点之后（${fa}–${fb} 帧）`); return; }
  const speed = v.speed ?? 1;
  if (speed <= 0) { problems.push(`${where}：speed 要大于 0`); return; }
  const frames = Math.round((fb - fa) / speed);
  if (m && usAt(fb) > m.dur + 1000000 / fps) problems.push(`${where}：出点 ${(fb / fps).toFixed(2)} 秒超过素材长度 ${(m.dur / 1e6).toFixed(2)} 秒`);
  if (v.crop) {
    if (!Array.isArray(v.crop) || v.crop.length !== 3) problems.push(`${where}：crop 要写 [x, y, h]，都是占画面的比例`);
    else {
      const [x, y, h] = v.crop;
      if (h <= 0 || h > 1 || x < 0 || y < 0 || x + h > 1.0001 || y + h > 1.0001) problems.push(`${where}：crop 超出画面`);
      if (m && Math.abs(m.width / m.height - W / H) > 0.01) problems.push(`${where}：crop 只支持和画布同比例的素材（这条是 ${m.width}x${m.height}）`);
    }
  }
  vPieces.push({ m, t0: cursor, t1: cursor + frames, fa, fb, speed, crop: v.crop, mute: v.mute ?? plan.muteVideo ?? false });
  cursor += frames;
});
const totalFrames = cursor;

const ROLE_TYPE = { dialog: 'record', sfx: 'sound', music: 'music' };
const aTracks = (plan.audio || []).map((t, ti) => {
  const label = t.name || `声音轨 ${ti + 1}`;
  const type = ROLE_TYPE[t.role];
  if (!type) problems.push(`${label}：role 要写 dialog（对白）、sfx（音效）或 music（音乐）`);
  const clips = (t.clips || []).map((c, ci) => {
    const where = `${label} 第 ${ci + 1} 段`;
    const m = addMedia('audio', c.file, c.as, where);
    if (m) m.type = type;
    const a = c.in ?? 0, b = c.out ?? (m ? m.dur / 1e6 : 0);
    if (b <= a) problems.push(`${where}：出点要在入点之后`);
    if (m && b * 1e6 > m.dur + 50000) problems.push(`${where}：出点 ${b.toFixed(2)} 秒超过文件长度 ${(m.dur / 1e6).toFixed(2)} 秒`);
    if ((c.at ?? 0) < 0) problems.push(`${where}：at 不能是负数`);
    return { m, at: c.at ?? 0, a, b, volume: c.volume };
  }).sort((p, q) => p.at - q.at);
  clips.forEach((c, i) => { if (i && c.at < clips[i - 1].at + (clips[i - 1].b - clips[i - 1].a) - 0.0005) problems.push(`${label}：${c.at.toFixed(2)} 秒处两段声音重叠，要放到不同轨道`); });
  return { type, clips, label };
});

const STYLES = {
  en: { size: 8, stroke: 0.08, y: -0.363, lineSpacing: 0.5, wrap: 40, ascii: true },    // 公司《字幕标准》：字号 8、描边 40、行间距 10、Y -465
  zh: { size: 6.5, stroke: 0.06, y: -0.56, lineSpacing: 0.5 },
};
function styleOf(s, label) {
  if (typeof s === 'string') { if (!STYLES[s]) problems.push(`${label}：没有样式 ${s}`); return STYLES[s] || STYLES.zh; }
  const base = STYLES[s?.base] || {};
  return { size: 8, stroke: 0, y: 0, lineSpacing: 0.02, ...base, ...(s || {}) };
}
function wrapLine(text, limit) {
  if (!limit || text.length <= limit || text.includes('\n')) return text;
  const spaces = [...text].flatMap((c, i) => (c === ' ' ? [i] : []));
  if (!spaces.length) return text;
  let best = spaces[0];
  for (const k of spaces) if (Math.abs(k - text.length / 2) < Math.abs(best - text.length / 2)) best = k;
  return `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}
const tTracks = (plan.text || []).map((t, ti) => {
  const label = t.name || `字幕轨 ${ti + 1}`;
  const style = styleOf(t.style, label);
  const cues = (t.cues || []).map((c, ci) => {
    const where = `${label} 第 ${ci + 1} 条`;
    const f0 = frameOf(c, 'aFrame', 'a', where), f1 = frameOf(c, 'bFrame', 'b', where);
    if (f1 <= f0) problems.push(`${where}：结束要在开始之后`);
    let text = String(c.text ?? '');
    if (!text) problems.push(`${where}：没有文字`);
    if (style.ascii) text = text.replace(/…/g, '...');
    return { text: wrapLine(text, style.wrap), f0, f1 };
  }).sort((p, q) => p.f0 - q.f0);
  cues.forEach((c, i) => { if (i && c.f0 < cues[i - 1].f1) problems.push(`${label}：第 ${(c.f0 / fps).toFixed(2)} 秒和上一条字幕重叠`); });
  return { style, cues, label };
});

if (problems.length) {
  console.error(`方案有 ${problems.length} 处问题，没有写草稿：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
const duration = Math.max(usAt(totalFrames),
  ...aTracks.flatMap((t) => t.clips.map((c) => Math.trunc(c.at * 1e6) + Math.trunc((c.b - c.a) * 1e6))),
  ...tTracks.flatMap((t) => t.cues.map((c) => usAt(c.f1))));
const summary = `画面 ${vPieces.length} 段，声音 ${aTracks.length} 轨 ${aTracks.reduce((n, t) => n + t.clips.length, 0)} 段，字幕 ${tTracks.length} 轨 ${tTracks.reduce((n, t) => n + t.cues.length, 0)} 条，总长 ${(duration / 1e6).toFixed(2)} 秒`;
if (has('--dry-run')) { console.log(`✓ 方案没问题（没有写文件）：${summary}`); process.exit(0); }

// ---------- 写草稿：先写到临时文件夹，全部成功才改名 ----------
const workDir = `${finalDir}.writing`;
removeDir(workDir);
fs.mkdirSync(`${workDir}/materials/video`, { recursive: true });
fs.mkdirSync(`${workDir}/materials/audio`, { recursive: true });

const app = appInfo();
if (!app.version.startsWith(VERIFIED_APP)) console.error(`注意：这台电脑的剪映是 ${app.version}，这个脚本只在 ${VERIFIED_APP} 上验证过，打开后要看一眼素材和轨道对不对。`);
const materials = { videos: [], audios: [], texts: [], speeds: [], placeholder_infos: [], canvases: [], sound_channel_mappings: [], material_colors: [], vocal_separations: [] };
const EMPTY = { speeds: { type: 'speed' }, placeholder_infos: { meta_type: 'none', type: 'placeholder_info' }, canvases: { type: 'canvas_color' }, sound_channel_mappings: { type: 'none' }, material_colors: {}, vocal_separations: { type: 'vocal_separation' } };
const V_CATS = ['speeds', 'placeholder_infos', 'canvases', 'sound_channel_mappings', 'material_colors', 'vocal_separations'];
const A_CATS = ['speeds', 'placeholder_infos', 'sound_channel_mappings', 'vocal_separations'];
function extras(cats, speed) {
  return cats.map((c) => {
    const m = { ...structuredClone(EMPTY[c]), id: uid() };
    if (c === 'speeds' && speed && speed !== 1) m.speed = speed;
    materials[c].push(m);
    return m.id;
  });
}

function videoMaterial(entry) {
  if (entry.mid) return entry.mid;
  const dst = `${finalDir}/materials/video/${entry.name}`;
  if (!entry.generated) fs.copyFileSync(entry.abs, `${workDir}/materials/video/${entry.name}`);
  entry.mid = hid();
  materials.videos.push({
    path: dst, category_name: 'local', duration: entry.dur, crop: {}, video_mask_shadow: { resource_id: '', path: '' }, check_flag: 62978047,
    video_mask_stroke: { path: '', type: '', resource_id: '' }, type: 'video', id: entry.mid, width: entry.width, beauty_face_auto_preset: {}, material_id: entry.mid,
    matting: { path: '' }, video_algorithm: { story_video_modify_video_config: {}, path: '' }, height: entry.height, material_name: entry.name, stable: { time_range: {} }, unique_id: hid(),
  });
  return entry.mid;
}

function audioMaterial(entry) {
  if (entry.mid) return entry.mid;
  fs.copyFileSync(entry.abs, `${workDir}/materials/audio/${entry.name}`);
  entry.mid = hid();
  materials.audios.push({
    path: `${finalDir}/materials/audio/${entry.name}`, category_name: 'local', id: entry.mid, duration: entry.dur, tts_benefit_info: { benefit_type: 'none' }, music_id: entry.mid,
    resource_id: '', local_material_id: entry.mid, name: entry.name, type: entry.type, similiar_music_info: {}, check_flag: 3, unique_id: hid(),
  });
  return entry.mid;
}

let blackEntry = null;
const maxBlack = Math.max(0, ...vPieces.filter((p) => p.black).map((p) => p.t1 - p.t0));
if (maxBlack) {
  const f = `${workDir}/materials/video/黑场.mp4`;
  const secs = Math.ceil(maxBlack / fps) + 1;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}:d=${secs}`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', f], { encoding: 'utf8' });
  if (r.status) { removeDir(workDir); die(`做黑场失败：${r.stderr || r.error}`); }
  blackEntry = { name: '黑场.mp4', width: W, height: H, dur: Math.trunc(Number(probe(f).dur)), generated: true };
}

const vSegs = vPieces.map((p) => {
  const start = usAt(p.t0), dur = usAt(p.t1) - start;
  let clip = { transform: { y: 0, x: 0 }, flip: {} };
  if (p.crop) {
    const [x, y, h] = p.crop, s = 1 / h;
    clip = { scale: { x: s, y: s }, transform: { x: 2 * (0.5 - (x + h / 2)) * s, y: -2 * (0.5 - (y + h / 2)) * s }, flip: {} };
  }
  const speed = p.black ? 1 : p.speed;
  // 剪映按向下取整取帧，入点多留 2 微秒，保证落在这一帧里而不是上一帧
  const seg = {
    responsive_layout: {}, render_timerange: {}, id: hid(), extra_material_refs: extras(V_CATS, speed), material_id: videoMaterial(p.black ? blackEntry : p.m),
    target_timerange: { start, duration: dur }, source: 'segmentsourcenormal', hdr_settings: { mode: 1 }, clip,
    source_timerange: { start: (p.black ? 0 : usAt(p.fa)) + 2, duration: speed === 1 ? dur : Math.round(dur * speed) },
  };
  if (p.black || p.mute) seg.volume = 0;
  if (speed !== 1) seg.speed = speed;
  return seg;
});

const aSegTracks = aTracks.map((t) => t.clips.map((c) => {
  const seg = {
    visible: true, responsive_layout: {}, render_timerange: {}, id: hid(), enable_adjust_mask: false, extra_material_refs: extras(A_CATS), enable_adjust: false,
    material_id: audioMaterial(c.m), enable_hsl: false, enable_lut: false, target_timerange: { start: Math.trunc(c.at * 1e6), duration: Math.trunc((c.b - c.a) * 1e6) },
    source: 'segmentsourcenormal', source_timerange: { start: Math.trunc(c.a * 1e6), duration: Math.trunc((c.b - c.a) * 1e6) },
  };
  if (c.volume != null) seg.volume = c.volume;
  return seg;
}));

function textMaterial(text, s) {
  const style = { fill: { alpha: 1.0, content: { render_type: 'solid', solid: { alpha: 1.0, color: s.color || [1, 1, 1] } } }, range: [0, text.length], size: s.size, bold: false, italic: false, underline: false };
  if (s.stroke) style.strokes = [{ content: { solid: { alpha: 1.0, color: [0, 0, 0] } }, width: s.stroke }];
  const id = hid();
  materials.texts.push({
    lyrics_template: { resource_id: '', path: '' }, type: 'text', caption_template_info: { resource_id: '', path: '' }, text_color: '#FFFFFF', id, font_path: app.font, current_words: {},
    combo_info: {}, words: {}, shadow_point: { y: 0, x: 0 }, line_spacing: s.lineSpacing, check_flag: 15, content: JSON.stringify({ styles: [style], text }),
  });
  return id;
}
const tSegTracks = tTracks.map((t, i) => t.cues.map((c) => ({
  responsive_layout: {}, render_timerange: {}, id: hid(), enable_adjust_mask: false, enable_adjust: false, material_id: textMaterial(c.text, t.style), render_index: 14000 + i, enable_hsl: false,
  source: 'segmentsourcenormal', target_timerange: { start: usAt(c.f0), duration: usAt(c.f1) - usAt(c.f0) }, clip: { transform: { y: t.style.y, x: 0 }, flip: {} }, enable_lut: false,
})));

const platform = { app_version: app.version, os_version: os.release(), os: process.platform === 'win32' ? 'windows' : 'mac', device_id: hid(), mac_address: hid(), app_id: 3704, app_source: 'lv' };
const tracks = [{ id: uid(), type: 'video', name: '', segments: vSegs }];
for (const segments of tSegTracks) tracks.push({ id: uid(), type: 'text', name: '', segments });
for (const segments of aSegTracks) tracks.push({ id: uid(), type: 'audio', name: '', segments });
const draft = {
  path: '', duration, canvas_config: { height: H, width: W }, tracks, last_modified_platform: platform, color_space: 0, is_minimal_draft: true, keyframes: {}, platform, smart_ads_info: {},
  id: uid(), fps, config: { maintrack_adsorb: false, zoom_info_params: {}, combination_max_index: 1, original_sound_last_index: 1 },
  materials: Object.fromEntries(Object.entries(materials).filter(([, v]) => v.length)), function_assistant_info: { fps: {} }, version: 360000, uneven_animation_template_info: {}, new_version: DRAFT_NEW_VERSION,
};
const content = JSON.stringify(draft);
fs.writeFileSync(`${workDir}/draft_content.json`, content, 'utf8');

const now = Date.now() * 1000;
const size = dirSize(`${workDir}/materials`);
const meta = {
  cloud_draft_cover: false, cloud_draft_sync: false, cloud_package_completed_time: '', draft_cloud_capcut_purchase_info: '', draft_cloud_last_action_download: false, draft_cloud_package_type: '',
  draft_cloud_purchase_info: '', draft_cloud_template_id: '', draft_cloud_tutorial_info: '', draft_cloud_videocut_purchase_info: '', draft_cover: 'draft_cover.jpg', draft_deeplink_url: '',
  draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '', enterprise_material: [] }, draft_fold_path: finalDir, draft_has_unfinished_aigc_video_effect: false,
  draft_id: uid(), draft_is_ae_produce: false, draft_is_ai_packaging_used: false, draft_is_ai_shorts: false, draft_is_ai_translate: false, draft_is_article_video_draft: false, draft_is_cloud_temp_draft: false,
  draft_is_from_deeplink: 'false', draft_is_infinite_canvas_draft: false, draft_is_invisible: false, draft_is_pippit_draft: false, draft_is_web_article_video: false,
  draft_materials: [0, 1, 2, 3, 6, 7, 8].map((type) => ({ type, value: [] })), draft_materials_copied_info: [], draft_name: name, draft_need_rename_folder: false, draft_new_version: '',
  draft_removable_storage_device: /^[A-Za-z]:/.test(root) ? root.slice(0, 2) : '', draft_root_path: process.platform === 'win32' ? root.replace(/\//g, '\\') : root, draft_segment_extra_info: [],
  draft_timeline_materials_size_: size, draft_type: '', draft_web_article_video_enter_from: '', pippit_avatar_url: '', pippit_extra_info: '', pippit_id: '', pippit_user_name: '',
  tm_draft_cloud_completed: '', tm_draft_cloud_entry_id: -1, tm_draft_cloud_modified: 0, tm_draft_cloud_parent_entry_id: -1, tm_draft_cloud_space_id: -1, tm_draft_cloud_user_id: -1,
  tm_draft_create: now, tm_draft_modified: now, tm_draft_removed: 0, tm_duration: duration,
};
fs.writeFileSync(`${workDir}/draft_meta_info.json`, JSON.stringify(meta), 'utf8');
fs.renameSync(workDir, finalDir);

// 剪映一打开就会加密，先留一份明文，dump_timeline / qc_draft 之后还能读
const keep = path.join(BACKUP_ROOT, `${name}@${stamp()}`);
fs.mkdirSync(keep, { recursive: true });
fs.writeFileSync(path.join(keep, 'draft_content.json'), content, 'utf8');

console.log(`✓ 草稿写好了：${finalDir}`);
console.log(`  ${summary}，素材 ${(size / 1e6).toFixed(0)} MB（都复制进了草稿文件夹）`);
console.log(`  明文备份：${keep}`);
if (has('--no-register')) {
  console.log('  没有加进草稿列表（--no-register）');
} else {
  const r = register(finalDir, indexFile, !!flag('--index'));
  if (r === 'running') {
    console.log('  ! 剪映开着，还没加进草稿列表。先跑 qc_draft 检查，关掉剪映后执行：');
    console.log(`    node "${fwd(process.argv[1])}" --register "${name}"`);
  } else {
    console.log('  已加进草稿列表。先跑 qc_draft 检查，再打开剪映（打开后时间线会被加密）');
  }
}
