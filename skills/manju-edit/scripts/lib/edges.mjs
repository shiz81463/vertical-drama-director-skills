// 对着草稿查每段画面的头尾残帧：读每段用到的原始素材，看入点/出点是不是压在素材内部切点的边上，
// 头尾有没有混合帧、坏帧、卡住不动的帧。qc_draft.mjs（规则 2）和 qc_edges.mjs 共用。
//
// 为什么要查素材而不只查成片：AI 生成的一条素材里自带好几个镜头。入点早了 1 帧，这一段开头就带着素材里上一个镜头的最后 1 帧；
// 出点晚了 1 帧，结尾就带着下一个镜头的第 1 帧。时间线上看是一整段，导出后才露出来，而且成片里看不出是哪一段、该拖哪条边。
import fs from 'node:fs';
import path from 'node:path';
import { probe, decodeGray, detectCuts, edgeCheck, findBlendFrames, findGlitchFrames, KIND_ZH } from './frames.mjs';
import { listDrafts } from './draft.mjs';

/** 草稿里的素材路径常是相对路径（相对剪映里那份草稿的文件夹）；读的是明文备份时，要回到剪映的草稿文件夹去找 */
export function resolveMedia(p, d) {
  if (!p) return null;
  const rel = p.replace(/^##_draftpath_placeholder_[^#]*_##[\\/]?/, '');
  const cands = [p, path.join(d.dir, rel)];
  const base = d.name.split('@')[0];
  for (const x of listDrafts()) if (x.name === base) cands.push(path.join(x.dir, rel));
  return cands.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || null;
}

const cache = new Map();
/** 一条素材分析一次：内部切点、混合帧、坏帧、每个内部镜头头尾的残帧和卡帧 */
export function analyzeSource(file) {
  if (cache.has(file)) return cache.get(file);
  const P = probe(file);
  if (!P.v) { cache.set(file, null); return null; }
  const S = decodeGray(file, P.v.width, P.v.height);
  const { cuts, nbr } = detectCuts(S);
  const bad = new Map(); // 源帧号 → 什么问题
  for (const b of findBlendFrames(S)) for (let k = 0; k < b.len; k++) bad.set(b.at + k, 'blend');
  for (const g of findGlitchFrames(S, cuts)) for (let k = 0; k < g.len; k++) bad.set(g.at + k, g.kind);
  const marks = [0, ...cuts, S.NF];
  const freeze = new Map(); // 源帧号 → 卡帧
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1];
    for (const e of edgeCheck(S, a, b, { prev: a - 1, next: b < S.NF ? b : -1, fps: P.fps })) {
      const r0 = e.side === 'head' ? a : b - e.k;
      for (let k = 0; k < e.k; k++) (e.kind === 'freeze' ? freeze : bad).set(r0 + k, e.kind === 'freeze' ? 'freeze' : (bad.get(r0 + k) || e.kind));
    }
  }
  const shotOf = new Int32Array(S.NF); { let id = 0, c = 0; for (let f = 0; f < S.NF; f++) { while (c < cuts.length && cuts[c] <= f) { id++; c++; } shotOf[f] = id; } }
  const out = { file, fps: P.fps, NF: S.NF, S, cuts, nbr, bad, freeze, shotOf };
  cache.set(file, out);
  return out;
}

const T_EPS = 1e-6;
// 剪映把入出点存成整微秒（1.666666s 其实是第 50 帧），换算成素材帧号时容差 0.001 帧
const F_EPS = 1e-3;
/**
 * shots：flattenPicture 的结果（观众实际看到的每一段画面）。返回 issues [{level, at, msg, piece}]。
 * at 是时间线秒数。fps 是时间线帧率。
 */
export function checkDraftEdges(d, shots, { onProgress } = {}) {
  const fps = d.fps, F = 1 / fps;
  const issues = [], missing = new Set(), skipped = [];
  const add = (level, at, msg, piece) => issues.push({ level, at, msg, piece });
  const contiguous = (A, B, t) => {
    if (!A || !B) return false;
    const srcAt = (s) => s.srcStart + (t - s.start) * s.speed;
    return A.path === B.path && Math.abs(srcAt(A) - srcAt(B)) < 0.08 && A.scale === B.scale && A.flipH === B.flipH;
  };
  const STRONG = ['blend', 'other', 'garble', 'black', 'white'];
  // 一段画面在素材里的位置。时间线上每一帧显示“这一帧开始那一刻素材里已经出现的最后一帧”（向下取整）。
  // 2026-11-21 用 21 条定稿草稿对照导出成片校准：原速片段两种算法给出不同素材帧的 57 处接缝里 51 处是向下取整（1 处四舍五入、5 处分不清）。
  // 变速片段只碰到 1 处能分辨的（第5集 0.7x），符合“起点先取整、再加偏移量取整”。所以变速片段两种都算，两种都有问题才判“大概率要改”。
  const place = (sh) => {
    const seg = sh?.seg;
    if (!seg || seg.matType !== 'video' || seg.photo || !seg.path || seg.reverse) return null;
    const src = resolveMedia(seg.path, d); if (!src) return null;
    const A = analyzeSource(src); if (!A || A.NF < 2) return null;
    const sf = A.fps, T0 = Math.round(sh.start * fps), T1 = Math.round(sh.end * fps), S0 = Math.round(seg.start * fps);
    const clamp = (x) => Math.min(A.NF - 1, Math.max(0, x));
    const srcT = (T) => seg.srcStart + (T / fps - seg.start) * seg.speed;
    const h1 = (T) => clamp(Math.floor(srcT(T) * sf + F_EPS));
    const h2 = (T) => clamp(Math.floor(seg.srcStart * sf + F_EPS) + Math.floor((T - S0) * seg.speed * sf / fps + F_EPS));
    const cand = (T) => (seg.speed === 1 ? [h1(T)] : [...new Set([h1(T), h2(T)])]);
    return { seg, src, A, sf, T0, T1, srcT, cand, first: h1(T0), last: h1(T1 - 1) };
  };
  // 两段画面里的两帧像不像（不同素材也能比，只要小图尺寸一样）
  const crossSim = (A1, f1, A2, f2) => {
    if (A1 === A2) return A1.S.sim(f1, f2);
    const P = A1.S.PX; if (P !== A2.S.PX) return null;
    const b1 = A1.S.buf, b2 = A2.S.buf, o1 = f1 * P, o2 = f2 * P;
    let m1 = 0, m2 = 0; for (let k = 0; k < P; k++) { m1 += b1[o1 + k]; m2 += b2[o2 + k]; } m1 /= P; m2 /= P;
    let x = 0, y = 0, z = 0; for (let k = 0; k < P; k++) { const a = b1[o1 + k] - m1, b = b2[o2 + k] - m2; x += a * b; y += a * a; z += b * b; }
    return x / Math.sqrt(y * z + 1e-9);
  };
  // 切点前后亮度差很多、构图又还连着：可能只是闪电/开灯，不一定是换镜头
  const lightOnly = (A, c) => Math.abs(A.S.lum[c] - A.S.lum[c - 1]) > 25 && A.S.sim(c - 1, c) >= 0.3;
  // 一顿一顿的快动作（素材本身帧率低、每隔两三帧重复一帧）：切点检测会把每次跳动都当成切点，扎堆出现。
  // 第3集 a5onj8 11 秒实测：奔跑镜头 ±6 帧里 4 个重复帧、±10 帧里还有 2 个“切点”，其实没换镜头
  const jerky = (A, c) => { let dup = 0; for (let i = c - 6; i <= c + 6; i++) if (i > 0 && i < A.NF && A.S.md[i] < 0.35) dup++; return dup >= 3 && A.cuts.some((x) => x !== c && Math.abs(x - c) <= 10); };
  const doubt = (A, c) => (lightOnly(A, c) ? '（这里前后亮度差很多，也可能只是闪电/开灯，不是换镜头）' : jerky(A, c) ? '（这里素材是一顿一顿的快动作，这个切点可能是误判）' : '');
  shots.forEach((sh, i) => {
    const seg = sh.seg;
    if (!seg || seg.matType !== 'video' || seg.photo) return;
    if (!seg.path) return; // 预设/占位素材，没有文件
    if (!resolveMedia(seg.path, d)) { missing.add(seg.name || seg.path); return; }
    if (seg.reverse) { skipped.push(seg.name + '（倒放）'); return; }
    onProgress?.(seg.name);
    const p = place(sh);
    if (!p || p.T1 - p.T0 < 2) return; // 1 帧的画面已经按“少于 N 帧”报过
    const { A, sf, T0, T1, srcT, cand } = p;
    const firstT = srcT(T0), lastT = srcT(T1 - 1);
    const sp = seg.speed !== 1 ? '（变速片段：剪映变速时取哪一帧只校准过 1 处，看逐帧条确认）' : '';
    const curve = seg.curveSpeed ? '（曲线变速，按匀速估算，看逐帧条确认）' : sp;
    const label = '「' + seg.name + '」';
    const prevP = shots[i - 1]?.seg ? place(shots[i - 1]) : null;
    const nextP = shots[i + 1]?.seg ? place(shots[i + 1]) : null;
    const headCut = !contiguous(shots[i - 1]?.seg, seg, sh.start);
    const tailCut = !contiguous(seg, shots[i + 1]?.seg, sh.end);
    const tcAt = (srcFrame) => sh.start + Math.max(0, (srcFrame / sf - firstT) / seg.speed);
    const dragHead = (c) => Math.max(1, Math.ceil((((c - F_EPS) / sf) - firstT) / seg.speed * fps - T_EPS)); // 让第一帧落到源帧 c 及之后
    const dragTail = (c) => Math.max(1, Math.floor((lastT - (c - F_EPS) / sf) / seg.speed * fps) + 1); // 让最后一帧落到源帧 c 之前
    // 残帧和隔壁那段挨着的画面其实是同一个：观众看到的只是切点早/晚了一两帧，不算夹帧（校园21 21 秒、40 秒实测是这种）
    const sameAsPrev = (f) => { if (!prevP) return false; const v = crossSim(A, f, prevP.A, prevP.last); return v != null && v >= 0.8; };
    const sameAsNext = (f) => { if (!nextP) return false; const v = crossSim(A, f, nextP.A, nextP.first); return v != null && v >= 0.8; };

    // ---- 头
    if (headCut) {
      const sAs = cand(T0), sA = sAs[0];
      // a) 入点早于素材内部切点：开头几帧是素材里上一个镜头
      const hits = sAs.map((x) => A.cuts.find((c) => c > x && c <= x + 3));
      const c = hits.find((h) => h != null);
      if (c != null && !sameAsPrev(sA)) {
        const sure = hits.every((h) => h != null) && !doubt(A, c);
        add(sure ? '!' : '?', sh.start, label + '开头 ' + (c - sA) + ' 帧（素材帧）是素材里上一个镜头的画面：入点在素材 ' + firstT.toFixed(3) + 's，素材在 ' + (c / sf).toFixed(3) + 's 处换镜头' + doubt(A, c) + curve + ' → 左边缘向右拖 ' + dragHead(c) + ' 帧', sh);
      } else if (c == null) {
        // b) 开头几帧本身是坏的：混合帧/坏帧/和本镜头对不上
        let k = 0; while (k < 3 && sA + k <= p.last && A.bad.has(sA + k)) k++;
        if (k && !sameAsPrev(sA)) {
          const kind = A.bad.get(sA);
          add(STRONG.includes(kind) && !sp ? '!' : '?', sh.start, label + '开头 ' + k + ' 帧（素材帧）是' + KIND_ZH[kind] + curve + ' → 左边缘向右拖 ' + dragHead(sA + k) + ' 帧', sh);
        }
        // c) 卡帧：入点落在一段停住不动的帧上
        let fz = 0; while (sA + fz <= p.last && A.freeze.has(sA + fz)) fz++;
        if (fz >= 2 && !k) add('?', sh.start, label + '开头 ' + fz + ' 帧（素材帧）画面停住不动，之后才开始动（AI 起幅僵直/卡帧）' + curve + ' → 左边缘向右拖 ' + dragHead(sA + fz) + ' 帧', sh);
      }
    }
    // ---- 尾
    if (tailCut) {
      const sBs = cand(T1 - 1), sB = sBs[0];
      const hits = sBs.map((x) => [...A.cuts].reverse().find((c) => c <= x && c >= x - 2));
      const c = hits.find((h) => h != null);
      if (c != null && !sameAsNext(sB)) {
        const sure = hits.every((h) => h != null) && !doubt(A, c);
        add(sure ? '!' : '?', sh.end - dragTail(c) / fps, label + '结尾 ' + (sB - c + 1) + ' 帧（素材帧）是素材里下一个镜头的画面：出点在素材 ' + lastT.toFixed(3) + 's，素材在 ' + (c / sf).toFixed(3) + 's 处换镜头' + doubt(A, c) + curve + ' → 右边缘向左拖 ' + dragTail(c) + ' 帧', sh);
      } else if (c == null) {
        let k = 0; while (k < 3 && sB - k >= p.first && A.bad.has(sB - k)) k++;
        if (k && !sameAsNext(sB)) {
          const kind = A.bad.get(sB);
          add(STRONG.includes(kind) && !sp ? '!' : '?', sh.end - dragTail(sB - k + 1) / fps, label + '结尾 ' + k + ' 帧（素材帧）是' + KIND_ZH[kind] + curve + ' → 右边缘向左拖 ' + dragTail(sB - k + 1) + ' 帧', sh);
        }
        let fz = 0; while (sB - fz >= p.first && A.freeze.has(sB - fz)) fz++;
        const lastPiece = !shots.slice(i + 1).some((s) => s.seg);
        if (fz >= 2 && !k && !lastPiece) add('?', sh.end - dragTail(sB - fz + 1) / fps, label + '结尾 ' + fz + ' 帧（素材帧）画面停住不动（素材末尾卡住/卡帧）' + curve + ' → 右边缘向左拖 ' + dragTail(sB - fz + 1) + ' 帧', sh);
      }
    }
    // ---- 中间：用到的区间里，素材内部切点上的混合帧、单独坏掉的几帧
    const a0 = p.first + 3, b0 = p.last - 3;
    const seen = new Set();
    for (let f = a0; f <= b0; f++) {
      const kind = A.bad.get(f);
      if (!kind || seen.has(f) || A.freeze.has(f)) continue;
      let k = 0; while (A.bad.has(f + k)) { seen.add(f + k); k++; }
      const atCut = A.cuts.some((c) => Math.abs(c - f) <= 2);
      const lvl = kind === 'blend' || (atCut && STRONG.includes(kind)) ? '!' : '?';
      add(lvl, tcAt(f), label + '中间有 ' + k + ' 帧（素材帧）' + KIND_ZH[kind] + (atCut ? '，就在素材内部换镜头的地方（兜底手册 A8）' : '') + ' → 在这里分割，删掉这 ' + k + ' 帧' + (atCut ? '' : '，接缝用叠盖/放大一档盖住'), sh);
    }
    // 素材内部的极短镜头（1–2 帧）落在用到的区间里。两侧画面都稳才像真夹帧；两侧也在剧烈变化的多半是快动作
    for (let q = 0; q + 1 < A.cuts.length; q++) {
      const c1 = A.cuts[q], c2 = A.cuts[q + 1];
      if (!(c2 - c1 <= 2 && c1 >= p.first && c2 <= p.last + 1)) continue;
      const steady = A.nbr(c1, -1) >= 0.85 && A.nbr(c2, 1) >= 0.85;
      add(steady ? '!' : '?', tcAt(c1), label + '素材内部夹着 ' + (c2 - c1) + ' 帧别的画面（素材 ' + (c1 / sf).toFixed(3) + 's）' + (steady ? '' : '——但前后本身也在快速变化，多半是快动作，看逐帧条') + ' → 是夹帧就在这里分割，删掉这 ' + (c2 - c1) + ' 帧', sh);
    }
  });
  return { issues, missing: [...missing], skipped };
}
