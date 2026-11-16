#!/usr/bin/env node
// 竖屏武戏编导：竖屏（9:16）常规打戏提示词自动检查。规则编号对应 rules.md。
// 从横屏原版 武戏编导/scripts/check_prompt.js 改出来：剧设定改读 竖屏制作/剧设定，加了 V 节（竖屏构图）的检查。
// 用法：node check_prompt.js <提示词.txt>
// 结果：❌ 必须改；⚠️ 要人看一眼并在回复里交代；✅ 通过。有 ❌ 时退出码为 1。
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const styleArg = argv.includes('--style') ? (argv[argv.indexOf('--style') + 1] || '') : '';
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--style');
if (!file) { console.error('用法：node check_prompt.js <提示词.txt> [--style 剧名或剧设定路径]'); process.exit(2); }
const t = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r/g, '').replace(/\n+$/, '');
const canon = JSON.parse(fs.readFileSync(path.join(__dirname, 'canon.json'), 'utf8'));

const results = [];
const add = (level, id, msg, details = []) => results.push({ level, id, msg, details });
const ctx = (s, i, n = 40) => s.slice(Math.max(0, i - n), i + n).replace(/\n/g, ' ');
const short = (s, n = 48) => s.slice(0, n) + (s.length > n ? '…' : '');
const findAll = (re, s = t) => {
  const out = []; let m;
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = r.exec(s))) { out.push(m); if (m[0] === '') r.lastIndex++; }
  return out;
};
const idx = mark => t.indexOf(mark);
const lineAfter = mark => {
  const i = idx(mark); if (i < 0) return '';
  const nl = t.indexOf('\n', i); if (nl < 0) return '';
  return (t.slice(nl + 1).split('\n').find(l => l.trim()) || '').trim();
};

// ---------- 切块 ----------
const endingStart = idx('严禁字幕');
const shotsStart = t.search(/^镜头1｜/m);
const body = endingStart >= 0 ? t.slice(0, endingStart) : t;
const shotsText = shotsStart >= 0 ? t.slice(shotsStart, endingStart >= 0 ? endingStart : undefined) : '';
const assetLines = t.split('\n').filter(l => /^\S+ (@\S+|\$图片\d+) ?：/.test(l));
const hasScale = idx('【体型与比例') >= 0;
const skyOnly = /SKY ONLY/.test(t);

// ---------- B0 占位符 ----------
if (/\{\{|\}\}/.test(t)) add('fail', 'B0', '还有没填的 {{占位}}', findAll(/\{\{[^}]*\}\}/).slice(0, 5).map(m => m[0]));
else add('pass', 'B0', '没有没填的占位');

// ---------- B1 区块顺序（【主体规则】名字不固定，不查；【体型与比例】可选） ----------
const order = [
  ['【全局视觉风格】', true], ['【画面质感', true], ['【实拍特效规范', true], ['ASSETS', true], ['【场景', true],
  ['【体型与比例', false], ['【打斗', true], ['【镜头衔接', true], ['【本段战损】', true],
  ['镜头1｜', true], ['【结束状态】', true], ['严禁字幕', true],
];
let last = -1; const missing = [], outOfOrder = [];
for (const [m, req] of order) {
  const i = m === 'ASSETS' ? (assetLines.length ? t.indexOf(assetLines[0]) : -1) : idx(m);
  const name = m === 'ASSETS' ? '资产行' : m;
  if (i < 0) { if (req) missing.push(name); continue; }
  if (i < last) outOfOrder.push(name);
  last = Math.max(last, i);
}
if (missing.length) add('fail', 'B1', '缺区块：' + missing.join('、'));
else if (outOfOrder.length) add('fail', 'B1', '区块顺序不对：' + outOfOrder.join('、'));
else add('pass', 'B1', `区块都在，顺序对${hasScale ? '（含【体型与比例】）' : ''}`);

// ---------- S 剧设定：同一部戏的风格锁、画面质感、特效质感不跑偏（规则 S1–S5） ----------
// 每部戏一份竖屏剧设定（竖屏制作\剧设定\<剧名>.md），代码块里是锁定的句子。默认拿风格锁去认是哪部戏，也可以 --style 指定。
// 横屏剧设定（精品制作\剧设定）只用来提示"这部戏还没有竖屏剧设定"，不拿来比对。
const STYLE_DIR = 'D:/漫剧公司/竖屏制作/剧设定';
const HSTYLE_DIR = 'D:/漫剧公司/精品制作/剧设定';
const codeLines = s => { const m = (s || '').match(/```(?:text)?\n([\s\S]*?)```/); return m ? m[1].split('\n').map(x => x.trim()).filter(Boolean) : []; };
function parseStyle(f) {
  const raw = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const sec = {};
  for (const p of raw.split(/^## /m).slice(1)) sec[p.split('\n')[0].trim()] = p;
  const effects = [];
  for (const sub of (sec['特效定义：用到就照抄'] || '').split(/^### /m).slice(1)) {
    const words = ((sub.match(/^触发词[:：]\s*(.+)$/m) || [])[1] || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean);
    const lines = codeLines(sub);
    if (words.length && lines.length) effects.push({ name: sub.split('\n')[0].trim(), words, lines });
  }
  return {
    name: (raw.match(/^# 剧设定[:：]\s*(.+)$/m) || [])[1] || path.basename(f, '.md'),
    status: (raw.match(/^状态[:：]\s*(.+)$/m) || [])[1] || '',
    language: (raw.match(/^台词语言[:：]\s*(.+)$/m) || [])[1] || '',
    ratio: (raw.match(/^画幅[:：]\s*(.+)$/m) || [])[1] || '',
    lock: codeLines(sec['风格锁'])[0] || '',
    texture: codeLines(sec['画面质感：固定句']),
    fx: codeLines(sec['特效质感：固定句']),
    effects,
    ending: codeLines(sec['结尾：固定句']),
  };
}
let styles = [];
try {
  if (styleArg) {
    const f = fs.existsSync(styleArg) ? styleArg : path.join(STYLE_DIR, styleArg.replace(/\.md$/, '') + '.md');
    const have = fs.existsSync(STYLE_DIR) ? fs.readdirSync(STYLE_DIR).filter(x => x.endsWith('.md') && x !== '说明.md').map(x => x.replace(/\.md$/, '')) : [];
    if (fs.existsSync(f)) styles = [parseStyle(f)];
    else add('fail', 'S0', `剧设定里没有「${styleArg}」。现有：${have.join('、') || '（一份都没有）'}`);
  } else if (fs.existsSync(STYLE_DIR)) {
    styles = fs.readdirSync(STYLE_DIR).filter(f => f.endsWith('.md') && f !== '说明.md').map(f => parseStyle(path.join(STYLE_DIR, f)));
  }
} catch (e) { add('fail', 'S0', '读剧设定出错：' + e.message); }
const lock = lineAfter('【全局视觉风格】');
const kw = s => new Set(s.replace(/^【[^】]*】/, '').split(/[，,、；;。：:（）()\s]+/).map(x => x.trim()).filter(Boolean));
let style = styles.find(s => s.lock && s.lock === lock);
// 竖屏剧设定里没有、横屏剧设定里有：先做竖屏剧设定
let hOnly = null;
if (!style && !styleArg) {
  try {
    if (fs.existsSync(HSTYLE_DIR)) hOnly = fs.readdirSync(HSTYLE_DIR).filter(f => f.endsWith('.md') && f !== '说明.md').map(f => parseStyle(path.join(HSTYLE_DIR, f))).find(s => s.lock && s.lock === lock) || null;
  } catch (e) { /* 横屏剧设定读不了就跳过这条提示 */ }
}
if (style) add('pass', 'S1', `风格锁和《${style.name}》的竖屏剧设定一字不差`);
else if (hOnly) add('fail', 'S0', `《${hOnly.name}》只有横屏剧设定（精品制作\\剧设定），还没有竖屏剧设定。先按 references/风格三件套.md 第一节第 0 步做一份竖屏剧设定（宽银幕词先问用户），存进 竖屏制作\\剧设定`);
else if (styles.length) {
  const K = kw(lock);
  const best = styles.map(s => {
    const S = kw(s.lock), inter = [...K].filter(x => S.has(x)).length;
    return { s, score: inter / Math.max(1, new Set([...K, ...S]).size) };
  }).sort((a, b) => b.score - a.score)[0];
  if (best.score >= 0.4) {
    style = best.s;
    const S = kw(style.lock), lessW = [...S].filter(x => !K.has(x)), moreW = [...K].filter(x => !S.has(x));
    const d = [];
    if (lessW.length) d.push('少了：' + lessW.join('、'));
    if (moreW.length) d.push('多了：' + moreW.join('、'));
    if (!d.length) d.push('词都一样，标点、顺序或空格不同');
    add('fail', 'S1', `风格锁跑偏了：和《${style.name}》的剧设定对不上（风格锁一字不动）`, d);
  } else add('fail', 'S1', '风格锁和剧设定里哪一部戏都对不上。新剧先填 templates/新剧输入卡.md，按 references/风格三件套.md 定剧设定', [short(lock, 80)]);
} else if (!results.some(r => r.id === 'S0')) add('fail', 'S0', `找不到剧设定（${styleArg || STYLE_DIR}）。新剧先填 templates/新剧输入卡.md，按 references/风格三件套.md 定剧设定`);

// ---------- C1 画面质感的开头（所有戏通用） ----------
const tex = lineAfter('【画面质感');
if (!tex.startsWith(canon.texturePrefix)) add('fail', 'C1', `画面质感没有用验证过的开头"${canon.texturePrefix}："`, [short(tex, 60)]);
else add('pass', 'C1', '画面质感用了验证过的开头');

if (style) {
  if (!/9\s*[:：]\s*16/.test(style.ratio)) add('fail', 'V0', `《${style.name}》剧设定里的画幅写的是"${style.ratio || '（没写）'}"，竖屏剧设定要写"画幅：9:16"`);
  if (!/验证过/.test(style.status) || /未验证/.test(style.status)) add('warn', 'S1', `《${style.name}》的剧设定还没被成片验证过：第一条生成后，按 references/风格三件套.md 第七节验质感`);
  const fxStart = t.search(/【实拍/), fxEnd = assetLines.length ? t.indexOf(assetLines[0]) : -1;
  const fxBlock = fxStart >= 0 ? t.slice(fxStart, fxEnd > fxStart ? fxEnd : undefined) : '';
  const endBlock = endingStart >= 0 ? t.slice(endingStart) : '';
  const lockCheck = (id, what, lines, region) => {
    const miss = lines.filter(x => !region.includes(x));
    if (!lines.length) add('warn', id, `《${style.name}》的剧设定里没有${what}的固定句`);
    else if (miss.length) add('fail', id, `${what}跑偏了：缺了《${style.name}》剧设定里的固定句`, miss.map(x => short(x, 80)));
    else add('pass', id, `${what}的固定句都在（${lines.length} 句）`);
  };
  lockCheck('S2', '画面质感', style.texture, tex);
  lockCheck('S3', '特效质感', style.fx, fxBlock);
  for (const e of style.effects) {
    const re = new RegExp('\\b(' + e.words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
    if (!re.test(fxBlock)) continue;
    const miss = e.lines.filter(x => !fxBlock.includes(x));
    if (miss.length) add('warn', 'S4', `特效段用到了「${e.name}」，但没照抄剧设定里的定义（同一部戏里，同一种特效要写成同一个样子）`, miss.map(x => short(x, 80)));
    else add('pass', 'S4', `「${e.name}」照抄了剧设定的定义`);
  }
  lockCheck('S5', '结尾', style.ending, endBlock);
}

// ---------- 必备原句 ----------
for (const r of canon.required) {
  if (t.includes('STEADY HAZARD:') && ['H1-镜头停住不超过半秒', 'G1-相对速度', 'G1-镜头差点跟不上'].includes(r.id)) continue; // v2 P14：灾难戏不用打戏运镜
  if (r.when && !t.includes(r.when)) continue;
  if (r.whenRe && !new RegExp(r.whenRe, 'i').test(t)) continue;
  if (t.includes(r.text)) add('pass', r.id, '有：' + short(r.text));
  else add(r.level, r.id, '缺原句：' + short(r.text, 70) + (r.status === 'verified' ? '' : '（这句还没验证过）'));
}

// ---------- C1 特效质感段字数 ----------
const fxA = idx('【画面质感'), fxB = assetLines.length ? t.indexOf(assetLines[0]) : -1;
if (fxA >= 0 && fxB > fxA) {
  const n = fxB - fxA;
  if (n < 2000) add('fail', 'C1', `特效质感段只有 ${n} 字（v12 删到 2,669 字成片就变 CG 感；v13 约 3,800）`);
  else if (n < 2800) add('warn', 'C1', `特效质感段 ${n} 字，比 v13（约 3,800）少很多，查一下是不是删了质感句（这条字数线在非雨夜场景里还没验证）`);
  else add('pass', 'C1', `特效质感段 ${n} 字`);
}

// ---------- B3 优先级 ----------
const top = findAll(/【([^】]*)——最高优先级】/);
if (top.length !== 1) add('fail', 'B3', `"最高优先级"有 ${top.length} 处，只能有一处（其余标"高优先级"）`);
else if (hasScale && !top[0][1].includes('体型与比例')) add('warn', 'B3', '有【体型与比例】时，最高优先级应该标它（v13 验证过）');
else if (!hasScale && !top[0][1].includes('打斗')) add('warn', 'B3', `常规武戏默认把最高优先级标在【打斗】，现在标在【${top[0][1]}】，在回复里说明为什么`);
else add('pass', 'B3', '"最高优先级"只有一处：' + top[0][1]);

// ---------- E1/C4 资产行 ----------
if (!assetLines.length) add('fail', 'E1', '没找到资产行（格式：名字 @资产 ： 或 名字 $图片N ：）');
for (const l of assetLines) {
  const name = l.split(' ')[0];
  if (/只采用/.test(l)) add('fail', 'E1', `${name}：资产行用了"只采用……"列外形。外形交给参考图，文字只写尺寸、数量、状态和与参考图不同处`);
  else if (!l.includes('外形照参考图')) add('warn', 'E1', `${name}：没写"外形照参考图"`);
  if (!/CG质感/.test(l)) add('warn', 'C4', `${name}：资产行没写"不采用……CG质感"，参考图的渲染感会被搬进成片`);
  if (!/[\d一二三四五六七八九十百千两]+\s*(米|公分|厘米)|翼展|身高|身长|比.{1,12}(高|长|大|粗|宽|矮|小)/.test(l)) add('warn', 'E1', `${name}：资产行里没看到尺寸`);
  const colorWords = l.match(/(白色|蓝色|青蓝|金色|红色|暗红|灰黑|黑色|青玉色|铜绿|深青|浅青|银色|浅蓝灰|浅灰蓝)/g);
  if (colorWords && colorWords.length >= 2 && !/不采用参考图里/.test(l)) add('warn', 'E1', `${name}：资产行里有外形颜色描述（${[...new Set(colorWords)].join('、')}），参考图已经有了`);
}
if (assetLines.length && assetLines.every(l => !/只采用/.test(l))) add('pass', 'E1', `资产行 ${assetLines.length} 条，都没有列外形`);

// ---------- F7 道具分身（30s片段：写了"从头到尾拿着"又要掉，模型手里留一个、地上再掉一个） ----------
const propDup = assetLines.filter(l => /(从头到尾|一直|全程)[^；;。]{0,12}(拿着|握着|端着|攥着|捧着)/.test(l) && /(掉|松手|扔|放下|摔)/.test(l));
// "之后手里是空的"要说的是手，不能被"the empty cup"这类说法骗过去
const handEmpty = /\bhand\b[^.;\n]{0,25}\bempty\b|\bempty\b[^.;\n]{0,15}\bhand\b|手[^，。；、\n]{0,4}空|空着手/i;
const holdM = body.match(/\b(stays|remains) in [^.;\n]{0,25}\bhand\b[^.;\n]{0,20}\buntil\b[^.;\n]*/i);
const holdUntil = !!holdM && !handEmpty.test(body);
if (propDup.length || holdUntil) add('warn', 'F7', '道具写了"一直拿着"又要掉或放下，却没写"之后手里是空的"：模型会两头都做（手里留一个、地上再掉一个）。写成"全片只有这一个……X 秒后手里是空的"（30s片段）', [...propDup.map(l => short(l, 80)), ...(holdUntil ? [short(holdM[0], 80)] : [])]);

// ---------- H1 环绕方向（30s片段："绕到她左侧"又写"往左摇"，两半句打架，镜头绕反了） ----------
const swing = [
  ...findAll(/\b(LEFT|RIGHT) side\b[^.;\n]{0,60}?\bpann?(?:ing|s|ed)? (right to left|left to right)\b/i, body),
  ...findAll(/(从右往左|从左往右|右→左|左→右)摇[^。；\n]{0,12}绕到[^。；\n]{0,4}[左右]侧|绕到[^。；\n]{0,4}[左右]侧[^。；\n]{0,12}(从右往左|从左往右|右→左|左→右)摇/, body),
];
if (swing.length) add('warn', 'H1', '环绕同时写了"绕到某一侧"和摇的方向，两半句容易打架，模型会绕反（30s片段）。改写看得见的位置：看到她哪边脸、朝画面哪边走、道具在身体哪一侧', swing.map(m => '…' + ctx(body, m.index, 50) + '…'));

// ---------- 镜头 ----------
const heads = findAll(/^镜头(\d+)｜([\d.]+)[–-]([\d.]+)s｜(.*)$/m);
const endStateAt = idx('【结束状态】');
const shots = heads.map((h, i) => {
  const a = h.index, b = i + 1 < heads.length ? heads[i + 1].index : (endStateAt >= 0 ? endStateAt : t.length);
  return { n: +h[1], a: +h[2], b: +h[3], title: h[4], text: t.slice(a, b) };
});
if (!shots.length) add('fail', 'B5', '没找到镜头（格式：镜头1｜0–1s｜中文一句）');
else {
  const total = shots[shots.length - 1].b;
  let ok = true, prev = 0;
  for (const s of shots) { if (Math.abs(s.a - prev) > 1e-9) { ok = false; add('fail', 'B5', `镜${s.n} 从 ${s.a}s 开始，上一镜结束在 ${prev}s，中间断了`); } prev = s.b; }
  if (ok) add('pass', 'B5', `时间轴 0–${total}s 连续，共 ${shots.length} 镜（平台时长要设 ${Math.round(total)} 秒）`);
  const maxShots = Math.max(1, Math.floor(total / 15 * 6 + 1e-9));
  if (shots.length > maxShots) add('fail', 'B5', `${total} 秒放了 ${shots.length} 镜，超过上限 ${maxShots}（15 秒最多 6 镜，多了模型会重画空间）`);
  const nonInt = shots.filter(s => s.b !== Math.round(s.b)).map(s => s.b);
  if (nonInt.length) add('warn', 'B5', '切点不是整数秒：' + nonInt.join('、') + '（Seedance 2.5 只认整数秒）');
  const cuts = (t.match(/hard cuts only at ([^.]+?) s[.;]/) || [])[1];
  if (cuts) {
    const declared = cuts.replace(/and/g, ',').split(',').map(x => +x.trim()).filter(x => !isNaN(x));
    const actual = shots.slice(0, -1).map(s => s.b);
    if (JSON.stringify(declared) === JSON.stringify(actual)) add('pass', 'B5', '镜头规则里写的切点和镜头一致：' + actual.join('、'));
    else add('fail', 'B5', `镜头规则写的切点 ${declared.join('、')} 和镜头实际切点 ${actual.join('、')} 不一致`);
  } else add('warn', 'B5', '镜头规则里没写"hard cuts only at … s"');
  const words = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE'];
  const dw = (t.match(/\b(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE) SHOTS\b/) || [])[1];
  if (dw && words.indexOf(dw) + 1 !== shots.length) add('fail', 'B5', `镜头规则写 ${dw} SHOTS，实际 ${shots.length} 镜`);

  for (const s of shots) {
    const miss = [];
    if (!/^\[[^\]]+\]/m.test(s.text)) miss.push('机位方括号');
    if (!/^运镜：/m.test(s.text)) miss.push('运镜');
    if (!/^Practical effects:/m.test(s.text)) miss.push('Practical effects');
    if (!/^Sound:/m.test(s.text)) miss.push('Sound');
    if (miss.length) add(miss.includes('运镜') || miss.includes('机位方括号') ? 'fail' : 'warn', 'B6', `镜${s.n} 缺：${miss.join('、')}`);
    const beats = findAll(/^([\d.]+)(?:[–-]([\d.]+))?s: /m, s.text).map(m => [+m[1], m[2] ? +m[2] : +m[1]]);
    let p = s.a, gap = false;
    for (const [x, y] of beats) { if (Math.abs(x - p) > 1e-9) gap = true; p = y; }
    if (!beats.length) add('warn', 'B6', `镜${s.n} 没有逐拍时间（a–bs: …）`);
    else if (gap || Math.abs(p - s.b) > 1e-9) add('fail', 'B6', `镜${s.n} 逐拍时间不连续，或者没写到 ${s.b}s`);
    if (s.n > 1) {
      const firstBeat = (s.text.match(/^[\d.]+(?:[–-][\d.]+)?s: [^\n]*/m) || [''])[0];
      if (!/Matched on action/.test(firstBeat)) add('fail', 'H2', `镜${s.n} 第一拍没写 "Matched on action"（接着上一镜的哪个动作）`);
    }
    const yun = (s.text.match(/^运镜：[^\n]*/m) || [''])[0];
    if (yun && !yun.includes('→') && !/摇|推|拉|跟|飞|冲|甩|翻|退|升|降|绕|追|晃|抖|扎|撞|震|转/.test(yun) && s.b - s.a > 1.5) add('warn', 'H1', `镜${s.n} 运镜链里没有"→"，看看镜头是不是一直不动`);
    s.bracket = (s.text.match(/^\[[^\]]+\]/m) || [''])[0];
    s.far = /fleck|小点/.test(s.text);
    s.close = /fill(s|ing)? (the |most of the )?(whole |top of the |bottom of the |right half of the |left half of the )?frame|fills the bottom|from edge to edge|run(s|ning)? out past|wall of|surface|占满画面|出画|撑出画框/.test(s.text);
    if (hasScale) {
      if (!s.far && !s.close) add('warn', 'E2', `镜${s.n} 看不出是"贴近"还是"远离"取景（贴近：大的一方只给撑出画框的表面；远离：小的一方是小点）`);
      for (const m of findAll(/[^.;:]*\bwhole (hand|fist|head|trident|claw|wing|body)[^.;:]*/i, s.text)) {
        if (!/never|fleck/.test(m[0])) add('warn', 'E2', `镜${s.n} 有整块局部，确认小的一方是小点：…${m[0].trim().slice(0, 80)}…`);
      }
    }
    s.noSize = !/(大特写|特写|中近景|近景|中景|大全景|全景|远景|微距|close-up|medium shot|wide shot|extreme wide|macro)/i.test(s.bracket);
  }

  // H17 机位写景别（待验证）；用了【体型与比例】时先不要求（规则 E2 的推测）
  const noSize = shots.filter(s => s.noSize).map(s => s.n);
  if (hasScale) add('pass', 'H17', '有【体型与比例】，方括号先不要求写景别（规则 E2 的推测）');
  else if (noSize.length) add('warn', 'H17', `镜 ${noSize.join('、')} 的机位方括号没写景别（特写 / 近景 / 中景 / 全景 / 大全景），紧松节奏只能靠猜（规则 H17，待验证）`);
  else add('pass', 'H17', '每镜都写了景别');

  // H9 紧紧松（待验证）：松 = 大景别，或体型悬殊时的远离取景
  const loose = shots.map(s => (hasScale && s.far) || /大全景|(^|[^中])全景|远景|extreme wide|wide shot/i.test(s.bracket));
  let runLen = 0, maxRun = 0;
  for (const l of loose) { runLen = l ? 0 : runLen + 1; maxRun = Math.max(maxRun, runLen); }
  const looseCount = loose.filter(Boolean).length;
  const needLoose = Math.max(1, Math.round(total / 15 * 2));
  const longLoose = shots.some((s, i) => loose[i] && s.b - s.a >= 2);
  const pattern = loose.map(l => (l ? '松' : '紧')).join(' ');
  let rhythmOk = true;
  if (maxRun > 3) { rhythmOk = false; add('warn', 'H9', `节奏 ${pattern}：连续 ${maxRun} 镜都是"紧"，中间没有松一下（规则 H9，待验证）`); }
  if (looseCount < needLoose) { rhythmOk = false; add('warn', 'H9', `节奏 ${pattern}：${total} 秒里只有 ${looseCount} 个"松"的镜头，至少要 ${needLoose} 个（规则 H9，待验证）`); }
  if (!longLoose) { rhythmOk = false; add('warn', 'H9', `节奏 ${pattern}：没有停 2 秒以上的"松"镜头（规则 H9，待验证）`); }
  if (rhythmOk) add('pass', 'H9', `紧松节奏：${pattern}`);

  const es = (t.match(/END STATE:[^\n]*/) || [''])[0];
  const lastN = shots[shots.length - 1].n;
  if (!es) add('fail', 'B7', '没写结束状态 END STATE');
  else if (!new RegExp('shot ' + lastN + '\\b').test(es)) add('warn', 'B7', `结束状态没写"end of shot ${lastN}"`);
  else add('pass', 'B7', '结束状态对应最后一镜');
}

// ---------- V0 画幅和宽银幕词（竖屏） ----------
// 风格锁是用户原文：里面有宽银幕词只报 ⚠️（问过用户再定留不留）；别的地方出现就报 ❌
const WIDE = /变形宽银幕|宽银幕|2\.39\s*[:：]\s*1|2\.35\s*[:：]\s*1|16\s*[:：]\s*9|横屏|anamorphic|wide-?screen|letterbox(?:ed|ing)?|cinemascope|black bars/gi;
{
  const lockAt = lock ? t.indexOf(lock) : -1;
  const inLock = [], outside = [];
  for (const m of findAll(WIDE)) (lockAt >= 0 && m.index >= lockAt && m.index < lockAt + lock.length ? inLock : outside).push(m);
  if (inLock.length) add('warn', 'V0', `风格锁里有宽银幕词（${[...new Set(inLock.map(m => m[0]))].join('、')}）：在竖画面里可能被画成上下黑边或横向光斑（待验证）。风格锁是用户原文，问过用户、决定保留的，在回复里说一句`);
  if (outside.length) add('fail', 'V0', '风格锁以外写了画幅或宽银幕词：竖屏的画幅只在平台设 9:16，提示词里不写', outside.slice(0, 4).map(m => '…' + ctx(t, m.index) + '…'));
  if (!inLock.length && !outside.length) add('pass', 'V0', '没有画幅和宽银幕词');
}

// ---------- V1 两方不左右排开（竖屏，粗查） ----------
// 全景以上的镜头里同时写了 LEFT 和 RIGHT，又没写远近上下，多半是横屏的排法
if (shots.length && !hasScale) {
  const spread = [];
  for (const s of shots) {
    if (!/大全景|(^|[^中])全景|远景|extreme wide|wide shot/i.test(s.bracket || '')) continue;
    const beat = s.text.split('\n').filter(l => /^[\d.]+(?:[–-][\d.]+)?s: /.test(l)).join(' ');
    const both = /\bon the LEFT\b|screen-LEFT|画面左/.test(beat) && /\bon the RIGHT\b|screen-RIGHT|画面右/.test(beat);
    const depth = /\b(near|nearer|close to) the lens\b|\bfarther back\b|\bforeground\b|\bbackground\b|\bin the depth\b|\b(low|lower|high|higher) in (the )?frame\b|\b(upper|lower) (half|part|third|two thirds|LEFT|RIGHT|corner)\b|\b(top|bottom) of the frame\b|\bover (his|her|their|the [\w-]+'s) (right |left )?shoulder\b|前景|后景|纵深|过肩|离镜头近|离镜头远|画面上方|画面下方|画面上半|画面下半|画面左下|画面右上|画面右下|画面左上/i.test(s.text);
    if (both && !depth) spread.push(s.n);
  }
  if (spread.length) add('warn', 'V1', `镜 ${spread.join('、')} 是全景以上，两方一个写在 LEFT、一个写在 RIGHT，没写谁近谁远、谁上谁下：竖屏里左右排开会被挤小、中间一片空。改成纵深或上下（规则 V1、V2）`);
  else add('pass', 'V1', '全景以上的镜头里没有只靠左右排开的同框');
}

// ---------- G1 绝对速度 ----------
const absSpeed = findAll(/(\d+\s*(km\/h|kph|mph|m\/s)\b|kilomet(er|re)s? (an|per) hour|miles (an|per) hour|meters? per second|公里每小时|每小时[\d一二三四五六七八九十百千约]+公里|时速)/i);
if (absSpeed.length) add('fail', 'G1', '写了绝对速度；速度只写相对的（近处闪过、远处几乎不动、镜头差点跟不上、留下痕迹）', absSpeed.map(m => '…' + ctx(t, m.index) + '…'));
else add('pass', 'G1', '没有绝对速度');

// ---------- G3 慢 ----------
const slow = findAll(/\bslow\w*/i).filter(m => !/^No slow motion/i.test(t.slice(Math.max(0, m.index - 3), m.index + 14)) && !/^slow-shutter/i.test(t.slice(m.index, m.index + 12)));
const zhSlow = findAll(/慢镜头|放慢|缓慢|慢慢|慢动作|升格/).filter(m => !(endingStart >= 0 && m.index > endingStart && /不要|禁|No/.test(t.slice(Math.max(0, m.index - 6), m.index))));
if (slow.length || zhSlow.length) add('warn', 'G3', '有"慢"字，容易被做成慢镜头', [...slow, ...zhSlow].map(m => '…' + ctx(t, m.index) + '…'));
else add('pass', 'G3', '除了结尾禁止项，没有"慢"字');
if (/only small things move fast/i.test(t)) add('fail', 'G3', '"only small things move fast" 会把大的一方的动作也带慢');

// ---------- G4 让镜头变死的机位词 ----------
const camLines = t.split('\n').filter(l => /^(运镜：|\[|Camera:)/.test(l));
const stat = [];
for (const l of camLines) for (const m of findAll(/(平飞|稳住|保持水平|固定机位|静止不动|\blevel\b|\bsteadies\b|\bsteady\b|locked-off|\bstatic\b|\bside on\b|\balongside\b)/i, l)) {
  if (/never tipped up|at its height/.test(l) && /level/i.test(m[0])) continue;
  stat.push(m[0] + '：' + l.slice(0, 60));
}
if (stat.length) add('warn', 'G4', '机位里有让镜头变死的词（v12 写"平飞/侧面/稳住/水平"，成片就是固定镜头）', stat);
else add('pass', 'G4', '机位和运镜里没有让镜头变死的词');

// ---------- I2/I3/I5 噪声词 ----------
const skyLine = (t.match(/^SKY ONLY:[^\n]*/m) || [''])[0];
const noise = [
  [/fast and furious/i, 'fail', '撞《速度与激情》片名'],
  [/fireworks|烟花|打铁花/i, 'fail', '容易被画成放烟花'],
  [/mosquito|蚊子/i, 'fail', '会画出蚊子'],
  [/cyclops|独眼/i, 'fail', '会被读成独眼巨人'],
  [/terrain|地形/i, skyOnly ? 'fail' : 'warn', skyOnly ? '喻体是地面，和"只有天空"打架' : '"地形"拿来做比喻时会被画出来；写实的地面不算'],
  [/\b(mountains?|peaks?|cliffs?)\b|山峰|山脉|悬崖/i, 'warn', skyOnly ? '山的比喻会带出山（SKY ONLY 那行除外）' : '山拿来做比喻时会被画出来；场景里真有山就不算'],
  [/\bas if\b|\blike an? \b/i, 'warn', '英文比喻，看喻体会不会被画出来'],
  [/thunder|lightning|雷|闪电/i, 'warn', '没写闪电的场景里，雷会带出闪电'],
  [/\b(tower|mast|swallow|furnace|rocket|avalanche|paper cut)\b|桅杆|燕子|炉门|火箭|雪崩/i, 'warn', '比喻的喻体可能被画出来'],
  [/\brings?\b|\bspirals?\b|螺旋|圆环/i, 'warn', '容易被画成发光的圈或螺旋光痕'],
  [/\bwaves?\b|\bwater\b|\becho(es)?\b|波浪|回音|水声|水泡/i, 'warn', '音频里容易出水泡声（不写水、波浪、回音）'],
  [/\btrails?\b/i, 'warn', '容易被画成一条横穿画面的直线（"never a straight trail" 除外）'],
];
for (const [re, level, why] of noise) {
  const hits = findAll(re).filter(m => {
    const ls = t.lastIndexOf('\n', m.index) + 1, le = t.indexOf('\n', m.index);
    const line = t.slice(ls, le < 0 ? t.length : le);
    if (skyLine && line === skyLine) return false;
    if (/never a straight trail/.test(t.slice(Math.max(0, m.index - 20), m.index + 10))) return false;
    if (/lined with|ringed/i.test(m[0])) return false;
    return true;
  });
  if (hits.length) add(level, 'I2', `${why}：` + [...new Set(hits.map(m => m[0]))].join('、'), hits.slice(0, 4).map(m => '…' + ctx(t, m.index) + '…'));
}
if (!results.some(r => r.id === 'I2')) add('pass', 'I2', '没有已知的噪声词和危险比喻');

// ---------- I1 否定句数量 ----------
const neg = findAll(/\bnever\b/i, body).length;
if (neg > 16) add('warn', 'I1', `正文里 never 有 ${neg} 次（v13 是 13 次）。否定句里的词模型照样看得见，只留针对具体失败的`);
else add('pass', 'I1', `正文 never ${neg} 次`);

// ---------- I4 代词 ----------
const male = ['rider', 'giant', 'swordsman', 'bandit', 'assassin', 'monk', 'general', 'soldier', 'warrior', 'stranger', 'guard', 'old man', 'young man', 'boy', 'man'];
const female = ['swordswoman', 'woman', 'girl', 'old woman', 'young woman', 'lady'];
const countLabels = (s, list) => list.filter(l => new RegExp('\\bthe ' + l + '\\b', 'i').test(s)).length;
const sentences = shotsText.split(/(?<=[.;:])\s+/);
const amb = sentences.filter(s => (/\b(he|his|him)\b/i.test(s) && countLabels(s, male) >= 2) || (/\b(she|her|hers)\b/i.test(s) && countLabels(s, female) >= 2));
if (amb.length) add('warn', 'I4', '同一句里有两个同性别的人，又用了 he/his 或 she/her，确认指得清', amb.slice(0, 5).map(s => s.trim().slice(0, 100)));
else add('pass', 'I4', '镜头里没有分不清的代词');

// ---------- D3 火星 ----------
const hit = (t.match(/REAL HIT REACTIONS[^\n]*/) || [''])[0];
if (/\bsparks?\b/i.test(hit)) add('fail', 'D3', '通用受击规则里列了 sparks，会让打在身上也冒火星');
const skinSpark = shotsText.split(/(?<=[.;])\s+/).filter(s => /\bsparks?\b/i.test(s) && /\b(skin|flesh|brow|split|blood|wound|cheek|ribs)\b/i.test(s));
if (skinSpark.length) add('warn', 'D3', '同一句里有火星和皮肉，确认火星只在金属相碰时出现', skinSpark.map(s => s.trim().slice(0, 100)));
if (!/\bsparks?\b/i.test(hit) && !skinSpark.length) add('pass', 'D3', '火星没有和皮肉写在一起');

// ---------- D7 持续接触 ----------
const sustain = findAll(/skids? along|slides? along|grinds? along|presses? against|locked together|(sword|blade|tine|spear|saber|sabre)s? (stays?|sticks?|rests?) (on|against)|擦过去|顶住|顶在一起|贴在.{0,4}上/i, shotsText);
if (sustain.length) add('warn', 'D7', '持续接触的动词会拖成对顶，接触写"一眨眼"', sustain.map(m => '…' + ctx(shotsText, m.index) + '…'));
else add('pass', 'D7', '没有持续接触的动词');

// ---------- R 资产齐全，人物和场景的位置不穿帮（规则 R1、R4、R9；R3 在 canon.json 里查） ----------
// R1 场景资产：【场景：地点，…】里的地点要有一条资产行
{
  const place = ((t.match(/【场景[:：]([^，,】]+)/) || [])[1] || '').trim();
  const names = assetLines.map(l => l.split(' ')[0]);
  if (!place) add('warn', 'R1', '没找到【场景：地点】，没法核对场景资产行');
  else if (!names.some(n => place.includes(n) || n.includes(place))) add('warn', 'R1', `【场景】的地点"${place}"没有资产行：我们做片场景通常有资产图，有就加一行 @ 它（规则 R1、R2）`);
  else add('pass', 'R1', `场景"${place}"有资产行`);
}
// R4 群演：逐拍里写了群演，要有群演资产行，或者【场景】里写清了长相和衣服
{
  const beats = shotsText.split('\n').filter(l => /^[\d.]+(?:[–-][\d.]+)?s: /.test(l)).join(' ');
  const sceneLine = (t.match(/【场景[^】]*】\n([^\n]*)/) || [])[1] || '';
  const names = assetLines.map(l => l.split(' ')[0]).join(' ');
  const groups = [
    // 单数 guard 在打戏里常指防守架势（the giant's guard），只认复数和 guardsman 这类明确指人的词
    ['禁卫军、守卫、士兵', /\b(guards|guardsm[ae]n|soldiers?|sentries|henchm[ae]n|thugs|knights)\b/i, /禁卫军|侍卫|守卫|卫兵|士兵|骑士|手下|打手/],
    ['近侍、仆从', /\b(attendants?|servants?|footm[ae]n|pages?|butlers?|stewards?)\b/i, /近侍|侍从|仆人|仆从|管家|随从/],
    ['侍女', /\b(maids?|handmaidens?|ladies-in-waiting)\b/i, /侍女|宫女|女仆|丫鬟/],
    ['贵族、宾客', /\b(nobles?|noblem[ae]n|noblewom[ae]n|courtiers?|guests?|lady|ladies)\b/i, /贵族|朝臣|宾客|客人|贵妇/],
    ['路人、群众', /\b(crowd|villagers?|onlookers?|passers-by|townsfolk|bystanders?)\b/i, /群众|路人|村民|围观|百姓/],
  ];
  const described = /各不相同|长相|长得|穿|衣服|服装|铠甲|制服|外套|照参考图/;
  const miss = [];
  for (const [label, en, zh] of groups) {
    if (!en.test(beats) && !zh.test(beats)) continue;
    if (zh.test(names)) continue;
    // 要同一句里既有这类群演、又写了长相或衣服才算写清；写贵族的那句不能替禁卫军过关
    if (sceneLine.split('。').some(s => zh.test(s) && described.test(s))) continue;
    miss.push(label);
  }
  if (miss.length) add('warn', 'R4', `逐拍里有群演（${miss.join('；')}），没有资产行，【场景】里也没写清长相和衣服：有资产图就 @；没有就写清和主角不同的年龄、长相、衣服，不然模型会拿主角的参考图去套（规则 R4）`);
  else add('pass', 'R4', '群演都有资产行，或者在【场景】里写清了长相');
}
// R9 收尾：v3 起英文全段只留一句"只出现一次"（规则 N2），写在【打斗】或结尾都算
if (/appears (exactly|only) once/.test(t)) add('pass', 'R9', '写了"每个有名字的角色只出现一次"');

// ---------- B4 字数 → v3 换成 N1 字数区间，加 N2 去重、Q 台词保护 ----------
require('./lean_checks.js')({ t, body, add, lock, shots, endingStart, assetLines, mode: '武戏', argv, findAll, ctx, short });

// ---------- 输出 ----------
const icon = { fail: '❌', warn: '⚠️', pass: '✅' };
const by = l => results.filter(r => r.level === l);
console.log(`\n检查：${path.basename(file)}（竖屏武戏编导，9:16）\n`);
for (const level of ['fail', 'warn', 'pass']) {
  for (const r of by(level)) {
    console.log(`${icon[level]} [${r.id}] ${r.msg}`);
    for (const d of r.details) console.log('      ' + d);
  }
}
const imgs = [...new Set((t.match(/\$图片\d+/g) || []))];
console.log(`\n合计：❌ ${by('fail').length}  ⚠️ ${by('warn').length}  ✅ ${by('pass').length}`);
console.log(by('fail').length
  ? '下一步：先把 ❌ 改完再跑；没有 ❌ 以后，派审查员查意思层面（SKILL.md"每次必做"第 3 条）。'
  : '下一步：派审查员（轻量子 agent，model: haiku）按 references/审查清单.md 查脚本查不了的意思层面：武器在谁手里、打得实不实、物理做不做得到、视线、打戏逻辑等（SKILL.md"每次必做"第 3 条）。');
console.log(`上平台前：画面比例设 9:16；时长设 ${shots.length ? Math.round(shots[shots.length - 1].b) : '?'} 秒；分辨率 720p 以上；这一行要传的图：${imgs.join('、') || '无'}；不点生成，由用户点。`);
process.exit(by('fail').length ? 1 : 0);
