#!/usr/bin/env node
// 头尾残帧检查（夹帧 / 卡帧）：对着草稿，读每段画面用到的原始素材，查入点、出点有没有压在素材内部切点的边上，
// 头尾有没有混合帧、坏帧、停住不动的帧；素材内部切点上有没有混合帧。导出之前就能查，报出来的是“哪一段、头还是尾、拖几帧”。
// usage: node qc_edges.mjs <草稿文件夹 | 草稿名> [--json]
//        node qc_edges.mjs <成片或素材.mp4>          （没有草稿时：只看画面，等于 qc_media.mjs 里的残帧部分）
// 需要 ffmpeg / ffprobe。qc_draft.mjs 默认也会跑这一项（规则 2）；这个脚本单独跑、输出更细。
import fs from 'node:fs';
import { resolveDraft, loadDraft, flattenPicture, tc } from './lib/draft.mjs';
import { checkDraftEdges } from './lib/edges.mjs';
import { probe, decodeGray, detectCuts, edgeCheck, findBlendFrames, findGlitchFrames, KIND_ZH } from './lib/frames.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) { console.error('用法: node qc_edges.mjs <草稿名|草稿文件夹|视频.mp4> [--json]'); process.exit(2); }

if (fs.existsSync(target) && fs.statSync(target).isFile() && !/\.json$/i.test(target)) {
  // 只有视频：按画面找
  const P = probe(target); const fps = P.fps;
  const S = decodeGray(target, P.v.width, P.v.height);
  const { cuts } = detectCuts(S);
  const marks = [0, ...cuts, S.NF], out = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1];
    if (b - a < 5 && a > 0 && b < S.NF) out.push({ f: a, msg: `! ${b - a} 帧的极短镜头（夹帧？）` });
    for (const e of edgeCheck(S, a, b, { prev: a - 1, next: b < S.NF ? b : -1, fps })) {
      if (e.kind === 'freeze' && e.side === 'tail' && b === S.NF) continue;
      out.push({ f: e.side === 'head' ? a : b - e.k, msg: `${e.level} 镜头${e.side === 'head' ? '开头' : '结尾'} ${e.k} 帧：${KIND_ZH[e.kind]}` });
    }
  }
  for (const bl of findBlendFrames(S)) out.push({ f: bl.at, msg: `! 切点上 ${bl.len} 帧${KIND_ZH.blend}` });
  for (const g of findGlitchFrames(S, cuts)) out.push({ f: g.at, msg: `? 镜头中间 ${g.len} 帧${KIND_ZH[g.kind]}` });
  console.log(`# 头尾残帧 · ${target.split(/[\\/]/).pop()} · ${S.NF} 帧 · ${fps}fps · 切点 ${cuts.length}`);
  for (const o of out.sort((x, y) => x.f - y.f)) console.log(`  ${tc(o.f / fps, Math.round(fps))}  ${o.msg}（--strip ${(o.f / fps).toFixed(2)}）`);
  if (!out.length) console.log('  没发现（机器只看得出明显的；接缝还是要逐帧看）');
  process.exit(0);
}

let d;
try { d = loadDraft(resolveDraft(target)); } catch (e) { console.error('无法读取草稿：' + e.message); process.exit(2); }
const shots = flattenPicture(d);
const { issues, missing, skipped } = checkDraftEdges(d, shots);
issues.sort((a, b) => a.at - b.at);
if (args.includes('--json')) { console.log(JSON.stringify({ draft: d.name, issues: issues.map(({ level, at, msg }) => ({ level, tc: tc(at, d.fps), at, msg })), missing, skipped }, null, 1)); process.exit(0); }
console.log(`# 头尾残帧 · ${d.name}`);
console.log(`画面 ${shots.filter((s) => s.seg).length} 段 · 查了素材 ${new Set(shots.filter((s) => s.seg?.matType === 'video').map((s) => s.seg.path)).size - missing.length} 条`);
const n = (l) => issues.filter((i) => i.level === l).length;
console.log(`结果：! 大概率要改 ${n('!')} · ? 待确认 ${n('?')}\n`);
for (const i of issues) console.log(`  ${i.level} ${tc(i.at, d.fps)}  ${i.msg}`);
if (!issues.length) console.log('  没发现素材层面的残帧。');
if (missing.length) console.log(`\n本机找不到这些素材，没查：${missing.join('、')}`);
if (skipped.length) console.log(`没查：${skipped.join('、')}`);
console.log('\n说明：“帧”在箭头前是素材帧（AI 素材多是 24fps），箭头后“拖 N 帧”是时间线帧，照着在剪映里拖。改完把播放头放到时间码，用 ←/→ 逐帧看接缝；导出后再跑 qc_media.mjs。');
