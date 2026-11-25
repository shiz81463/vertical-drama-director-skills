// v5：把一段的源（段落源 + 场景卡 + 人物卡 + 集卡 + 剧设定）按戏种模板拼成完整提示词。
// 固定句、风格锁、场景卡的文字都由这里贴进去，所以同一场戏的各段天生一字不差；逐拍时间、切点、台词行、台词句数由这里算，不会接不上。
'use strict';
const fs = require('fs');
const path = require('path');
const { SrcError, noDot } = require('./parse.js');

const NUM = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
const fmt = c => String(c / 100);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const PREFIX = { 人: '外形照参考图，不采用参考图的光线、背景、姿势和CG质感；', 道具: '外形照参考图，不采用参考图的光线、背景和CG质感；' };
const REAL_LENS = 'Real lens and real film: highlights bloom and halate with a red-orange halo, slight chromatic fringing, softer focus at the frame edges, heavy motion blur and step-printed smearing on fast action, film grain and faint scratches;';
// V1.1：险情模板的两句表情。受惊的是原句（v4 骨架）；动手的是 2026-11-19 加的，没成片验证过
const HAZARD_FACE = {
  受惊: ['THREE LAYERS: a shock is a flicker, then the fear leaking out, then the grip.', 'FACES: fear shows first in the hands and the breath: fingers grip until the knuckles whiten, breaths come short and quick, the eyes stay on the danger; nobody screams unless it is a written line.'],
  动手: ['THREE LAYERS: a burst of force is a flicker, then the anger leaking out, then the grip.', 'FACES: anger shows first in the hands and the breath: fingers grip until the knuckles whiten, the jaw sets, breaths come hard through the nose, the eyes stay on what is breaking; nobody screams unless it is a written line.'],
};
const RESTRAINT = 'Restraint: a few large, motivated effects rather than many small ones. Every effect has a physical cause and a physical consequence.';

// V1.2（2026-11-20）：情绪的固定句放在 templates/情绪.txt（档 → 短语；"小而真"换成"放开"那句）
const EMO = (() => {
  const r = { phrase: {}, swaps: [] };
  let from = null;
  for (const l of fs.readFileSync(path.join(__dirname, '..', 'templates', '情绪.txt'), 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    let m;
    if ((m = l.match(/^档\s*(\S+?)\s*[:：]\s*(.+)$/))) r.phrase[m[1]] = m[2].trim();
    else if ((m = l.match(/^原[:：]\s*(.+)$/))) from = m[1].trim();
    else if ((m = l.match(/^换[:：]\s*(.+)$/)) && from) { r.swaps.push([from, m[1].trim()]); from = null; }
  }
  return r;
})();

const tplCache = {};
const template = mode => tplCache[mode] || (tplCache[mode] = fs.readFileSync(path.join(__dirname, '..', 'templates', 'v1', mode + '.tpl'), 'utf8').replace(/\r\n/g, '\n').split('\n').filter(l => !l.startsWith('#!')).join('\n').replace(/\n+$/, ''));

// 剧设定里的特效定义：值里写 @@特效:触发词@@ 就贴上那一条的原文
const expandFx = (s, bible, where) => (s || '').replace(/@@特效[:：](.+?)@@/g, (_, k) => {
  const d = bible.effects[k.trim().toLowerCase()];
  if (!d) throw new SrcError(where, 0, `剧设定里没有触发词是"${k}"的特效定义`);
  return d;
});

function sceneLines(scene, usedDirs) {
  const k = scene.kv;
  const overview = `${scene.place} ${k['总览图']} ：外形照参考图，不采用参考图的光线和CG质感；下面几张是同一个地方朝不同方向看的样子，成片里就是这一个地方。${noDot(k['总览'])}。参考图里没有人：成片里${noDot(k['成片里'] || '只有下面写到的人')}。`;
  const plates = usedDirs.map(n => { const d = scene.dirs[n]; return `方向${n}背景 ${d.kv['图']} ：外形照参考图，不采用参考图的构图和CG质感；成片里方向${n}（${d.name}）的镜头，背景就是图里这一头：${noDot(d.kv['背景'])}。图里没有人。${noDot(d.kv['尺寸'])}。`; });
  const facing = usedDirs.map(n => { const d = scene.dirs[n]; return `FACING ${n} (toward ${d.kv['朝']}): ${d.kv['光']}`; });
  const block = [`【场景：${scene.name}】`, `${scene.place}照参考图。${noDot(k['时间'])}，整段在这一个地方，不换地点。`, `地图：${noDot(k['地图'])}。`];
  if (k['站位']) block.push(`站位：${noDot(k['站位'])}。`);
  if (k['不入画']) block.push(`不入画：${noDot(k['不入画'])}。`);
  return { overview, plates, facing, block: block.join('\n') };
}

function castLine(c, text, open) {
  const pre = PREFIX[c.kv['类型'] || '人'];
  if (!pre) throw new SrcError('人物卡', c.line, `人物"${c.key}"的类型只能是 人、道具`);
  const start = open ? `这一段开场：${open.posture}，${open.place}，${noDot(open.hands)}。` : '';
  return `${c.kv['名']} ${c.kv['图']} ：${pre}${c.kv['固定']}${text || ''}${start}`;
}

function renderShots(seg, scene, lang) {
  let c = 0; const cuts = []; const out = []; let lines = 0; let lastSayEnd = null; const info = [];
  seg.shots.forEach((s, i) => {
    const d = scene.dirs[s.dir];
    if (!d) throw new SrcError(seg.file, s.line, `镜头"${s.title}"用了方向${s.dir}，场景卡"${scene.name}"里没有这个方向（只有 ${Object.keys(scene.dirs).join('、')}）`);
    const a = c; const beats = [];
    // 这一镜的台词要几秒（给"加秒报批"用）：英文按词、中文按字，算法和 J3 语速检查一样
    const si = { en: 0, zh: 0, say: 0, pre: 0, post: 0 };
    for (const b of s.beats) {
      const x = c; c += Math.round(b.dur * 100);
      if (b.dur <= 0) throw new SrcError(seg.file, b.line, '这一拍的秒数要大于 0');
      const t = `${fmt(x)}–${fmt(c)}`;
      if (b.say) { si.en += (b.say.line.match(/[A-Za-z']+/g) || []).length; si.zh += (b.say.line.match(/[一-鿿]/g) || []).length; si.say += c - x; si.post = 0; }
      else if (si.say) si.post += c - x; else si.pre += c - x;
      if (b.say) {
        lines++; lastSayEnd = c;
        beats.push(`${t}s: ${b.during || cap(b.say.who) + ' speaks; everyone else keeps their lips closed.'}`);
        if (b.say.emo) beats.push(`Emotion order, ${EMO.phrase[b.say.emo.level]}: ${b.say.emo.text.replace(/[.。\s]+$/, '')}.`);
        beats.push(`Dialogue: ${t}s, ${b.say.who}, to ${b.say.whom}, in ${lang}, ${b.say.tone}: {${b.say.line}}`);
      } else beats.push(`${t}s: ${b.text}`);
    }
    if ((c - a) % 100) throw new SrcError(seg.file, s.line, `镜头"${s.title}"的各拍加起来是 ${fmt(c - a)} 秒：一镜要整数秒（切点落在整秒上）`);
    out.push(`镜头${i + 1}｜${fmt(a)}–${fmt(c)}s｜${s.title}`, `[${s.size}, 方向${s.dir}（${d.name}），${s.cam}]`, `运镜：${s.move}`, ...beats);
    if (s.fx) out.push('Practical effects: ' + s.fx);
    out.push('Sound: ' + s.sound);
    if (s.light) out.push('Light: ' + s.light);
    if (i < seg.shots.length - 1) cuts.push(c / 100);
    info.push({ dur: (c - a) / 100, en: si.en, zh: si.zh, say: si.say / 100, pre: si.pre / 100, post: si.post / 100 });
  });
  return { text: out.join('\n'), cuts, total: c / 100, lines, lastSayEnd: lastSayEnd === null ? null : lastSayEnd / 100, info };
}

function compileSegment(seg, ctx) {
  const { bible, ep, scenes, cast } = ctx;
  const scene = scenes.scenes[seg.scene];
  if (!scene) throw new SrcError(seg.file, 0, `场景卡里没有"${seg.scene}"这一场（有：${scenes.order.join('；')}）`);
  if (seg.shots.length < 2) throw new SrcError(seg.file, 0, '一段至少 2 镜。单镜的补拍镜头不走编译，照 规则档案/骨架 手写');
  const usedDirs = [...new Set(seg.shots.map(s => s.dir))].sort();
  const sh = renderShots(seg, scene, bible.lang);
  const sc = sceneLines(scene, usedDirs);
  const rows = seg.people.map(p => {
    const c = cast.cast[p.key];
    if (!c) throw new SrcError(seg.file, p.line, `人物卡里没有"${p.key}"`);
    return castLine(c, p.text, seg.open[p.key]);
  });
  for (const k of Object.keys(seg.open)) if (!seg.people.some(p => p.key === k)) throw new SrcError(seg.file, seg.open[k].line, `"开场"写了 ${k}，但这一段的"人"里没有他`);
  const n = sh.lines; const w = (NUM[n] || String(n)).toLowerCase();
  const declLong = n === 0 ? ' Nobody speaks in this segment; every mouth stays closed except for breath and laughter.'
    : n === 1 ? ' This segment has only this one line, spoken once, word for word, by the person named; only the speaker\'s lips move; nobody says anything else.'
      : ` This segment has only these ${w} lines, each spoken once, word for word, by the person named; only the speaker's lips move; nobody says anything else.`;
  const declShort = n === 0 ? '' : n === 1 ? ' This segment has only this one line, spoken once, word for word, by the person named; only the speaker\'s lips move.'
    : ` This segment has only these ${w} lines, each spoken once, word for word, by the person named; only the speaker's lips move.`;
  const who = (seg.kv['险情谁'] || '受惊').trim();
  const hf = HAZARD_FACE[/动手|施害/.test(who) ? '动手' : /受惊|受害/.test(who) ? '受惊' : null];
  if (!hf) throw new SrcError(seg.file, 0, `"险情谁"只能写 受惊 或 动手，现在是"${who}"`);
  const cutTxt = sh.cuts.length > 1 ? sh.cuts.slice(0, -1).join(', ') + ' and ' + sh.cuts[sh.cuts.length - 1] : String(sh.cuts[0]);

  const computed = {
    '@集': ep.kv['集'], '@风格锁': bible.style, '@颜色句': bible.color, '@特效固定1': bible.fx1, '@特效固定2': bible.fx2, '@胶片后半': bible.film,
    '@结尾固定': bible.ending, '@语言': bible.lang, '@FACING': sc.facing.join('\n'), '@资产行': [sc.overview, ...sc.plates, ...rows].join('\n'), '@场景块': sc.block,
    '@人物句': seg.acts.join('\n'), '@人物句内联': seg.acts.join(' '), '@台词声明': declLong, '@台词声明短': declShort,
    '@镜头数': NUM[seg.shots.length] || String(seg.shots.length), '@切点': cutTxt, '@镜头': sh.text, '@末镜号': String(seg.shots.length), '@BGM对白': n ? '对白、' : '', '@险情三层': hf[0], '@险情表情': hf[1],
  };
  const lookup = k => {
    if (k in computed) return computed[k];
    if (k === '@特效规范') {
      const raw = expandFx(scene.kv['特效规范'], bible, scenes.file);
      if (!raw) throw new SrcError(scenes.file, scene.line, `武戏要在场景卡"${scene.name}"里写"特效规范"（多行，第 1 条到其他特效那几条）`);
      const ls = raw.split('\n').map(x => x.trim()).filter(Boolean);
      const items = ls.filter(l => /^\d+\. /.test(l)).length;
      const hl = seg.kv['高光'] || scene.kv['高光'];
      if (!hl) throw new SrcError(scenes.file, scene.line, `场景"${scene.name}"缺"高光"`);
      // 第 1 条（光）后面接剧设定的特效质感固定句（规则 S3），再接这一段用到的方向的光句
      const first = ls[0] + [bible.fx1, bible.fx2].filter(x => x && !ls[0].includes(x)).map(x => ' ' + x).join('');
      return [first, ...sc.facing, ...ls.slice(1), `${items + 1}. ${REAL_LENS} the ${hl} highlights ${bible.film}`, `${items + 2}. ${RESTRAINT}`].join('\n');
    }
    for (const src of [seg.kv, scene.kv, ep.kv]) if (k in src && src[k] !== '') return expandFx(src[k], bible, seg.file);
    if (k === '打斗优先级' && (seg.kv['体型与比例'] || scene.kv['体型与比例'])) return '高优先级';   // 只能有一处"最高优先级"（规则 B3）
    return undefined;
  };
  const missing = new Set();
  const sub = (s, soft) => {
    let empty = false;
    const r = s.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
      const [k, def] = expr.split('|');
      if (k.trim() in computed) return computed[k.trim()];   // 脚本算出来的值可以是空的（比如没台词时不写"对白、"）
      let v = lookup(k.trim());
      if (v === undefined || v === '') v = def;
      if (v === undefined || v === '') { empty = true; if (!soft) missing.add(k.trim()); return ''; }
      return v;
    });
    return { r, empty };
  };
  const out = [];
  for (let line of template(seg.mode).split('\n')) {
    // 行首 ?(键)：这个键填了才要这一行（给"可选的一整块"用，标题行和内容行都挂同一个键）；行首 ?：这一行里有键没填就不要
    const cond = line.match(/^\?\((.+?)\)(.*)$/);
    if (cond) { const v = lookup(cond[1]); if (v === undefined || v === '') continue; line = cond[2]; }
    const optional = !cond && line.startsWith('?');
    if (optional) line = line.slice(1);
    line = line.replace(/\[\[(.*?)\]\]/g, (_, inner) => { const x = sub(inner, true); return x.empty ? '' : x.r; });
    const x = sub(line, optional);
    if (optional && x.empty) continue;
    out.push(x.r);
  }
  if (missing.size) throw new SrcError(seg.file, 0, `${seg.mode}这一段还缺：${[...missing].join('、')}（写在段落源里；整场戏都一样的写在场景卡里）`);
  let text = out.join('\n') + '\n';
  // V1.2：这一段有情绪档是 显、过、破 的，模板里"小而真"那句换成"放开"那句（按 情绪.txt 的顺序，换上一处就停）
  const loud = seg.shots.some(s => s.beats.some(b => b.say && b.say.emo && b.say.emo.level !== '收'));
  if (loud) for (const [a, b] of EMO.swaps) if (text.includes(a)) { text = text.replace(a, () => b); break; }
  const refs = (text.match(/@[^\s：:，,；;）)]+/g) || []);
  return { text, total: sh.total, shots: seg.shots.length, lines: n, dirs: usedDirs, cuts: sh.cuts, lastSayEnd: sh.lastSayEnd, shotInfo: sh.info, sceneBlock: sc.block, count: text.replace(/\n+$/, '').length + refs.length, refs: [...new Set(refs)], sceneChars: [sc.overview, ...sc.plates, ...sc.facing, sc.block].join('\n').length, fixedChars: bible.style.length };
}

module.exports = { compileSegment, sceneLines, castLine, NUM, EMO, HAZARD_FACE };
