#!/usr/bin/env node
// v4（2026-11-09）跨段检查：同一场戏的各段，场景卡那几样文字一字不差、每镜有方向、方向都有背景图和光句。规则 X1–X7。
// 用法：node check_scene.js <这一集的提示词文件夹> [--lock 第N集_场景锁.txt]
//   提示词文件名要有"段N"；场景锁默认找文件夹里的 *场景锁*.txt。没有场景锁时，只拿同一场戏的各段互相比。
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
if (!dir || !fs.existsSync(dir)) { console.log('用法：node check_scene.js <提示词文件夹> [--lock 场景锁.txt]'); process.exit(2); }
const li = args.indexOf('--lock');
let lockFile = li >= 0 ? args[li + 1] : null;
if (!lockFile) { const f = fs.readdirSync(dir).find(f => /场景锁.*\.txt$/.test(f)); if (f) lockFile = path.join(dir, f); }

const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const norm = s => (s || '').replace(/[ \t]+$/gm, '').trim();
const out = [];
let fails = 0, warns = 0;
const add = (lv, who, id, msg) => { out.push(`${lv === 'fail' ? '❌' : lv === 'warn' ? '⚠️' : '✅'} [${id}] ${who}：${msg}`); if (lv === 'fail') fails++; if (lv === 'warn') warns++; };

// ---------- 读一段提示词 ----------
function parsePrompt(t) {
  const lines = t.split('\n');
  const sceneHdr = (t.match(/^【场景[:：][^】]*】$/m) || [''])[0];
  const sceneBlock = (() => { const m = t.match(/^(【场景[:：][^】]*】\n[\s\S]*?)(?=\n【)/m); return m ? norm(m[1]) : ''; })();
  const overview = lines.filter(l => /^\S+ @\S*_总览 ?：/.test(l)).map(norm);
  const plates = {}; for (const l of lines) { const m = l.match(/^方向(\d+)背景 @\S+ ?：/); if (m) plates[m[1]] = norm(l); }
  const facing = {}; for (const l of lines) { const m = l.match(/^FACING (\d+)\b/); if (m) facing[m[1]] = norm(l); }
  const fx = (() => { const a = t.indexOf('【实拍'); if (a < 0) return ''; const firstAsset = lines.find(l => /^\S+ (@\S+|\$图片\d+) ?：/.test(l)); const b = firstAsset ? t.indexOf(firstAsset) : -1; return norm(t.slice(a, b > a ? b : undefined).split('\n').filter(l => !/^FACING \d/.test(l)).join('\n')); })();
  const shots = [];
  const re = /^镜头(\d+)｜[^\n]*\n(\[[^\]\n]*\])?/gm; let m;
  while ((m = re.exec(t))) { const d = ((m[2] || '').match(/方向\s*(\d+)/) || [])[1]; shots.push({ n: +m[1], bracket: m[2] || '', dir: d }); }
  return { sceneHdr, sceneBlock, overview, plates, facing, fx, shots };
}

// ---------- 读场景锁 ----------
const lock = {};
if (lockFile && fs.existsSync(lockFile)) {
  const t = read(lockFile);
  const parts = t.split(/^== 场景[:：]\s*(.+?)\s*==\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1];
    const p = parsePrompt(body + '\n【END】');
    lock[norm(p.sceneHdr)] = { name: parts[i].trim(), ...p };
  }
  if (!Object.keys(lock).length) add('fail', path.basename(lockFile), 'X1', '场景锁文件里没读到场景（每节标题写"== 场景：<地方>，<时段> =="，下面放【场景：…】块）');
}

// ---------- 读所有段 ----------
const files = fs.readdirSync(dir).filter(f => /段\d+.*提示词.*\.txt$/.test(f)).sort((a, b) => (+a.match(/段(\d+)/)[1]) - (+b.match(/段(\d+)/)[1]));
if (!files.length) { console.log('文件夹里没有"段N…提示词….txt"'); process.exit(2); }
const segs = files.map(f => ({ f, seg: +f.match(/段(\d+)/)[1], ...parsePrompt(read(path.join(dir, f))) }));

for (const s of segs) {
  const who = `段${s.seg}`;
  if (!s.sceneHdr) { add('fail', who, 'X3', '没有【场景：地方，时段】这一行'); continue; }
  const L = lock[norm(s.sceneHdr)];
  if (lockFile && !L) add('fail', who, 'X1', `场景锁里没有"${s.sceneHdr}"这一场：先在场景锁里写好再照抄`);
  // X4 每镜有方向，方向有背景图
  const used = new Set();
  for (const sh of s.shots) {
    if (!sh.dir) add('fail', who, 'X4', `镜头${sh.n} 的机位方括号没写"方向N"：${sh.bracket.slice(0, 40) || '（没找到方括号）'}`);
    else { used.add(sh.dir); if (!s.plates[sh.dir]) add('fail', who, 'X4', `镜头${sh.n} 用了方向${sh.dir}，但这一段没有"方向${sh.dir}背景 @…"资产行`); }
  }
  for (const d of Object.keys(s.plates)) if (!used.has(d)) add('warn', who, 'X2', `有方向${d}的背景图资产行，但没有一镜用它：删掉这一行，省字`);
  // X5 用到的方向都有光句
  for (const d of used) if (!s.facing[d]) add('fail', who, 'X5', `用了方向${d}，【实拍光影规范】里没有"FACING ${d} (…)"那句光`);
  for (const d of Object.keys(s.facing)) if (!used.has(d)) add('warn', who, 'X5', `有 FACING ${d}，但没有一镜用方向${d}：删掉这一句`);
  if (!s.overview.length) add('fail', who, 'X2', '没有场景总览图那一条资产行（<地方> @<地方>_总览 ：…）');
  // 和场景锁一字不差
  if (L) {
    if (s.sceneBlock !== L.sceneBlock) add('fail', who, 'X3', '【场景】块和场景锁不一样：照场景锁原样复制');
    if (L.overview[0] && s.overview[0] !== L.overview[0]) add('fail', who, 'X2', '总览资产行和场景锁不一样');
    for (const d of Object.keys(s.plates)) {
      if (!L.plates[d]) add('fail', who, 'X2', `方向${d}不在场景锁里：不能自己发明新方向`);
      else if (s.plates[d] !== L.plates[d]) add('fail', who, 'X2', `方向${d}背景图资产行和场景锁不一样`);
    }
    for (const d of Object.keys(s.facing)) {
      if (L.facing[d] && s.facing[d] !== L.facing[d]) add('fail', who, 'X5', `FACING ${d} 和场景锁不一样`);
      if (!L.facing[d]) add('fail', who, 'X5', `FACING ${d} 不在场景锁里`);
    }
  }
}

// ---------- U7（V1.1，2026-11-19）同一张方向图用在了几场戏里 ----------
// E01：玻璃已经碎了的"餐厅对峙，三周后夜"用了完好的那张图（平安夜几段也用它），图压过字，成片树会回到屋里。
const imgUse = {};
for (const s of segs) {
  if (!s.sceneHdr) continue;
  const hdr = s.sceneHdr.replace(/^【场景[:：]\s*|】$/g, '');
  const cut = Math.max(hdr.lastIndexOf('，'), hdr.lastIndexOf(','));
  const time = cut >= 0 ? hdr.slice(cut + 1).trim() : '';
  const ov = ((s.overview[0] || '').match(/@\S*?_总览/) || [''])[0];
  for (const line of Object.values(s.plates)) {
    const img = (line.match(/^方向\d+背景 (@\S+)/) || [])[1];
    if (img) (imgUse[img] = imgUse[img] || []).push({ seg: s.seg, hdr, time, ov });
  }
}
for (const [img, us] of Object.entries(imgUse)) {
  const hdrs = [...new Set(us.map(u => u.hdr))];
  if (hdrs.length < 2) continue;
  const where = hdrs.map(h => `${h}（段${[...new Set(us.filter(u => u.hdr === h).map(u => u.seg))].join('、')}）`).join('；');
  if (new Set(us.map(u => u.time)).size > 1) add('fail', img, 'U7', `同一张方向图用在了不同时段的几场戏里：${where}。图里的光、摆设、破没破只对得上其中一场，另一场会照着图变回去。每个时段、每种状态单独出方向图，场景卡里换成新图`);
  else if (new Set(us.map(u => u.ov)).size > 1) add('warn', img, 'U7', `同一张方向图用在了总览图不同的几场戏里：${where}。总览图不同，多半是这个地方的状态变了（打碎、布置、收拾）；确认这张图就是每一场的样子，不是就给那一场单独出图`);
}

// ---------- 同一场戏各段互相比（有没有场景锁都比） ----------
const groups = {};
for (const s of segs) if (s.sceneHdr) (groups[norm(s.sceneHdr)] = groups[norm(s.sceneHdr)] || []).push(s);
for (const [hdr, g] of Object.entries(groups)) {
  const name = `${hdr}（段${g.map(s => s.seg).join('、')}）`;
  if (g.length < 2) { add('pass', name, 'X7', '这一场只有一段'); continue; }
  const diff = (key, label, id) => {
    const vals = [...new Set(g.map(s => typeof s[key] === 'string' ? s[key] : JSON.stringify(s[key])))];
    if (vals.length > 1) add(id === 'X7' ? 'warn' : 'fail', name, id, `${label}各段不一样`);
  };
  diff('sceneBlock', '【场景】块', 'X3');
  // 方向资产行、光句：同一方向在各段必须一样
  for (const key of ['plates', 'facing']) {
    const byDir = {};
    for (const s of g) for (const [d, v] of Object.entries(s[key])) (byDir[d] = byDir[d] || new Set()).add(v);
    for (const [d, set] of Object.entries(byDir)) if (set.size > 1) add('fail', name, key === 'plates' ? 'X2' : 'X5', `方向${d}的${key === 'plates' ? '背景图资产行' : 'FACING 光句'}各段不一样`);
  }
  diff('fx', '【实拍光影规范】（去掉 FACING 句以后）', 'X7');
  if (!out.some(l => l.includes(name))) add('pass', name, 'X7', '各段场景卡文字一致');
}

console.log(`跨段检查：${files.length} 段${lockFile ? '，场景锁 ' + path.basename(lockFile) : '，没有场景锁（只做段和段之间的比对）'}\n`);
for (const l of out) console.log(l);
console.log(`\n合计：❌ ${fails}  ⚠️ ${warns}`);
process.exit(fails ? 1 : 0);
