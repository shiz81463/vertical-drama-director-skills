#!/usr/bin/env node
// 核对“时间线上的每段声音是否真的出现在成片里”：把成片的声音和每个音频片段的源文件做互相关。
// usage: node audio_in_export.mjs <draft folder | draft name> <export.mp4> [--media-root <素材所在的草稿文件夹>]
// 用途：导出后发现少了对白/音效（整轨静音、片段被停用、分离后的原声丢了）时定位是哪一段。
// corr 接近 1 = 清楚听得到；0.3–0.7 = 被别的声音盖着但在；接近 0 = 成片里没有这段声音。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolveDraft, loadDraft, tc } from './lib/draft.mjs';

const args = process.argv.slice(2);
const mrI = args.indexOf('--media-root');
const pos = args.filter((a, i) => !a.startsWith('--') && i !== mrI + 1);
if (pos.length < 2) { console.error('用法: node audio_in_export.mjs <草稿> <成片.mp4> [--media-root 目录]'); process.exit(2); }
const d = loadDraft(resolveDraft(pos[0]), { includeDisabled: true });
const mediaRoot = mrI >= 0 ? args[mrI + 1] : d.dir;
const pcm = (file, ss, t) => { const b = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(ss), '-t', String(t), '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 }); return new Int16Array(b.buffer, b.byteOffset, b.length >> 1); };
const xc = (a, b) => { let best = 0; for (let lag = -400; lag <= 400; lag += 4) { let s = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { const j = i + lag; if (j < 0 || j >= b.length) continue; s += a[i] * b[j]; sa += a[i] * a[i]; sb += b[j] * b[j]; } const r = s / Math.sqrt(sa * sb + 1); if (Math.abs(r) > Math.abs(best)) best = r; } return best; };
console.log(`# ${d.name} ↔ ${path.basename(pos[1])}`);
for (const t of d.tracks) for (const s of t.segments) {
  if (t.type !== 'audio' || s.dur < 0.6) continue;
  if (Math.abs(s.speed - 1) > 0.01) { console.log(`  跳过(变速)  ${tc(s.start, d.fps)}  ${s.name}`); continue; }
  const src = path.isAbsolute(s.path) ? s.path : path.join(mediaRoot, s.path);
  try {
    const n = Math.min(s.dur, 3);
    const r = Math.abs(xc(pcm(pos[1], s.start, n), pcm(src, s.srcStart, n)));
    const verdict = r > 0.25 ? '在' : (s.enabled && s.volume > 0 ? '✗ 时间线上启用但成片里听不到' : '不在（已停用/音量为 0，符合预期）');
    console.log(`  ${s.enabled ? '启用' : '停用'}  ${tc(s.start, d.fps)}  ${s.role.padEnd(6)} corr=${r.toFixed(2)}  ${verdict}  ${s.name}`);
  } catch { console.log(`  读不到源文件  ${tc(s.start, d.fps)}  ${s.name}  (${src})`); }
}
