#!/usr/bin/env node
// 分镜编导 v5（2026-11-21）：把分镜脚本第 3 节的"平面图数据"块画成俯视机位图（环3 规则 3.24）。
// 用法：node draw_plan.js <分镜脚本.md> [输出.html]
// 输出默认放在分镜旁边：<文件名>_机位图.html。一场戏一块数据，画成一张图。
//
// 数据块写法（坐标单位米，原点在左下角，x 往右、y 往里）：
//   ```平面图数据
//   场地 王宫大殿 16x40
//   物 金座 8,38
//   人 皇帝 8,38
//   人 玛蒂尔达 10,17 -> 9,14        走位：起点 -> 终点（可以连写几段：a -> b -> c）
//   机位 A 8,39.5 朝 拱形大门        朝向写一个点，或者人、东西的名字，或者"下"（正上方往下拍）；朝人默认朝他最后站的位置，写"名字(起)"朝起点
//   ```
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.log('用法：node draw_plan.js <分镜脚本.md> [输出.html]'); process.exit(2); }
const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const out = process.argv[3] || path.join(path.dirname(file), path.basename(file, path.extname(file)) + '_机位图.html');

const problems = [];
const pt = s => { const m = String(s).match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/); return m ? { x: +m[1], y: +m[2] } : null; };

// ---------- 读数据块 ----------
const blocks = [];
const re = /```平面图数据\s*\n([\s\S]*?)```/g;
let m;
while ((m = re.exec(text))) {
  const b = { name: '', w: 0, d: 0, things: [], people: [], cams: [], line: text.slice(0, m.index).split('\n').length };
  for (const raw of m[1].split('\n')) {
    const l = raw.replace(/#.*$/, '').trim();
    if (!l) continue;
    let r;
    if ((r = l.match(/^场地\s+(\S+)\s+(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)/))) { b.name = r[1]; b.w = +r[2]; b.d = +r[3]; }
    else if ((r = l.match(/^物\s+(\S+)\s+(\S+)/))) { const p = pt(r[2]); if (p) b.things.push({ name: r[1], ...p }); else problems.push(`第 ${b.line} 行起的数据块：物"${r[1]}"的坐标读不出（写成 x,y）`); }
    else if ((r = l.match(/^人\s+(\S+)\s+(.+)$/))) {
      const pts = r[2].split(/\s*(?:->|→)\s*/).map(pt);
      if (pts.every(Boolean)) b.people.push({ name: r[1], path: pts });
      else problems.push(`数据块"${b.name || '?'}"：人"${r[1]}"的坐标读不出（写成 x,y，走位用 -> 连）`);
    }
    else if ((r = l.match(/^机位\s+(\S+)\s+(\S+)\s+朝\s+(.+)$/))) {
      const p = pt(r[2]);
      if (!p) { problems.push(`数据块"${b.name || '?'}"：机位 ${r[1]} 的位置读不出`); continue; }
      b.cams.push({ id: r[1].toUpperCase(), ...p, aim: r[3].trim() });
    }
    else problems.push(`数据块"${b.name || '?'}"：这一行认不出："${l}"（每行以 场地 / 物 / 人 / 机位 开头）`);
  }
  if (!b.w || !b.d) problems.push(`第 ${b.line} 行起的数据块没有"场地 名字 宽x深"一行`);
  // 朝向：点，或者人、东西的名字（人取起点）
  for (const c of b.cams) {
    if (/^(正?下|俯拍|往下)$/.test(c.aim)) { c.down = true; continue; }
    let t = pt(c.aim);
    if (!t) {
      // 朝一个人：默认朝他最后站的位置；写成"名字(起)"朝他的起点
      const nm = c.aim.replace(/[（(]\s*(起|止)\s*[)）]$/, '');
      const useStart = /[（(]\s*起\s*[)）]$/.test(c.aim);
      const th = b.things.find(x => x.name === nm);
      const pe = b.people.find(x => x.name === nm);
      t = th ? { x: th.x, y: th.y } : pe ? (useStart ? pe.path[0] : pe.path[pe.path.length - 1]) : null;
    }
    if (!t) problems.push(`数据块"${b.name}"：机位 ${c.id} 朝"${c.aim}"，数据块里没有这个人或东西，也不是坐标`);
    c.t = t;
    if (b.w && b.d && (c.x < -2 || c.y < -2 || c.x > b.w + 2 || c.y > b.d + 2)) problems.push(`数据块"${b.name}"：机位 ${c.id} 在场地外面 2 米以上，坐标写错了没有`);
  }
  blocks.push(b);
}

// 机位表（第一列表头是"机位"的表）里有、图上没有的机位
const camTable = new Set();
let inCamTable = false;
for (const line of text.split('\n')) {
  if (!/^\s*\|/.test(line)) { inCamTable = false; continue; }
  const c = line.split('|').map(x => x.trim());
  if (/^机位$/.test(c[1])) { inCamTable = true; continue; }
  if (inCamTable && /^[A-Z]{1,2}\d{0,3}$/.test(c[1])) camTable.add(c[1]);
}
const drawn = new Set(blocks.flatMap(b => b.cams.map(c => c.id)));
const notDrawn = [...camTable].filter(c => !drawn.has(c));
const notInTable = [...drawn].filter(c => camTable.size && !camTable.has(c));

if (!blocks.length) {
  console.log(`没找到"平面图数据"块。在第 3.1 节平面图下面加一个 \`\`\`平面图数据 块（写法见 templates/分镜脚本模板.md 或本脚本开头的注释）。`);
  process.exit(1);
}

// ---------- 画 ----------
const COLORS = ['#d9480f', '#1971c2', '#2f9e44', '#9c36b5', '#e67700', '#0c8599', '#c2255c', '#5c940d'];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function svgOf(b) {
  const W = 560, pad = 44;
  const k = Math.min((W - 2 * pad) / b.w, 900 / b.d);
  const sw = b.w * k + 2 * pad, sh = b.d * k + 2 * pad;
  const X = x => pad + x * k, Y = y => pad + (b.d - y) * k;   // y 往里 = 往上画
  const s = [], labels = [], marks = [];
  const mark = (x, y, r) => marks.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r });
  const label = (x, y, text, size, color, bold) => labels.push({ x, y, text, size, color, bold });
  s.push(`<svg viewBox="0 0 ${sw.toFixed(0)} ${sh.toFixed(0)}" width="${sw.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">`);
  s.push(`<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`);
  s.push(`<rect x="${pad}" y="${pad}" width="${(b.w * k).toFixed(1)}" height="${(b.d * k).toFixed(1)}" fill="#f8f9fa" stroke="#868e96" stroke-width="1.5"/>`);
  const step = b.w > 30 || b.d > 30 ? 5 : 1;   // 格子
  for (let x = step; x < b.w; x += step) s.push(`<line x1="${X(x)}" y1="${Y(0)}" x2="${X(x)}" y2="${Y(b.d)}" stroke="#e9ecef" stroke-width="1"/>`);
  for (let y = step; y < b.d; y += step) s.push(`<line x1="${X(0)}" y1="${Y(y)}" x2="${X(b.w)}" y2="${Y(y)}" stroke="#e9ecef" stroke-width="1"/>`);
  s.push(`<text x="${pad}" y="${sh - 14}" font-size="11" fill="#868e96">${b.w}×${b.d} 米，格子 ${step} 米；下边是 y=0，往上是往里</text>`);
  for (const t of b.things) {
    s.push(`<rect x="${X(t.x) - 7}" y="${Y(t.y) - 7}" width="14" height="14" fill="#adb5bd" stroke="#495057"/>`);
    mark(X(t.x), Y(t.y), 8); label(X(t.x), Y(t.y), t.name, 12, '#495057', false);
  }
  // 机位的扇形先画，人和机位的点压在上面
  for (const c of b.cams) {
    const cx = X(c.x), cy = Y(c.y);
    if (c.down) { s.push(`<circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="#212529" stroke-width="2" stroke-dasharray="3 2"/>`); continue; }
    if (!c.t) continue;
    let dx = X(c.t.x) - cx, dy = Y(c.t.y) - cy;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    dx /= len; dy /= len;
    const L = 30, half = 0.36;   // 视角约 40 度
    const rot = a => ({ x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) });
    const l = rot(-half), r = rot(half);
    s.push(`<line x1="${cx}" y1="${cy}" x2="${X(c.t.x)}" y2="${Y(c.t.y)}" stroke="#212529" stroke-width="0.8" stroke-dasharray="2 4" opacity="0.45"/>`);
    s.push(`<path d="M${cx},${cy} L${cx + l.x * L},${cy + l.y * L} L${cx + r.x * L},${cy + r.y * L} z" fill="rgba(33,37,41,0.16)" stroke="#212529" stroke-width="1.2"/>`);
  }
  b.people.forEach((p, i) => {
    const col = COLORS[i % COLORS.length];
    for (let j = 1; j < p.path.length; j++) {
      const a = p.path[j - 1], c = p.path[j];
      s.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(c.x)}" y2="${Y(c.y)}" stroke="${col}" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#ar)"/>`);
    }
    const st = p.path[0], en = p.path[p.path.length - 1];
    if (p.path.length > 1) { s.push(`<circle cx="${X(st.x)}" cy="${Y(st.y)}" r="5" fill="#fff" stroke="${col}" stroke-width="2"/>`); mark(X(st.x), Y(st.y), 6); }
    s.push(`<circle cx="${X(en.x)}" cy="${Y(en.y)}" r="8" fill="${col}" stroke="#fff" stroke-width="1.5"/>`);
    mark(X(en.x), Y(en.y), 9); label(X(en.x), Y(en.y), p.name, 13, col, true);
  });
  for (const c of b.cams) {
    const cx = X(c.x), cy = Y(c.y);
    s.push(`<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" fill="#212529"/>`);
    mark(cx, cy, 6); label(cx, cy, c.id, 13, '#212529', true);
  }
  // 标签：挨个找不和别的点、别的标签打架的位置；离得远就拉一根细线
  const placed = [];
  const hit = (r, q) => !(r.x1 < q.x0 || r.x0 > q.x1 || r.y1 < q.y0 || r.y0 > q.y1);
  const tw = (t, size) => [...t].reduce((n, ch) => n + (/[\x00-\xff]/.test(ch) ? size * 0.62 : size), 0);
  for (const lb of labels) {
    const w = tw(lb.text, lb.size), h = lb.size;
    let best = null;
    for (const rad of [11, 22, 34, 48, 64]) {
      for (const [ux, uy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        const ax = lb.x + ux * rad, ay = lb.y + uy * rad;
        const x0 = ux > 0 ? ax : ux < 0 ? ax - w : ax - w / 2;
        const yb = uy > 0 ? ay + h : uy < 0 ? ay : ay + h / 2 - 1;
        const r = { x0: x0 - 1, y0: yb - h, x1: x0 + w + 1, y1: yb + 2 };
        if (r.x0 < 2 || r.y0 < 2 || r.x1 > sw - 2 || r.y1 > sh - 2) continue;
        if (marks.some(q => hit(r, q)) || placed.some(q => hit(r, q))) continue;
        best = { r, x0, yb, rad }; break;
      }
      if (best) break;
    }
    if (!best) best = { r: { x0: lb.x + 9, y0: lb.y - h, x1: lb.x + 9 + w, y1: lb.y }, x0: lb.x + 9, yb: lb.y + 4, rad: 0 };
    placed.push(best.r);
    if (best.rad > 22) s.push(`<line x1="${lb.x}" y1="${lb.y}" x2="${(best.r.x0 + best.r.x1) / 2}" y2="${(best.r.y0 + best.r.y1) / 2}" stroke="${lb.color}" stroke-width="0.7" opacity="0.6"/>`);
    s.push(`<text x="${best.x0.toFixed(1)}" y="${best.yb.toFixed(1)}" font-size="${lb.size}"${lb.bold ? ' font-weight="bold"' : ''} fill="${lb.color}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(lb.text)}</text>`);
  }
  s.push('</svg>');
  return s.join('\n');
}

const parts = blocks.map(b => `<section><h2>${esc(b.name || '（没写场地名）')}</h2>${svgOf(b)}<p class="note">机位：${b.cams.map(c => esc(c.id) + ' 朝 ' + esc(c.aim)).join('｜') || '无'}</p></section>`);
const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>俯视机位图</title>
<style>body{font-family:sans-serif;background:#fff;color:#212529;margin:16px;max-width:1200px}h1{font-size:20px}h2{font-size:16px;margin:24px 0 8px}section{display:inline-block;vertical-align:top;margin-right:24px}svg{max-width:100%;height:auto;border:1px solid #dee2e6;background:#fff}.note{font-size:13px;color:#495057;max-width:560px}.legend,.warn{font-size:13px;color:#495057}.warn{color:#c92a2a}</style></head><body>
<h1>俯视机位图：${esc(path.basename(file))}</h1>
<p class="legend">灰方块 = 东西；彩色圆点 = 人（空心圈是起点，虚线箭头是走位）；黑方块加扇形 = 机位和它朝的方向（细虚线指向它拍的东西）；虚线圆圈 = 正上方往下拍（数据里写"朝 下"）。坐标照分镜第 3.1 节的"平面图数据"块；图和你想的不一样，就是平面图或机位表写错了。</p>
${problems.length || notDrawn.length || notInTable.length ? `<p class="warn">${[...problems, notDrawn.length ? '机位表里有、图上没画的机位：' + notDrawn.join('、') : '', notInTable.length ? '图上有、机位表里没有的机位：' + notInTable.join('、') : ''].filter(Boolean).map(esc).join('<br>')}</p>` : ''}
${parts.join('\n')}
</body></html>`;
fs.writeFileSync(out, html);
console.log(`画好了：${out}`);
console.log(`${blocks.length} 张图：${blocks.map(b => `${b.name}（${b.people.length} 人、${b.cams.length} 个机位）`).join('；')}`);
if (problems.length) { console.log('数据块的问题：'); problems.forEach(p => console.log('  ⚠️ ' + p)); }
if (notDrawn.length) console.log(`  ⚠️ 机位表里有、图上没画的机位：${notDrawn.join('、')}`);
if (notInTable.length) console.log(`  ⚠️ 图上有、机位表里没有的机位：${notInTable.join('、')}`);
