// V2（2026-11-24）：把一段的源拼成统一结构的提示词。文戏、武戏、险情同一套章节。
// 和 V1 比：固定站位删了，换成【承接画面】【结束画面】（从账本来，上一段结尾 = 下一段开头逐字一样）；
//   每镜多了 构图、光影、落幅；方向只写总览图里有的；音频只挂给这一段说话的人；不写上半下半、分屏、一串"不要"。
// 为什么这么改：手册/0_V2写法.md；反面案例：反面案例/。
'use strict';
const fs = require('fs');
const path = require('path');
const { SrcError, noDot } = require('./parse.js');
const V1 = require('./compile.js');

const TPL = path.join(__dirname, '..', 'templates');
const readTpl = f => fs.readFileSync(path.join(TPL, f), 'utf8').replace(/\r\n/g, '\n');
const tpl = () => readTpl('V2.tpl').split('\n').filter(l => !l.startsWith('#!')).join('\n').replace(/\n+$/, '');
const actionTpl = () => {
  const r = {}; let k = null;
  for (const l of readTpl('动作质感_V2.txt').split('\n')) {
    if (l.startsWith('#') || !l.trim()) continue;
    const m = l.match(/^==\s*(.+?)\s*==$/);
    if (m) { k = m[1]; r[k] = []; continue; }
    if (k) r[k].push(l);
  }
  return r;
};
const fmt = c => String(c / 100);
const dot = s => (s ? noDot(s) + '。' : '');
const baseWho = w => w.replace(/'s inner voice.*$/i, '').trim();
const ZH = (cast, w) => (cast.cast[baseWho(w)] ? cast.cast[baseWho(w)].kv['名'] : baseWho(w));

// 机位术语库（2026-11-24，用户给的 34 个）：镜头里写"术语: 过肩视角、前景遮挡"，这里展开成固定写法
let TERMS = null;
const termLib = () => { if (TERMS) return TERMS; const j = JSON.parse(readTpl('机位术语.json')); TERMS = { by: {}, alias: j['别名'] || {} }; for (const t of j['术语']) TERMS.by[t['名']] = t; return TERMS; };
function findTerms(seg, s) {
  return (s.terms || []).map(x => {
    const L = termLib(); const t = L.by[x] || L.by[L.alias[x]];
    if (!t) throw new SrcError(seg.file, s.line, `机位术语库里没有"${x}"（手册 8）。能用的：${Object.keys(L.by).join('、')}`);
    return t;
  });
}

function stateLine(cast, key, o) {
  const name = cast.cast[key] ? cast.cast[key].kv['名'] : key;
  return `${name}：${[o.posture, o.place, o.hands, o.facing].filter(x => x && !/^(无|—|-)$/.test(x.trim())).map(noDot).join('，')}。`;
}

function renderShots(seg, scene, lang, cast) {
  let c = 0; const cuts = []; const out = []; let lines = 0; let lastSayEnd = null; const info = []; const tilt = [];
  seg.shots.forEach((s, i) => {
    const d = scene.dirs[s.dir];
    if (!d) throw new SrcError(seg.file, s.line, `镜头"${s.title}"用了方向${s.dir}，场景卡"${scene.name}"里没有这个方向（只有 ${Object.keys(scene.dirs).join('、')}）`);
    const a = c; const beats = []; const tm = findTerms(seg, s);
    const si = { en: 0, zh: 0, say: 0, pre: 0, post: 0 };
    for (const b of s.beats) {
      const x = c; c += Math.round(b.dur * 100);
      if (b.dur <= 0) throw new SrcError(seg.file, b.line, '这一拍的秒数要大于 0');
      const t = `${fmt(x)}–${fmt(c)}`;
      if (b.say) { si.en += (b.say.line.match(/[A-Za-z']+/g) || []).length; si.zh += (b.say.line.match(/[一-鿿]/g) || []).length; si.say += c - x; si.post = 0; }
      else if (si.say) si.post += c - x; else si.pre += c - x;
      if (b.say) {
        lines++; lastSayEnd = c;
        beats.push(`${t}s：${b.during || ZH(cast, b.say.who) + '开口，其余人嘴唇合着。'}`);
        if (b.say.emo) beats.push(`Emotion order, ${V1.EMO.phrase[b.say.emo.level]}: ${b.say.emo.text.replace(/[.。\s]+$/, '')}.`);
        beats.push(`Dialogue: ${t}s, ${b.say.who}, to ${b.say.whom}, in ${lang}, ${b.say.tone}: {${b.say.line}}`);
      } else beats.push(`${t}s：${b.text}`);
    }
    if ((c - a) % 10) throw new SrcError(seg.file, s.line, `镜头"${s.title}"的各拍加起来是 ${fmt(c - a)} 秒：切点最细到 0.1 秒，常用整秒或半秒`);
    out.push(`镜头${i + 1}｜${fmt(a)}–${fmt(c)}s｜${s.title}`, `机位：${s.size}${tm.length ? '，' + tm.map(x => x['名']).join('、') + '（' + tm.map(x => x['英文']).join('; ') + '）' : ''}｜${d.name}｜${s.cam}`);
    if (tm.length) out.push('拍法：' + tm.map(x => x['句']).join('；') + '。');
    out.push(`运镜：${s.move}`);
    for (const x of tm) if (x['标记'].includes('tilt')) tilt.push(i + 1);
    if (s.comp) out.push(`构图：${s.comp}`);
    if (s.lit || s.light) out.push(`光影：${s.lit || s.light}`);
    out.push(...beats);
    if (s.fx) out.push(`现场特效：${s.fx}`);
    if (s.endf) out.push(`落幅：${s.endf}`);
    out.push(`声音：${s.sound}`);
    if (i < seg.shots.length - 1) cuts.push(c / 100);
    info.push({ dur: (c - a) / 100, en: si.en, zh: si.zh, say: si.say / 100, pre: si.pre / 100, post: si.post / 100 });
  });
  return { text: out.join('\n'), cuts, total: c / 100, lines, lastSayEnd: lastSayEnd === null ? null : lastSayEnd / 100, info, tilt };
}

function compileSegmentV2(seg, ctx) {
  const { bible, ep, scenes, cast } = ctx;
  const scene = scenes.scenes[seg.scene];
  if (!scene) throw new SrcError(seg.file, 0, `场景卡里没有"${seg.scene}"这一场（有：${scenes.order.join('；')}）`);
  const usedDirs = []; for (const s of seg.shots) if (!usedDirs.includes(s.dir)) usedDirs.push(s.dir);
  const sh = renderShots(seg, scene, bible.lang, cast);
  const k = scene.kv;
  const speakers = new Set(seg.shots.flatMap(s => s.beats.filter(b => b.say).map(b => baseWho(b.say.who))));

  // 场景与方位
  const sceneBlock = [
    `${scene.place} ${k['总览图']} ：外形照参考图，不采用参考图的光线和CG质感；${noDot(k['总览说明'] || '总览图是同一个地方的几个视角，取它的结构、材质、灯的位置和方位')}；构图和光线以每个镜头写的为准。${dot(k['时间'])}${dot(k['成片里'] || '画面里只有本段写到的人')}`,
    dot(k['总览']),
    ...usedDirs.map(n => { const d = scene.dirs[n]; if (!d) return ''; return `${d.name}：${dot(d.kv['背景'])}${dot(d.kv['光'])}`; }),
  ].filter(Boolean).join('\n');

  // 人物与道具
  const rows = seg.people.map(p => {
    const c = cast.cast[p.key];
    if (!c) throw new SrcError(seg.file, p.line, `人物卡里没有"${p.key}"`);
    const isProp = (c.kv['类型'] || '人') === '道具';
    const au = !isProp && c.kv['音频'] && speakers.has(p.key) ? c.kv['音频'] + ' ' : '';
    return `${c.kv['名']} ${c.kv['图']} ${au}：外形照参考图，不采用参考图的${isProp ? '光线和背景' : '光线、背景、姿势和CG质感'}；${dot(c.kv['固定'])}${dot(p.text)}`;
  });
  for (const x of Object.keys(seg.open)) if (!seg.people.some(p => p.key === x) && cast.cast[x]) throw new SrcError(seg.file, seg.open[x].line, `"开场"写了 ${x}，但这一段的"人"里没有他`);

  const openKeys = Object.keys(seg.open);
  if (!openKeys.length) throw new SrcError(seg.file, 0, 'V2 每段都要写"开场"（人物 | 姿态 | 位置 | 手里的东西 | 朝向）：它就是【承接画面】，要和上一段的收场一样');
  const open = openKeys.map(x => stateLine(cast, x, seg.open[x]));
  const closeKeys = [...new Set([...openKeys, ...Object.keys(seg.close)])];
  const close = closeKeys.map(x => stateLine(cast, x, seg.close[x] || seg.open[x]));
  if (seg.kv['结束']) close.push('画面：' + dot(seg.kv['结束']));

  // 动作质感
  const expandFx = s => (s || '').replace(/@@特效[:：](.+?)@@/g, (_, x) => {
    const d = bible.effects[x.trim().toLowerCase()];
    if (!d) throw new SrcError(seg.file, 0, `剧设定里没有触发词是"${x}"的特效定义`);
    return d;
  });
  const who = (seg.kv['险情谁'] || '受惊').trim();
  const hf = V1.HAZARD_FACE[/动手|施害/.test(who) ? '动手' : '受惊'];
  const raw = key => { for (const src of [seg.kv, scene.kv, ep.kv]) if (key in src && src[key] !== '') return expandFx(src[key]); return undefined; };
  const missing = new Set();
  const fill = (line, extra) => line.replace(/\[\[(.*?)\]\]/g, (_, inner) => {
    let empty = false; const r = inner.replace(/\{\{(.+?)\}\}/g, (__, x) => { const v = (extra && extra[x]) || raw(x); if (!v) empty = true; return v || ''; });
    return empty ? '' : r;
  }).replace(/\{\{(.+?)\}\}/g, (_, x) => { const v = (extra && extra[x]) || raw(x); if (!v) { missing.add(x); return ''; } return v; });
  const act = [];
  if (seg.mode === '武戏' || seg.mode === '险情') {
    for (const l of actionTpl()[seg.mode]) act.push(fill(l, { '@险情三层': hf[0], '@险情表情': hf[1] }));
    if (k['动作特效']) act.push(...expandFx(k['动作特效']).split('\n').map(x => x.trim()).filter(Boolean));
    else if (k['特效规范']) act.push(...expandFx(k['特效规范']).split('\n').map(x => x.trim()).filter(x => /^\d+\./.test(x) && +x.match(/^(\d+)/)[1] >= 3).map(x => x.replace(/^\d+\.\s*/, '')));
  }
  if (seg.kv['动作质感']) act.push(expandFx(seg.kv['动作质感']));

  const change = [seg.kv['战损开场'] && `开场时${noDot(seg.kv['战损开场'])}`, seg.kv['战损新增'] && noDot(seg.kv['战损新增']), seg.kv['状态'] && noDot(seg.kv['状态'])].filter(Boolean).join('；');
  if (!change) missing.add('状态');
  const eye = seg.kv['机位视线'] || [seg.kv['空间'], seg.kv['视线']].filter(Boolean).join(' ');
  if (!eye) missing.add('机位视线');
  const n = sh.lines;
  const decl = n === 0 ? `这一条的人声只有${seg.kv['人声'] || '喘息、抽泣和痛哼'}这类不带词的声音。`
    : `${/English/.test(bible.lang) ? 'ENGLISH ONLY' : 'SPOKEN LANGUAGE'}: every spoken word is in ${bible.lang}; background people make only wordless sounds (${raw('背景声词') || 'gasps, breath, laughter'}). ${n === 1 ? 'This clip has one line,' : `This clip has ${(V1.NUM[n] || String(n)).toLowerCase()} lines, each`} spoken once, word for word, by the person named; only the speaker's lips move; nobody says anything else.`;
  const small = /^收/.test(seg.kv['表演档'] || '');
  const computed = {
    '@集': ep.kv['集'], '@段名': seg.kv['名'] || `段${seg.n}`, '@风格锁': (k['风格锁'] || bible.style).trim(), '@颜色句': k['颜色句'] || bible.color,
    '@特效固定1': bible.fx1, '@特效固定2': bible.fx2, '@胶片后半': bible.film, '@结尾固定': k['结尾'] || bible.ending,
    '@片头': `竖屏 9:16，全长 ${sh.total} 秒，${seg.shots.length} 个镜头${sh.cuts.length ? '，硬切在 ' + sh.cuts.join('、') + ' 秒。' : '，一镜到底。'}`,
    '@场景块': sceneBlock, '@人物块': rows.join('\n'), '@承接': open.join('\n'), '@结束': close.join('\n'), '@人物句': seg.acts.join('\n'),
    '@大表演': !small && seg.mode !== '险情' ? '1' : '', '@小表演': small && seg.mode !== '险情' ? '1' : '', '@台词声明': decl, '@机位视线': dot(eye).replace(/\.。$/, '. '), '@动作质感': act.join('\n'),
    '@变化': change + '。', '@镜头': sh.text, '@有台词': n ? '1' : '',
    '@声音': `全程现场同期声：${n ? '对白清楚地在最前面，后面是' : ''}${noDot(raw('环境声') || '')}，加上每一镜写明的动作声；远近分得清，近的清楚、远的轻。无配乐，无字幕。`,
  };
  if (!raw('环境声')) missing.add('环境声');
  const lookup = x => (x in computed ? computed[x] : raw(x));
  const out = [];
  for (let line of tpl().split('\n')) {
    const cond = line.match(/^\?\((.+?)\)(.*)$/);
    if (cond) { const v = lookup(cond[1]); if (v === undefined || v === '') continue; line = cond[2]; }
    out.push(line.replace(/\{\{(.+?)\}\}/g, (_, expr) => {
      const [x, def] = expr.split('|'); let v = lookup(x.trim());
      if ((v === undefined || v === '') && def !== undefined) v = def;
      if (v === undefined || (v === '' && !(x.trim() in computed))) { missing.add(x.trim()); return ''; }
      return v;
    }));
  }
  if (missing.size) throw new SrcError(seg.file, 0, `${seg.mode}这一段还缺：${[...missing].join('、')}（写在段落源里；整场戏都一样的写在场景卡里）`);
  let text = out.filter((l, i, a) => l.trim() || i === a.length - 1).join('\n') + '\n';
  // 用了荷兰角：模板里"地平线是平的"那两句改成"除了镜头 N"
  if (sh.tilt.length) text = text.replace('完整竖幅画面，地平线是平的。', `完整竖幅画面；除了镜头${sh.tilt.join('、')}故意倾斜约十五度，地平线都是平的。`)
    .replace('The camera is always level and the right way up, gravity pulling down, heads above feet.', `The camera is level and the right way up except for the deliberate tilt in shot ${sh.tilt.join(', ')}; gravity always pulls down, heads above feet.`);
  const refs = text.match(/@[^\s：:，,；;）)]+/g) || [];
  return { text, total: sh.total, shots: seg.shots.length, lines: n, dirs: usedDirs, cuts: sh.cuts, lastSayEnd: sh.lastSayEnd, shotInfo: sh.info, sceneBlock, count: text.replace(/\n+$/, '').length + refs.length, refs: [...new Set(refs)], sceneChars: sceneBlock.length, fixedChars: bible.style.length, speakers: [...speakers] };
}

module.exports = { compileSegmentV2, findTerms };
