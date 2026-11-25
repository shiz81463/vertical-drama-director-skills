// GPT 模式（2026-11-18 加）：集卡写"模型: GPT"，或者 build.js 加 --gpt，才跑这里的检查。
// 不开 GPT 模式时 build.js 不调用这个文件，DeepSeek、Claude 编出来的提示词和编译报告和原来一字不差。
// 为什么要它：用户 2026-11-18，GPT-6.2 用译镜写的提示词多段场景一致性没保持好，到处发光；GPT 照着范例的样子填键，不推理跨段的事。
// 办法：先在 源/工作单.txt 里把全集的方向（段表）和每场戏谁看画面哪边（轴线）一次定死；写段的时候只照表填；脚本逐段对表。
// 编号 G1–G21 只在 GPT 模式出现。规程见 GPT/执行规程.md。
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./parse.js');

// GPT 模式下从 ⚠️ 升成 ❌ 的编号：锚点、账本、视线、强情绪词、备注混进提示词、没写分镜秒
const ESCALATE = new Set(['X6', 'L2', 'L3', 'F3', 'E7', 'T14', 'T15', 'T16', 'Y2']);

const SKILL = path.join(__dirname, '..', '..');
const sideOf = s => (/RIGHT|右/i.test(s) ? 'RIGHT' : /LEFT|左/i.test(s) ? 'LEFT' : null);

// ---------- 工作单 ----------
function parsePlan(file) {
  const plan = { file, kv: {}, scenes: {}, segs: [] };
  let sec = null;
  for (const e of P.entries(file)) {
    if (e.t === 'sub') throw new P.SrcError(file, e.line, '工作单里没有"-- 小节 --"');
    if (e.t === 'sec') {
      if (/^段表$/.test(e.v)) { sec = { type: 'segs' }; continue; }
      const m = e.v.match(/^场景[:：]\s*(.+)$/);
      if (!m) throw new P.SrcError(file, e.line, '工作单的节标题只有两种："== 场景：地方，时段 ==" 和 "== 段表 =="');
      const name = m[1].trim();
      if (plan.scenes[name]) throw new P.SrcError(file, e.line, `场景"${name}"写了两次`);
      plan.scenes[name] = { name, locks: [], swaps: [], line: e.line };
      sec = { type: 'scene', name }; continue;
    }
    if (!sec) { plan.kv[e.k] = e.v; continue; }
    const p = P.parts(e.v).map(x => x.trim());
    if (e.n !== null) p.unshift(String(e.n));   // 也认"段 1: 场景 | …"
    if (sec.type === 'segs') {
      if (e.k !== '段') throw new P.SrcError(file, e.line, '段表里一行一段："段: 段号 | 场景 | 分镜里的镜号 | 每镜方向，用 / 隔开"');
      if (p.length < 4) throw new P.SrcError(file, e.line, '"段"写成：段号 | 场景 | 分镜里的镜号 | 每镜方向（如 1/2/2/1，和这一段的镜头一一对应）');
      const n = +((p[0].match(/\d+/) || [])[0]);
      const dirs = p[3].split(/[/／、,，\s]+/).filter(Boolean).map(x => (x.match(/\d+/) || [''])[0]);
      if (!n || !dirs.length || dirs.some(d => !d)) throw new P.SrcError(file, e.line, '"段"的第一格写段号，第四格写每镜的方向号，用 / 隔开，如 1/2/2/1');
      plan.segs.push({ n, scene: p[1], sb: p[2], dirs, line: e.line });
      continue;
    }
    const sc = plan.scenes[sec.name];
    if (e.k === '轴线') {
      const pair = (p[0] || '').split(/\s*>\s*/).map(x => x.trim());
      const side = sideOf(p[1] || '');
      if (pair.length !== 2 || !pair[0] || !pair[1] || !side) throw new P.SrcError(file, e.line, '"轴线"写成：谁 > 看谁 | screen-LEFT 或 screen-RIGHT（谁看着谁的时候，眼睛朝画面哪边）');
      if (sc.locks.some(l => l.a === pair[0] && l.b === pair[1])) throw new P.SrcError(file, e.line, `"${pair[0]} > ${pair[1]}"写了两次：要变就写"换轴"`);
      sc.locks.push({ a: pair[0], b: pair[1], side, line: e.line });
    } else if (e.k === '换轴') {
      const from = +(((p[0] || '').match(/\d+/)) || [])[0];
      const pair = (p[1] || '').split(/\s*>\s*/).map(x => x.trim());
      const side = sideOf(p[2] || '');
      if (!from || pair.length !== 2 || !side || !p[3]) throw new P.SrcError(file, e.line, '"换轴"写成：段N | 谁 > 看谁 | 新的 screen-LEFT 或 screen-RIGHT | 为什么换（谁走到了哪一边）');
      sc.swaps.push({ from, a: pair[0], b: pair[1], side, why: p[3], line: e.line });
    } else throw new P.SrcError(file, e.line, `工作单的场景节里只写"轴线"和"换轴"，不认识"${e.k}"`);
  }
  plan.segs.sort((a, b) => a.n - b.n);
  return plan;
}

function loadPlan(src, add) {
  const f = path.join(src, '工作单.txt');
  if (!fs.existsSync(f)) { add(0, 'fail', 'G1', 'GPT 模式要先写 源\\工作单.txt（模板：译镜\\GPT\\工作单模板.txt）：全集每段每镜朝哪个方向、每场戏谁看画面哪边，先一次定死，再写段落源'); return null; }
  return parsePlan(f);
}

// 这一段、谁看谁，现在锁的是画面哪边（换轴从那一段起算）
function lockSide(sp, a, b, n) {
  if (!sp) return null;
  const l = sp.locks.find(x => x.a === a && x.b === b);
  let side = l ? l.side : null;
  for (const s of sp.swaps.filter(x => x.a === a && x.b === b && x.from <= n).sort((x, y) => x.from - y.from)) side = s.side;
  return side;
}

function checkPlan(plan, scenes, cast, add) {
  if (!plan.segs.length) add(0, 'fail', 'G2', '工作单的段表是空的：照分镜把全集排成段，每段一行"段: 段号 | 场景 | 分镜里的镜号 | 每镜方向"');
  plan.segs.forEach((r, i) => {
    if (r.n !== i + 1) add(0, 'fail', 'G3', `段表的段号要从 1 连着排：第 ${i + 1} 行写的是段 ${r.n}`);
    const sc = scenes.scenes[r.scene];
    if (!sc) { add(0, 'fail', 'G4', `段表段${r.n} 的场景"${r.scene}"不在场景卡里：和场景卡的节标题一字不差`); return; }
    const bad = [...new Set(r.dirs.filter(d => !sc.dirs[d]))];
    if (bad.length) add(0, 'fail', 'G5', `段表段${r.n} 用了方向 ${bad.join('、')}，场景卡"${r.scene}"里只有方向 ${Object.keys(sc.dirs).join('、')}：不发明新方向；真缺一个方向，先在场景卡里加，再出这个方向的图`);
  });
  for (const sp of Object.values(plan.scenes)) {
    const sc = scenes.scenes[sp.name];
    if (!sc) { add(0, 'fail', 'G6', `工作单里的场景"${sp.name}"不在场景卡里：和场景卡的节标题一字不差`); continue; }
    for (const l of [...sp.locks, ...sp.swaps]) for (const k of [l.a, l.b]) if (!cast.cast[k]) add(0, 'fail', 'G7', `工作单"${sp.name}"的"${l.a} > ${l.b}"里，"${k}"不是人物卡里的人物键`);
    for (const l of sp.locks) {
      const back = sp.locks.find(x => x.a === l.b && x.b === l.a);
      if (back && back.side === l.side && l.a < l.b) add(0, 'fail', 'G8', `"${sp.name}"里 ${l.a} 看 ${l.b} 是 screen-${l.side}，${l.b} 看 ${l.a} 也是 screen-${back.side}：两个人对看，眼睛一个朝左、一个朝右；同一边就是越轴，剪在一起像两个人看同一个方向`);
      const aa = sc.anchors[l.a] || [], ab = sc.anchors[l.b] || [];
      if (back && l.a < l.b && aa.length === 1 && ab.length === 1 && aa[0] === ab[0]) add(0, 'warn', 'G9', `"${sp.name}"里 ${l.a} 和 ${l.b} 对看，场景卡的锚点却都是方向${aa[0]}：正反打的两个单人镜头背景会一模一样，分不出谁在哪一头。对看的两个人，身后一般是相反的两头`);
    }
    for (const s of sp.swaps) {
      if (!plan.segs.some(r => r.n === s.from)) add(0, 'fail', 'G11', `"${sp.name}"的换轴写在段${s.from}，段表里没有这一段`);
      if (!sp.locks.some(x => x.a === s.a && x.b === s.b)) add(0, 'fail', 'G11', `"${sp.name}"的换轴"${s.a} > ${s.b}"前面没有对应的"轴线"：先写一开始的轴线，再写从哪一段换`);
    }
  }
  for (const name of new Set(plan.segs.map(r => r.scene))) {
    const sc = scenes.scenes[name]; if (!sc) continue;
    const sp = plan.scenes[name];
    if (Object.keys(sc.anchors).length >= 2 && (!sp || !sp.locks.length)) add(0, 'warn', 'G10', `"${name}"有 ${Object.keys(sc.anchors).length} 个人有锚点，工作单里没写这场戏的轴线：有人对看或说话，就把"谁 > 看谁 | 画面哪边"定下来；真没有人对看，在这一节写一行 # 注释说明`);
  }
}

// ---------- 段落源 ----------
// 机位里写背景：方向号已经带着背景，机位再写一遍，模型就可能照机位、不照场景卡
function bgClauses(cam) {
  const out = [];
  for (const cl of String(cam || '').split(/[；;，,。]/)) {
    // "在她身后半步"是站位，不算；"身后是/身后有/身后的"才是背景
    const m = cl.match(/(背景|身后(?=是|有|的|一片|虚)|尽头|远处是|后面是)/);
    if (!m) continue;
    const rest = cl.slice(cl.indexOf(m[1]));
    if (/^(背景|身后|尽头)\s*(是|为)?\s*(方向\s*\d+)?\s*[（(]?\s*(虚掉|虚焦|虚化|虚)?\s*[)）]?\s*$/.test(rest.trim())) continue;
    out.push(cl.trim());
  }
  return out;
}

const NAMES = cast => Object.values(cast.cast).map(c => {
  const keys = [c.key, c.kv['名']].filter(Boolean);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const src = keys.map(k => /^[A-Za-z]/.test(k) ? `\\b${esc(k)}\\b` : esc(k)).join('|');
  return { key: c.key, re: new RegExp(src, 'i'), reG: new RegExp(src, 'gi') };
});

// 一个分句里：谁、看画面哪边、看谁
function looksIn(clause, names) {
  const out = [];
  for (const n of names) {
    const re = new RegExp(`(?:${n.re.source})(?:'s)?[^.;:]{0,40}?\\b(looks?|looking|gazes?|gazing|glances?|glancing|eyes|eyeline|watch(?:es|ing)?|stares?|staring)\\b[^.;:]{0,40}?screen-(LEFT|RIGHT)`, 'i');
    const m = clause.match(re);
    if (!m) continue;
    const after = clause.slice(m.index + m[0].length);
    let target = null;
    for (const o of names) if (o.key !== n.key && o.re.test(after)) { const i = after.search(o.re); if (target === null || i < target.i) target = { key: o.key, i }; }
    // "when they look at each other, A looks screen-LEFT, B looks screen-RIGHT"：后一个人的对象没写在后面，句子里另外只有一个人，就是看他
    if (!target && /each other/i.test(clause)) { const others = names.filter(o => o.key !== n.key && o.re.test(clause)); if (others.length === 1) target = { key: others[0].key }; }
    // 看的不是人物卡里的人（at her、the runway），不查：规程要求看人时写名字
    out.push({ a: n.key, side: m[2].toUpperCase(), b: target ? target.key : null });
  }
  return out;
}

// 发光：GPT 最爱写，成片里就是到处发光、眼睛发光（用户 2026-11-18）
const GLOW = /\b(glow(?:s|ed|ing)?|aglow|luminous|luminescent|radiant(?:ly)?|radiance|radiating|aura|ethereal|incandescent|shimmer(?:s|ed|ing)?|iridescent|lit from within|halos? around)\b/i;
const BODY = '(?:eyes?|irises|pupils?|gaze|skin|face|faces|cheeks?|hair|hands?|fingers?|body|tears?|lips|teeth|veins?|chest|heart)';
// 人身上发光：身体部位后面紧跟发光的动词（her eyes shine、eyes that never glow），或者发光的形容词紧跟身体部位（glowing skin）。
// "its warm glow rims the hair"是灯光勾亮头发，不算
const LIGHTV = '(?:glow\\w*|shin(?:e|es|ing)|shimmer\\w*|sparkl\\w*|gleam\\w*|glint\\w*|blaz\\w*|burn\\w*|light(?:s)? up|lit up)';
const GLOWADJ = '(?:glowing|luminous|radiant|shimmering|sparkling|gleaming|shining|burning|blazing|glittering)';
const BODYGLOW = new RegExp(`\\b${BODY}\\s+(?:[a-z']+\\s+){0,2}?${LIGHTV}\\b|\\b${GLOWADJ}\\s+${BODY}\\b`, 'i');
const ZHGLOW = /发光|发亮|光芒|光晕|闪耀|熠熠|荧光|辉光|眼(?:睛|里|中|神)[^，。；]{0,6}(?:亮|光|闪)/;
const SCENERY = /\b(?:in the background|behind (?:him|her|them|us))\b[^.;]{0,50}\b(?:walls?|windows?|doors?|curtains?|drapes?|mirrors?|racks?|shel(?:f|ves)|tables?|stage|trees?|lamps?|bulbs?|sky|city|counters?|bar|paintings?|chandeliers?|lights?)\b/i;

function srcLines(file) {
  const lines = P.read(file).split('\n');
  return lines.map((t, i) => ({ t, line: i + 1 })).filter(x => x.t.trim() && !x.t.trim().startsWith('#'));
}

// 照抄范例：范例的句子只是格式，换一部戏、换一集还照抄，就是没推理。40 个字一样算抄（手册、模板里写明要用的句子不算）
const COPYKEYS = new Set(['人', '表演', '空间', '视线', '逻辑', '同框', '正反打', '状态', '结束', '拍', '说时']);
const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const W = 40;
let exampleSet = null;
function windows(s) { const t = norm(s); const out = []; for (let i = 0; i + W <= t.length; i++) out.push(t.slice(i, i + W)); return out; }
function loadExamples() {
  if (exampleSet) return exampleSet;
  const allow = new Set();
  const walk = (dir, re) => { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name), re) : re.test(d.name) ? [path.join(dir, d.name)] : []); };
  for (const f of [...walk(path.join(SKILL, '手册'), /\.md$/), ...walk(path.join(SKILL, '模板'), /\.txt$/), ...walk(path.join(SKILL, 'GPT'), /\.(md|txt)$/), path.join(SKILL, 'SKILL.md')]) {
    if (fs.existsSync(f)) for (const w of windows(P.read(f))) allow.add(w);
  }
  exampleSet = new Set();
  for (const f of walk(path.join(SKILL, 'examples'), /^段\d+\.txt$/)) {
    for (const e of P.entries(f)) if (e.t === 'kv' && COPYKEYS.has(e.k)) for (const w of windows(e.v)) if (!allow.has(w)) exampleSet.add(w);
  }
  return exampleSet;
}

function checkSegments(segs, plan, scenes, cast, add) {
  const names = NAMES(cast);
  const ex = loadExamples();
  for (const seg of segs) {
    const row = plan && plan.segs.find(r => r.n === seg.n);
    if (plan && !row) add(seg.n, 'fail', 'G12', `工作单的段表里没有段${seg.n}：先在段表里排好这一段（场景、分镜镜号、每镜方向），再写段落源`);
    if (row && row.scene !== seg.scene) add(seg.n, 'fail', 'G12', `场景和段表不一样：段表写"${row.scene}"，段落源写"${seg.scene}"。两边都改成和场景卡的节标题一字不差`);
    if (row && row.dirs.length !== seg.shots.length) add(seg.n, 'fail', 'G13', `段表排了 ${row.dirs.length} 镜（方向 ${row.dirs.join('/')}），段落源写了 ${seg.shots.length} 镜：镜头数照段表。分镜真要合并或拆开，先改段表`);
    seg.shots.forEach((s, i) => {
      const want = row && row.dirs[i];
      if (want && s.dir !== want) add(seg.n, 'fail', 'G14', `镜头${i + 1} 用了方向${s.dir}，段表定的是方向${want}：方向照段表抄。是段表定错了，就改段表，再看同一个人在别的段是不是也该跟着改`);
      if (!s.subject || !s.subject.length) add(seg.n, 'fail', 'G15', `镜头${i + 1}（${s.title}）没写"主体"：每镜写拍的是谁（人物键）；拍手、拍东西、拍全场写"主体: 无"。写了脚本才能查这个人身后是不是他固定的方向`);
      const bg = bgClauses(s.cam);
      if (bg.length) add(seg.n, 'fail', 'G16', `镜头${i + 1} 的机位里写了背景（"${bg.join('；')}"）：背景只靠方向号，方向${s.dir} 的背景脚本会从场景卡贴进去；机位里再写一遍，就可能和场景卡、和别的段对不上。删掉，或者只写"背景是方向${s.dir}，虚掉"`);
      for (const b of s.beats) {
        const t = (b.text || '') + ' ' + (b.during || '');
        const m = t.match(SCENERY);
        if (m) { add(seg.n, 'warn', 'G21', `镜头${i + 1} 的拍里写了背景里有什么（"${m[0].slice(0, 60)}"）：背景交给方向图和场景卡，拍里只写人。真要写，确认和场景卡方向${s.dir} 的"背景"一样`); break; }
      }
    });
    // 视线照工作单的轴线
    const sp = plan && plan.scenes[seg.scene];
    if (plan) {
      for (const cl of String(seg.kv['视线'] || '').split(/[;；]/)) {
        for (const lk of looksIn(cl, names)) {
          const b = lk.b;
          if (!b) continue;
          const want = lockSide(sp, lk.a, b, seg.n);
          if (!want) add(seg.n, 'fail', 'G18', `"视线"写了 ${lk.a} 看 ${b}（screen-${lk.side}），工作单"${seg.scene}"里没定 ${lk.a} > ${b}：先在工作单里定下来，这一场每一段都照它写`);
          else if (want !== lk.side) add(seg.n, 'fail', 'G17', `"视线"里 ${lk.a} 看 ${b} 写成 screen-${lk.side}，工作单定的是 screen-${want}：同一场戏每一段都一样，不然两段剪在一起像越轴。人真走到了另一边，在工作单写"换轴: 段${seg.n} | ${lk.a} > ${b} | screen-${lk.side} | 为什么"`);
        }
      }
    }
    // 发光、照抄范例：查段落源原文
    const glow = [], zh = [], copied = [];
    for (const x of srcLines(seg.file)) {
      const m = x.t.match(BODYGLOW) || x.t.match(GLOW);
      if (m) glow.push(`第 ${x.line} 行"${m[0]}"`);
      const z = x.t.match(ZHGLOW);
      if (z) zh.push(`第 ${x.line} 行"${z[0]}"`);
    }
    for (const e of P.entries(seg.file)) {
      if (e.t !== 'kv' || !COPYKEYS.has(e.k)) continue;
      const hit = windows(e.v).find(w => ex.has(w));
      if (hit) copied.push(`第 ${e.line} 行（${e.k}）"…${hit}…"`);
    }
    if (glow.length || zh.length) add(seg.n, 'fail', 'G19', `段落源里写了发光一类的词（${[...glow, ...zh].slice(0, 4).join('；')}）：成片里就会有东西、眼睛、皮肤发光。光只写在场景卡里；人的情绪写身体信号（眼睛停在哪、呼吸、手）；要写光，写光从哪来、照在哪（the candle lights the left side of her face）。"never glow""不发光"这种否定句也别写，风格锁的负面词里已经有了`);
    if (copied.length) add(seg.n, 'fail', 'G20', `有 ${copied.length} 行照抄了范例的句子（${copied.slice(0, 3).join('；')}）：范例只看格式。这一句要按这一集、这一段的分镜重新写`);
  }
}

// 场景卡、人物卡：GPT 也会把发光写进去。场景里的灯可以亮，人身上不能
function checkCards(scenes, cast, src, add) {
  for (const f of ['场景卡.txt', '人物卡.txt']) {
    const p = path.join(src, f); if (!fs.existsSync(p)) continue;
    const hits = srcLines(p).filter(x => BODYGLOW.test(x.t)).map(x => `第 ${x.line} 行"${x.t.match(BODYGLOW)[0]}"`);
    if (hits.length) add(0, 'fail', 'G19', `${f} 里写了人身上发光（${hits.slice(0, 3).join('；')}）：眼睛、皮肤、头发、手都不发光。光只来自场景里真有的灯、窗、火`);
  }
}

// ---------- 分镜硬连接（2026-11-18 第二版）：工作单写"分镜: 路径"，脚本自己读分镜，段表编不出来 ----------
// 读的是分镜编导模板的格式：## 3. 里的机位表（第一列"机位"、有"方向"一列）和"#### 场景卡：名字"；## 5. 里的分镜表（镜 | 时间码 | 时长 | 机位 | … | 台词）。
const { spawnSync } = require('child_process');
function mdTables(body) {
  const lines = body.split('\n'); const out = []; let i = 0;
  const row = l => { let s = l.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|')) s = s.slice(0, -1); return s.split('|').map(c => c.trim()); };
  while (i < lines.length) {
    if (/^\s*\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|\s*:?-{2,}/.test(lines[i + 1])) {
      const header = row(lines[i]); const rows = []; let j = i + 2;
      while (j < lines.length && /^\s*\|/.test(lines[j])) { rows.push(row(lines[j])); j++; }
      out.push({ header, rows }); i = j;
    } else i++;
  }
  return out;
}
const cl = s => String(s || '').replace(/\*\*|`/g, '').trim();
const camId = s => (cl(s).match(/^[A-Za-z]*\d+[A-Za-z]?/) || [''])[0].toUpperCase();
// 台词比对：去掉括号里的说明和翻译、去掉标点，只比字母、数字、汉字
const lineNorm = s => String(s).replace(/（[^）]*）|\([^)]*\)/g, '').replace(/[^A-Za-z0-9一-鿿]/g, '').toLowerCase();
// V1.2（2026-11-20）：台词可以改标点、把台词里已有的词紧挨着重复（口吃、哽住）。比对时两边都把紧挨着重复的词并成一个，写的词数不能比原文少（删词不行）
const sayWords = s => String(s).replace(/（[^）]*）|\([^)]*\)/g, '').toLowerCase().replace(/'/g, '').match(/[a-z0-9]+|[一-鿿]/g) || [];
const sayKey = s => { const a = sayWords(s); let ch = true; while (ch) { ch = false; for (let n = 1; n <= 3; n++) for (let i = 0; i + 2 * n <= a.length;) { if (a.slice(i, i + n).join(' ') === a.slice(i + n, i + 2 * n).join(' ')) { a.splice(i + n, n); ch = true; } else i++; } } return a.join(''); };
const sameSay = (w, h) => h.n === w.n || (sayKey(h.raw) === sayKey(w.raw) && sayWords(h.raw).length >= sayWords(w.raw).length);
function boardLines(cell) {
  const out = [];
  for (let piece of String(cell || '').split(/<br\s*\/?>|\n/i)) {
    piece = piece.replace(/（[^）]*[一-鿿][^）]*）\s*$/, '').trim();     // 句末的中文翻译
    const i = piece.indexOf('：'); if (i >= 0 && i < 30) piece = piece.slice(i + 1);   // 说话的人（画外，语气）：
    if (!lineNorm(piece)) continue;
    out.push({ raw: piece.trim(), n: lineNorm(piece) });
  }
  return out;
}
function parseBoard(file) {
  const t = P.read(file);
  const secs = []; const re = /^## (\d+)\.\s*(.*)$/gm; let m;
  while ((m = re.exec(t))) secs.push({ n: +m[1], start: m.index });
  secs.forEach((s, i) => { s.body = t.slice(s.start, i + 1 < secs.length ? secs[i + 1].start : t.length); });
  const s3 = secs.find(s => s.n === 3), s5 = secs.find(s => s.n === 5);
  const board = { file, cams: {}, hasDirCol: false, cards: {}, shots: [] };
  if (s3) {
    for (const tb of mdTables(s3.body)) {
      if (!cl(tb.header[0]).startsWith('机位')) continue;
      const di = tb.header.findIndex(h => cl(h) === '方向' || /方向（v4）/.test(h));
      if (di >= 0) board.hasDirCol = true;
      for (const r of tb.rows) { const c = camId(r[0]); if (c) board.cams[c] = di >= 0 ? cl(r[di]).split(/[/／、,，\s]+/).map(x => (x.match(/\d+/) || [''])[0]).filter(Boolean) : []; }
    }
    const cre = /^#{3,4}\s*场景卡[:：]\s*(.+)$/gm; const cards = [];
    while ((m = cre.exec(s3.body))) cards.push({ name: m[1].trim().replace(/（[^）]*）\s*$/, ''), start: m.index });
    cards.forEach((c, i) => {
      const body = s3.body.slice(c.start, i + 1 < cards.length ? cards[i + 1].start : s3.body.length);
      const tb = mdTables(body).find(x => cl(x.header[0]).startsWith('方向'));
      const bi = tb ? tb.header.findIndex(h => h.includes('背景图')) : -1;
      board.cards[c.name] = tb ? tb.rows.map(r => ({ d: (cl(r[0]).match(/\d+/) || [''])[0], img: bi >= 0 ? (String(r[bi]).match(/@[^\s，,；;|]+/) || [''])[0] : '' })).filter(x => x.d) : [];
    });
  }
  if (s5) {
    for (const tb of mdTables(s5.body)) {
      if (cl(tb.header[0]) !== '镜') continue;
      const ix = k => tb.header.findIndex(h => cl(h) === k);
      const iDur = ix('时长'), iCam = ix('机位'), iLine = ix('台词');
      for (const r of tb.rows) {
        const id = (cl(r[0]).match(/^\d+[a-z]?/i) || [''])[0]; if (!id) continue;
        board.shots.push({ id, dur: iDur >= 0 ? parseFloat(cl(r[iDur])) : NaN, cam: iCam >= 0 ? camId(r[iCam]) : '', lines: iLine >= 0 ? boardLines(r[iLine]) : [] });
      }
    }
  }
  return board;
}
// 段表第三格"分镜里的镜号"：镜1–4、镜5、7–9、12a
function shotIds(s) {
  const out = []; const re = /(\d+)\s*[–—\-~～至到]\s*(\d+)|(\d+[a-z]?)/gi; let m;
  while ((m = re.exec(String(s)))) { if (m[1]) { const a = +m[1], b = +m[2]; for (let k = a; a <= b && k <= b; k++) out.push(String(k)); } else out.push(m[3].toLowerCase()); }
  return out;
}

function checkBoard(plan, src, scenes, add) {
  const p = plan.kv['分镜'];
  if (!p) { add(0, 'fail', 'G22', '工作单开头没写"分镜: 分镜脚本的完整路径"：GPT 模式要照真的分镜排段表，脚本会拿分镜核对每镜的方向、秒数和台词。手里没有分镜，就回到执行规程"第 -1 步"，先做分镜'); return null; }
  const f = path.isAbsolute(p) ? p : path.resolve(src, p);
  if (!fs.existsSync(f)) { add(0, 'fail', 'G22', `工作单里的分镜找不到：${f}`); return null; }
  const chk = path.join(SKILL, '..', '分镜编导', 'scripts', 'check_storyboard.js');
  if (fs.existsSync(chk)) {
    const r = spawnSync(process.execPath, [chk, f], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const n = +(((r.stdout || '').match(/合计：❌ (\d+)/) || [])[1] || 0);
    if (n) add(0, 'fail', 'G23', `分镜没过分镜编导的检查（❌ ${n} 个）：先用分镜编导改到 0，给用户确认过，再回来写提示词。命令：node "${chk}" "${f}"`);
  } else add(0, 'warn', 'G23', `没找到分镜编导的检查脚本（${chk}），分镜没检查`);
  const b = parseBoard(f);
  const miss = [];
  if (!Object.keys(b.cards).length) miss.push('第 3 节的场景卡（"#### 场景卡：地方，时段"，每场戏一张方向表）');
  if (!b.hasDirCol) miss.push('机位表的"方向"一列（每个机位属于场景卡的哪个方向）');
  if (!b.shots.length) miss.push('第 5 节的分镜表（第一列"镜"）');
  if (miss.length) { add(0, 'fail', 'G24', `分镜缺：${miss.join('；')}。这是旧格式的分镜，GPT 模式不能照它排方向：先用分镜编导补上（环3 规则 3.15–3.17），给用户确认，再写工作单`); return b.shots.length ? b : null; }
  // 段表 ↔ 分镜：每镜都排进去、只排一次、顺序不乱；镜头数一样；方向一样
  const byId = new Map(b.shots.map((s, i) => [s.id.toLowerCase(), { ...s, i }]));
  const used = new Map(); let last = -1, order = true;
  for (const r of plan.segs) {
    r.board = [];
    for (const id of shotIds(r.sb)) {
      const s = byId.get(id);
      if (!s) { add(0, 'fail', 'G25', `段表段${r.n} 写了分镜镜${id}，分镜第 5 节里没有这一镜`); continue; }
      if (used.has(id)) add(0, 'fail', 'G26', `分镜镜${id} 排了两次（段${used.get(id)} 和段${r.n}）`); else used.set(id, r.n);
      if (s.i < last) order = false; last = s.i;
      r.board.push(s);
    }
    if (r.board.length && r.board.length !== r.dirs.length) add(0, 'fail', 'G27', `段表段${r.n} 照分镜是 ${r.board.length} 镜（镜${r.board.map(s => s.id).join('、')}），每镜方向却写了 ${r.dirs.length} 个：GPT 模式不合并、不拆分分镜的镜头。真要合并，写进"要总控批的事"，批了再改`);
    else r.board.forEach((s, i) => {
      const ds = b.cams[s.cam] || [];
      if (!s.cam || !ds.length) add(0, 'fail', 'G28', `分镜镜${s.id} 的机位"${s.cam || '没写'}"在机位表里查不到方向：回分镜编导补`);
      else if (!ds.includes(r.dirs[i])) add(0, 'fail', 'G28', `段表段${r.n} 第 ${i + 1} 镜（分镜镜${s.id}，机位 ${s.cam}）写的方向${r.dirs[i]}，分镜里机位 ${s.cam} 属于方向 ${ds.join('、')}：方向照分镜抄`);
    });
  }
  if (!order) add(0, 'fail', 'G26', '段表里分镜镜号的顺序和分镜不一样：照分镜的顺序排，不调换');
  const left = b.shots.filter(s => !used.has(s.id.toLowerCase())).map(s => s.id);
  if (plan.segs.length && left.length) add(0, 'fail', 'G26', `分镜里有 ${left.length} 镜没排进段表（镜${left.slice(0, 12).join('、')}${left.length > 12 ? '……' : ''}）：每一镜都要排进某一段；真要删，写进"要总控批的事"`);
  // 场景卡.txt ↔ 分镜 3.5：方向号和背景图名一样
  for (const [name, dirs] of Object.entries(b.cards)) {
    const sc = scenes.scenes[name];
    if (!sc) { add(0, 'fail', 'G31', `分镜的场景卡"${name}"在 场景卡.txt 里没有同名的一节：节标题照分镜一字不差`); continue; }
    for (const x of dirs) {
      const d = sc.dirs[x.d];
      if (!d) add(0, 'fail', 'G31', `分镜"${name}"有方向${x.d}，场景卡.txt 里没有`);
      else if (x.img && d.kv['图'] !== x.img) add(0, 'fail', 'G31', `"${name}"方向${x.d} 的背景图：分镜是 ${x.img}，场景卡.txt 是 ${d.kv['图']}：照分镜`);
    }
    for (const n of Object.keys(sc.dirs)) if (!dirs.some(x => x.d === n)) add(0, 'fail', 'G31', `场景卡.txt"${name}"多了一个方向${n}，分镜里没有：不发明新方向`);
  }
  return b;
}

// 段落源 ↔ 分镜：分镜秒照分镜，台词一句不少、一句不多
function checkSegBoard(segs, plan, add) {
  for (const seg of segs) {
    const r = plan.segs.find(x => x.n === seg.n);
    if (!r || !r.board || !r.board.length) continue;
    if (r.board.length === seg.shots.length) seg.shots.forEach((s, i) => {
      const want = r.board[i].dur;
      if (Number.isFinite(want) && s.sbDur !== undefined && Math.abs(s.sbDur - want) > 1e-6) add(seg.n, 'fail', 'G29', `镜头${i + 1} 写的分镜秒是 ${s.sbDur}，分镜镜${r.board[i].id} 是 ${want} 秒：分镜秒照分镜抄，为台词加的秒写在拍里，脚本会报批`);
    });
    const want = r.board.flatMap(s => s.lines.map(l => ({ ...l, id: s.id })));
    const have = seg.shots.flatMap(s => s.beats.filter(b => b.say).map(b => ({ raw: b.say.line, n: lineNorm(b.say.line) })));
    const lost = want.filter(w => !have.some(h => sameSay(w, h)));
    const extra = have.filter(h => !want.some(w => sameSay(w, h)));
    if (lost.length) add(seg.n, 'fail', 'G30', `分镜里这一段的台词有 ${lost.length} 句没出现，或者被改了字（${lost.slice(0, 3).map(l => `镜${l.id}"${l.raw.slice(0, 40)}"`).join('；')}）：台词的词和词序一字不改，照分镜抄进"说"（V1.2 起可以改标点、把已有的词紧挨着重复，见手册 7）`);
    if (extra.length) add(seg.n, 'fail', 'G30', `"说"里有 ${extra.length} 句分镜这几镜里没有（${extra.slice(0, 3).map(h => `"${h.raw.slice(0, 40)}"`).join('；')}）：不加台词；是分镜别的镜头的台词，就是段表排错了`);
  }
}

// ---------- 进度：写在文件里，不靠记性。上下文被压缩、换了对话，读这个文件接着做 ----------
// V1.1（2026-11-19）：编译全过以后还有一步审查（规程第 2.5 步）。原来这里直接写"全集都过了，照交付写回复"，GPT 照进度文件走就跳过了审查。
// 审过没有也写在文件里：每段一个指纹（提示词全文的 md5 前 8 位），审完在 <前缀>_审查记录.md 里每段记一行"| 段N | 指纹 | …"。
// 段落源改过、重编以后指纹变了，那一段就要重审；没改的段指纹不变，不用重审。
function progress(plan, built, issues, prefix, outDir) {
  const md = [`# ${prefix} GPT 进度`, '', '自动生成（GPT 模式每次编译都更新）。上下文被压缩、换了对话，先读这个文件，从"下一步"接着做。', ''];
  if (!plan) { md.push('**下一步：写 源\\工作单.txt**（模板：译镜\\GPT\\工作单模板.txt），再编译一次。'); return md.join('\n') + '\n'; }
  const planFails = issues.filter(x => x.seg === 0 && x.lv === 'fail' && /^G([1-9]|1[01]|2[2-8]|31)$/.test(x.id)).length;
  const recName = `${prefix}_审查记录.md`;
  const reviewed = {};
  if (outDir) {
    const rec = path.join(outDir, recName);
    if (fs.existsSync(rec)) for (const m of fs.readFileSync(rec, 'utf8').matchAll(/^\|\s*段\s*(\d+)\s*\|\s*([0-9a-f]{8})\s*\|/gm)) reviewed[+m[1]] = m[2];
  }
  const fp = b => require('crypto').createHash('md5').update(b.r.text).digest('hex').slice(0, 8);
  md.push('| 段 | 场景 | 分镜 | 每镜方向 | 状态 | 指纹 | 审查 |', '|---|---|---|---|---|---|---|');
  let next = null; const toReview = [];
  for (const r of plan.segs) {
    const b = built.find(x => x.seg.n === r.n);
    const f = issues.filter(x => x.seg === r.n && x.lv === 'fail').length;
    const st = !b ? '还没写' : f ? `❌ ${f} 个` : '✅ 过了';
    if (!next && st !== '✅ 过了') next = { r, st };
    let fpr = '—', rv = '—';
    if (b && !f) {
      fpr = fp(b);
      rv = reviewed[r.n] === fpr ? '✅ 审过' : reviewed[r.n] ? '改过，要重审' : '还没审';
      if (rv !== '✅ 审过') toReview.push(r.n);
    }
    md.push(`| ${r.n} | ${r.scene} | ${r.sb} | ${r.dirs.join('/')} | ${st} | ${fpr} | ${rv} |`);
  }
  const whole = issues.filter(x => x.seg === 0 && x.lv === 'fail').length;
  md.push('');
  if (planFails) md.push(`**下一步：先改工作单和场景卡**（整集还有 ❌ ${whole} 个，见编译输出）。工作单过了才写段落源。`);
  else if (next && next.st === '还没写') md.push(`**下一步：写段${next.r.n}**（${next.r.scene}；分镜 ${next.r.sb}；每镜方向 ${next.r.dirs.join('/')}）。只看：分镜里这几镜、工作单里这一行和这场戏的轴线、场景卡这一场、人物卡、上一段的"收场"。`);
  else if (next) md.push(`**下一步：改段${next.r.n} 的 ❌**（${next.st}），改到 0 再写下一段。`);
  else if (whole) md.push(`**下一步：改整集的 ❌ ${whole} 个**（见编译输出"整集"那几行）。`);
  else if (toReview.length) md.push(`**下一步：审查段 ${toReview.join('、')}**（规程第 2.5 步，编译过了不等于没问题）。武戏照 \`规则档案/审查清单_武戏.md\`，文戏和险情照 \`规则档案/审查清单_文戏.md\`，每段连前一段、后一段一起读。能派子代理就派，不能就自己重读。审出 ❌ 回到源文件改、再编译（改过的段指纹会变，要重审）。审完在 \`${recName}\`（和提示词放在一起，没有就新建）里每段写一行：\`| 段N | 指纹 | 审出 ❌ 几个、⚠️ 几个 | 怎么处理的 |\`，指纹照上表抄。`);
  else md.push(`**全集都过了，也都审过了。** 照 SKILL.md 的"交付"写回复：第 2 条写审查记录里每段审出几条、怎么处理的（见 \`${recName}\`），另外报 GPT 模式的检查结果。`);
  return md.join('\n') + '\n';
}

module.exports = { ESCALATE, parsePlan, loadPlan, checkPlan, checkSegments, checkCards, checkBoard, checkSegBoard, parseBoard, shotIds, boardLines, lineNorm, progress, bgClauses, looksIn, NAMES };
