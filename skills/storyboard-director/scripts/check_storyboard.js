#!/usr/bin/env node
// 分镜编导：分镜脚本自动检查。报告按环分组，编号对应 环/环N_*.md 里的规则。
// 用法：node check_storyboard.js <分镜脚本.md> [--partial]
//   --partial：只写了一部分（比如先交一场戏）时用，不查整集时长、缺的章节和戏表对应。
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const partial = args.includes('--partial');
if (!file) {
  console.log('用法：node check_storyboard.js <分镜脚本.md> [--partial]');
  process.exit(2);
}
const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const skillDir = path.resolve(__dirname, '..');

const found = [];
const add = (lvl, id, msg) => found.push({ lvl, ring: id.split('.')[0], id, msg });

// ---------- 读章节和表格 ----------
function readSections(t) {
  const list = [];
  const re = /^## (\d+)\.\s*(.*)$/gm;
  let m;
  while ((m = re.exec(t))) list.push({ n: +m[1], title: m[2].trim(), start: m.index });
  list.forEach((s, i) => { s.body = t.slice(s.start, i + 1 < list.length ? list[i + 1].start : t.length); });
  return list;
}
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}
function readTables(body) {
  const lines = body.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitRow(lines[i]);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && /^\s*\|/.test(lines[j])) { rows.push(splitRow(lines[j])); j++; }
      out.push({ header, rows });
      i = j;
    } else i++;
  }
  return out;
}
const clean = s => (s || '').replace(/\*\*|`/g, '').trim();
const isEmpty = s => !s || /^[—–\-\s]*$/.test(s) || /^\[.*\]$/.test(s);

const secs = readSections(text);
const sec = n => secs.find(s => s.n === n);

// ---------- 环0：开工卡和方向 ----------
let dirName = null;
const overrides = {};
const range = v => { const m = (v || '').match(/(\d+)\s*[–\-~～至到]\s*(\d+)/); return m ? [+m[1], +m[2]] : null; };
const s0 = sec(0);
if (!s0 || !/开工卡/.test(s0.title)) add('❌', '0.1', '没有"## 0. 开工卡"一节');
else {
  for (const t of readTables(s0.body)) for (const r of t.rows) {
    const k = clean(r[0]), v = clean(r[1]);
    if (/^方向/.test(k)) dirName = v;
    if (/单集时长/.test(k) && range(v)) overrides.单集时长 = range(v);
  }
  if (!dirName) add('❌', '0.1', '开工卡里没有"方向"一行');
}
let P = null;
if (dirName) {
  const f = path.join(skillDir, '方向', dirName + '.md');
  if (!fs.existsSync(f)) add('❌', '0.1', `开工卡的方向"${dirName}"在 方向/ 里没有同名文件（应为"竖屏快节奏短剧"或"横屏精品剧"）`);
  else {
    const m = fs.readFileSync(f, 'utf8').match(/```json\s*([\s\S]*?)```/);
    if (m) P = JSON.parse(m[1]);
    else add('❌', '0.1', `方向文件 ${dirName}.md 里没有检查参数`);
  }
}
const usedDefault = !P;
if (!P) P = { 拍上限: 3, 镜时长: [2, 6], 单集时长: [60, 120], 英文词每秒: 2.5, 中文字每秒: 4 };
Object.assign(P, overrides);

// ---------- 环1：戏表 ----------
const KNOWN_TYPES = ['情感戏', '暧昧戏', '冲突对峙戏', '审判群戏', '打戏', '揭示戏', '爽点高光戏', '独处心理戏', '追逐潜入戏', '转场呼吸', '钩子悬念'];
const sceneRows = [];
const s1 = sec(1);
if (s1) {
  const t = readTables(s1.body).find(t => t.header.some(h => h.includes('戏型')));
  if (!t) add('❌', '1.0', '第 1 节没有带"戏型"一列的戏表');
  else {
    const ci = t.header.findIndex(h => h.includes('戏型'));
    for (const r of t.rows) {
      const id = clean(r[0]).replace(/\s/g, ''), type = clean(r[ci]);
      if (!/^戏\d+/.test(id)) continue;
      sceneRows.push({ id, type });
      if (isEmpty(type)) add('❌', '1.0', `${id} 没写戏型`);
      else if (!KNOWN_TYPES.some(k => type.includes(k))) add('⚠️', '1.0', `${id} 的戏型"${type}"不在戏型表里（${KNOWN_TYPES.join('、')}）`);
    }
    if (!sceneRows.length) add('❌', '1.0', '戏表里一场戏都没有（第一列写"戏1""戏2"……）');
  }
}

// ---------- 环2：节拍表 ----------
const s2 = sec(2);
if (s2 && !readTables(s2.body).some(t => t.header.some(h => h.includes('触发')))) add('❌', '2.0', '第 2 节没有节拍表（带"触发"一列）');

// ---------- 环3：机位表 ----------
const camSet = new Set();
const s3 = sec(3);
if (s3) {
  for (const t of readTables(s3.body)) {
    if (!clean(t.header[0]).startsWith('机位')) continue;
    for (const r of t.rows) { const c = clean(r[0]).toUpperCase(); if (c && !isEmpty(c)) camSet.add(c); }
  }
}
if (s3 && !camSet.size) add('❌', '3.4', '第 3 节没有机位表（第一列表头是"机位"，每行一个编号）');

// ---------- 环3（v4）：场景卡 ----------
if (s3) {
  // 场景卡：#### 场景卡：<名> 下面一张首列为"方向"的表
  const cardRe = /^#{3,4}\s*场景卡[:：]\s*(.+)$/gm;
  const cards = [];
  let cm;
  while ((cm = cardRe.exec(s3.body))) cards.push({ name: cm[1].trim(), start: cm.index });
  cards.forEach((c, i) => { c.body = s3.body.slice(c.start, i + 1 < cards.length ? cards[i + 1].start : s3.body.length); });
  const dirSet = new Set();
  for (const c of cards) {
    const t = readTables(c.body).find(t => clean(t.header[0]).startsWith('方向'));
    if (!t) { add('❌', '3.15', `场景卡"${c.name}"没有方向表（第一列表头是"方向"）`); continue; }
    const rows = t.rows.filter(r => !isEmpty(clean(r[0])));
    if (rows.length < 2 || rows.length > 4) add('⚠️', '3.15', `场景卡"${c.name}"有 ${rows.length} 个方向：一场戏定 2–4 个`);
    const li = t.header.findIndex(h => h.includes('光')), bi = t.header.findIndex(h => h.includes('背景图'));
    for (const r of rows) {
      const d = clean(r[0]);
      dirSet.add(d);
      if (li < 0 || isEmpty(clean(r[li]))) add('❌', '3.15', `场景卡"${c.name}"方向 ${d} 没写光`);
      if (bi < 0 || !/@\S/.test(r[bi] || '')) add('❌', '3.17', `场景卡"${c.name}"方向 ${d} 没写背景图（@名字）`);
    }
    if (!/站位锚点[:：]\s*\S/.test(c.body)) add('⚠️', '3.16', `场景卡"${c.name}"没写站位锚点（谁身后固定是方向几）`);
  }
  // 机位表的"方向"一列
  let hasDirCol = false;
  for (const t of readTables(s3.body)) {
    if (!clean(t.header[0]).startsWith('机位')) continue;
    const di = t.header.findIndex(h => clean(h) === '方向' || /方向（v4）/.test(h));
    if (di < 0) continue;
    hasDirCol = true;
    for (const r of t.rows) {
      const cam = clean(r[0]), d = clean(r[di]);
      if (!cam || isEmpty(cam)) continue;
      if (isEmpty(d)) add('❌', '3.15', `机位 ${cam} 没写属于哪个方向`);
      else if (cards.length && !d.split(/[\/、,，]/).every(x => dirSet.has(x.trim()))) add('❌', '3.15', `机位 ${cam} 的方向"${d}"不在场景卡里`);
    }
  }
  if (!cards.length) add('⚠️', '3.15', '第 3 节没有场景卡（v4：每场戏一张，"#### 场景卡：地方，时段"）');
  else if (!hasDirCol) add('⚠️', '3.15', '机位表没有"方向"一列：每个机位写属于场景卡的哪个方向');
}

// ---------- 环4：配方 ----------
const recipeIds = new Set();
const s4 = sec(4);
if (s4) {
  const t = readTables(s4.body).find(t => t.header.some(h => h.includes('骨架')));
  if (!t) add('❌', '4.0', '第 4 节没有镜头配方表（带"镜头骨架"一列）');
  else for (const r of t.rows) { const id = clean(r[0]).replace(/\s/g, ''); if (/^戏\d+/.test(id)) recipeIds.add(id); }
}

// ---------- 环5：读分镜表 ----------
const SIZE_RE = /大远景|大全景|大特写|中近景|全景|中景|近景|特写|EWS|ECU|MCU|WS|MS|CU/g;
const RANK = { 大远景: 1, 大全景: 1, EWS: 1, 全景: 2, WS: 2, 中景: 3, MS: 3, 中近景: 3.5, 近景: 4, MCU: 4, 特写: 5, CU: 5, 大特写: 6, ECU: 6 };
const RANK_NAME = { 1: '大全景', 2: '全景', 3: '中景', 3.5: '中近景', 4: '近景', 5: '特写', 6: '大特写' };
const shots = [];
const scenesInTable = [];
let hasCamCol = false;
const s5 = sec(5);
if (s5) {
  const parts = s5.body.split(/^### /m).slice(1);
  for (const part of parts) {
    const head = part.split('\n')[0].trim();
    const idm = head.match(/戏\s*(\d+)/);
    const sid = idm ? '戏' + idm[1] : head;
    const tm = head.match(/[（(]([^）)]*)[）)]\s*$/);
    const stype = tm ? tm[1] : '';
    scenesInTable.push({ id: sid, type: stype });
    for (const t of readTables(part)) {
      const H = t.header.map(clean);
      const col = test => H.findIndex(test);
      const c = {
        no: col(h => h === '镜'), tc: col(h => h.includes('时间码')), dur: col(h => h === '时长'),
        cam: col(h => h === '机位'), size: col(h => h === '景别'),
        guide: col(h => h.includes('引导')), cut: col(h => h.includes('接法')), line: col(h => h === '台词'),
      };
      if (c.tc < 0 || c.dur < 0) continue;
      if (c.cam >= 0) hasCamCol = true;
      for (const r of t.rows) {
        const get = i => (i >= 0 ? clean(r[i]) : '');
        const tcRaw = get(c.tc);
        const m = tcRaw.match(/(\d+)\s*[–\-~～]\s*(\d+)/);
        const sizeRaw = get(c.size);
        const sizes = (sizeRaw.match(SIZE_RE) || []).map(x => RANK[x]);
        shots.push({
          no: get(c.no) || '?', tcRaw, a: m ? +m[1] : NaN, b: m ? +m[2] : NaN, d: +get(c.dur),
          cam: get(c.cam).toUpperCase(), sizeRaw, sizes, guide: get(c.guide), cut: get(c.cut), line: get(c.line),
          scene: sid, stype, hasSize: c.size >= 0, hasGuide: c.guide >= 0, hasCut: c.cut >= 0,
        });
      }
    }
  }
  if (!shots.length) add('❌', '5.0', '第 5 节没有读到分镜表（标题"### 戏N：名字（戏型）"，表头要有"时间码""时长"）');
}

// ---------- 环5：逐镜检查 ----------
let prevEnd = 0;
const offscreen = [];
shots.forEach((s, i) => {
  const tag = `镜${s.no}`;
  if (isNaN(s.a) || isNaN(s.b)) add('❌', '5.0', `${tag} 时间码"${s.tcRaw}"读不出来（写成"0–3"）`);
  else {
    if (s.a !== prevEnd) add('❌', '5.0', `${tag} 从 ${s.a} 秒开始，上一镜到 ${prevEnd} 秒结束，时间码不连续`);
    if (isNaN(s.d) || s.b - s.a !== s.d) add('❌', '5.0', `${tag} 时长写的是"${isNaN(s.d) ? '' : s.d}"，时间码是 ${s.a}–${s.b}`);
    prevEnd = s.b;
  }
  if (!isNaN(s.d)) {
    if (s.d > P.镜时长[1]) add('❌', '5.1', `${tag} ${s.d} 秒，超过这个方向一镜的上限 ${P.镜时长[1]} 秒`);
    else if (s.d < P.镜时长[0]) add('⚠️', '5.1', `${tag} ${s.d} 秒，短于这个方向一镜的下限 ${P.镜时长[0]} 秒`);
    if (s.d > P.拍上限 * 1.5 && !/→/.test(s.guide)) add('⚠️', '5.1', `${tag} ${s.d} 秒装了不止一拍，"镜头怎么引导"里没用"→"写清镜头里怎么分拍`);
  }
  if (s.hasGuide && isEmpty(s.guide)) add('❌', '5.2', `${tag} "镜头怎么引导"是空的`);
  if (!s.hasGuide && i === 0) add('❌', '5.2', '分镜表没有"镜头怎么引导"一列');
  if (s.hasCut && isEmpty(s.cut)) add('❌', '5.3', `${tag} 没写切入理由`);
  else if (s.hasCut && !/因为|看|动|因果|交代|转场/.test(s.cut)) add('⚠️', '5.3', `${tag} 的接法没写成"看 / 动 / 因果 / 交代 / 转场"，也没有"因为…所以…"`);
  // 换场第一镜要写转场
  if (i > 0 && s.scene !== shots[i - 1].scene && s.hasCut && !isEmpty(s.cut) && !/转场/.test(s.cut))
    add('⚠️', '5.15', `${tag} 是${s.scene}的第一镜（换场），接法没写"转场·X"（动作承接 / 相似衔接 / 视线引导 / 甩镜 / 遮挡 / 硬切），见 references/转场衔接.md`);
  if (!s.hasCut && i === 0) add('❌', '5.3', '分镜表没有"接法"一列');
  if (s.hasSize && !s.sizes.length) add('❌', '5.5', `${tag} 景别"${s.sizeRaw}"认不出（用大远景、大全景、全景、中景、中近景、近景、特写、大特写）`);
  if (hasCamCol) {
    if (isEmpty(s.cam)) add('❌', '3.4', `${tag} 没写机位编号`);
    else if (camSet.size && !camSet.has(s.cam)) add('❌', '3.4', `${tag} 的机位"${s.cam}"不在第 3.4 节机位表里`);
  }
  // 同一机位连着两镜
  if (i > 0) {
    const p = shots[i - 1];
    if (p.cam && s.cam && !isEmpty(p.cam) && p.cam === s.cam && p.sizes.length && s.sizes.length) {
      const pe = p.sizes[p.sizes.length - 1], cs = s.sizes[0];
      if (cs > pe) add('❌', '5.4', `镜${p.no}→${s.no} 同一机位 ${s.cam}，从${RANK_NAME[pe]}硬切到更紧的${RANK_NAME[cs]}：要靠近就在镜头里推，或者换一个明显不同的角度`);
      else if (cs === pe) add('⚠️', '5.5', `镜${p.no}→${s.no} 同一机位 ${s.cam}、同一景别（${RANK_NAME[cs]}）连着切，像画面跳了一下；不是故意的就换角度或合成一镜`);
    }
  }
  // 台词
  const L = s.line;
  if (!isEmpty(L)) {
    const noParen = L.replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ');
    const labels = noParen.match(/[一-龥·]{1,10}\s*：/g) || [];
    if (labels.length > 2) add('❌', '5.8', `${tag} 一镜 ${labels.length} 个人说话，最多两句`);
    else if (labels.length === 2) add('⚠️', '5.8', `${tag} 一镜两人先后说话：写清先后，确认这一镜装得下两句`);
    const speech = noParen.replace(/[一-龥·]{1,10}\s*：/g, ' ');
    const en = (speech.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length;
    const zh = (speech.match(/[一-龥]/g) || []).length;
    if (!isNaN(s.d) && s.d > 0) {
      if (en > 0 && en / s.d > P.英文词每秒) add('❌', '5.8', `${tag} 台词 ${en} 个词 / ${s.d} 秒 = 每秒 ${(en / s.d).toFixed(1)} 个词，超过 ${P.英文词每秒}`);
      else if (en === 0 && zh > 0 && zh / s.d > P.中文字每秒) add('❌', '5.8', `${tag} 台词 ${zh} 个字 / ${s.d} 秒 = 每秒 ${(zh / s.d).toFixed(1)} 个字，超过 ${P.中文字每秒}`);
    }
    if (/画外/.test(L)) offscreen.push(s.no);
  }
});
if (offscreen.length) add('⚠️', '5.8', `画外音的镜头：${offscreen.map(n => '镜' + n).join('、')}。推动剧情、要观众听清的台词，设计成说话的人在画面里`);

// ---------- 环4：按戏型查景别呼吸 ----------
for (const sc of scenesInTable) {
  const list = shots.filter(s => s.scene === sc.id && s.sizes.length);
  if (!list.length) continue;
  if (/打戏/.test(sc.type)) {
    let run = 0, maxRun = 0;
    for (const s of list) { if (s.sizes[0] >= 4) { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
    if (maxRun > 3) add('⚠️', '4.2', `${sc.id}（打戏）连着 ${maxRun} 镜近景或更紧，紧紧松：连着紧不超过 3 镜`);
    if (!list.some(s => s.sizes.some(r => r <= 2))) add('⚠️', '4.2', `${sc.id}（打戏）一个全景以上的"松"镜头都没有`);
  }
  if (/情感戏|暧昧戏/.test(sc.type) && !list.some(s => s.sizes.some(r => r >= 5))) add('⚠️', '4.3', `${sc.id}（${sc.type}）一个特写都没有：情感戏要有脸或手的特写`);
}

// ---------- 章节齐不齐、总时长 ----------
const NAMES = { 0: '开工卡', 1: '戏表', 2: '节拍与情绪', 3: '空间与机位', 4: '镜头配方', 5: '分镜表' };
const RING_OF = { 1: '1.0', 2: '2.0', 3: '3.4', 4: '4.0', 5: '5.0' };
const need = partial ? [3, 4, 5] : [1, 2, 3, 4, 5];
for (const n of need) if (!sec(n)) add('❌', RING_OF[n], `没有"## ${n}. ${NAMES[n]}"一节`);
if (!partial) {
  for (const r of sceneRows) {
    if (!scenesInTable.some(x => x.id === r.id)) add('⚠️', '5.0', `戏表里的 ${r.id} 在第 5 节没有分镜表`);
    if (s4 && !recipeIds.has(r.id)) add('⚠️', '4.0', `戏表里的 ${r.id} 在第 4 节没有配方`);
  }
  if (shots.length && (prevEnd < P.单集时长[0] || prevEnd > P.单集时长[1])) add('❌', '1.3', `全集 ${prevEnd} 秒，不在单集时长 ${P.单集时长[0]}–${P.单集时长[1]} 秒里`);
}

// ---------- 报告 ----------
const RINGS = { 0: '环0 开工卡', 1: '环1 拆戏', 2: '环2 节拍与情绪', 3: '环3 空间与机位', 4: '环4 镜头配方', 5: '环5 逐镜分镜' };
console.log(`检查：${path.basename(file)}${partial ? '（--partial）' : ''}`);
console.log(`方向：${dirName || '（没读到，按竖屏快节奏的默认值查）'}${usedDefault && dirName ? '（方向文件没读到参数，用默认值）' : ''}｜一镜 ${P.镜时长.join('–')} 秒｜单集 ${P.单集时长.join('–')} 秒`);
console.log(`读到：${shots.length} 镜，共 ${prevEnd} 秒，${scenesInTable.length} 场戏`);
console.log('');
for (const k of Object.keys(RINGS)) {
  const items = found.filter(f => f.ring === k);
  if (!items.length) continue;
  console.log(`【${RINGS[k]}】`);
  for (const f of items.sort((x, y) => (x.lvl === y.lvl ? 0 : x.lvl === '❌' ? -1 : 1))) console.log(`  ${f.lvl} [${f.id}] ${f.msg}`);
}
const nErr = found.filter(f => f.lvl === '❌').length;
const nWarn = found.filter(f => f.lvl === '⚠️').length;
console.log('');
console.log(`合计：❌ ${nErr} 个，⚠️ ${nWarn} 个。${nErr ? '❌ 全部改掉再交；' : ''}${nWarn ? '保留的 ⚠️ 在回复里逐条说明为什么。' : ''}`);
console.log('脚本只查能数、能对表的规则；每环的〔人工〕规则照那一环文件的"验收"自查，最后用导演的眼睛过一遍（环5 验收最后一条）。');
process.exit(nErr ? 1 : 0);
