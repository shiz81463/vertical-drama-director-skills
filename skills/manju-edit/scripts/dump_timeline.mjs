#!/usr/bin/env node
// Print a 剪映 draft as a readable cut list, so the edit can be reviewed without opening 剪映.
// usage: node dump_timeline.mjs <draft folder | draft name> [--all] [--from 12.5] [--to 30]
//   --all   also show 停用片段 (disabled segments), marked with ✗
import { resolveDraft, loadDraft, flattenPicture, tc, dB } from './lib/draft.mjs';

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const target = args.find((a) => !a.startsWith('--') && a !== opt('--from') && a !== opt('--to'));
const from = parseFloat(opt('--from', '0')), to = parseFloat(opt('--to', '1e9'));
let d;
try { d = loadDraft(resolveDraft(target), { includeDisabled: args.includes('--all') }); } catch (e) { console.error('无法读取草稿：' + e.message); process.exit(2); }
const T = (s) => tc(s, d.fps);
const inRange = (s) => s.end > from && s.start < to;

console.log(`# ${d.name}`);
console.log(`时长 ${d.duration.toFixed(2)}s | 画布 ${d.width}x${d.height} | ${d.fps}fps | 停用片段 ${d.disabledSegments} 个${args.includes('--all') ? '（已显示）' : '（未显示，--all 可看）'}`);
console.log(`轨道（自上而下为文件顺序）: ${d.tracks.map((t) => `${t.type}${t.segments.length}${t.hidden ? '[隐藏]' : ''}${t.muted ? '[静音]' : ''}`).join('  ')}`);

console.log('\n## 观众看到的画面（多轨压平后）');
const shots = flattenPicture(d).filter(inRange);
shots.forEach((sh, i) => {
  const s = sh.seg;
  if (!s) { console.log(`${T(sh.start)}–${T(sh.end)} ${sh.dur.toFixed(2)}s  ■ 空洞（黑场）`); return; }
  const tags = [];
  if (s.freeze) tags.push('定格'); else if (s.photo) tags.push('图片');
  if (s.compound) tags.push('复合片段');
  if (Math.abs(s.speed - 1) > 0.001) tags.push(`${s.speed.toFixed(2)}x`);
  if (s.curveSpeed) tags.push('曲线变速');
  if (s.reverse) tags.push('倒放');
  if (Math.abs(s.scale - 1) > 0.005) tags.push(`缩放${Math.round(s.scale * 100)}%`);
  if (Math.abs(s.x) > 0.005 || Math.abs(s.y) > 0.005) tags.push(`位移(${s.x.toFixed(2)},${s.y.toFixed(2)})`);
  if (s.flipH) tags.push('镜像');
  if (s.transition) tags.push(`转场:${s.transition.name}`);
  if (s.animations.length) tags.push('动画:' + s.animations.map((a) => a.name).join('/'));
  if (s.mask) tags.push(`蒙版:${s.mask}`);
  if (s.adjust.length) tags.push('调色');
  if (s.vocalSep) tags.push('人声分离');
  if (s.matType === 'video') tags.push(s.soundSeparated ? '原声已分离' : s.volume === 0 ? '原声关' : `原声${dB(s.volume)}`);
  // 只写“看得见的那一截”对应的素材区间：片段被上层轨道盖住的部分不算
  const vis0 = s.srcStart + (sh.start - s.start) * s.speed, vis1 = s.srcStart + (sh.end - s.start) * s.speed;
  const covered = sh.start > s.start + 1e-6 || sh.end < s.end - 1e-6;
  const src = s.matType === 'video' ? ` 源[${vis0.toFixed(2)}–${vis1.toFixed(2)}/${s.matDur.toFixed(1)}s]${covered ? '(部分被上层盖住)' : ''}` : '';
  console.log(`${String(i + 1).padStart(3)}. ${T(sh.start)}–${T(sh.end)} ${sh.dur.toFixed(2).padStart(5)}s  V${s.track}  ${s.name}${src}  ${tags.join(' · ')}`);
});

for (const t of d.tracks) {
  if (t.type === 'video') continue;
  const segs = t.segments.filter(inRange);
  if (!segs.length) continue;
  console.log(`\n## 轨道 ${t.index} · ${t.type}${t.hidden ? ' [隐藏]' : ''}${t.muted ? ' [静音]' : ''}`);
  for (const s of segs) {
    const off = s.enabled ? ' ' : '✗';
    if (t.type === 'text') console.log(`${off}${T(s.start)}–${T(s.end)} ${s.dur.toFixed(2).padStart(5)}s  ${JSON.stringify(s.text)}`);
    else if (t.type === 'audio') {
      const tags = [s.role, dB(s.volume)];
      if (s.fadeIn) tags.push(`淡入${s.fadeIn.toFixed(2)}s`);
      if (s.fadeOut) tags.push(`淡出${s.fadeOut.toFixed(2)}s`);
      if (Math.abs(s.speed - 1) > 0.001) tags.push(`${s.speed.toFixed(2)}x`);
      if (s.vocalSep) tags.push('人声分离');
      if (s.audioFx) tags.push('音频特效:' + s.audioFx.join('/'));
      const tail = s.matDur ? ` 源[${s.srcStart.toFixed(2)}–${(s.srcStart + s.srcDur).toFixed(2)}/${s.matDur.toFixed(1)}s]` : '';
      console.log(`${off}${T(s.start)}–${T(s.end)} ${s.dur.toFixed(2).padStart(5)}s  ${s.name}${tail}  ${tags.join(' · ')}`);
    } else console.log(`${off}${T(s.start)}–${T(s.end)} ${s.dur.toFixed(2).padStart(5)}s  ${s.name}`);
  }
}
