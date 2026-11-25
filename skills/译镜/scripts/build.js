#!/usr/bin/env node
// v5 编译：把一集的源文件拼成每段的完整提示词，顺手把能查的都查了。
// 用法：node build.js <源文件夹> [--out <输出文件夹>] [--bible <剧设定.md>] [--budget 11000] [--no-check]
//   源文件夹里放：集卡.txt、场景卡.txt、人物卡.txt、段1.txt、段2.txt……（格式见 模板/ 和 手册/）
//   输出（默认放在源文件夹的上一层）：<前缀>_段N_起-止秒_提示词.txt、<前缀>_编译报告.md、<前缀>_出图清单.md（场景卡写了"出图"才有）
// 脚本负责的事：风格锁和固定句照剧设定贴；场景卡文字各段一字不差；逐拍时间、切点、台词行、台词句数自动算；
//   段和段之间人物的姿态、位置、手里的东西接不接得上（连续性账本）；每个人身后的方向对不对（站位锚点）。
// v5.1（2026-11-11）：每镜写"分镜秒"，时长和分镜不一样的自动列出来（Y）：为台词加秒要报批，别的改动报 ❌；场景卡里不能写某一镜的事（X12）。
// GPT 模式（2026-11-18）：源文件夹里有 工作单.txt、集卡写"模型: GPT"或者加 --gpt，多查工作单、工作单指向的分镜和一组 G 检查（lib/gpt_checks.js），几个 ⚠️ 升成 ❌，另出 <前缀>_GPT进度.md。
//   不开 GPT 模式时，下面带 GPT 的几处都不跑，输出和原来一字不差。规程见 GPT/执行规程.md。
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./lib/parse.js');
const { compileSegment } = require('./lib/compile.js');
const { compileSegmentV2, findTerms } = require('./lib/compile_v2.js');
const { checkFile, checkScene } = require('./check.js');

const argv = process.argv.slice(2);
const opt = k => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : '');
const src = argv.find((a, i) => !a.startsWith('--') && !['--out', '--bible', '--budget'].includes(argv[i - 1]));
if (!src || !fs.existsSync(src)) { console.error('用法：node build.js <源文件夹> [--out <输出文件夹>] [--bible <剧设定.md>] [--budget 11000] [--no-check]'); process.exit(2); }
const outDir = opt('--out') || path.dirname(path.resolve(src));
const need = f => { const p = path.join(src, f); if (!fs.existsSync(p)) { console.error(`❌ 源文件夹里没有 ${f}`); process.exit(1); } return p; };

let ep, scenes, cast, bible, segs;
let GPT = false;
let FMT = 'V2';
try {
  ep = P.parseEpisode(need('集卡.txt'));
  // 源文件夹里有工作单也算：工作单只有 GPT 规程会写，开关不靠 GPT 记得在集卡里写"模型: GPT"
  GPT = argv.includes('--gpt') || /gpt/i.test(ep.kv['模型'] || '') || fs.existsSync(path.join(src, '工作单.txt'));
  // V2（2026-11-24）：默认 V2 统一结构；集卡写"格式: V1"或加 --v1 用旧模板（templates/v1）
  FMT = argv.includes('--v1') || /v1/i.test(ep.kv['格式'] || '') ? 'V1' : 'V2';
  scenes = P.parseScenes(need('场景卡.txt'), FMT);
  cast = P.parseCast(need('人物卡.txt'));
  const biblePath = opt('--bible') || ep.kv['剧设定'] || `D:/漫剧公司/竖屏制作/剧设定/${ep.kv['剧']}.md`;
  if (!fs.existsSync(biblePath)) throw new P.SrcError(ep.file, 0, `找不到剧设定：${biblePath}（在集卡里写"剧设定: 路径"，或者加 --bible）`);
  bible = P.parseBible(biblePath);
  const files = fs.readdirSync(src).filter(f => /^段\d+\.txt$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  if (!files.length && !GPT) throw new P.SrcError(src, 0, '源文件夹里没有 段1.txt、段2.txt……');
  segs = files.map(f => P.parseSegment(path.join(src, f)));
  segs.forEach((s, i) => { if (s.n !== i + 1) throw new P.SrcError(s.file, 0, `段号要从 1 连着排：这个文件里写的是段 ${s.n}，按顺序应该是段 ${i + 1}`); });
} catch (e) { if (e.src) { console.error('❌ ' + e.message); process.exit(1); } throw e; }

// ---------- GPT 模式第一关：还没写段落源时，只查工作单、场景卡、人物卡。过了才写段 ----------
const G = GPT ? require('./lib/gpt_checks.js') : null;
if (GPT && !segs.length) {
  const gi = [];
  const gadd = (seg, lv, id, msg) => gi.push({ seg, lv, id, msg });
  let plan = null;
  try { plan = G.loadPlan(src, gadd); if (plan) { G.checkPlan(plan, scenes, cast, gadd); G.checkBoard(plan, src, scenes, gadd); } G.checkCards(scenes, cast, src, gadd); }
  catch (e) { if (e.src) { console.error('❌ ' + e.message); process.exit(1); } throw e; }
  const gf = gi.filter(x => x.lv === 'fail').length;
  console.log(`\nGPT 模式 第一关（工作单、场景卡、人物卡）：${src}`);
  for (const x of gi) console.log(`   ${x.lv === 'fail' ? '❌' : '⚠️'} [${x.id}] ${x.msg}`);
  if (plan) console.log(`段表 ${plan.segs.length} 段；轴线：${Object.values(plan.scenes).map(s => `${s.name} ${s.locks.length} 条`).join('，') || '没写'}`);
  const outDir0 = opt('--out') || path.dirname(path.resolve(src));
  fs.mkdirSync(outDir0, { recursive: true });
  fs.writeFileSync(path.join(outDir0, `${ep.kv['前缀']}_GPT进度.md`), G.progress(plan, [], gi, ep.kv['前缀']), 'utf8');
  console.log(`==== ${gf ? '还有 ❌ ' + gf + ' 个：改工作单 / 场景卡 / 人物卡，再跑一次' : '第一关过了：照 ' + ep.kv['前缀'] + '_GPT进度.md 的"下一步"写段1'}；⚠️ ${gi.length - gf} 个 ====`);
  process.exit(gf ? 1 : 0);
}

// ---------- 编译 ----------
const issues = [];   // {seg, lv, id, msg}
const add = (seg, lv, id, msg) => issues.push({ seg, lv, id, msg });
const prefix = ep.kv['前缀'];
const built = [];
let start = 0;
for (const seg of segs) {
  let r;
  try { r = (FMT === 'V1' ? compileSegment : compileSegmentV2)(seg, { bible, ep, scenes, cast }); }
  catch (e) { if (e.src) { console.error('❌ ' + e.message); process.exit(1); } throw e; }
  const end = start + r.total;
  const name = `${prefix}_段${seg.n}_${String(start).padStart(2, '0')}-${end}秒_提示词.txt`;
  built.push({ seg, r, start, end, name });
  if ((r.total < 8 || r.total > 20) && !/衔接|补拍/.test(seg.kv['类型'] || '')) add(seg.n, 'warn', 'B2', `这一段 ${r.total} 秒：一段 15–20 秒最稳，太长最后一镜容易演不到`);
  if (r.lastSayEnd !== null && r.total - r.lastSayEnd < 1) add(seg.n, 'warn', 'Q5', `最后一句台词说到 ${r.lastSayEnd}s，离段尾 ${r.total}s 不到 1 秒：能留 1 秒就留`);
  start = end;
}

// ---------- 时长（Y，v5.1）：每镜的秒数照分镜；只有有台词的镜可以为台词加秒，加了要报批 ----------
// 用户 2026-11-11 定：允许为台词加秒，但必须报批。所以加的秒由脚本列出来，写的人漏不掉。
const r1 = x => String(Math.round(x * 10) / 10);
const timing = [];        // 时长和分镜不一样的镜
let sbTotal = 0, sbMissing = 0;
const noneHasSb = segs.every(s => s.shots.every(x => x.sbDur === undefined));
if (noneHasSb) add(0, 'warn', 'Y2', '整集都没写"分镜秒"（每个镜头一行，分镜表里这一镜几秒）：写了脚本才能核对时长有没有改、把为台词加的秒列进"要总控批的事"');
for (const b of built) {
  const miss = [];
  b.seg.shots.forEach((s, i) => {
    const inf = b.r.shotInfo[i];
    if (s.sbDur === undefined) { miss.push(i + 1); sbMissing++; sbTotal += inf.dur; return; }
    sbTotal += s.sbDur;
    if (Math.abs(inf.dur - s.sbDur) > 1e-6) {
      const hasLine = inf.en + inf.zh > 0;
      const need = inf.zh ? inf.zh / 4 : inf.en / 2.5;   // 最快语速：英文每秒 2.5 词，中文每秒 4 字
      timing.push({ seg: b.seg.n, i: i + 1, title: s.title, sb: s.sbDur, now: inf.dur, hasLine, need, inf, ok: hasLine && inf.dur > s.sbDur });
    }
  });
  if (miss.length && !noneHasSb) add(b.seg.n, 'warn', 'Y2', `镜头 ${miss.join('、')} 没写"分镜秒"（分镜表里这一镜几秒）：写了脚本才能核对时长有没有改`);
  const mine = timing.filter(x => x.seg === b.seg.n);
  const ok = mine.filter(x => x.ok);
  if (ok.length) add(b.seg.n, 'warn', 'Y1', `为台词加了 ${r1(ok.reduce((a, x) => a + x.now - x.sb, 0))} 秒（${ok.map(x => `镜头${x.i} ${r1(x.sb)}→${r1(x.now)}`).join('、')}）：可以，但要报批。编译报告的"要总控批的事"已经列出来，回复里照抄；批之前不上平台`);
  for (const x of mine.filter(x => !x.ok)) add(b.seg.n, 'fail', 'Y3', `镜头${x.i} 的时长和分镜不一样（${r1(x.sb)}→${r1(x.now)} 秒），${x.hasLine ? '是缩短' : '这一镜没有台词'}：只有有台词的镜可以为台词加秒。改回 ${r1(x.sb)} 秒；分镜本身不合适就回去改分镜`);
}

// ---------- 打戏设计（Z，v5.2）：武戏段先设计再写镜头。设计写在段落源里，这里查能数的，并出一份设计单 ----------
// 来源：原版武戏编导的流程第 2 步"设计"和交付里的设计单（攻防表）。v5 把它挪进了"平时不用读"的规则档案，GPT 没设计就写镜头，打戏很平（用户 2026-11-12）。
const FIGHT = new Set(['进攻', '闪避', '防守', '反击', '受击']);
// V2：拍可以写中文，标签写中文也认（出招：闪避：格挡：反击：受击：）
const TAG = { 进攻: [/(?<!COUNTER)ATTACK|出招：|进攻：/, 'ATTACK'], 闪避: [/DODGE|闪避：/, 'DODGE'], 防守: [/DEFENSE|BLOCK|格挡：|防守：/, 'DEFENSE'], 反击: [/COUNTERATTACK|反击：/, 'COUNTERATTACK'], 受击: [/REAL HIT REACTION|受击：/, 'REAL HIT REACTION'] };
const SEV = ['', '轻', '中', '重'];
const fightSegs = [];
for (const b of built) {
  const seg = b.seg; if (seg.mode !== '武戏') continue;
  fightSegs.push(b);
  const miss = [];
  if (!seg.kv['讲什么']) miss.push('讲什么');
  if (seg.setup.length < 2) miss.push('设定（双方各一行）');
  if (!seg.rounds.length) miss.push('回合（至少一个）');
  if (!seg.exch.length) miss.push('攻防（攻防表）');
  if (miss.length) add(seg.n, 'fail', 'Z1', `武戏段没做打戏设计，缺：${miss.join('、')}。先照 手册/6_打戏设计.md 把打法设计出来，再写镜头`);
  if (!seg.exch.length) continue;
  const ex = seg.exch.slice().sort((x, y) => x.shot - y.shot);   // 同一镜里保持写的顺序
  const bad = ex.filter(r => r.shot < 1 || r.shot > seg.shots.length);
  if (bad.length) add(seg.n, 'fail', 'Z2', `攻防表里写了镜 ${[...new Set(bad.map(r => r.shot))].join('、')}，这一段只有 ${seg.shots.length} 镜`);
  seg.shots.forEach((s, i) => {
    const rows = ex.filter(r => r.shot === i + 1);
    if (!rows.length) { add(seg.n, 'fail', 'Z2', `镜头${i + 1} 在攻防表里一行都没有：每一镜里谁出招、对方怎么回应，都要先设计`); return; }
    const text = s.beats.map(x => (x.text || '') + ' ' + (x.during || '')).join(' ');
    const need = [...new Set(rows.map(r => r.type).filter(t => TAG[t]))].filter(t => !TAG[t][0].test(text));
    if (need.length) add(seg.n, 'fail', 'Z3', `镜头${i + 1} 的攻防表里有${need.join('、')}，这一镜的"拍"里没有对应的标签（${need.map(t => TAG[t][1] + ':').join('、')}）：攻防表里设计的每一下，都要写进拍里，开头带标签`);
    const n = rows.filter(r => FIGHT.has(r.type)).length;
    const dur = b.r.shotInfo[i].dur;
    if (n > 4) add(seg.n, 'warn', 'Z5', `镜头${i + 1} 排了 ${n} 下攻防：一镜里模型大概做得出 3–4 下，再多会被合并或跳过。拆到下一镜，或者去掉没有目的的那几下`);
    else if (n === 1 && dur >= 2) add(seg.n, 'warn', 'Z5', `镜头${i + 1} 有 ${dur} 秒，只排了 1 下攻防：这一下会被拉满整镜，节奏就慢了。一镜放 2–4 下`);
  });
  // Z9 第一镜就要在打
  if (!ex.some(r => r.shot === 1 && ['进攻', '反击', '受击'].includes(r.type))) add(seg.n, 'warn', 'Z9', '第一镜的攻防表里没有交手：0.5 秒内就要开打，不赶路、不摆姿势、不对峙');
  // Z4 每一下出招，对方都要有回应（躲、挡、挨上，或者抢先反击）
  const fr = ex.filter(r => FIGHT.has(r.type));
  const noAns = [];
  fr.forEach((r, k) => {
    if (!['进攻', '反击'].includes(r.type) || k === fr.length - 1) return;   // 最后一下可以停在动作里
    const nx = fr[k + 1];
    if (nx.who === r.who) noAns.push(`镜${r.shot} ${r.who}"${r.act.slice(0, 12)}"`);
  });
  if (noAns.length) add(seg.n, 'warn', 'Z4', `有 ${noAns.length} 下出招后面没写对方怎么回应，紧接着还是同一个人的动作（${noAns.slice(0, 3).join('；')}）：每一下都要写对方是躲开、挡住还是挨上。连着出招不回应，就是堆招`);
  // Z10 一次躲和挡都没有
  if (fr.filter(r => ['进攻', '反击'].includes(r.type)).length >= 2 && !fr.some(r => ['闪避', '防守'].includes(r.type))) add(seg.n, 'warn', 'Z10', '整段没有一次闪避或防守，全是出招和挨打：至少让挨打的一方躲开或挡住一下，打戏才有来有回');
  // Z6 挨打一次比一次重，最重的一下在最后；Z7 挨上的每一下写清为什么没防住；Z8 最重的一下后面补一张脸
  const hits = ex.filter(r => r.type === '受击');
  for (let k = 1; k < hits.length; k++) if (hits[k].sev < hits[k - 1].sev) { add(seg.n, 'warn', 'Z6', `挨打没有一次比一次重：镜${hits[k - 1].shot} 是受击${SEV[hits[k - 1].sev]}，后面镜${hits[k].shot} 反而是受击${SEV[hits[k].sev]}。最重的一下放在结尾`); break; }
  const noWhy = hits.filter(r => !r.why);
  if (noWhy.length) add(seg.n, 'warn', 'Z7', `有 ${noWhy.length} 下受击没写为什么没防住（镜 ${[...new Set(noWhy.map(r => r.shot))].join('、')}）：攻防行最后一格写清破绽，比如上一招用力过猛、兵器甩过了头、被逼到了桌角。说不出为什么挨上，这一下看起来就是硬挨`);
  const heavy = hits.filter(r => r.sev === 3);
  if (heavy.length) {
    const last = heavy[heavy.length - 1]; const idx = ex.indexOf(last);
    if (!ex.slice(idx + 1).some(r => r.type === '反应') && !/pain|teeth|face twists|grimace|疼|咬牙|牙关|扭曲/i.test(seg.shots[last.shot - 1].beats.map(x => x.text || '').join(' '))) add(seg.n, 'warn', 'Z8', `镜${last.shot} 最重的那一下后面没有"反应"：挨了重击，补一张脸（疼、咬牙、喘），哪怕只有 1 秒`);
    const heavyText = seg.shots[last.shot - 1].beats.map(x => x.text || '').join(' ');
    if (!/the heaviest|最重/i.test(heavyText)) add(seg.n, 'warn', 'Z6', `镜${last.shot} 是最重的一下，标签写成 REAL HIT REACTION, the heaviest:（前面中等的那下写 REAL HIT REACTION, heavier:）`);
  }
}

// ---------- 场景卡写法（X12，v5.1）：场景卡的文字会贴进这场戏的每一段，不能写某一镜、某一段的事 ----------
const SHOTREF = /镜头\s*\d+|(?<![一-鿿])镜\s*\d+|第\s*[一二三四五六七八九十\d]+\s*[镜段]|(?<![一-鿿])段\s*\d+|\bshots?\s*\d+|\bsegments?\s*\d+/i;
for (const name of scenes.order) {
  const s = scenes.scenes[name];
  const fields = [...Object.entries(s.kv).filter(([k]) => !['出图', '总览图', '特效规范'].includes(k)).map(([k, v]) => [k, v]),
    ...Object.values(s.dirs).flatMap(d => Object.entries(d.kv).filter(([k]) => !['出图', '图'].includes(k)).map(([k, v]) => [`方向${d.n} 的"${k}"`, v]))];
  for (const [k, v] of fields) {
    const m = String(v).match(SHOTREF);
    if (m) add(0, 'fail', 'X12', `场景卡"${name}"的${/^方向/.test(k) ? k : `"${k}"`}里写了"${m[0]}"：场景卡的文字会原样贴进这场戏的每一段，别的段里没有这一镜。只写整场戏都成立的事；某一镜、某一段才有的安排挪到那一段的"空间"或那一镜的"机位"里`);
  }
}

// ---------- V2 源文件检查（2026-11-24）：固定站位、没有图的方向、全景里的固定物、衣服 ----------
if (FMT === 'V2') {
  for (const name of scenes.order) {
    const s = scenes.scenes[name];
    if (s.kv['站位']) add(0, 'fail', 'X13', `场景卡"${name}"写了"站位"：V2 不写整场固定的站位（每段重复同一句，第二段就回到第一段的开场）。人在哪写在每段的"开场""收场"和那一镜的"机位""构图"里`);
    for (const d of Object.values(s.dirs)) {
      if (/无图|没有图|猜|待定|应该|大概/.test(d.kv['依据'] || '')) add(0, 'fail', 'K4', `场景"${name}"方向${d.n}"${d.name}"的依据写的是"${d.kv['依据']}"：图里没有的方向不能用，模型会自己翻面（E27 的"朝集装箱"：三条里两条变成别的方向、一条左右翻）。换成图里有的方向，或者先补一张这个方向的图`);
      if (/前面提到|同上|见上/.test(d.kv['背景'] || '')) add(0, 'warn', 'K4', `方向${d.n} 的背景没写完整`);
    }
  }
  for (const seg of segs) {
    if (seg.kv['站位']) add(seg.n, 'fail', 'X13', '段落源写了"站位"：V2 改写"开场""收场"和每一镜的构图');
    const sc = scenes.scenes[seg.scene]; if (!sc) continue;
    const marks = (sc.kv['地标'] || '').split(/[、，,；;\s]+/).filter(Boolean);
    seg.shots.forEach((s, i) => {
      if (!/全景|远景|大全/.test(s.size)) return;
      const t = s.cam + (s.comp || '');
      if (!marks.some(x => t.includes(x))) add(seg.n, 'warn', 'K26', `镜头${i + 1} 是${s.size.split(' ')[0]}，机位和构图里没提场景里的固定物（${marks.slice(0, 5).join('、')}）：写清人贴着哪样东西、那样东西在画面哪一侧。E27 段 7 没写，父亲跪到了栈道正中`);
    });
  }
  // K29 机位术语（手册 8）：特殊的一集一次、一段一个；一镜两个角度打架；和看镜头、顶视拍人的规则打架
  const special = [];
  for (const seg of segs) seg.shots.forEach((s, i) => {
    const tm = findTerms(seg, s); if (!tm.length) return;
    if (tm.length > 2) add(seg.n, 'warn', 'K29', `镜头${i + 1} 用了 ${tm.length} 个机位术语：一镜最多两个（一个角度或方位，加一个构图或光）`);
    const ang = tm.filter(x => ['角度', '特殊视角'].includes(x['组'])); if (ang.length > 1) add(seg.n, 'fail', 'K29', `镜头${i + 1} 的"${ang.map(x => x['名']).join('、')}"是两个角度，一个镜头只能有一个`);
    const fs2 = tm.filter(x => x['组'] === '光学'); if (fs2.length > 1) add(seg.n, 'fail', 'K29', `镜头${i + 1} 用了两种镜头光学：${fs2.map(x => x['名']).join('、')}`);
    for (const x of tm) if (x['标记'].includes('special')) special.push({ seg: seg.n, shot: i + 1, n: x['名'] });
    if (tm.some(x => x['名'] === '顶视视角') && !/特写|桌|地/.test(s.size + s.cam)) add(seg.n, 'warn', 'K29', `镜头${i + 1} 顶视视角拍人：头身比例会坏。只拍桌面、地面、手，拍人换"高角度"或"篮筐高度"`);
    if (tm.some(x => x['名'] === '自拍视角')) add(seg.n, 'warn', 'K29', `镜头${i + 1} 自拍视角：人会看镜头。只有剧情真的在自拍、直播、视频通话才用`);
    if (tm.some(x => /鱼眼|广角特写/.test(x['名'])) && s.beats.some(b => b.say)) add(seg.n, 'warn', 'K29', `镜头${i + 1} 用了${tm.map(x => x['名']).join('、')}又有台词：脸会变形，口型难看`);
    if (tm.some(x => /剪影|背面视角/.test(x['名'])) && s.beats.some(b => b.say)) add(seg.n, 'warn', 'K29', `镜头${i + 1} 看不见脸又有台词：模型可能把台词安到别人嘴上，写清"声音是他的，画面里没有别人张嘴"`);
  });
  for (const g of [...new Set(special.map(x => x.seg))]) { const a = special.filter(x => x.seg === g); if (a.length > 1) add(g, 'warn', 'K29', `一段里用了 ${a.length} 个特殊机位（${a.map(x => `镜${x.shot} ${x.n}`).join('、')}）：一段最多一个`); }
  for (const nm of [...new Set(special.map(x => x.n))]) { const a = special.filter(x => x.n === nm); if (a.length > 1) add(0, 'warn', 'K29', `特殊机位"${nm}"这一集用了 ${a.length} 次（${a.map(x => `段${x.seg}镜${x.shot}`).join('、')}）：一集最多一次`); }
  for (const c of Object.values(cast.cast)) {
    if ((c.kv['类型'] || '人') === '道具') continue;
    if (!/衣|裙|衫|袄|袍|西装|外套|风衣|衬衫|毛衣|裤|制服|coat|shirt|dress|suit|jacket|sweater/i.test(c.kv['固定'] || '')) add(0, 'warn', 'K28', `人物卡"${c.key}"的"固定"没写衣服：同一场戏里会换装（E30 段 2、4 砖红针织裙变成雪花毛衣）。写颜色、料子、款式，每段一样`);
    if (!/只有一个/.test(c.kv['固定'] || '')) add(0, 'warn', 'K28', `人物卡"${c.key}"的"固定"没写"成片里只有一个……"`);
  }
}

// ---------- 连续性账本（L）：上一段结尾的姿态、位置、手里的东西 = 下一段开场 ----------
const same = (a, b) => (a || '').replace(/\s/g, '') === (b || '').replace(/\s/g, '');
const jumps = [];   // V1.1 U8：写了"衔接: 时间跳"的地方跳过了哪些变化
for (let i = 0; i < segs.length; i++) {
  const b = segs[i];
  for (const p of b.people) {
    const c = cast.cast[p.key];
    if (c && /^(是|要|yes)$/i.test(c.kv['记账'] || '') && !b.open[p.key]) add(b.n, 'warn', 'L2', `${c.kv['名']}没写"开场"（姿态 | 位置 | 手里的东西）：主要人物每段都写，模型才不会自己让人坐下、换地方`);
  }
  for (const [k, o] of Object.entries(b.open)) {
    const cl = b.close[k];
    if (cl && (!same(cl.posture, o.posture) || !same(cl.place, o.place) || !same(cl.hands, o.hands))) {
      const what = [!same(cl.posture, o.posture) && `${o.posture}→${cl.posture}`, !same(cl.place, o.place) && `${o.place}→${cl.place}`, !same(cl.hands, o.hands) && `${o.hands}→${cl.hands}`].filter(Boolean).join('；');
      if (!b.kv['状态'] && b.mode === '文戏') add(b.n, 'warn', 'L3', `${k} 在这一段里变了（${what}），"状态"里没写从第几镜起变`);
    }
  }
  if (i === 0) continue;
  // V2：隔了几段才又出现的人，也要接得上他最后一次的状态（E27：奥利维亚段 2 结尾抱着膝，段 3 没她，段 4 开场还得抱着膝）
  if (FMT === 'V2' && !/跳/.test(b.kv['衔接'] || '')) {
    for (const [k, o] of Object.entries(b.open)) {
      let prev = null, from = 0;
      for (let j = i - 1; j >= 0 && segs[j].scene === b.scene; j--) { if (/跳/.test(segs[j + 1].kv['衔接'] || '')) break; const x = segs[j].close[k] || segs[j].open[k]; if (x) { prev = x; from = segs[j].n; break; } }
      if (!prev) continue;
      for (const [f, label] of [['posture', '姿态'], ['place', '位置'], ['hands', '手里'], ['facing', '朝向']]) if (!same(prev[f], o[f])) add(b.n, 'fail', 'L1', `${k} 的${label}接不上：段${from} 结尾是"${prev[f] || '（没写）'}"，段${b.n} 开场是"${o[f] || '（没写）'}"。【承接画面】要和他上一次的【结束画面】逐字一样`);
    }
    continue;
  }
  const a = segs[i - 1];
  if (a.scene !== b.scene) continue;
  if (/跳/.test(b.kv['衔接'] || '')) {
    // V1.1 U8：时间跳以前是悄悄放过。两段之间是硬切，人和东西突然换了观众看得见（E01：伊森在门槛外→已经进门两步；文森特手里酒杯→面包）。列出来给人看
    const ch = [];
    for (const [k, o] of Object.entries(b.open)) {
      const prev = a.close[k] || a.open[k];
      if (!prev) continue;
      for (const [f, label] of [['posture', '姿态'], ['place', '位置'], ['hands', '手里']]) if (!same(prev[f], o[f])) ch.push(`${k} 的${label}：${prev[f]} → ${o[f]}`);
    }
    if (ch.length) { jumps.push({ from: a.n, to: b.n, ch }); add(b.n, 'warn', 'U8', `写了"衔接: 时间跳"，段${a.n}→段${b.n} 跳过了 ${ch.length} 处变化（${ch.slice(0, 3).join('；')}${ch.length > 3 ? '……' : ''}）：两段是硬切，观众会看到人和东西突然换了。已列进编译报告"要总控批的事"，回复里照抄`); }
    continue;
  }
  for (const [k, o] of Object.entries(b.open)) {
    const prev = a.close[k] || a.open[k];
    if (!prev) continue;
    for (const [f, label] of [['posture', '姿态'], ['place', '位置'], ['hands', '手里']]) {
      if (!same(prev[f], o[f])) add(b.n, 'fail', 'L1', `${k} 的${label}接不上：段${a.n} 结尾是"${prev[f]}"，段${b.n} 开场是"${o[f]}"。在段${a.n} 末尾或段${b.n} 开头补上这个动作；真是时间过了一会儿，就在段${b.n} 写"衔接: 时间跳"`);
    }
  }
}
// ---------- 站位锚点（X6）：拍某个人的单人镜头，方向要是他身后固定的那个 ----------
for (const seg of segs) {
  const sc = scenes.scenes[seg.scene];
  seg.shots.forEach((s, i) => {
    for (const who of s.subject || []) {
      const allow = sc.anchors[who];
      if (allow && allow.length && !allow.includes(s.dir)) add(seg.n, 'warn', 'X6', `镜头${i + 1} 主体是 ${who}，用了方向${s.dir}；场景卡里这个人身后固定是方向 ${allow.join('、')}。人走动了就在场景卡的锚点里加上新方向，没走动就是方向写错了`);
    }
  });
}
// ---------- 同框的听的人（T5，2026-11-21）：有台词的镜里，主体有说的人以外的人，说时要写他的眼睛 ----------
// 用户反馈：A 说话时同框的 B 不看 A、不反应。没写说时，脚本只填"别人嘴闭着"，模型让听的人定住。
{
  const isSpeaker = (k, who) => { const w = who.toLowerCase(); return k.split(/(?=[A-Z])|[\s_-]+/).filter(Boolean).every(p => w.includes(p.toLowerCase())); };
  const EYES = /\b(eyes?|looks?|looking|watch(?:es|ing)?|gaz(?:e|es|ing)|glanc(?:e|es|ing)|star(?:e|es|ing)|turns?|turning)\b/i;
  for (const seg of segs) seg.shots.forEach((s, i) => {
    const subj = (s.subject || []).filter(k => cast.cast[k]);
    if (!subj.length) return;
    for (const b of s.beats) {
      if (!b.say) continue;
      const lis = subj.filter(k => !isSpeaker(k, b.say.who));
      if (!lis.length) continue;
      if (lis.length === subj.length && subj.length === 1) {
        // 主体只有一个人、名字又对不上说的人：可能是只拍听的人的反应镜头，也可能是说的人换了叫法，只在说时完全没写时提醒
        if (!b.during) add(seg.n, 'warn', 'T5', `镜头${i + 1} 主体是 ${subj[0]}，台词是 ${b.say.who} 说的，说时没写：如果画面里是听的人，写 the voice comes from off-screen; 再写他眼睛在哪、一个跟着这句话的反应、嘴唇闭着（手册 3"同框的听的人"）；如果 ${subj[0]} 就是说的人，不用管`);
        continue;
      }
      if (!b.during) add(seg.n, 'warn', 'T5', `镜头${i + 1} 主体有 ${lis.join('、')}，${b.say.who} 说话时听的人也在画面里，说时没写：脚本只会填"别人嘴闭着"，模型会让听的人定住、眼睛乱放。写他眼睛在哪（看说的人 screen-LEFT/RIGHT on 谁，或故意不看、看哪）、一个跟着这句话的反应，最后才是 lips closed（手册 3"同框的听的人"）。过肩只露虚肩的，主体只写说的人`);
      else if (!EYES.test(b.during)) add(seg.n, 'warn', 'T5', `镜头${i + 1} 的说时没写听的人（${lis.join('、')}）眼睛在哪：看说的人写 keeps her eyes screen-LEFT on him，故意不看写看哪（手册 3"同框的听的人"）`);
    }
  });
}

// ---------- 写文件 ----------
fs.mkdirSync(outDir, { recursive: true });
const stale = fs.readdirSync(outDir).filter(f => f.startsWith(prefix + '_段') && /_提示词\.txt$/.test(f) && !built.some(b => b.name === f));
if (stale.length) {
  const old = path.join(outDir, '_旧稿'); fs.mkdirSync(old, { recursive: true });
  for (const f of stale) fs.renameSync(path.join(outDir, f), path.join(old, f));
  console.log(`时间变了，${stale.length} 个旧文件名的提示词挪到了 _旧稿\\`);
}
for (const b of built) fs.writeFileSync(path.join(outDir, b.name), b.r.text, 'utf8');

// ---------- 检查 ----------
const noCheck = argv.includes('--no-check');
let sceneRes = { fails: 0, warns: 0, issues: [] };
if (!noCheck) {
  for (const b of built) {
    b.chk = checkFile(path.join(outDir, b.name), { style: bible.file, budget: opt('--budget') });
    for (const l of b.chk.issues) add(b.seg.n, l.startsWith('❌') ? 'fail' : 'warn', (l.match(/\[([^\]]+)\]/) || [, '?'])[1], l.replace(/^(❌|⚠️)\s*(\[[^\]]+\])?\s*/, ''));
    if (b.chk.crash) add(b.seg.n, 'fail', '脚本', '检查脚本出错了，把这一段发给总控');
  }
  if (FMT === 'V1') sceneRes = checkScene(outDir);
  for (const l of sceneRes.issues) add(0, /❌/.test(l) ? 'fail' : 'warn', (l.match(/\[([^\]]+)\]/) || [, 'X'])[1], l.trim().replace(/^(❌|⚠️)\s*(\[[^\]]+\])?\s*/, ''));
}
// ---------- GPT 模式：段表、轴线、主体、机位里的背景、发光、照抄范例（G）；几个 ⚠️ 升成 ❌ ----------
let gptPlan = null;
if (GPT) {
  try {
    gptPlan = G.loadPlan(src, add);
    if (gptPlan) { G.checkPlan(gptPlan, scenes, cast, add); G.checkBoard(gptPlan, src, scenes, add); G.checkSegBoard(segs, gptPlan, add); }
    G.checkSegments(segs, gptPlan, scenes, cast, add); G.checkCards(scenes, cast, src, add);
  }
  catch (e) { if (e.src) { console.error('❌ ' + e.message); process.exit(1); } throw e; }
  // V2：眼神光是正当写法（G19 只提醒）；方向不再一张图一个（G31 的背景图不比）
  if (FMT === 'V2') for (const x of issues) if (x.id === 'G19' || (x.id === 'G31' && /背景图/.test(x.msg))) x.lv = 'warn';
  for (const x of issues) if (x.lv === 'warn' && G.ESCALATE.has(x.id)) { x.lv = 'fail'; x.msg = `（GPT 模式算 ❌）${x.msg}`; }
}
// Q5 检查脚本也报，去掉重复
const seen = new Set();
const uniq = issues.filter(x => { const k = x.seg + x.id + (x.id === 'Q5' ? '' : x.msg); if (seen.has(k)) return false; seen.add(k); return true; });
const fails = uniq.filter(x => x.lv === 'fail').length, warns = uniq.filter(x => x.lv === 'warn').length;

// ---------- 报告 ----------
const rows = built.map(b => {
  const f = uniq.filter(x => x.seg === b.seg.n && x.lv === 'fail').length, w = uniq.filter(x => x.seg === b.seg.n && x.lv === 'warn').length;
  return { ...b, f, w };
});
console.log(`\n${prefix}：${built.length} 段，共 ${start} 秒  →  ${outDir}`);
for (const r of rows) console.log(`${r.f ? '❌' : r.w ? '⚠️' : '✅'} 段${r.seg.n}  ${String(r.start).padStart(3)}–${String(r.end).padEnd(3)}s  ${r.seg.mode}  ${r.r.shots} 镜  ${r.r.lines} 句  方向 ${r.r.dirs.join(',')}  ${r.r.count} 字  ❌ ${r.f}  ⚠️ ${r.w}`);
for (const x of uniq) console.log(`   ${x.lv === 'fail' ? '❌' : '⚠️'} ${x.seg ? '段' + x.seg : '整集'} [${x.id}] ${x.msg}`);
const added = timing.filter(x => x.ok);
const timeNote = sbMissing ? `有 ${sbMissing} 镜没写"分镜秒"，时长没核对完` : timing.length ? `分镜 ${r1(sbTotal)} 秒 → 现在 ${start} 秒（${start - sbTotal >= 0 ? '+' : ''}${r1(start - sbTotal)}）${added.length ? `，为台词加秒的 ${added.length} 镜要报批` : ''}` : `时长和分镜一致（${start} 秒）`;
console.log(`\n时长：${timeNote}`);
console.log(`==== ${fails ? '还有 ❌ ' + fails + ' 个：改源文件，再跑一次' : '没有 ❌'}；⚠️ ${warns} 个${noCheck ? '（没跑检查）' : ''}${added.length ? '；有要总控批的事，见编译报告' : ''} ====`);
if (GPT) {
  const pg = G.progress(gptPlan, built, uniq, prefix, outDir);   // V1.1：传 outDir，进度文件才读得到审查记录
  fs.writeFileSync(path.join(outDir, `${prefix}_GPT进度.md`), pg, 'utf8');
  console.log(`GPT 模式：开。${(pg.match(/\*\*下一步[^*]*\*\*[^\n]*/) || pg.match(/\*\*全集都过了[^*]*\*\*[^\n]*/) || [''])[0].replace(/\*\*/g, '')}（进度 → ${prefix}_GPT进度.md）`);
}

const md = [];
md.push(`# ${prefix} 编译报告`, '', `自动生成，别手改。要改提示词，改 \`${path.basename(path.resolve(src))}\\\` 里的源文件，再跑一次 build.js。`, '', `共 ${built.length} 段、${start} 秒。检查：❌ ${fails}，⚠️ ${warns}。`, '');
if (GPT) md.push(`GPT 模式：开。多查了 \`工作单.txt\`（段表、轴线）和 G1–G21；X6、L2、L3、F3、E7、T14、T15、T16、Y2 在这个模式下算 ❌。进度和下一步见 \`${prefix}_GPT进度.md\`。`, '');
if (fightSegs.length) md.push(`有 ${fightSegs.length} 段武戏（段 ${fightSegs.map(b => b.seg.n).join('、')}）。打法设计摆在 \`${prefix}_打戏设计单.md\` 里：先看那份，打法没问题再上平台。`, '');
md.push('## 每一段', '', '| 段 | 时间 | 戏种 | 场景 | 方向 | 镜 | 台词 | 字数 | ❌ | ⚠️ | 文件 |', '|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) md.push(`| ${r.seg.n} | ${r.start}–${r.end} | ${r.seg.mode} | ${r.seg.scene} | ${r.r.dirs.join('、')} | ${r.r.shots} | ${r.r.lines} | ${r.r.count} | ${r.f} | ${r.w} | ${r.name} |`);
// 要总控批的事：为台词加的秒。脚本列，回复里照抄，批之前不上平台
md.push('', '## 要总控批的事', '');
if (added.length) {
  md.push(`**时长：分镜 ${r1(sbTotal)} 秒 → 现在 ${start} 秒。为台词加秒的有 ${added.length} 镜，共 ${r1(added.reduce((a, x) => a + x.now - x.sb, 0))} 秒。批了才上平台；不批就把这几镜改回分镜的秒数。**`, '', '| 段 | 镜头 | 分镜 | 现在 | 台词 | 照分镜的秒数说得完吗 |', '|---|---|---|---|---|---|');
  for (const x of added) {
    const words = x.inf.zh ? `${x.inf.zh} 字` : `${x.inf.en} 词`;
    const fits = x.sb >= x.need - 1e-6;
    md.push(`| ${x.seg} | ${x.i}（${x.title.replace(/\|/g, '/')}） | ${r1(x.sb)} 秒 | ${r1(x.now)} 秒 | ${words}，说 ${r1(x.inf.say)} 秒 | ${fits ? `说得完（最快 ${r1(x.need)} 秒）。加的秒用在说前 ${r1(x.inf.pre)} 秒、说后 ${r1(x.inf.post)} 秒的反应和更慢的语速上` : `说不完：最快也要 ${r1(x.need)} 秒`} |`);
  }
} else md.push(sbMissing ? `时长没核对完：有 ${sbMissing} 镜没写"分镜秒"。` : '时长和分镜一致，没有加秒。');
if (jumps.length) {
  md.push('', `**时间跳：${jumps.length} 处。两段之间是硬切，下面这些变化观众会看到"突然变了"。确认是故意的、剪辑接得上，再上平台。**`, '', '| 从 | 到 | 跳过的变化 |', '|---|---|---|');
  for (const j of jumps) md.push(`| 段${j.from} | 段${j.to} | ${j.ch.join('；').replace(/\|/g, '/')} |`);
}
md.push('', '写的人在回复里另外要报的（脚本查不出来）：觉得哪条规则不对、同一个 ❌ 改两次还过不了、少了或合并了镜头。');
// V1.2（2026-11-20）：台词里紧挨着重复的词（口吃、哽住）。铁规矩 1 允许，不用批；列出来，总控扫一眼是不是想加的（原文本来就重复的不用管）
{
  const REP = /(?:^|[^A-Za-z'])([A-Za-z']+(?: [A-Za-z']+){0,2})[\s,.…—–-]+\1(?![A-Za-z'])|([一-鿿]{1,3})[，,…—\s]+\2/i;
  const reps = [];
  for (const b of built) b.seg.shots.forEach((s, i) => s.beats.forEach(x => { if (x.say && REP.test(x.say.line)) reps.push(`| 段${b.seg.n} | ${i + 1} | ${x.say.who} | ${x.say.line.replace(/\|/g, '/')} |`); }));
  if (reps.length) md.push('', '## 台词里的重复（不用批，看一眼）', '', `有 ${reps.length} 句台词里有紧挨着重复的词（口吃、哽住，手册 7）。词和词序没改就行；原文本来就重复的不用管。`, '', '| 段 | 镜头 | 谁 | 台词 |', '|---|---|---|---|', ...reps);
}
if (uniq.length) { md.push('', '## 要处理的', '', '| 哪一段 | 级别 | 编号 | 说明 |', '|---|---|---|---|'); for (const x of uniq) md.push(`| ${x.seg ? '段' + x.seg : '整集'} | ${x.lv === 'fail' ? '❌ 必须改' : '⚠️ 看一眼'} | ${x.id} | ${x.msg.replace(/\|/g, '/')} |`); }
const use = {};
for (const b of built) for (const ref of b.r.refs) (use[ref] = use[ref] || []).push(b.seg.n);
md.push('', '## 平台上要建的主体', '', '每个 @ 名字建一个主体，一张场景图一个主体，不拼在一起。名字和平台上的不一样，就改源文件里的 @。', '', '| @ 名字 | 用在哪几段 |', '|---|---|');
for (const k of Object.keys(use).sort()) md.push(`| ${k} | ${use[k].join('、')} |`);
const led = segs.filter(s => Object.keys(s.open).length);
if (led.length) {
  md.push('', '## 连续性账本', '', '上一段的收场和下一段的开场要一样（同一场戏、没写"衔接: 时间跳"的时候）。', '', '| 段 | 人物 | 开场：姿态 / 位置 / 手里 | 收场 |', '|---|---|---|---|');
  for (const s of led) for (const [k, o] of Object.entries(s.open)) { const c = s.close[k] || o; md.push(`| ${s.n} | ${k} | ${o.posture} / ${o.place} / ${o.hands} | ${same(c.posture + c.place + c.hands, o.posture + o.place + o.hands) ? '同开场' : `${c.posture} / ${c.place} / ${c.hands}`} |`); }
}
fs.writeFileSync(path.join(outDir, `${prefix}_编译报告.md`), md.join('\n') + '\n', 'utf8');

// ---------- 打戏设计单（v5.2）：把武戏段的设计摆成表给人看。原版武戏编导交付里的那份设计单 ----------
if (fightSegs.length) {
  const cell = s => String(s || '').replace(/\|/g, '/');
  const ds = [`# ${prefix} 打戏设计单`, '', '自动生成自段落源里的打戏设计（讲什么、设定、回合、攻防）。要改就改源文件，再跑一次 build.js。', '', '怎么看：先看"讲什么"和回合，打法说不说得通；再看攻防表，每一下出招对方有没有回应、挨上的那几下是不是一次比一次重、为什么没防住。', ''];
  for (const b of fightSegs) {
    const seg = b.seg;
    let t = 0; const range = b.r.shotInfo.map(x => { const a = t; t += x.dur; return `${r1(b.start + a)}–${r1(b.start + t)}`; });
    ds.push(`## 段${seg.n}（${b.start}–${b.end} 秒，${seg.scene}）`, '', `**这一段讲什么：** ${seg.kv['讲什么'] || '（没写）'}`, '');
    if (seg.setup.length) {
      ds.push('### 双方设定', '', '| 谁 | 体型和快慢 | 看不见、够不着的地方 | 怕什么 | 想要的距离 | 能力的代价和破绽 |', '|---|---|---|---|---|---|');
      for (const s of seg.setup) ds.push(`| ${cell((cast.cast[s.key] || { kv: {} }).kv['名'] || s.key)} | ${s.f.map(cell).join(' | ')} |`);
      ds.push('');
    }
    if (seg.rounds.length) {
      ds.push('### 回合', '', '| 回合 | 谁主动 | 怎么打 | 对方怎么回应 | 距离怎么变 | 双方各学到什么 |', '|---|---|---|---|---|---|');
      for (const r of seg.rounds) ds.push(`| ${r.f.map(cell).join(' | ')} |`);
      ds.push('');
    }
    if (seg.exch.length) {
      const ex = seg.exch.slice().sort((x, y) => x.shot - y.shot);
      ds.push('### 攻防表', '', '| 镜 | 秒 | 谁 | 属于 | 动作 | 为什么没防住 |', '|---|---|---|---|---|---|');
      for (const r of ex) ds.push(`| ${r.shot} | ${range[r.shot - 1] || '?'} | ${cell((cast.cast[r.who] || { kv: {} }).kv['名'] || r.who)} | ${r.type}${r.sev ? SEV[r.sev] : ''} | ${cell(r.act)} | ${cell(r.why)} |`);
      const hits = ex.filter(r => r.type === '受击');
      ds.push('', hits.length ? `受击：${hits.map(r => SEV[r.sev]).join(' → ')}` : '这一段没有人挨上。', '');
    }
    ds.push('### 分镜', '', '| 镜 | 秒 | 景别 | 方向 | 这一镜干什么 | 运镜 |', '|---|---|---|---|---|---|');
    seg.shots.forEach((s, i) => ds.push(`| ${i + 1} | ${range[i]} | ${cell(s.size)} | ${s.dir} | ${cell(s.title)} | ${cell(s.move)} |`));
    const zi = uniq.filter(x => x.seg === seg.n && /^Z/.test(x.id));
    ds.push('', zi.length ? '### 设计上要处理的' : '设计检查：能数的几项都过了（0.5 秒内开打、每一镜都设计了、出招有回应、受击逐级加重、标签都写进了拍里）。打得好不好看，还要照审查清单人工看。', '');
    for (const x of zi) ds.push(`- ${x.lv === 'fail' ? '❌' : '⚠️'} [${x.id}] ${x.msg}`);
    if (zi.length) ds.push('');
  }
  fs.writeFileSync(path.join(outDir, `${prefix}_打戏设计单.md`), ds.join('\n') + '\n', 'utf8');
  console.log(`打戏设计单 → ${prefix}_打戏设计单.md（${fightSegs.length} 段武戏）`);
}

// ---------- 出图清单：场景卡里写了"出图"的方向，按"先总览、再拆方向"排好 ----------
const hasImg = Object.values(scenes.scenes).some(s => s.kv['出图'] || Object.values(s.dirs).some(d => d.kv['出图']));
if (hasImg) {
  const style = scenes.globals['出图风格'] || '';
  const im = [`# ${prefix} 场景资产出图清单`, '', '自动生成自场景卡。每场戏开一个新对话：先出总览，再在同一个对话里按方向出单张。每张人工校对过才建主体：没人没字、左右和总览一致、光和场景卡一致、场景卡写的东西都在。校对完以图为准，回头改场景卡。', ''];
  if (style) im.push('## 每条提示词后面都接这一段', '', '```text', style, '```', '');
  for (const name of scenes.order) {
    const s = scenes.scenes[name];
    im.push(`## ${name}`, '', '| 存成 | 画幅 | 提示词（英文，后面接风格段） |', '|---|---|---|');
    if (s.kv['出图']) im.push(`| ${s.kv['总览图'].replace(/^@/, '')}.png | 横 3:2 | ${s.kv['出图']} |`);
    for (const d of Object.values(s.dirs)) if (d.kv['出图']) im.push(`| ${d.kv['图'].replace(/^@/, '')}.png | 竖 2:3 | ${d.kv['出图']} |`);
    im.push('');
  }
  fs.writeFileSync(path.join(outDir, `${prefix}_出图清单.md`), im.join('\n'), 'utf8');
}
process.exit(fails ? 1 : 0);
