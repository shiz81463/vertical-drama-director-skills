// 读画面的公共部分：把视频解码成小灰度图、算相邻帧相似度、找切点、找镜头头尾的残帧。
// qc_media.mjs（查成片/单条素材）和 qc_edges.mjs（对着草稿查每段素材的入出点）共用。只依赖 ffmpeg / ffprobe。
import { spawnSync } from 'node:child_process';

export const run = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: o.binary ? 'buffer' : 'utf8', maxBuffer: 1 << 30 });

/** ffprobe 一下：{ v, a, fps, dur, format } */
export function probe(file) {
  const p = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).stdout || '{}');
  const v = (p.streams || []).find((s) => s.codec_type === 'video');
  const a = (p.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) return { v: null, a, fps: 0, dur: 0, format: p.format };
  const [fn, fd] = v.r_frame_rate.split('/').map(Number);
  return { v, a, fps: fn / (fd || 1), dur: parseFloat(p.format?.duration || v.duration || 0), format: p.format };
}

/** 长边 48 像素的灰度小图尺寸（偶数） */
export function thumbSize(w, h) {
  const TW = w >= h ? 48 : Math.max(2, Math.round((48 * w) / h / 2) * 2);
  const TH = w >= h ? Math.max(2, Math.round((48 * h) / w / 2) * 2) : 48;
  return [TW, TH];
}

/** 解码成灰度小图序列。不给 from/count 就整条解码。 */
export function decodeGray(file, w, h, { fromFrame, count, fps } = {}) {
  const [TW, TH] = thumbSize(w, h);
  const pre = fromFrame != null && fromFrame > 0 ? ['-ss', ((fromFrame - 0.4) / fps).toFixed(4)] : [];
  const lim = count ? ['-frames:v', String(count)] : [];
  const buf = run('ffmpeg', ['-v', 'error', ...pre, '-i', file, '-an', ...lim, '-vf', `scale=${TW}:${TH},format=gray`, '-f', 'rawvideo', '-'], { binary: true }).stdout;
  return series(buf, TW * TH);
}

/**
 * 一串灰度帧和它们之间的度量。
 * sim(i,j)：去掉亮度后的“画面结构相似度”（相关系数，1 = 一样）；mad(i,j)：平均每像素差多少（0–255）。
 */
export function series(buf, PX) {
  const NF = Math.floor(buf.length / PX);
  const lum = new Float64Array(NF), nrm = new Float64Array(NF);
  for (let i = 0; i < NF; i++) {
    let s = 0; for (let k = 0; k < PX; k++) s += buf[i * PX + k];
    const m = s / PX; lum[i] = m;
    let q2 = 0; for (let k = 0; k < PX; k++) { const d = buf[i * PX + k] - m; q2 += d * d; }
    nrm[i] = Math.sqrt(q2);
  }
  const isFlat = (i) => nrm[i] / Math.sqrt(PX) < 2; // 整帧几乎一个颜色：黑帧/白帧
  const sim = (i, j) => {
    if (isFlat(i) && isFlat(j)) return 1;
    if (isFlat(i) || isFlat(j)) return 0;
    let s = 0; const mi = lum[i], mj = lum[j];
    for (let k = 0; k < PX; k++) s += (buf[i * PX + k] - mi) * (buf[j * PX + k] - mj);
    return s / (nrm[i] * nrm[j]);
  };
  const mad = (i, j) => { let s = 0; for (let k = 0; k < PX; k++) s += Math.abs(buf[i * PX + k] - buf[j * PX + k]); return s / PX; };
  const cs = new Float64Array(NF); if (NF) cs[0] = 1; for (let i = 1; i < NF; i++) cs[i] = sim(i - 1, i);
  const md = new Float64Array(NF); for (let i = 1; i < NF; i++) md[i] = mad(i - 1, i);
  return { buf, PX, NF, lum, nrm, isFlat, sim, mad, cs, md };
}

/**
 * 切点：相似度只在这一帧突然掉下去、前后都稳才算——暗场戏不漏，连续几帧都在变的快动作/甩镜头也不会被当成一串切点。
 * 用 7 条定稿对照时间线上的真实切点校准过：找回 97–100%。返回“新镜头第一帧”的帧号。
 */
export function detectCuts(S, { th = 0.6, prom = 0.2 } = {}) {
  const { cs, NF } = S;
  const nbr = (i, dir) => { for (let k = 1; k <= 3; k++) { const j = i + dir * k; if (j < 1 || j >= NF) break; if (cs[j] < 0.995) return cs[j]; } return 1; }; // 跳过重复帧
  const cuts = [];
  for (let i = 1; i < NF; i++) {
    if (cs[i] >= th) continue;
    if (nbr(i, -1) - cs[i] >= prom && nbr(i, 1) - cs[i] >= prom) { cuts.push(i); continue; }
    // 单独 1 帧和前后都不像：连续两个极低值，外侧都稳。
    // 24fps 素材进 30/60fps 成片后，夹进来的那 1 帧会被复制成 2–3 帧（中间是重复帧），所以跳过重复帧再找第二个低值
    if (cs[i] < 0.35) {
      let j = i + 1; while (j < NF && j - i <= 3 && cs[j] >= 0.995) j++;
      if (j < NF && j - i <= 3 && cs[j] < 0.35) {
        const worst = Math.max(cs[i], cs[j]);
        if (nbr(i, -1) - worst >= prom && nbr(j, 1) - worst >= prom) { cuts.push(i, j); i = j; }
      }
    }
  }
  return { cuts, nbr };
}

/** 帧 r 是不是 x、y 两个画面按比例叠在一起（混合帧）：返回 { alpha, resid }，resid 越小越像叠出来的 */
export function blendFit(S, r, x, y) {
  const { buf, PX } = S;
  let num = 0, den = 0;
  for (let k = 0; k < PX; k++) { const R = buf[r * PX + k], X = buf[x * PX + k], Y = buf[y * PX + k]; num += (R - Y) * (X - Y); den += (X - Y) * (X - Y); }
  if (den < 1e-6) return null;
  const al = Math.max(0, Math.min(1, num / den));
  let e = 0, e0 = 0, e1 = 0;
  for (let k = 0; k < PX; k++) { const R = buf[r * PX + k], X = buf[x * PX + k], Y = buf[y * PX + k]; const f = al * X + (1 - al) * Y; e += (R - f) ** 2; e0 += (R - Y) ** 2; e1 += (R - X) ** 2; }
  return { alpha: al, resid: Math.sqrt(e / (Math.min(e0, e1) + 1e-9)) };
}

/** 画面有多少细节（灰度标准差，0–128）。近乎纯黑/纯色/糊成一片的帧很低 */
export const contrast = (S, i) => S.nrm[i] / Math.sqrt(S.PX);

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/**
 * 混合切点：两个画面之间夹着 1–2 帧“两个画面叠在一起”的帧（AI 长条素材内部换镜头时常见）。
 * 这种地方相邻帧相似度只掉一半，常规切点检测会漏，或者把混合帧算进前后某个镜头里。
 * 返回 [{ at: 混合帧号, len: 1|2, alpha }]；连续 3 帧以上都是叠出来的，是叠化转场，不算在这里。
 */
export function findBlendFrames(S) {
  const { NF, cs, sim, lum } = S;
  const out = [];
  for (let i = 2; i + 2 < NF; i++) {
    for (const len of [1, 2]) {
      const x = i - 1, y = i + len; // x：混合之前最后一个干净帧；y：混合之后第一个干净帧
      if (y + 1 >= NF) continue;
      // 近乎全黑/没细节的画面怎么叠都像（暗场开门、渐黑），不判
      if (contrast(S, x) < 8 || contrast(S, y) < 8) continue;
      // 前后亮度差很大：多半是闪电、开灯、开门这种光线突变，不是两个镜头叠在一起（定稿实测：第04、05集闪电，校园15 开门）
      if (Math.abs(lum[x] - lum[y]) > 25) continue;
      if (sim(x, y) > 0.5) continue; // 前后两个画面得真的不一样（不然只是动作）
      if (cs[x] < 0.8 || cs[y + 1] < 0.8) continue; // 两侧本身是稳的
      let ok = true, alSum = 0;
      for (let r = i; r < i + len; r++) {
        const b = blendFit(S, r, x, y);
        if (!b || b.resid > 0.55 || b.alpha < 0.15 || b.alpha > 0.85) { ok = false; break; }
        alSum += b.alpha;
      }
      // 再往外一帧也是叠出来的：那是 3 帧以上的叠化，不报
      if (ok && x - 1 >= 0) { const b = blendFit(S, x, x - 1, y); if (b && b.resid < 0.45 && b.alpha > 0.15 && b.alpha < 0.85 && sim(x - 1, y) < 0.5) ok = false; }
      if (ok) { out.push({ at: i, len, alpha: alSum / len }); i += len; break; }
    }
  }
  return out;
}

/**
 * 一个镜头 [a, b) 的头尾有没有残帧：
 *  - 混合帧 / 别的画面 / 坏帧：头（尾）1–2 帧和镜头里其他帧对不上，跳过它们之后画面就稳了；
 *  - 卡帧：开头（结尾）连着好几帧一模一样，镜头里其余部分却在动——AI 起幅僵直、或片段末尾卡住。
 * prev/next 是相邻镜头挨着的那一帧（没有就给 -1），用来判断残帧是不是两个画面叠在一起。
 * 返回 [{ side:'head'|'tail', k, kind, level, alpha? }]，k 是残帧数。
 */
export function edgeCheck(S, a, b, { prev = a - 1, next = b < S.NF ? b : -1, fps = 30, maxK = fps > 40 ? 5 : fps > 26 ? 3 : 2 } = {}) {
  const out = [];
  const n = b - a;
  if (n < 6) return out; // 太短的镜头交给“短于 N 帧”的检查
  const { md, cs, lum, isFlat, sim } = S;
  const inner = [], innerC = [];
  // 帧率转换出来的重复帧（变化量≈0）不算进“正常变化量”，不然 60fps 成片里一半是 0，什么都像突变
  for (let i = a + maxK + 2; i <= b - maxK - 2; i++) if (md[i] >= 0.35) { inner.push(md[i]); innerC.push(cs[i]); }
  if (inner.length < 2) return out;
  const base = Math.max(pct(inner, 0.75), 0.8);  // 镜头里正常的逐帧变化量
  const cMed = pct(innerC, 0.5);
  const spike = (m, c) => m >= Math.max(4 * base, 6) && c <= Math.min(0.85, cMed - 0.12);
  const calm = (m) => m <= 2.2 * base + 1;
  const classify = (r, clean, other) => {
    if (isFlat(r)) return { kind: lum[r] < 40 ? 'black' : 'white' };
    if (other >= 0 && other < S.NF) {
      const bl = blendFit(S, r, other, clean);
      if (bl && bl.resid < 0.6 && bl.alpha >= 0.15 && bl.alpha <= 0.85 && sim(other, clean) < 0.6 && Math.abs(lum[other] - lum[clean]) <= 25) return { kind: 'blend', alpha: bl.alpha };
      // 残帧其实和隔壁镜头是一个画面：只是切点位置差了一两帧，观众看到的是隔壁镜头多/少一点，不算残帧
      if (sim(r, other) >= 0.8 && sim(r, other) > sim(r, clean)) return { kind: 'skip' };
    }
    // 构图都对不上的，不管亮不亮都是别的画面（校园21 38 秒：夹进来 2 帧另一个演员，比前后亮，原来会被当成闪光放过）
    if (sim(r, clean) < 0.5) return { kind: 'other' };
    const dl = lum[r] - lum[clean];
    if (Math.abs(dl) > 25) return { kind: dl > 0 ? 'flash' : 'dark' };
    return { kind: 'other' };
  };
  // “必须改”只给：跳变很猛、残帧本身画面清楚（不是糊成一片的甩镜头/暗帧）、而且不是亮度变化
  const level = (c, j, r) => (['flash', 'dark'].includes(c.kind) || contrast(S, r) < 20 ? '?' : md[j] >= 6 * base && cs[j] < 0.6 ? '!' : '?');
  // 头
  for (let k = 1; k <= maxK; k++) {
    const j = a + k; // 跳变在 j-1 → j；a..j-1 是残帧
    let inside = 0; for (let i = a + 1; i < j; i++) inside = Math.max(inside, md[i]);
    if (spike(md[j], cs[j]) && calm(Math.max(md[j + 1], md[j + 2])) && calm(inside)) {
      const c = classify(a, j, prev);
      if (c.kind !== 'skip') out.push({ side: 'head', k, ...c, level: level(c, j, a) });
      break;
    }
  }
  // 尾
  for (let k = 1; k <= maxK; k++) {
    const j = b - k; // 跳变在 j-1 → j；j..b-1 是残帧
    let inside = 0; for (let i = j + 1; i < b; i++) inside = Math.max(inside, md[i]);
    if (spike(md[j], cs[j]) && calm(Math.max(md[j - 1], md[j - 2])) && calm(inside)) {
      const c = classify(b - 1, j - 1, next);
      if (c.kind !== 'skip') out.push({ side: 'tail', k, ...c, level: level(c, j, b - 1) });
      break;
    }
  }
  // 卡帧：头/尾连着几帧一模一样，镜头其余部分在动。正常的帧率转换（24→30/60）会让个别帧重复 2–3 次，所以要比镜头内部最长的重复更长
  const same = (i) => md[i] < 0.35 && cs[i] > 0.997;
  let maxRun = 1, cur = 1;
  for (let i = a + 1; i < b; i++) { if (same(i)) { cur++; maxRun = Math.max(maxRun, cur); } else cur = 1; }
  let hr = 1; while (a + hr < b && same(a + hr)) hr++;
  let tr = 1; while (b - 1 - tr >= a && same(b - tr)) tr++;
  let innerMax = 1; cur = 1;
  for (let i = a + hr + 1; i < b - tr; i++) { if (same(i)) { cur++; innerMax = Math.max(innerMax, cur); } else cur = 1; }
  const moving = base >= 1.2;
  const lim = Math.max(3, innerMax + 2), maxLen = Math.round(0.6 * fps);
  if (moving && hr >= lim && hr <= maxLen && hr < n - 3) out.push({ side: 'head', k: hr, kind: 'freeze', level: '?' });
  if (moving && tr >= lim && tr <= maxLen && tr < n - 3) out.push({ side: 'tail', k: tr, kind: 'freeze', level: '?' });
  return out;
}

/**
 * 镜头中间单独坏掉一帧：它和前后都差很多，前后两帧彼此却对得上（AI 生成偶发的花一下、闪一下、跳一下）。
 * 构图可能没变（相似度还很高），所以按“像素差突然放大又马上回来”找。成片里这一帧可能被复制成 2–3 帧，跳过重复帧。
 * 返回 [{ at, len }]。
 */
export function findGlitchFrames(S, cuts = []) {
  const { NF, md, mad } = S;
  const cutSet = new Set(cuts);
  const out = [];
  for (let i = 3; i + 4 < NF; i++) {
    let j = i + 1; while (j < NF && j - i <= 3 && md[j] < 0.35) j++; // j：坏帧之后第一个不重复的帧
    if (j + 2 >= NF || j - i > 3) continue;
    if ([...Array(j - i + 1).keys()].some((k) => cutSet.has(i + k))) continue; // 已经按切点/短镜头处理
    const around = [md[i - 1], md[i - 2], md[j + 1], md[j + 2]].filter((x) => x >= 0.35);
    const base = Math.max(pct(around, 0.75), 0.8);
    const th = Math.max(5 * base, 6);
    if (md[i] >= th && md[j] >= th && mad(i - 1, j) <= 2.5 * base + 1.5) {
      // 亮度一下变了又回来：闪电/闪光/曝光跳（第04集 47 秒实测是这种）；亮度没怎么变：画面花了、跳了
      const flick = Math.abs(S.lum[i] - S.lum[i - 1]) > 20;
      out.push({ at: i, len: j - i, kind: flick ? 'flicker' : 'garble' }); i = j;
    }
  }
  return out;
}

export const KIND_ZH = {
  blend: '混合帧（两个画面叠在一起）',
  other: '和本镜头对不上的画面（别的镜头或坏帧）',
  black: '黑帧',
  white: '白帧',
  flash: '突然变亮的帧（可能是闪白/枪火/闪电，也可能是夹进来的别的画面：校园21 38 秒那 2 帧就是另一个演员）',
  dark: '突然变暗的帧（可能是甩镜头的模糊帧，也可能是夹进来的暗画面）',
  freeze: '卡帧（这几帧一模一样，画面停住）',
  flicker: '亮度一下变了又回来（闪电/闪光，或曝光跳了一下）',
  garble: '画面花了/跳了一下，前后两帧是接得上的',
};
