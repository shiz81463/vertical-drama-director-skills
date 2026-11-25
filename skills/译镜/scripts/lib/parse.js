// v5：读源文件（集卡、场景卡、人物卡、段落源）和剧设定。源文件都是"键: 值"一行一条，格式见 模板/ 和 手册/。
'use strict';
const fs = require('fs');
const path = require('path');

class SrcError extends Error {
  constructor(file, line, msg) { super(`${path.basename(file)}${line ? ' 第 ' + line + ' 行' : ''}：${msg}`); this.src = true; }
}
const read = f => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

// 一行一条：== 节 ==、-- 小节 --、键: 值、键 数字: 值；多行的值写成  键: <<<  ……  >>>
function entries(file) {
  const lines = read(file).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    if (/[〈〉]/.test(l)) throw new SrcError(file, i + 1, `这一行还是模板里的〈说明〉，没填：${l.slice(0, 36)}`);
    let m;
    if ((m = l.match(/^==\s*(.+?)\s*==$/))) { out.push({ t: 'sec', v: m[1], line: i + 1 }); continue; }
    if ((m = l.match(/^--\s*(.+?)\s*--$/))) { out.push({ t: 'sub', v: m[1], line: i + 1 }); continue; }
    m = l.match(/^([^\s:：|]{1,10})(?:\s+(\d+(?:\.\d+)?))?\s*[:：]\s*(.*)$/);
    if (!m) throw new SrcError(file, i + 1, `看不懂这一行，要写成"键: 值"：${l.slice(0, 40)}`);
    let v = m[3];
    if (v === '<<<') {
      const start = i + 1; const buf = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '>>>') buf.push(lines[i++]);
      if (i >= lines.length) throw new SrcError(file, start, '多行内容 <<< 没有用 >>> 收尾');
      v = buf.join('\n').trim();
    }
    if (/[〈〉]/.test(v)) throw new SrcError(file, i + 1, `"${m[1]}"还是模板里的〈说明〉，没填：${v.slice(0, 30)}`);
    out.push({ t: 'kv', k: m[1], n: m[2] === undefined ? null : +m[2], v, line: i + 1 });
  }
  return out;
}
const parts = (s, n) => { const a = s.split(/\s*\|\s*/); return n && a.length > n ? [...a.slice(0, n - 1), a.slice(n - 1).join(' | ')] : a; };
const noDot = s => (s || '').replace(/[。.]\s*$/, '');

// ---------- 剧设定 ----------
function parseBible(file) {
  const raw = read(file);
  const block = h => { const m = raw.match(new RegExp('## ' + h + '[^\\n]*\\n```text\\n([\\s\\S]*?)\\n```')); if (!m) throw new SrcError(file, 0, `剧设定里没有"## ${h}"这一节的锁定句`); return m[1]; };
  const fx = block('特效质感').split('\n');
  const effects = {};
  const sec = raw.split(/^## /m).find(p => p.startsWith('特效定义')) || '';
  for (const sub of sec.split(/^### /m).slice(1)) {
    const words = ((sub.match(/^触发词[:：]\s*(.+)$/m) || [])[1] || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean);
    const body = (sub.match(/```text\n([\s\S]*?)\n```/) || [])[1];
    if (body) for (const w of words) effects[w.toLowerCase()] = body;
  }
  const lang = (raw.match(/台词语言[:：][^\n]*?in ([A-Z][A-Za-z ]*?(?:English|Chinese))/) || [])[1] || 'American English';
  // V1.1：模板是 "the {{高光}} highlights {{@胶片后半}}"。本机的剧设定第三句多是 "highlights roll off…"（给旧技能拼 "the bulb " + 这句用的），
  // 直接接上去会变成 "highlights highlights"（第 29 集在本机重编、E01 补拍都中了）。开头的 highlights 去掉，剧设定不用改。
  return { file, style: block('风格锁'), color: block('画面质感'), fx1: fx[0] || '', fx2: fx[1] || '', film: (fx[2] || '').replace(/^highlights\s+/i, ''), ending: block('结尾'), effects, lang };
}

// ---------- 集卡 ----------
function parseEpisode(file) {
  const kv = {};
  for (const e of entries(file)) { if (e.t !== 'kv') throw new SrcError(file, e.line, '集卡里只写"键: 值"'); kv[e.k] = e.v; }
  for (const k of ['剧', '集', '前缀']) if (!kv[k]) throw new SrcError(file, 0, `集卡缺"${k}"`);
  return { file, kv };
}

// ---------- 场景卡 ----------
function parseScenes(file, fmt = 'V1') {
  const scenes = {}; const order = []; const globals = {};
  let cur = null, dir = null;
  for (const e of entries(file)) {
    if (e.t === 'sec') {
      const m = e.v.match(/^场景[:：]\s*(.+)$/);
      if (!m) throw new SrcError(file, e.line, '场景卡的节标题写成"== 场景：地方，时段 =="');
      cur = { name: m[1], place: m[1].split(/[，,]/)[0].trim(), kv: {}, dirs: {}, anchors: {}, line: e.line };
      if (scenes[cur.name]) throw new SrcError(file, e.line, `场景"${cur.name}"写了两次`);
      scenes[cur.name] = cur; order.push(cur.name); dir = null; continue;
    }
    if (e.t === 'sub') {
      const m = e.v.match(/^方向\s*(\d+)\s*[:：]\s*(.+)$/);
      if (!cur || !m) throw new SrcError(file, e.line, '方向的小节标题写成"-- 方向1：朝什么 --"，而且要在某个场景下面');
      dir = { n: m[1], name: m[2].trim(), kv: {}, line: e.line };
      cur.dirs[m[1]] = dir; continue;
    }
    if (!cur) { globals[e.k] = e.v; continue; }
    if (dir) { dir.kv[e.k] = e.v; continue; }
    if (e.k === '锚点') { const [who, ds] = parts(e.v, 2); cur.anchors[who] = (ds || '').split(/[,，、\s]+/).filter(Boolean); continue; }
    cur.kv[e.k] = e.v;
  }
  for (const s of Object.values(scenes)) {
    for (const k of fmt === 'V2' ? ['时间', '材质', '光源', '总览图', '总览', '地标'] : ['时间', '材质', '光源', '总览图', '总览', '地图']) if (!s.kv[k] && !(k === '光源' && s.kv['特效规范'])) throw new SrcError(file, s.line, `场景"${s.name}"缺"${k}"${fmt === 'V2' && k === '地标' ? '（V2 新加：全景里用来说人贴着什么的固定物。要重编的是 2026-11-24 以前的旧集，就在集卡里写"格式: V1"）' : ''}`);
    const n = Object.keys(s.dirs).length;
    if (n < 1) throw new SrcError(file, s.line, `场景"${s.name}"一个方向都没写`);
    for (const d of Object.values(s.dirs)) for (const k of fmt === 'V2' ? ['背景', '光', '依据'] : ['图', '背景', '尺寸', '朝', '光']) if (!d.kv[k]) throw new SrcError(file, d.line, `场景"${s.name}"方向${d.n} 缺"${k}"${k === '依据' ? '（V2：这个方向的左右是照总览图哪个视角推出来的；总览图里没有、也没单独出图的方向不能用，模型会自己翻面）' : ''}`);
  }
  return { file, scenes, order, globals };
}

// ---------- 人物卡 ----------
function parseCast(file) {
  const cast = {}; let cur = null;
  for (const e of entries(file)) {
    if (e.t === 'sec') { cur = { key: e.v, kv: {}, line: e.line }; if (cast[e.v]) throw new SrcError(file, e.line, `人物"${e.v}"写了两次`); cast[e.v] = cur; continue; }
    if (e.t !== 'kv' || !cur) throw new SrcError(file, e.line, '人物卡先写"== 键 =="，下面写"键: 值"');
    cur.kv[e.k] = e.v;
  }
  for (const c of Object.values(cast)) for (const k of ['名', '图', '固定']) if (!c.kv[k]) throw new SrcError(file, c.line, `人物"${c.key}"缺"${k}"`);
  return { file, cast };
}

// ---------- 段落源 ----------
const MULTI = new Set(['人', '表演', '开场', '收场']);
// v5.2 打戏设计：攻防表每一行"属于"哪一种。别的说法（攻击、防御、躲避、建立空间）也认
const EXCH_ALIAS = { 攻击: '进攻', 出招: '进攻', 防御: '防守', 格挡: '防守', 挡: '防守', 躲避: '闪避', 躲: '闪避', 闪: '闪避', 建立空间: '关系', 关系镜头: '关系', 脸: '反应', 反应镜头: '反应', 憋一口气: '憋气', 蓄力: '起手' };
const EXCH_TYPES = ['关系', '起手', '进攻', '闪避', '防守', '反击', '受击', '反应', '憋气'];
// V1.2（2026-11-20）："情绪: 档 | 格1 → 格2 → 格3"，紧挨着写在它那句"说"的上一行（手册 7）
const EMO_LEVELS = ['收', '显', '过', '破'];
const EMO_ALIAS = { 明: '显', 爆: '破' };
function parseSegment(file) {
  const seg = { file, kv: {}, people: [], acts: [], open: {}, close: {}, shots: [], setup: [], rounds: [], exch: [] };
  let shot = null, lastSay = null, pendingEmo = null;
  const emoLeft = () => new SrcError(file, pendingEmo.line, '"情绪"要紧挨着写在它那句"说"的上一行，中间不隔别的键（手册 7）');
  const exchRow = (e, curShot) => {
    const p = parts(e.v).map(x => x.trim());
    let n = null;
    const m0 = (p[0] || '').match(/^镜?头?\s*(\d+)$/);
    if (e.n !== null) n = e.n;                       // 也认"攻防 2: 谁 | 属于 | 动作"
    else if (m0) { n = +m0[1]; p.shift(); }
    else if (curShot) n = curShot;                   // 写在某个镜头下面时，不用写镜号
    if (n === null || p.length < 3) throw new SrcError(file, e.line, '"攻防"写成：镜号 | 谁 | 属于 | 动作 | 为什么没防住（受击才写）。属于：' + EXCH_TYPES.join(' / ') + '，受击要写成 受击轻 / 受击中 / 受击重');
    let type = p[1], sev = 0;
    const hs = type.match(/^受击\s*[（(]?\s*(轻|中|重|最重)?\s*[）)]?$/);
    if (hs) { if (!hs[1]) throw new SrcError(file, e.line, '"受击"要写轻重：受击轻 / 受击中 / 受击重（挨打一次比一次重，最重的放在结尾）'); type = '受击'; sev = { 轻: 1, 中: 2, 重: 3, 最重: 3 }[hs[1]]; }
    type = EXCH_ALIAS[type] || type;
    if (!EXCH_TYPES.includes(type)) throw new SrcError(file, e.line, `攻防表里不认识"${p[1]}"（能写：关系 / 起手 / 进攻 / 闪避 / 防守 / 反击 / 受击轻 / 受击中 / 受击重 / 反应 / 憋气）`);
    return { shot: n, who: p[0], type, sev, act: p[2], why: p.slice(3).join(' | '), line: e.line };
  };
  const ledger = (e) => { const p = parts(e.v, 5); if (p.length < 4) throw new SrcError(file, e.line, `"${e.k}"写成：人物键 | 姿态 | 位置 | 手里的东西 | 脸朝哪（V2 加，可不写）`); return [p[0], { posture: p[1], place: p[2], hands: p[3], facing: p[4] || '', line: e.line }]; };
  for (const e of entries(file)) {
    if (e.t === 'sub') throw new SrcError(file, e.line, '段落源里没有"-- 小节 --"');
    if (e.t === 'sec') {
      if (pendingEmo) throw emoLeft();
      const m = e.v.match(/^镜头\s*[:：|｜]\s*(.+)$/);
      if (!m) throw new SrcError(file, e.line, '镜头的节标题写成"== 镜头：这一镜的情绪任务 =="');
      shot = { title: m[1].trim(), beats: [], line: e.line }; seg.shots.push(shot); lastSay = null; continue;
    }
    if (!shot) {
      if (e.k === '情绪') throw new SrcError(file, e.line, '"情绪"写在镜头里，紧挨着它那句"说"的上一行（手册 7）');
      if (e.k === '人') { const [key, text] = parts(e.v, 2); seg.people.push({ key, text: text || '', line: e.line }); }
      else if (e.k === '表演') seg.acts.push(e.v);
      else if (e.k === '开场') { const [k, v] = ledger(e); seg.open[k] = v; }
      else if (e.k === '收场') { const [k, v] = ledger(e); seg.close[k] = v; }
      else if (e.k === '设定') { const p = parts(e.v).map(x => x.trim()); if (p.length < 6) throw new SrcError(file, e.line, '"设定"写成：人物键 | 体型和快慢 | 看不见、够不着的地方 | 怕什么 | 想要的距离 | 能力的代价和破绽'); seg.setup.push({ key: p[0], f: p.slice(1, 6), line: e.line }); }
      else if (e.k === '回合') { const p = parts(e.v).map(x => x.trim()); if (p.length < 6) throw new SrcError(file, e.line, '"回合"写成：名字 | 谁主动 | 怎么打 | 对方怎么回应 | 距离怎么变 | 双方各学到什么'); seg.rounds.push({ f: p.slice(0, 6), line: e.line }); }
      else if (e.k === '攻防') seg.exch.push(exchRow(e, null));
      else { if (e.k in seg.kv) throw new SrcError(file, e.line, `"${e.k}"写了两次`); seg.kv[e.k] = e.v; }
      continue;
    }
    if (pendingEmo && e.k !== '说') throw emoLeft();
    if (e.k === '情绪') {
      const p = parts(e.v, 2).map(x => x.trim());
      const lv = EMO_ALIAS[(p[0] || '').replace(/档$/, '')] || (p[0] || '').replace(/档$/, '');
      if (!EMO_LEVELS.includes(lv) || !p[1]) throw new SrcError(file, e.line, '"情绪"写成：档 | 格1 → 格2 → 格3。档是 收 / 显 / 过 / 破（手册 7）');
      pendingEmo = { level: lv, text: p[1], line: e.line };
      continue;
    }
    if (e.k === '攻防') { seg.exch.push(exchRow(e, seg.shots.length)); continue; }
    if (e.k === '拍') { if (e.n === null) throw new SrcError(file, e.line, '"拍"后面写这一拍几秒，如"拍 1.5: ……"'); shot.beats.push({ dur: e.n, text: e.v, line: e.line }); lastSay = null; }
    else if (e.k === '说') {
      if (e.n === null) throw new SrcError(file, e.line, '"说"后面写这句话占几秒，如"说 4: 谁 > 对谁 | 语气 | 台词"');
      const p = parts(e.v, 3); const ww = (p[0] || '').split(/\s*>\s*/);
      if (p.length < 3 || ww.length !== 2) throw new SrcError(file, e.line, '"说"写成：谁 > 对谁 | 语气 | 台词原文');
      lastSay = { dur: e.n, say: { who: ww[0].trim(), whom: ww[1].trim(), tone: p[1], line: p[2].replace(/^\{|\}$/g, '') }, line: e.line };
      if (pendingEmo) { lastSay.say.emo = pendingEmo; pendingEmo = null; }
      shot.beats.push(lastSay);
    }
    else if (e.k === '说时') { if (!lastSay) throw new SrcError(file, e.line, '"说时"要紧跟在一条"说"后面'); lastSay.during = e.v; }
    else if (e.k === '机位') {
      const p = parts(e.v, 3);
      if (p.length < 3) throw new SrcError(file, e.line, '"机位"写成：景别 焦距 | 方向号 | 镜头站在哪、谁在画面哪里');
      shot.size = p[0]; shot.dir = (p[1].match(/\d+/) || [''])[0]; shot.cam = p[2];
      if (!shot.dir) throw new SrcError(file, e.line, '"机位"第二格写方向号（场景卡里的方向 1、2、3）');
    }
    else if (e.k === '运镜') shot.move = e.v;
    else if (e.k === '主体') shot.subject = e.v.split(/[,，、\s]+/).filter(Boolean);
    else if (e.k === '声') shot.sound = e.v;
    else if (e.k === '光') shot.light = e.v;
    else if (e.k === '构图') shot.comp = e.v;      // V2
    else if (e.k === '光影') shot.lit = e.v;      // V2
    else if (e.k === '落幅') shot.endf = e.v;     // V2
    else if (e.k === '术语') shot.terms = e.v.split(/[、，,；;]/).map(x => x.trim()).filter(Boolean);   // V2 机位术语库，手册 8
    else if (e.k === '特效') shot.fx = e.v;
    else if (e.k === '分镜秒') {
      // v5.1：分镜表里这一镜的时长。脚本拿它核对时长有没有改；为台词加的秒自动列进"要总控批的事"
      const n = e.n !== null ? e.n : parseFloat(e.v);
      if (!(n > 0)) throw new SrcError(file, e.line, '"分镜秒"写分镜表里这一镜几秒，一个数，如"分镜秒: 3"（两镜合成一镜就写两镜加起来的秒数）');
      shot.sbDur = n;
    }
    else throw new SrcError(file, e.line, `镜头里不认识"${e.k}"（能写：机位、术语、运镜、构图、光影、落幅、主体、分镜秒、拍、情绪、说、说时、声、光、特效；武戏还能写 攻防）`);
  }
  if (pendingEmo) throw emoLeft();
  for (const k of ['段', '场景']) if (!seg.kv[k]) throw new SrcError(file, 0, `段落源缺"${k}"`);
  seg.n = +seg.kv['段']; seg.mode = seg.kv['戏种'] || '文戏'; seg.scene = seg.kv['场景'];
  if (!['文戏', '武戏', '险情'].includes(seg.mode)) throw new SrcError(file, 0, `戏种只能是 文戏、武戏、险情，现在是"${seg.mode}"`);
  if (!seg.shots.length) throw new SrcError(file, 0, '一个镜头都没写');
  for (const s of seg.shots) {
    for (const k of ['size', 'cam', 'move', 'sound']) if (!s[k]) throw new SrcError(file, s.line, `镜头"${s.title}"缺"${{ size: '机位', cam: '机位', move: '运镜', sound: '声' }[k]}"`);
    if (!s.beats.length) throw new SrcError(file, s.line, `镜头"${s.title}"没有"拍"`);
  }
  return seg;
}

module.exports = { SrcError, read, entries, parts, noDot, parseBible, parseEpisode, parseScenes, parseCast, parseSegment };
