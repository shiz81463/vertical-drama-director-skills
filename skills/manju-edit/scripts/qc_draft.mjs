#!/usr/bin/env node
// 交付前自检：按公司群公告的 10 条剪辑要求检查一条剪映草稿里“机器能看出来”的部分。
// usage: node qc_draft.mjs <draft folder | draft name> [--min-frames 5] [--max-video-tracks 4] [--json]
// 级别：✗ 违规（规则写明、机器能确定） · ! 疑似（大概率要改） · ? 待人工确认（给出时间码，去听/去看）
// 机器看不出来的（穿帮、表演、音效选得对不对、错别字）不在这里，按 SKILL.md 的流程用成片和人工补。
import { resolveDraft, loadDraft, flattenPicture, isDialogCarrier, tc, frames, isCJK } from './lib/draft.mjs';
import { checkDraftEdges } from './lib/edges.mjs';

const args = process.argv.slice(2);
const num = (k, def) => { const i = args.indexOf(k); return i >= 0 ? parseFloat(args[i + 1]) : def; };
const FLAGS = ['--json', '--no-media'];
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !FLAGS.includes(args[i - 1])));
const MIN_FRAMES = num('--min-frames', 5);
const MAX_VTRACKS = num('--max-video-tracks', 4);

let d, all;
try {
  const draftFile = resolveDraft(target);
  d = loadDraft(draftFile);
  all = loadDraft(draftFile, { includeDisabled: true });
} catch (e) { console.error('无法读取草稿：' + e.message); process.exit(2); }
const fps = d.fps, F = 1 / fps;
const T = (s) => tc(s, fps);
const issues = [];
const add = (rule, level, msg, at) => issues.push({ rule, level, at: at ?? null, tc: at != null ? T(at) : '', msg });

const vTracks = d.tracks.filter((t) => t.type === 'video');
const aTracks = d.tracks.filter((t) => t.type === 'audio');
const tTracks = d.tracks.filter((t) => t.type === 'text' && !t.hidden); // 隐藏的文字轨不出画面（无字幕版/审片批注），不按字幕查
const vSegs = vTracks.flatMap((t) => t.segments);
const aSegs = aTracks.flatMap((t) => t.segments);
const subs = tTracks.flatMap((t) => t.segments).filter((s) => s.text.trim()).sort((a, b) => a.start - b.start);
const shots = flattenPicture(d);
const pictureEnd = Math.max(0, ...vSegs.map((s) => s.end));
// 观众看得出来的切点：换了素材，或同一素材但时间不连续/缩放镜像变了。同素材原地分割不算。
const realCuts = [];
for (let i = 1; i < shots.length; i++) {
  const A = shots[i - 1].seg, Bq = shots[i].seg, t = shots[i].start;
  if (!A || !Bq) { realCuts.push(t); continue; }
  const srcAt = (s) => s.srcStart + (t - s.start) * s.speed;
  const contiguous = A.path === Bq.path && Math.abs(srcAt(A) - srcAt(Bq)) < 0.08 && A.scale === Bq.scale && A.flipH === Bq.flipH;
  if (!contiguous) realCuts.push(t);
}
const carriers = [...vSegs, ...aSegs].filter(isDialogCarrier);
const audible = [...vSegs.filter((s) => s.matType === 'video' && s.volume > 0 && !s.soundSeparated), ...aSegs.filter((s) => s.volume > 0)];
const activeAt = (list, t) => list.filter((s) => s.start <= t && t < s.end);

// ---------- 规则 1：草稿与片段复用
for (const s of vSegs) if (s.compound) add(1, '✗', `时间线上有复合片段「${s.name}」——规定不要出现复合片段，复用别集内容要导入子草稿后把片段完整复制过来（唯一例外：预告片草稿里用来铺各集正片的“时间线1”）`, s.start);

// ---------- 规则 2：夹帧 / 空洞
shots.forEach((sh, i) => {
  const n = frames(sh.dur, fps);
  if (!sh.seg) {
    if (sh.start < pictureEnd - 1e-6) add(2, '✗', `画面空洞 ${n} 帧（上下轨都没有画面，导出是黑场）`, sh.start);
    return;
  }
  if (n < MIN_FRAMES) {
    const prev = shots[i - 1]?.seg, next = shots[i + 1]?.seg;
    const peek = prev && next && sh.seg.track < prev.track && sh.seg.track < next.track;
    add(2, '!', `只有 ${n} 帧的画面「${sh.seg.name}」${peek ? '——是上层两段之间漏出来的下层轨道，典型夹帧' : ''}`, sh.start);
  }
});
for (const s of vSegs) {
  const off = Math.abs(s.start * fps - Math.round(s.start * fps));
  if (off > 0.05 && off < 0.95) { add(2, '?', `片段「${s.name}」的起点不在整帧上，容易在接缝处多出或少掉 1 帧`, s.start); }
}
// 头尾残帧（夹帧/卡帧）：读每段用到的原始素材，查入出点是不是压在素材内部切点上、头尾有没有混合帧/坏帧/停住的帧（lib/edges.mjs）。
// 这是规则 2 最常见的来源，时间线结构上看不出来。--no-media 可以跳过（只查时间线结构）。
if (!args.includes('--no-media')) {
  const { issues: eis, missing, skipped } = checkDraftEdges(d, shots);
  for (const e of eis) add(2, e.level, `头尾残帧：${e.msg}`, e.at);
  if (missing.length) add(2, 'i', `本机找不到 ${missing.length} 条素材，这些段的头尾残帧没查：${missing.slice(0, 5).join('、')}${missing.length > 5 ? '…' : ''}`);
  if (skipped.length) add(2, 'i', `倒放的片段没查头尾残帧：${skipped.join('、')}`);
}

// ---------- 规则 3：声音
for (const s of aSegs.filter((s) => s.role === 'music' && s.volume > 0)) {
  const tailCut = s.matDur && s.srcStart + s.srcDur < s.matDur - 0.1;
  if (s.end < d.duration - 0.2 && !s.fadeOut && tailCut) add(3, '!', `音乐「${s.name}」在乐曲中途结束且没有淡出——戛然而止`, s.end);
  else if (s.end >= d.duration - 0.2 && !s.fadeOut && tailCut) add(3, '?', `片尾音乐「${s.name}」没有淡出，确认结尾不是硬切`, s.end);
  if (s.srcStart > 0.1 && !s.fadeIn) add(3, '?', `音乐「${s.name}」从乐曲中段切入且没有淡入，听一下入点是否突兀`, s.start);
}
for (const s of carriers) {
  // 一句话（以字幕为准）还没完，承载它的声音片段就结束了，后面也没有别的对白接上
  const tailCut = s.matType !== 'video' ? (s.matDur && s.srcStart + s.srcDur < s.matDur - 0.05) : s.tailTrim > 0.05;
  if (!tailCut || s.fadeOut) continue;
  const over = subs.find((u) => u.start < s.end - 2 * F && u.end > s.end + 4 * F);
  if (over && !activeAt(carriers, s.end + F).length) add(3, '!', `字幕「${over.text.slice(0, 16)}」还没结束，对白声「${s.name}」就被剪断了（差 ${frames(over.end - s.end, fps)} 帧）`, s.end);
}
for (const s of aSegs.filter((s) => s.role === 'sfx' && s.volume > 0 && s.dur >= 2)) {
  if (s.matDur && s.srcStart + s.srcDur < s.matDur - 0.1 && !s.fadeOut && s.end < d.duration - 0.2) add(3, '?', `较长的音效/环境音「${s.name}」被剪断且没有淡出，听一下尾巴`, s.end);
}
for (const s of aSegs) if (s.end > pictureEnd + 2 * F) add(3, '!', `「${s.name}」比画面晚结束 ${frames(s.end - pictureEnd, fps)} 帧，片尾会多出一段只有声音的黑场`, pictureEnd);
{ // 完全没有任何声音的区间：通常是缺环境音
  const marks = [...new Set([0, pictureEnd, ...audible.flatMap((s) => [s.start, s.end])])].filter((x) => x <= pictureEnd).sort((a, b) => a - b);
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1];
    if (b - a >= 0.5 && !activeAt(audible, (a + b) / 2).length) add(3, '?', `${(b - a).toFixed(1)}s 内时间线上没有任何声音（没有原声、环境音、音乐）`, a);
  }
}

// ---------- 规则 4：音效
const sfx = aSegs.filter((s) => s.role === 'sfx' && s.volume > 0);
{
  const perMin = sfx.length / (d.duration / 60);
  if (!sfx.length) add(4, '!', '整条时间线没有一个音效。规范要求多加音效（衣服摩擦、风声、脚步、开关门……），AI 没给的要自己加');
  const marks = [0, ...sfx.flatMap((s) => [s.start, s.end]), d.duration].sort((a, b) => a - b);
  let covered = 0; const holes = [];
  for (let i = 0; i + 1 < marks.length; i++) { const a = marks[i], b = marks[i + 1]; if (activeAt(sfx, (a + b) / 2).length) covered += b - a; else if (b - a >= 10) holes.push([a, b]); }
  for (const [a, b] of holes) add(4, '?', `${(b - a).toFixed(0)}s 没有任何音效（${T(a)}–${T(b)}）。看这段有没有动作、特写、反应镜头、前推镜头该配声`, a);
  add(4, 'i', `音效 ${sfx.length} 个，${perMin.toFixed(1)} 个/分钟，覆盖 ${(100 * covered / d.duration).toFixed(0)}% 时长（参考成片：中位约 4.5 个/分钟，动作戏集可到 20+）`);
}
{ // 片尾定格的重音
  const last = shots.filter((s) => s.seg).at(-1);
  if (last?.seg.freeze && !sfx.some((s) => Math.abs(s.start - last.start) <= 0.5)) add(4, '?', '片尾定格处 ±0.5s 内没有重音/悬疑音效（成片惯例：定格起点压一个“咚/震撼结尾”）', last.start);
}

// ---------- 规则 6：转场
for (const s of vSegs) {
  if (s.transition) add(6, '!', `转场「${s.transition.name}」${s.transition.dur.toFixed(2)}s，在「${s.name}」之后。规范：尽量少加，每个转场都要说得出理由（时间跨度/场景跳转等）`, s.end);
  for (const a of s.animations) add(6, '?', `片段动画「${a.name}」(${a.type})，同样需要理由`, s.start);
}

// ---------- 规则 8：隐藏/静音的整轨
for (const t of all.tracks) {
  if (t.hidden && t.type === 'text') add(8, '?', `第 ${t.index} 条文字轨（${t.segments.length} 段，如「${(t.segments[0]?.text || '').slice(0, 10)}」）被隐藏。成片里见过两种合理用法：出无字幕版时隐藏字幕轨、把审片批注打在隐藏轨上。确认属于其一，并且这版交付本来就不该带它`);
  else if (t.hidden) add(8, '✗', `第 ${t.index} 条轨道（${t.type}，${t.segments.length} 段）被整轨隐藏——隐藏只限临时预览，交付前要恢复或删掉`);
  if (t.muted && (t.type === 'audio' || t.type === 'video')) add(8, '✗', `第 ${t.index} 条轨道（${t.type}）被整轨静音——交付前要恢复`);
}
if (d.disabledSegments) add(8, 'i', `有 ${d.disabledSegments} 个停用片段留在轨道上（不出画面/不出声）。确认都是有意保留的备选，否则删掉保持整洁`);

// ---------- 规则 9：轨道数量与次序
if (vTracks.length > MAX_VTRACKS) add(9, '!', `视频轨 ${vTracks.length} 条，规范是尽量 3–4 条以内`);
{
  const rank = { dialog: 0, sfx: 1, music: 2 };
  const desc = aTracks.map((t) => {
    const w = {}; for (const s of t.segments) w[s.role] = (w[s.role] || 0) + s.dur;
    const tot = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const [dom, domW] = Object.entries(w).sort((a, b) => b[1] - a[1])[0] || ['other', 0];
    return { index: t.index, dom, share: domW / tot, mix: Object.keys(w) };
  });
  const mixed = desc.filter((x) => x.share < 0.8);
  if (mixed.length) add(9, '!', `${mixed.length} 条音频轨把不同类型混放在一起（轨道 ${mixed.map((x) => `${x.index}:${x.mix.join('+')}`).join('，')}）。规范：依次是对白、音效、音乐，分轨放`);
  const order = desc.filter((x) => x.dom in rank).map((x) => rank[x.dom]);
  if (order.some((r, i) => i && r < order[i - 1])) add(9, '!', `音频轨次序不是“对白 → 音效 → 音乐”：现在是 ${desc.map((x) => x.dom).join(' / ')}`);
  const kinds = d.tracks.map((t) => t.type);
  const lastVideo = kinds.lastIndexOf('video'), firstFx = kinds.findIndex((k) => k === 'effect' || k === 'filter' || k === 'adjust'), firstText = kinds.indexOf('text');
  if (firstFx >= 0 && lastVideo > firstFx) add(9, '?', '有视频轨排在特效/滤镜轨之上（该轨不受特效影响）。确认是有意的；规范次序是 视频轨 → 特效轨 → 字幕轨');
  if (firstText >= 0 && lastVideo > firstText) add(9, '!', '有视频轨压在字幕轨之上，会盖住字幕');
}

// ---------- 规则 10：字幕
const PUNCT_CJK = /[，。！？、；：,.!?;:“”"‘’…—~《》（）()【】\[\]]/;
for (const u of subs) {
  const text = u.text.trim(), cjk = isCJK(text);
  // 行数：中文字幕不多于一行（群公告）；竖屏英文字幕最多两行（《字幕标准》）
  const hardLines = text.split('\n').length;
  if (cjk && hardLines > 1) add(10, '✗', `中文字幕多于一行：${JSON.stringify(text)}`, u.start);
  if (!cjk && hardLines > 2) add(10, '✗', `英文字幕多于两行：${JSON.stringify(text)}`, u.start);
  if (cjk && PUNCT_CJK.test(text)) add(10, '✗', `中文字幕里有标点：「${text}」`, u.start);
  if (!cjk && /[，。！？；：“”‘’…]/.test(text)) add(10, '✗', `英文字幕里混入了中文全角标点：「${text}」`, u.start);
  if (u.text !== text && /^\s|\s$/.test(u.text)) add(10, '?', `字幕首尾有多余空格：${JSON.stringify(u.text)}`, u.start);
  if (cjk && [...text].length > 15) add(10, '!', `中文字幕 ${[...text].length} 个字，超过成片里出现过的最长长度（15），可能挤不下一行：「${text}」`, u.start);
  // 标准样式下竖屏一行约 32 个英文字符（标准示例 "Say I have something in mind I'd / like to run by him"），超过 64 基本就是三行
  if (!cjk && d.height > d.width && text.length > 64) add(10, '!', `英文字幕 ${text.length} 个字符，按标准字号会折成三行（标准：最多两行），拆成两条：「${text}」`, u.start);
  if (frames(u.dur, fps) < 6) add(10, '!', `字幕只停留 ${frames(u.dur, fps)} 帧，看不清：「${text.slice(0, 20)}」`, u.start);
  const cps = [...text].length / u.dur;
  if ((cjk && cps > 9.5) || (!cjk && cps > 32)) add(10, '?', `字幕语速偏快（${cps.toFixed(1)} 字/秒），多半是字幕条比说话短：「${text.slice(0, 20)}」`, u.start);
  // 断句：识别字幕自带逐词时间。词与词之间停顿很长，或停顿处正好换了镜头，多半是两句话/两个人的话挤在一条里
  if (u.words) {
    const w = u.words.text.map((x, i) => ({ x: x.trim(), s: u.start + u.words.start_time[i] / 1000, e: u.start + u.words.end_time[i] / 1000 })).filter((o) => o.x);
    for (let i = 1; i < w.length; i++) {
      const gap = w[i].s - w[i - 1].e;
      const cutInside = realCuts.some((c) => c > w[i - 1].e - F && c < w[i].s + F);
      if (gap >= 1.2) add(10, '?', `一条字幕中间停了 ${gap.toFixed(1)} 秒（「${w[i - 1].x}」和「${w[i].x}」之间）——多半是两句话挤在一条里，考虑在 ${T(w[i].s)} 拆开：「${text}」`, w[i - 1].e);
      else if (gap >= 0.45 && cutInside) add(10, '?', `字幕里「${w[i - 1].x}」和「${w[i].x}」之间停了 ${gap.toFixed(1)} 秒，而且正好换了镜头——如果是换人说话，应在 ${T(w[i].s)} 拆成两条：「${text}」`, w[i - 1].e);
    }
  }
  // 与对白同步：以承载对白的片段边界为准做粗查，逐句精查要听
  const during = carriers.filter((s) => s.start < u.end - F && s.end > u.start + F);
  if (!during.length) add(10, '!', `字幕出现时没有任何对白声在播：「${text.slice(0, 20)}」`, u.start);
  else {
    const lead = Math.min(...during.map((s) => s.start)) - u.start;
    if (lead > 4 * F) add(10, '!', `字幕比对白声早出现 ${frames(lead, fps)} 帧（规范：相差 4 帧以内）：「${text.slice(0, 20)}」`, u.start);
    const lag = u.end - Math.max(...during.map((s) => s.end));
    if (lag > 4 * F) add(10, '!', `字幕比对白声晚消失 ${frames(lag, fps)} 帧：「${text.slice(0, 20)}」`, u.end);
  }
}
for (const t of tTracks) {
  const ss = t.segments;
  for (let i = 1; i < ss.length; i++) if (ss[i].start < ss[i - 1].end - 1e-6) add(10, '✗', `同一轨上两条字幕重叠 ${frames(ss[i - 1].end - ss[i].start, fps)} 帧`, ss[i].start);
}
{ // 样式一致性：字号、缩放、纵向位置应该全片统一
  const key = (u) => `字号${u.fontSize} 缩放${u.scale.toFixed(2)} y=${u.y.toFixed(2)} 描边${u.stroke ? '有' : '无'}`;
  const count = {}; for (const u of subs) count[key(u)] = (count[key(u)] || 0) + 1;
  const sorted = Object.entries(count).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1) {
    const main = sorted[0][0];
    add(10, '!', `字幕样式不统一：主样式「${main}」×${sorted[0][1]}，另有 ${sorted.slice(1).map(([k, v]) => `「${k}」×${v}`).join('、')}`);
    for (const u of subs.filter((u) => key(u) !== main).slice(0, 12)) add(10, '?', `样式与主样式不同（${key(u)}）：「${u.text.slice(0, 20)}」`, u.start);
  }
}
{ // 《字幕标准》竖屏英文：字号 8、行间距 10、描边 40、位置 X 0 / Y -465（1280 高画布），不缩放
  const en = subs.filter((u) => !isCJK(u.text));
  if (d.height > d.width && en.length) {
    const yStd = -465 / d.height * (d.height / 1280); // 草稿里存的是占画布高度的比例：-465/1280 = -0.363
    const checks = [
      ['字号不是 8', (u) => u.fontSize !== 8, (u) => `字号 ${u.fontSize}`],
      ['高度不是 Y -465', (u) => Math.abs(u.y - yStd) > 0.006, (u) => `Y ${Math.round(u.y * 1280)}`],
      ['水平位置不是 X 0', (u) => Math.abs(u.x) > 0.006, (u) => `X ${Math.round(u.x * 720)}`],
      ['描边不是 40', (u) => Math.abs((u.stroke || 0) - 0.08) > 0.004, (u) => `描边 ${Math.round((u.stroke || 0) * 500)}`],
      ['被缩放（标准是 100%）', (u) => Math.abs(u.scale - 1) > 0.005, (u) => `缩放 ${Math.round(u.scale * 100)}%`],
      ['行间距不是 10', (u) => u.lineSpacing != null && Math.abs(u.lineSpacing - 0.5) > 0.03, (u) => `行间距 ${Math.round(u.lineSpacing * 20)}`],
    ];
    for (const [label, test, show] of checks) {
      const bad = en.filter(test);
      if (bad.length) add(10, '!', `${bad.length}/${en.length} 条英文字幕${label}（实际：${[...new Set(bad.map(show))].slice(0, 4).join('、')}）。《字幕标准》：字号 8、行间距 10、描边 40、X 0、Y -465；首条在此`, bad[0].start);
    }
  }
}
{ // 两条字幕轨同时有字：双语或误叠
  const lanes = tTracks.map((t) => t.segments.filter((s) => s.text.trim()));
  for (let a = 0; a < lanes.length; a++) for (let b = a + 1; b < lanes.length; b++) {
    const hit = lanes[a].find((x) => lanes[b].some((y) => x.start < y.end - F && y.start < x.end - F));
    if (hit) add(10, '?', `两条字幕轨在同一时间都有字（如「${hit.text.slice(0, 12)}」处），确认不是叠字`, hit.start);
  }
}

// ---------- 输出
if (args.includes('--json')) { console.log(JSON.stringify({ draft: d.name, fps, duration: d.duration, issues, subtitles: subs.map((u) => ({ tc: T(u.start), text: u.text })) }, null, 1)); process.exit(0); }
const RULES = { 1: '草稿与片段复用', 2: '夹帧 / 画面空洞', 3: '声音剪辑', 4: '音效', 6: '转场', 8: '整轨隐藏/静音', 9: '轨道数量与次序', 10: '字幕' };
const n = (l) => issues.filter((i) => i.level === l).length;
console.log(`# 交付自检 · ${d.name}`);
console.log(`${d.duration.toFixed(1)}s · ${d.width}x${d.height} · ${fps}fps · 画面 ${shots.filter((s) => s.seg).length} 段 · 视频轨 ${vTracks.length} / 音频轨 ${aTracks.length} / 字幕 ${subs.length} 条`);
console.log(`结果：✗ 违规 ${n('✗')} · ! 疑似 ${n('!')} · ? 待确认 ${n('?')}\n`);
for (const r of Object.keys(RULES)) {
  const list = issues.filter((i) => i.rule === +r).sort((a, b) => '✗!?i'.indexOf(a.level) - '✗!?i'.indexOf(b.level) || (a.at ?? 0) - (b.at ?? 0));
  console.log(`## 规则 ${r} · ${RULES[r]}${list.some((i) => i.level !== 'i') ? '' : ' — 通过'}`);
  for (const i of list) console.log(`  ${i.level} ${i.tc ? i.tc + '  ' : ''}${i.msg}`);
}
console.log('\n## 机器查不了的（规则 5、7 和错别字）');
console.log('  · 规则 5：先把画面和声音剪到没错、自成节奏，再加音乐——看不加音乐时成不成立');
console.log('  · 规则 7：穿帮要看画面——用 qc_media.mjs 对成片出逐镜头接触表，逐张看');
console.log('  · 错别字：下面是全部字幕，逐条对照台词本校对');
for (const u of subs) console.log(`    ${T(u.start)}  ${u.text.replace(/\n/g, '⏎')}`);
