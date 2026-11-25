// Shared loader for 剪映 (JianYing Pro) drafts. No dependencies; Node 18+.
// Everything is normalised to seconds and plain fields so the other scripts never touch raw JSON.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const US = 1e6;
const sec = (us) => (us || 0) / US;

/** Where 剪映 keeps its index of drafts (Windows first, then the usual macOS locations). */
export function draftIndexPath() {
  const tail = ['JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft', 'root_meta_info.json'];
  const cands = [
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), ...tail),
    path.join(os.homedir(), 'Movies', ...tail),
    path.join(os.homedir(), 'Library', 'Containers', 'com.lemon.lvpro', 'Data', 'Movies', ...tail),
  ];
  return cands.find((p) => fs.existsSync(p)) || cands[0];
}

/** List drafts known to 剪映: [{name, dir, duration}] */
export function listDrafts() {
  const p = draftIndexPath();
  if (!fs.existsSync(p)) return [];
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return (j.all_draft_store || []).map((d) => ({ name: d.draft_name, dir: path.normalize(d.draft_fold_path), duration: sec(d.tm_duration) }));
}

/**
 * 明文时间线 JSON 的备份目录（backup_drafts.mjs 写入，读草稿时自动回退到这里）。
 * 优先级：环境变量 MANJU_DRAFT_BACKUP → 这台机器原来的工作目录（存在才用）→ 用户主目录下的 漫剧剪辑/草稿JSON备份。
 */
const LEGACY_BACKUP = 'E:\\claude作品集\\漫剧剪辑\\草稿JSON备份';
export const BACKUP_ROOT = process.env.MANJU_DRAFT_BACKUP
  || (fs.existsSync(LEGACY_BACKUP) ? LEGACY_BACKUP : path.join(os.homedir(), '漫剧剪辑', '草稿JSON备份'));
export const isPlainJson = (file) => { try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); return b.toString('utf8').trimStart()[0] === '{'; } catch { return false; } };

/** 找某条草稿最新的明文备份：目录名等于草稿名，或“草稿名@时间戳”。 */
export function findBackup(name) {
  if (!fs.existsSync(BACKUP_ROOT)) return null;
  const cands = fs.readdirSync(BACKUP_ROOT)
    .filter((d) => d === name || d.startsWith(name + '@'))
    .map((d) => path.join(BACKUP_ROOT, d, 'draft_content.json'))
    .filter((f) => fs.existsSync(f) && isPlainJson(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return cands[0] || null;
}

/**
 * Accept a folder path, a draft_content.json path, or (part of) a draft name.
 * 剪映里现在的版本如果已被加密，自动改用最近一次的明文备份，并在 stderr 说明用的是哪一份、什么时候备份的。
 */
export function resolveDraft(arg) {
  if (!arg) throw new Error('需要草稿路径或草稿名');
  let file, name;
  if (fs.existsSync(arg)) {
    const st = fs.statSync(arg);
    file = st.isDirectory() ? path.join(arg, 'draft_content.json') : arg;
    name = path.basename(path.dirname(file));
  } else {
    const all = listDrafts();
    let hits = all.filter((d) => d.name === arg);
    if (!hits.length) hits = all.filter((d) => d.name.includes(arg));
    if (hits.length > 1) throw new Error(`"${arg}" 匹配到多条草稿：${hits.map((h) => h.name).join(' / ')}`);
    if (hits.length === 1) { file = path.join(hits[0].dir, 'draft_content.json'); name = hits[0].name; }
    else {
      // 剪映索引里没有，但备份里可能有
      const b = fs.existsSync(BACKUP_ROOT) ? fs.readdirSync(BACKUP_ROOT).filter((d) => d.includes(arg)) : [];
      const names = [...new Set(b.map((d) => d.split('@')[0]))];
      if (names.length === 1) { name = names[0]; file = path.join(BACKUP_ROOT, name, 'draft_content.json'); }
      else if (names.length > 1) throw new Error(`"${arg}" 在备份里匹配到多条：${names.join(' / ')}`);
      else throw new Error(`找不到草稿：${arg}`);
    }
  }
  if (fs.existsSync(file) && isPlainJson(file)) return file;
  const bak = findBackup(name);
  if (bak) {
    const when = fs.statSync(bak).mtime.toLocaleString('zh-CN', { hour12: false });
    console.error(`注意：「${name}」在剪映里的时间线已加密，改用明文备份（备份文件时间 ${when}）。备份之后在剪映里做的改动这里看不到。`);
    return bak;
  }
  return file; // 让 readDraftJson 给出加密/缺失的说明
}

export class EncryptedDraftError extends Error {}

export function readDraftJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.trimStart()[0] !== '{') {
    throw new EncryptedDraftError(
      `${file} 是加密的（剪映 6+ 在本机保存后会加密 draft_content.json）。` +
      '可读的来源：① 刚从云端/小组空间下载、还没在本机打开保存过的草稿；② 之前备份的 JSON；③ 让剪映导出成片后改用 qc_media.mjs 检查成片。');
  }
  return JSON.parse(raw);
}

const AUDIO_ROLE = { video_original_sound: 'dialog', record: 'dialog', text_to_audio: 'dialog', sound: 'sfx', music: 'music', extract_music: 'music' };

/**
 * Load and normalise a draft.
 * opts.includeDisabled: keep 停用片段 (segment.visible === false). Default false, because they do not render.
 */
export function loadDraft(file, opts = {}) {
  const j = readDraftJson(file);
  const dir = path.dirname(file);
  const byId = new Map();
  for (const [kind, arr] of Object.entries(j.materials || {})) {
    if (Array.isArray(arr)) for (const m of arr) if (m && m.id) byId.set(m.id, { kind, m });
  }
  const fps = j.fps || 30;
  const tracks = [];
  let disabled = 0;
  j.tracks.forEach((t, index) => {
    const attr = t.attribute || 0;
    const tr = { index, type: t.type, attribute: attr, muted: !!(attr & 1), hidden: !!(attr & 2), locked: !!(attr & 4), segments: [] };
    for (const s of t.segments) {
      const enabled = s.visible !== false;
      if (!enabled) { disabled++; if (!opts.includeDisabled) continue; }
      const ent = byId.get(s.material_id) || { kind: '?', m: {} };
      const m = ent.m;
      const refs = (s.extra_material_refs || []).map((id) => byId.get(id)).filter(Boolean);
      const pick = (kind) => refs.find((r) => r.kind === kind)?.m;
      const tt = s.target_timerange || {}, st = s.source_timerange || {};
      const seg = {
        id: s.id, track: index, trackType: t.type, enabled,
        start: sec(tt.start), dur: sec(tt.duration), end: sec((tt.start || 0) + (tt.duration || 0)),
        srcStart: sec(st.start), srcDur: sec(st.duration),
        speed: s.speed ?? 1, volume: s.volume ?? 1, reverse: !!s.reverse,
        scale: s.clip?.scale?.x ?? 1, x: s.clip?.transform?.x ?? 0, y: s.clip?.transform?.y ?? 0,
        flipH: !!s.clip?.flip?.horizontal, flipV: !!s.clip?.flip?.vertical, rotation: s.clip?.rotation ?? 0,
        keyframes: (s.common_keyframes || []).map((k) => k.property_type),
        matKind: ent.kind, matType: m.type || '', name: m.material_name || m.name || '',
        path: m.path || '', matDur: sec(m.duration), width: m.width, height: m.height,
        freeze: m.type === 'photo' && !!m.freeze, photo: m.type === 'photo', compound: ent.kind === 'drafts',
      };
      if (seg.matType === 'video') {
        seg.headTrim = seg.srcStart; seg.tailTrim = Math.max(0, seg.matDur - seg.srcStart - seg.srcDur);
        seg.soundSeparated = !!m.has_sound_separated;
      }
      const sp = pick('speeds');
      seg.curveSpeed = !!(sp && (sp.mode === 1 || sp.curve_speed));
      const fade = pick('audio_fades');
      seg.fadeIn = sec(fade?.fade_in_duration); seg.fadeOut = sec(fade?.fade_out_duration);
      const tr2 = pick('transitions');
      if (tr2) seg.transition = { name: tr2.name, dur: sec(tr2.duration) };
      seg.animations = refs.filter((r) => r.kind === 'material_animations').flatMap((r) => (r.m.animations || []).map((a) => ({ type: a.type, name: a.name, dur: sec(a.duration) })));
      seg.adjust = [...new Set(refs.filter((r) => r.kind === 'effects').map((r) => r.m.type))];
      const mask = refs.find((r) => r.kind === 'common_mask' && r.m.name); if (mask) seg.mask = mask.m.name;
      const vs = pick('vocal_separations'); if (vs?.choice) seg.vocalSep = vs.choice; // 1/2 = 人声分离的两种保留方式
      const afx = refs.filter((r) => r.kind === 'audio_effects').map((r) => r.m.name); if (afx.length) seg.audioFx = afx;
      if (t.type === 'audio') {
        seg.role = AUDIO_ROLE[seg.matType] || 'other';
        // 人声分离/AI 音频算法产出的音轨（Resources/audioAlg/...）类型写成 music，实际是从视频里分出来的人声
        if (/audioAlg/i.test(seg.path)) seg.role = 'dialog';
      }
      if (t.type === 'effect' || t.type === 'filter') seg.name = m.name || m.type;
      if (t.type === 'text') {
        let c = {}; try { c = JSON.parse(m.content || '{}'); } catch { /* old plain-text content */ c = { text: m.content }; }
        const style = (c.styles || [])[0] || {};
        seg.text = c.text ?? '';
        seg.textType = m.type; // subtitle = 识别/导入字幕, text = 手打文本
        seg.fontSize = style.size ?? m.font_size;
        seg.font = (style.font?.path || m.font_path || '').split(/[\\/]/).pop();
        seg.stroke = (style.strokes || [])[0]?.width ?? 0; // 界面“描边粗细 40” = 0.08
        seg.lineSpacing = m.line_spacing; // 界面“行间距 10” = 0.5
        seg.words = m.words && m.words.text?.length ? m.words : null; // ASR word timings in ms, relative to the subtitle's start
      }
      tr.segments.push(seg);
    }
    tr.segments.sort((a, b) => a.start - b.start);
    tracks.push(tr);
  });
  return {
    file, dir, name: path.basename(dir), fps, duration: sec(j.duration),
    width: j.canvas_config?.width, height: j.canvas_config?.height,
    tracks, disabledSegments: disabled, raw: j,
  };
}

/** Does this segment contribute audible dialogue-capable sound? */
export function isDialogCarrier(seg) {
  if (seg.volume === 0) return false;
  if (seg.trackType === 'audio') return seg.role === 'dialog';
  // 做过“音频分离”的视频片段自身不再出声（成片互相关验证过），声音在分离出来的音频片段上
  return seg.trackType === 'video' && seg.matType === 'video' && !seg.soundSeparated;
}

/**
 * What the viewer actually sees: higher video tracks cover lower ones.
 * Returns [{start, end, dur, seg|null}] — seg === null is a hole (black frames).
 */
export function flattenPicture(d) {
  const vts = d.tracks.filter((t) => t.type === 'video' && !t.hidden);
  const marks = new Set([0, d.duration]);
  for (const t of vts) for (const s of t.segments) { marks.add(s.start); marks.add(s.end); }
  const ts = [...marks].filter((x) => x >= 0 && x <= d.duration + 1e-6).sort((a, b) => a - b);
  const shots = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const a = ts[i], b = ts[i + 1];
    if (b - a < 1e-6) continue;
    const mid = (a + b) / 2;
    let top = null;
    for (const t of vts) { const s = t.segments.find((s) => s.start <= mid && mid < s.end); if (s) top = s; }
    const last = shots[shots.length - 1];
    if (last && last.seg === top && Math.abs(last.end - a) < 1e-6) { last.end = b; last.dur = last.end - last.start; }
    else shots.push({ start: a, end: b, dur: b - a, seg: top });
  }
  return shots;
}

export const frames = (s, fps) => Math.round(s * fps);
/** mm:ss:ff timecode, the way 剪映 shows it. */
export function tc(s, fps = 30) {
  const f = Math.round(s * fps);
  const ff = f % fps, total = Math.floor(f / fps);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}
export const dB = (v) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)}dB` : '静音');
export const isCJK = (text) => /[一-鿿]/.test(text);
