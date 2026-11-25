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
    const li = t.header.findIndex(h => h.includes('光')), bi = t.header.findIndex(h => h.includes('背景图')), yi = t.header.findIndex(h => h.includes('依据'));
    // v6（2026-11-24）：方向要有依据（照总览图哪一格推的），旧分镜没有这一列只提醒
    if (yi < 0) add('⚠️', '3.25', `场景卡"${c.name}"的方向表没有"依据"一列：每个方向写照平台总览图哪一格推的，图里没有的方向不设计`);
    for (const r of rows) {
      const d = clean(r[0]);
      dirSet.add(d);
      if (li < 0 || isEmpty(clean(r[li]))) add('❌', '3.15', `场景卡"${c.name}"方向 ${d} 没写光`);
      if (yi >= 0 ? isEmpty(clean(r[yi])) : (bi < 0 || !/@\S/.test(r[bi] || ''))) add('❌', '3.17', `场景卡"${c.name}"方向 ${d} 没写依据（总览图哪一格，或要补的图 @名字）`);
      if (yi >= 0 && /无图|没有图|猜|大概|待定/.test(r[yi] || '')) add('❌', '3.26', `场景卡"${c.name}"方向 ${d} 的依据是"${clean(r[yi])}"：图里没有的方向不设计，换一个，或者写要补的图 @名字`);
    }
    if (/身后(永远|固定|始终)是|站位锚点[:：]\s*\S/.test(c.body)) add('⚠️', '3.16', `场景卡"${c.name}"还锁着站位（身后永远是方向几）：v6 改成段和段接状态，写在"起 → 止"里（反面案例 02）`);
    if (yi >= 0 && !/地标[:：]\s*\S/.test(c.body)) add('⚠️', '3.27', `场景卡"${c.name}"没写地标（全景里用来说人贴着什么的固定物）`);
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
        pic: col(h => h.startsWith('画面')), mv: col(h => h.includes('运镜')),   // v7
        guide: col(h => h.includes('引导')), cut: col(h => h.includes('接法')), line: col(h => h === '台词'),
        func: col(h => h.includes('句子功能')),   // v4（2026-11-20）：每句台词的功能和意图（规则 5.16）
        ss: col(h => h.includes('起') && h.includes('止')),   // v5（2026-11-21）：起 → 止（规则 5.20）
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
          cam: get(c.cam).toUpperCase(), sizeRaw, sizes, guide: get(c.guide), cut: get(c.cut), line: get(c.line), func: get(c.func),
          ss: get(c.ss), hasSS: c.ss >= 0, pic: get(c.pic), mv: get(c.mv),
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

// ---------- v7（2026-11-24）：画面上半下半、全固定、每镜一样长（反面案例 01、06）。都只报 ⚠️ ----------
{
  const HALF = /画面(的)?(上半|下半|上方|下方|上部|下部|上沿|下沿|中上|中下|顶部|底部)|上半部|下半部|[左右]?下角|[左右]上角|三分之二|叠[两三]层|分屏/;
  const bad = shots.filter(s => HALF.test(s.pic + ' ' + s.mv + ' ' + s.guide));
  if (bad.length) add('⚠️', '5.26', `镜${bad.map(s => s.no).join('、')} 写了画面上半、下半、上方、下方或角落：提示词照抄会分屏。写左侧 / 右侧、三分线、前景 / 深处，高低用站、坐、跪（如"${(bad[0].pic + bad[0].mv).match(HALF) ? (bad[0].pic + bad[0].mv).match(HALF)[0] : '下角'}"）`);
  for (const id of [...new Set(shots.map(s => s.scene))]) {
    const ss = shots.filter(s => s.scene === id); if (ss.length < 4) continue;
    const fx = ss.filter(s => /固定/.test(s.mv) && !/推|拉|跟|移|摇|绕|甩|升|降/.test(s.mv));
    if (fx.length > ss.length / 2) add('⚠️', '5.27', `${id} ${ss.length} 镜里 ${fx.length} 镜固定：没有呼吸。每镜写起点 → 怎么动 → 停在哪，固定留一两镜`);
    if (new Set(ss.map(s => s.d)).size === 1) add('⚠️', '5.28', `${id} 每镜都是 ${ss[0].d} 秒：长短错开`);
  }
}

// ---------- v4（2026-11-20）：说话的戏（references/说话戏型谱.md）----------
// 2.11 有台词，第 2 节要有"说话的人"表（带"型"和"曲线"两列）；5.16 每句台词标功能和意图。都只报 ⚠️：旧分镜没有这两样照样能过
{
  const talk = shots.filter(s => !isEmpty(s.line));
  if (talk.length) {
    const s2b = sec(2);
    const hasWho = s2b && readTables(s2b.body).some(t => t.header.some(h => h.includes('型')) && t.header.some(h => h.includes('曲线')));
    if (!hasWho) add('⚠️', '2.11', `有 ${talk.length} 镜有台词，第 2 节没有"说话的人"表（谁｜型｜修饰｜六个维度｜强度走向）：查 references/说话戏型谱.md 给每个说话的人归型，译镜照这张表写情绪`);
    const noFunc = talk.filter(s => isEmpty(s.func));
    if (noFunc.length) add('⚠️', '5.16', `${noFunc.length} 镜有台词，没写"句子功能 / 意图"（${noFunc.slice(0, 8).map(s => '镜' + s.no).join('、')}${noFunc.length > 8 ? '……' : ''}）：省略问、陈述语序问不写清楚，模型容易说成陈述`);
  }
}

// ---------- v5（2026-11-21）：起 → 止、重音、画面曲线、信息差、覆盖、台词对账 ----------
// 全部只报 ⚠️：译镜 GPT 模式只看"合计：❌"，旧分镜不能因为 v5 新加的检查变成不过
const v5 = (() => {
  const s0b = sec(0) ? sec(0).body : '';
  const verLine = (s0b.match(/环版本[^\n]*/) || [''])[0];
  return /环5\s*v([5-9]|\d\d)/.test(verLine) || shots.some(s => s.hasSS) || /\*\*重音\*\*/.test(text);
})();
// 第 2 节按"### 戏N"切开，看每场戏有没有写某一行
function s2Scenes() {
  const s = sec(2); if (!s) return [];
  return s.body.split(/^### /m).slice(1).map(p => { const m = p.split('\n')[0].match(/戏\s*(\d+)/); return { id: m ? '戏' + m[1] : p.split('\n')[0].trim(), body: p }; });
}
const hasLine = (body, key) => { const m = body.match(new RegExp('\\*\\*' + key + '\\*\\*[：:]\\s*([^\\n]*)')); return !!(m && !isEmpty(m[1].trim())); };
if (shots.length && !v5) {
  add('⚠️', '5.20', '这份分镜是 v5 之前的格式，没有 v5 新加的几样：分镜表最后的"起 → 止"一列（5.20），节拍表下面的"重音""画面曲线"（2.15、2.16），揭示、悬念类戏的"信息差"（2.17）。旧分镜不补也能交给译镜；要补，照模板加');
} else if (shots.length) {
  // 5.20 起 → 止
  if (!shots.some(s => s.hasSS)) add('⚠️', '5.20', '分镜表没有"起 → 止"一列（加在最后一列）：写每一镜开头和结尾的状态，译镜的结束状态、补镜头都从这里拿');
  else {
    const empty = shots.filter(s => s.hasSS && isEmpty(s.ss));
    if (empty.length) add('⚠️', '5.20', `${empty.length} 镜"起 → 止"是空的（${empty.slice(0, 10).map(s => '镜' + s.no).join('、')}${empty.length > 10 ? '……' : ''}）：没变也写"不变：…"`);
    const odd = shots.filter(s => s.hasSS && !isEmpty(s.ss) && !/→|->|不变|重放/.test(s.ss));
    if (odd.length) add('⚠️', '5.20', `${odd.map(s => '镜' + s.no).slice(0, 10).join('、')} 的"起 → 止"没写成"开头 → 结尾"，也不是"不变：…""重放镜N"`);
  }
  // 2.15 / 2.16 / 2.17
  const sc2 = s2Scenes();
  if (sc2.length) {
    const noAcc = sc2.filter(x => !hasLine(x.body, '重音')).map(x => x.id);
    if (noAcc.length) add('⚠️', '2.15', `${noAcc.join('、')} 没写"重音"（这场戏最重的一句或一下，落在谁脸上）`);
    const noCurve = sc2.filter(x => !hasLine(x.body, '画面曲线')).map(x => x.id);
    if (noCurve.length) add('⚠️', '2.16', `${noCurve.join('、')} 没写"画面曲线"（画面的松紧怎么跟着情绪走，最紧的一镜放在重音上）`);
    const needInfo = sceneRows.filter(r => /揭示戏|钩子悬念|追逐潜入戏/.test(r.type)).map(r => r.id);
    const noInfo = needInfo.filter(id => { const x = sc2.find(y => y.id === id); return !x || !hasLine(x.body, '信息差'); });
    if (noInfo.length) add('⚠️', '2.17', `${noInfo.join('、')} 是揭示 / 悬念 / 追逐的戏，没写"信息差"（观众比人物先知道，还是一起知道）`);
  }
}

// 4.14 每场戏的覆盖（OpenShotDesigner 的思路：只报几乎总值得看一眼的）
for (const sc of scenesInTable) {
  const list = shots.filter(s => s.scene === sc.id);
  if (list.length >= 4 && list.every(s => s.sizes.length) && !list.some(s => s.sizes.some(r => r <= 3)))
    add('⚠️', '4.14', `${sc.id} ${list.length} 镜里没有一个中景或更松的镜头：没有能切回去的关系镜头，观众看不清谁在哪（故意全程贴脸的，在回复里说明）`);
  const cams = new Set(list.map(s => s.cam).filter(c => c && !isEmpty(c)));
  if (list.length >= 3 && hasCamCol && cams.size === 1)
    add('⚠️', '4.14', `${sc.id} ${list.length} 镜全是机位 ${[...cams][0]}：整场一个角度，剪的时候没有路可走（故意一镜到底的，在回复里说明）`);
}

// 5.24 台词对账：剧本原文里的每一句台词，分镜里都找得到；分镜里没有剧本以外的台词
{
  const enTok = s => (s.replace(/[’‘]/g, "'").toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || []);
  const zhTok = s => (s.match(/[一-龥]/g) || []);
  const stripBr = s => s.replace(/【[^】]*】/g, ' ').replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ');
  const inParens = s => (s.match(/（[^）]*）|\([^)]*\)/g) || []).join(' ');
  // 剧本原文：标题"剧本原文"下面，到下一个同级或更高的标题为止
  const hm = text.match(/^(#{2,4})\s*(?:\d+\.\s*)?剧本原文[^\n]*$/m);
  const scriptLines = [];
  if (hm) {
    const lv = hm[1].length;
    const rest = text.slice(hm.index + hm[0].length);
    const endM = rest.match(new RegExp('^#{1,' + lv + '}\\s', 'm'));
    const body = endM ? rest.slice(0, endM.index) : rest;
    const STOP = /^(人物|场景|时间|地点|注|备注|注意|说明|字幕|道具|服装|画面|镜头|背景|音效|音乐|BGM|特效|提示|内景|外景|剧名|集数|出场)$/;
    for (const raw of body.split('\n')) {
      const l = raw.replace(/^\s*(?:[-*>]\s+)?/, '').replace(/\*\*/g, '').trim();
      if (!l || /^[#`]/.test(l)) continue;
      // 两种写法："名字（语气）：台词"（名字里可以有空格，如 Guest 1、保安 1）；表格式"动作 | 名字（语气） | 台词"
      let m = /^[△【\[（(\d]/.test(l) ? null : l.match(/^([^：:△【\[#|（(。，,.!?！？]{1,20}?)\s*(?:[（(][^）)]*[）)])?\s*[：:]\s*(.+)$/);
      if (!m && l.includes('|')) {
        const cells = l.split('|').map(x => x.trim()).filter(Boolean);
        const sp = cells.length >= 2 ? cells[cells.length - 2].match(/^([^\s：:|]{1,12})\s*(?:[（(][^）)]*[）)])?$/) : null;
        if (sp) m = [null, sp[1], cells[cells.length - 1]];
      }
      if (!m || STOP.test(m[1].trim())) continue;
      const txt = m[2].replace(/^\s*(?:[（(][^）)]*[）)]\s*)+/, '');
      const outside = stripBr(txt);
      const zh = zhTok(outside), en = enTok(outside);
      if (zh.length) scriptLines.push({ mode: 'zh', tok: zh, raw: txt });
      else if (en.length) scriptLines.push({ mode: 'en', tok: en, raw: txt });
    }
  }
  // 分镜里的台词：按"／"分人，"谁（…）："后面是台词；英文台词括号里是中文对照，中文台词括号里是说明
  const segs = [];
  for (const s of shots) {
    if (isEmpty(s.line)) continue;
    for (const part of s.line.split('／')) {
      const i = part.indexOf('：');
      const txt = i >= 0 && i < 40 ? part.slice(i + 1) : part;
      const en = enTok(stripBr(txt));
      const zh = en.length ? zhTok(inParens(txt)) : zhTok(stripBr(txt));
      if (en.length || zh.length) segs.push({ no: s.no, en, zh, raw: txt.trim() });
    }
  }
  const lcs = (a, b) => { const dp = new Array(b.length + 1).fill(0); for (let i = 1; i <= a.length; i++) { let prev = 0; for (let j = 1; j <= b.length; j++) { const tmp = dp[j]; dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]); prev = tmp; } } return dp[b.length]; };
  // 在 S 里找 T：先找连续出现，找不到再看最像的一段有几成对得上
  const findIn = (T, S, sep) => {
    if (!T.length) return 1;
    if ((sep + S.join(sep) + sep).includes(sep + T.join(sep) + sep)) return 1;
    const set = new Set(T); let best = 0; const w = Math.ceil(T.length * 1.5) + 3;
    for (let i = 0; i < S.length; i++) if (set.has(S[i])) { best = Math.max(best, lcs(T, S.slice(Math.max(0, i - 2), i + w))); if (best === T.length) break; }
    return best / T.length;
  };
  const cut = s => (s.length > 36 ? s.slice(0, 36) + '…' : s);
  const lineCnt = shots.filter(s => !isEmpty(s.line)).length;
  if (lineCnt && !scriptLines.length) add('⚠️', '5.24', hm ? '"剧本原文"里没认出台词（写成"名字：台词"一句一行），台词没对账' : '开工卡下面没贴"剧本原文"，台词没对账：剧本原文一字不改贴过来，脚本才能查台词有没有漏、有没有改');
  else if (lineCnt) {
    const enS = segs.flatMap(x => x.en), zhS = segs.flatMap(x => x.zh);
    if (!partial) {
      const miss = [], diff = [];
      for (const L of scriptLines) {
        const r = findIn(L.tok, L.mode === 'en' ? enS : zhS, L.mode === 'en' ? ' ' : '');
        if (r >= 1) continue;
        // 很短的台词（不到 5 个字或词）只算"找到 / 没找到"：凑上一两个字不算"词有出入"
        (r >= 0.6 && L.tok.length >= 5 ? diff : miss).push(L);
      }
      if (miss.length) add('⚠️', '5.24', `剧本里有 ${miss.length} 句台词在分镜里没找到（${miss.slice(0, 6).map(l => '"' + cut(l.raw) + '"').join('；')}${miss.length > 6 ? '……' : ''}）：台词全留；用户同意删的，在回复里列出来`);
      if (diff.length) add('⚠️', '5.24', `剧本里有 ${diff.length} 句台词在分镜里词有出入（${diff.slice(0, 6).map(l => '"' + cut(l.raw) + '"').join('；')}${diff.length > 6 ? '……' : ''}）：词和词序照剧本，一字不改`);
    }
    const enMode = scriptLines.filter(l => l.mode === 'en').length >= scriptLines.length / 2;
    const scriptS = scriptLines.filter(l => l.mode === (enMode ? 'en' : 'zh')).flatMap(l => l.tok);
    const extra = segs.filter(x => { const T = enMode ? x.en : x.zh; return T.length >= 2 && findIn(T, scriptS, enMode ? ' ' : '') < 0.6; });
    if (extra.length) add('⚠️', '5.24', `分镜里有 ${extra.length} 句台词在剧本里找不到（${extra.slice(0, 6).map(x => '镜' + x.no + '"' + cut(x.raw) + '"').join('；')}${extra.length > 6 ? '……' : ''}）：不加剧本没有的台词（1.6）`);
  }
}

// ---------- 5.25（2026-11-21）：每句台词定"说法"（references/说话戏型谱.md 0.5）----------
// 全部只报 ⚠️。环5 v6 之前、也没写说法的旧分镜不查，输出和以前一样
{
  const sayRe = () => /｜[^｜／]*｜\s*(顺|卡|断|一字一顿|拖|一口气)\s*(?:（([^）]*)）)?\s*(?:[：:]\s*([^／]*))?(?=／|$)/g;
  const parseSay = f => [...String(f || '').matchAll(sayRe())].map(m => ({ kind: m[1], why: (m[2] || '').trim(), text: (m[3] || '').trim() }));
  const verLine = ((sec(0) ? sec(0).body : '').match(/环版本[^\n]*/) || [''])[0];
  const on = /环5\s*v([6-9]|\d\d)/.test(verLine) || shots.some(s => parseSay(s.func).length);
  if (on) {
    const enTok = s => (s.replace(/[’‘]/g, "'").toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || []);
    const zhTok = s => (s.match(/[一-龥]/g) || []);
    const stripBr = s => s.replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ');
    // 把紧挨着的重复并掉（一个词或一小串，中文按字），顺便数并了几处
    const collapse = t => {
      const o = []; let places = 0;
      for (const w of t) {
        o.push(w);
        for (let L = Math.min(4, o.length >> 1); L >= 1; L--) {
          if (o.slice(-L).join('\u0001') === o.slice(-2 * L, -L).join('\u0001')) { o.length -= L; places++; break; }
        }
      }
      return { t: o, places };
    };
    const norm = s => s.replace(/\.\.\./g, '…').replace(/…+/g, '…').replace(/—+/g, '—');
    const cnt = (s, re) => (norm(s).match(re) || []).length;
    const STOP = /[.。!！?？]/g, GAP = /[—…]/g;
    const lineParts = L => L.split('／').map(p => {
      const i = p.indexOf('：');
      const has = i >= 0 && i < 40;
      const who = has ? p.slice(0, i).replace(/[（(].*$/, '').trim() : '';
      const body = stripBr(has ? p.slice(i + 1) : p).trim();
      const en = enTok(body);
      return { who, body, lang: en.length ? 'en' : 'zh', tok: en.length ? en : zhTok(body) };
    }).filter(x => x.tok.length);
    const SHAPE = {
      卡: (x, o) => x.places > o.places,
      断: (x, o, t, b) => cnt(t, GAP) > cnt(b, GAP),
      一字一顿: (x, o, t, b) => cnt(t, STOP) > cnt(b, STOP),
      拖: (x, o, t, b) => cnt(t, /…/g) > cnt(b, /…/g),
      一口气: (x, o, t) => !/[.。…—!！?？]/.test(norm(t).replace(/[.。…—!！?？"”'’\s]+$/, '')),
    };
    const noSay = [], miscount = [], noText = [], wrongWords = [], noShape = [], tooMany = [], tooLong = [];
    const byScene = {};
    for (const s of shots) {
      if (isEmpty(s.line)) continue;
      const parts = lineParts(s.line), says = parseSay(s.func);
      if (!parts.length) continue;
      if (!says.length) { noSay.push(s.no); continue; }
      if (says.length !== parts.length) { miscount.push(`镜${s.no}（${parts.length} 句台词，${says.length} 个说法）`); continue; }
      let need = 0, changed = false;
      parts.forEach((p, i) => {
        const y = says[i];
        (byScene[s.scene] = byScene[s.scene] || []).push({ who: p.who, kind: y.kind, why: y.why, no: s.no });
        let tok = p.tok, gaps = 0;
        if (y.kind !== '顺') {
          if (!y.text) noText.push(`镜${s.no}（${y.kind}）`);
          else {
            const t2 = stripBr(y.text);
            const got = p.lang === 'en' ? enTok(t2) : zhTok(t2);
            const a = collapse(p.tok), b = collapse(got);
            if (a.t.join(' ') !== b.t.join(' ') || got.length < p.tok.length) wrongWords.push(`镜${s.no}"${y.text.slice(0, 36)}"`);
            else {
              if (!SHAPE[y.kind](b, a, t2, p.body)) noShape.push(`镜${s.no}（${y.kind}）"${y.text.slice(0, 36)}"`);
              if (b.places - a.places > 2) tooMany.push(`镜${s.no}`);
              tok = got; changed = true;
              gaps = Math.max(0, cnt(t2, GAP) - cnt(p.body, GAP)) + Math.max(0, cnt(t2, STOP) - cnt(p.body, STOP));
            }
          }
        }
        need += tok.length / (p.lang === 'en' ? P.英文词每秒 : P.中文字每秒) + gaps * 0.3;
      });
      if (changed && !isNaN(s.d) && need > s.d + 1e-6) tooLong.push(`镜${s.no}（要约 ${need.toFixed(1)} 秒，只有 ${s.d} 秒）`);
    }
    const list = (a, n = 8) => a.slice(0, n).map(x => (/^\d/.test(String(x)) ? '镜' + x : x)).join('、') + (a.length > n ? '……' : '');
    if (noSay.length) add('⚠️', '5.25', `${noSay.length} 镜有台词，没定"说法"（${list(noSay)}）：写成"功能｜意图｜说法"，说法选顺、卡、断、一字一顿、拖、一口气`);
    if (miscount.length) add('⚠️', '5.25', `台词和说法的句数对不上：${list(miscount)}。一镜两个人说话，用"／"隔开，各写一个说法`);
    if (noText.length) add('⚠️', '5.25', `写了说法，没写出带标点的台词：${list(noText)}。写成"卡：He's— he's my fiancé!"，译镜照抄`);
    if (wrongWords.length) add('⚠️', '5.25', `说法里的台词词变了：${list(wrongWords)}。只能改标点、把已有的词紧挨着重复，不加词、不删词、不换词序`);
    if (noShape.length) add('⚠️', '5.25', `说法和写出来的台词对不上：${list(noShape)}。卡要有重复的词，断要多一个破折号或省略号，一字一顿要多停几处，拖要有省略号，一口气中间不能有句号`);
    if (tooMany.length) add('⚠️', '5.25', `${list(tooMany)} 一句里重复超过两处：留在最难出口的那个词上`);
    if (tooLong.length) add('⚠️', '5.25', `加了卡顿和停顿以后可能说不完：${list(tooLong)}。先从相邻镜头匀秒，或者换一种不占时间的说法（5.19）`);
    // 该卡没卡、卡得太多：对着第 2 节"说话的人"表看
    const s2 = sec(2);
    if (s2) for (const part of s2.body.split(/^### /m).slice(1)) {
      const m = part.split('\n')[0].match(/戏\s*(\d+)/);
      if (!m) continue;
      const lines = byScene['戏' + m[1]] || [];
      if (!lines.length) continue;
      const t = readTables(part).find(x => x.header.some(h => clean(h) === '谁') && x.header.some(h => clean(h).includes('掌控')));
      if (!t) continue;
      const H = t.header.map(clean), iw = H.indexOf('谁'), ic = H.findIndex(h => h.includes('掌控')), is = H.findIndex(h => h.includes('强度'));
      for (const r of t.rows) {
        const who = clean(r[iw] || ''), ctrl = clean(r[ic] || ''), str = is >= 0 ? clean(r[is] || '') : '';
        if (!who) continue;
        const mine = lines.filter(l => l.who && (l.who === who || l.who.includes(who) || who.includes(l.who)));
        if (!mine.length) continue;
        if ((/失|半/.test(ctrl) || /过|破/.test(str)) && mine.every(l => l.kind === '顺' && !l.why))
          add('⚠️', '5.25', `戏${m[1]} ${who}（掌控：${ctrl}，强度：${str}）${mine.length} 句全是"顺"，也没写为什么：至少给最重的那句定一个说法；故意不卡，写成"顺（为什么）"`);
        const stutter = mine.filter(l => l.kind === '卡' || l.kind === '断');
        if (mine.length >= 3 && stutter.length > mine.length / 2)
          add('⚠️', '5.25', `戏${m[1]} ${who} ${mine.length} 句里 ${stutter.length} 句在卡或断：像一个口吃的人了，留给最难出口的那一两句`);
        if (/^控/.test(ctrl)) {
          const bad = stutter.filter(l => !l.why);
          if (bad.length) add('⚠️', '5.25', `戏${m[1]} ${who} 这场戏是掌控型，${bad.map(l => '镜' + l.no).join('、')} 写了卡或断，没写触发：写成"卡（是什么戳到了他）：…"，没有触发就改回顺`);
        }
      }
    }
  }
}

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
// 4.15 镜头分布：只看，不判（v5）
if (shots.length) {
  console.log('【镜头分布】只看、不判（环4 规则 4.15）：对照配方看像不像这种戏');
  for (const sc of scenesInTable) {
    const list = shots.filter(s => s.scene === sc.id);
    if (!list.length) continue;
    const durs = list.map(s => s.d).filter(Number.isFinite);
    const cnt = {};
    for (const s of list) if (s.sizes.length) { const n = RANK_NAME[s.sizes[0]] || '?'; cnt[n] = (cnt[n] || 0) + 1; }
    const order = ['大全景', '全景', '中景', '中近景', '近景', '特写', '大特写'];
    const cams = new Set(list.map(s => s.cam).filter(c => c && !isEmpty(c)));
    console.log(`  ${sc.id}${sc.type ? '（' + sc.type + '）' : ''}：${list.length} 镜，平均 ${durs.length ? (durs.reduce((a, b) => a + b, 0) / durs.length).toFixed(1) : '?'} 秒｜${order.filter(k => cnt[k]).map(k => k + ' ' + cnt[k]).join('、') || '景别没读到'}｜机位 ${cams.size} 个`);
  }
}
const nErr = found.filter(f => f.lvl === '❌').length;
const nWarn = found.filter(f => f.lvl === '⚠️').length;
console.log('');
console.log(`合计：❌ ${nErr} 个，⚠️ ${nWarn} 个。${nErr ? '❌ 全部改掉再交；' : ''}${nWarn ? '保留的 ⚠️ 在回复里逐条说明为什么。' : ''}`);
console.log('脚本只查能数、能对表的规则；每环的〔人工〕规则照那一环文件的"验收"自查，最后用导演的眼睛过一遍（环5 验收最后一条）。');
process.exit(nErr ? 1 : 0);
