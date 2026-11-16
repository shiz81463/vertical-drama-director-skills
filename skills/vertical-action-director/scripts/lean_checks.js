// v3（2026-11-08，11-09 改）：N 字数区间和去重、Q 台词保护的自动检查。竖屏文戏、竖屏武戏两个 check_prompt.js 共用这一份。
// 依据：用户实测提示词约 8,000 字时台词基本说对；《320磅》前十集 85 段语音识别对照（≥15,000 字的段台词缺 30%，<15,000 字缺 1%；缺台词的 27 段里 26 段在 14,850 字以上）。
// 用户 2026-11-09：字数不定死，给一个区间。区间里 ✅，偏短、偏长 ⚠️，只有到了台词开始成片丢的那条线才 ❌。
// 用法：在 check_prompt.js 里 require('./lean_checks.js')({ ... })；命令行可加 --budget 11000（总控把区间上限放宽）。
'use strict';

module.exports = function leanChecks(o) {
  const { t, body, add, lock, shots, endingStart, assetLines, mode, argv, findAll, ctx, short } = o;
  const budgetArg = argv.includes('--budget') ? +(argv[argv.indexOf('--budget') + 1] || 0) : 0;
  const lines = t.split('\n');
  const dlgLines = lines.filter(l => /^Dialogue:/.test(l));
  const zhDlg = lines.filter(l => !/^Dialogue:/.test(l) && /说[：:]\s*\{[^{}]+\}/.test(l));
  const allDlg = [...dlgLines, ...zhDlg];
  const dlgTexts = allDlg.map(l => (l.match(/\{([^{}]+)\}/) || [])[1] || '').filter(Boolean);
  const hasDlg = dlgTexts.length > 0;
  const hazard = /STEADY HAZARD:/.test(t);

  // ---------- N1 字数区间 ----------
  const refs = (t.match(/@[^\s：:，,；;）)]+/g) || []).length;
  const count = t.length + refs;
  let lo, hi, failAt, why;
  if (!hasDlg) { lo = 7000; hi = 12000; failAt = 20000; why = '没有台词的段：区间 7,000–12,000，再长最后一镜容易演不到；平台上限 20,000'; }
  else if (mode === '武戏' || hazard) { lo = 7000; hi = 11000; failAt = 14000; why = '有台词的打戏/险情段：区间 7,000–11,000（特效段有验证过的 2,000 字下限）；过了 14,000 台词开始成片丢'; }
  else { lo = 7000; hi = 10000; failAt = 14000; why = '有台词的文戏段：区间 7,000–10,000（用户实测 8,000 左右台词说得对）；过了 14,000 台词开始成片丢'; }
  if (budgetArg > 0) { hi = budgetArg; if (failAt < budgetArg) failAt = budgetArg; why += `；总控把区间上限放到 ${budgetArg}（写进设计单）`; }

  // 每块多少字，给出最该砍的地方
  // 参考上限（5 镜、4 条资产行、风格锁约 700 字的段）；总数是硬线，单块只是指路
  const marks = [['【全局视觉风格】', '风格锁', 0], ['【画面质感', '画面质感', 150], ['【实拍', '光影/特效规范', mode === '武戏' ? 3000 : 2000], ['ASSET', '资产行', 700], ['【场景', '场景', 120], ['【主体规则', '主体规则', 400], ['【体型与比例', '体型与比例', 900], ['【人物与表演', '人物与表演', 650], ['【打斗', '打斗', 1500], ['【空间与视线', '空间与视线', 420], ['【戏的逻辑', '戏的逻辑', 220], ['【镜头衔接', '镜头衔接', mode === '武戏' ? 1400 : 850], ['【本段状态】', '本段状态', 180], ['【本段战损】', '本段战损', 300], ['镜头1｜', '镜头（全部）', mode === '武戏' ? 3000 : 2300], ['【结束状态】', '结束状态', 160], ['严禁字幕', '结尾', 200]];
  const firstAsset = assetLines.length ? t.indexOf(assetLines[0]) : -1;
  const pos = marks.map(([m, name, lim]) => ({ name, lim, p: m === 'ASSET' ? firstAsset : t.indexOf(m) })).filter(x => x.p >= 0).sort((a, b) => a.p - b.p);
  const sizes = pos.map((x, i) => ({ ...x, n: (i + 1 < pos.length ? pos[i + 1].p : t.length) - x.p }));
  const over = sizes.filter(x => x.lim && x.n > x.lim).sort((a, b) => (b.n - b.lim) - (a.n - a.lim));
  const sizeLine = sizes.map(x => `${x.name} ${x.n}${x.lim ? '/' + x.lim : ''}`).join('，');
  if (count > failAt) add('fail', 'N1', `平台计数约 ${count}，超过 ${failAt}（${why}）。按 rules.md N4 的顺序砍；台词、固定句、验证过的特效句（含 Restraint）不砍`, [sizeLine, ...over.slice(0, 4).map(x => `超得最多：${x.name} ${x.n} 字，参考上限 ${x.lim}`)]);
  else if (count > hi) add('warn', 'N1', `平台计数约 ${count}，比区间上限 ${hi} 长：在回复里说明为什么，能按 N4 砍的先砍（${why}）`, [sizeLine]);
  else if (count < lo) add('warn', 'N1', `平台计数约 ${count}，比区间下限 ${lo} 短：查一下有没有砍到验证过的句子（剧设定特效定义、Restraint、固定句）或者表演信号；没砍到就在回复里一句话说明`, [sizeLine]);
  else add('pass', 'N1', `平台计数约 ${count}，在区间 ${lo}–${hi} 里（字数 ${t.length} + @引用 ${refs}；${why}）`);
  if (count > hi && count <= failAt && over.length) add('warn', 'N3', '比区间长时先看这几块（参考上限，只是指路）', over.slice(0, 5).map(x => `${x.name} ${x.n} 字，参考 ${x.lim}`));

  // ---------- X 场景卡（v4，2026-11-09）：每镜有方向，方向有背景图和光句；跨段一致用 check_scene.js ----------
  {
    const plateDirs = new Set(), facingDirs = new Set();
    lines.forEach(l => { let m = l.match(/^方向(\d+)背景 @\S+ ?：/); if (m) plateDirs.add(m[1]); m = l.match(/^FACING (\d+)\b/); if (m) facingDirs.add(m[1]); });
    const shotDirs = (shots || []).map(s => ({ n: s.n, d: (((s.text || '').match(/^\[[^\]\n]*\]/m) || [''])[0].match(/方向\s*(\d+)/) || [])[1] }));
    if (!plateDirs.size) add('warn', 'X1', 'v4：没有场景卡（方向背景图资产行、每镜"方向N"、FACING 光句）。同一场戏有好几段时，背景和光会段段不一样（rules.md X 节）');
    else {
      const noDir = shotDirs.filter(s => !s.d).map(s => s.n);
      const noPlate = shotDirs.filter(s => s.d && !plateDirs.has(s.d)).map(s => `镜${s.n}→方向${s.d}`);
      const used = new Set(shotDirs.filter(s => s.d).map(s => s.d));
      const noFacing = [...used].filter(d => !facingDirs.has(d));
      if (noDir.length) add('fail', 'X4', `镜 ${noDir.join('、')} 的机位方括号没写"方向N"`);
      if (noPlate.length) add('fail', 'X4', `用了没有背景图资产行的方向：${noPlate.join('、')}`);
      if (noFacing.length) add('fail', 'X5', `用了方向 ${noFacing.join('、')}，【实拍光影规范】里没有对应的 FACING 光句`);
      const unusedP = [...plateDirs].filter(d => !used.has(d)), unusedF = [...facingDirs].filter(d => !used.has(d));
      if (unusedP.length || unusedF.length) add('warn', 'X2', `方向 ${[...new Set([...unusedP, ...unusedF])].join('、')} 写了背景图或光句，但没有一镜用：删掉省字`);
      // X10 逆光方向：光句里写"脸被照得低、暗"，和剧设定"每张脸按主角打光"打架，模型每段选一边（第 29 集段 9 亮、段 10 暗）
      const vague = lines.filter(l => /^FACING \d/.test(l) && /faces?[^.;]{0,60}\b(lit low|low and soft|dim|dimly|in shadow|in darkness|unlit|barely lit|dark)\b/i.test(l));
      if (vague.length) add('warn', 'X10', '光句里写了"脸暗、脸被照得低"：和剧设定"每张脸按主角打光"打架，模型每段选一边，同一个方向的脸会一段亮一段暗。逆光的方向也写清脸的主光：从画面哪边来、来源是什么、和别的方向的脸一样亮', vague.map(l => l.slice(0, 60)));
      if (!noDir.length && !noPlate.length && !noFacing.length) add('pass', 'X4', `每镜都有方向，方向 ${[...used].join('、')} 都有背景图和光句；同一场各段一致用 check_scene.js 查`);
    }
  }

  // ---------- N2 一件事只说一次 ----------
  const dup = [];
  if (/Faces up close are real skin/i.test(body) && /毛孔|真实活人皮肤|皮肤纹理/.test(lock)) dup.push(['fail', '删掉 "Faces up close are real skin…" 整条：风格锁里已经写了真实皮肤（毛孔等）']);
  if (/normal human eyes that never glow/i.test(t) && /发光眼睛|眼睛发光/.test(lock)) dup.push(['warn', '"normal human eyes that never glow" 可以删：风格锁负面词里已经有"发光眼睛"']);
  const endBlock = endingStart >= 0 ? t.slice(endingStart) : '';
  const endEn = endBlock.match(/No CGI look[^.]*\.|no glowing eyes[^.]*\.|No slow motion\.|No music, no subtitles\.|no plastic skin[^.]*\./gi) || [];
  if (endEn.length && /严禁字幕|不生成BGM|全片实速|负面提示词/.test(endBlock + lock)) dup.push(['fail', '结尾的英文禁止项和中文固定句、风格锁负面词重复，删掉：' + [...new Set(endEn.map(x => short(x, 30)))].join(' / ')]);
  const onceN = (t.match(/appears (exactly|only) once/g) || []).length;
  if (onceN > 1) dup.push(['warn', `"appears exactly/only once" 写了 ${onceN} 次：资产行已经逐个写"成片里只有一个"，英文全段只留一句`]);
  // 完全相同的英文长句出现两次
  const sents = body.split(/(?<=[.;!?])\s+|\n/).map(s => s.trim()).filter(s => s.length >= 50 && /[A-Za-z]{4}/.test(s));
  const seen = new Map(); const twice = new Set();
  for (const s of sents) { const k = s.toLowerCase().replace(/[^a-z ]/g, ''); if (seen.has(k)) twice.add(s); else seen.set(k, 1); }
  if (twice.size) dup.push(['fail', '同一句英文出现了两次：' + [...twice].slice(0, 3).map(s => short(s, 50)).join(' / ')]);
  // 【场景】只写地点、时间、整段不换地点；站位放在 SPACE
  const sceneBlock = (t.match(/【场景[^】]*】\n([\s\S]*?)(?=\n【)/) || [])[1] || '';
  if (sceneBlock.length > 220) dup.push(['warn', `【场景】有 ${sceneBlock.length} 字：站位、距离写在【空间与视线】的 SPACE 里，【场景】只写"地点照参考图、什么时候、整段不换地点"和没有资产图的群演长相`]);
  // 每镜 Light 行重复光影规范
  const fxBlock = (() => { const a = t.search(/【实拍/); return a >= 0 ? t.slice(a, firstAsset > a ? firstAsset : undefined).toLowerCase() : ''; })();
  const lightRep = [];
  for (const s of shots || []) {
    const lt = (s.text.match(/^(Light|Practical effects):([^\n]*)/m) || [])[2] || '';
    const w = lt.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i + 8 <= w.length; i++) { if (fxBlock.includes(w.slice(i, i + 8).join(' '))) { lightRep.push(s.n); break; } }
  }
  if (lightRep.length) dup.push(['warn', `镜 ${lightRep.join('、')} 的 Light/Practical effects 行抄了光影规范里的句子：这一行只写这一镜光在脸上的变化，没变化就删掉 Light 行`]);
  if (dup.length) for (const [lv, msg] of dup) add(lv, 'N2', msg);
  else add('pass', 'N2', '没发现中英重复、同句重复');

  // ---------- Q 台词保护 ----------
  if (!hasDlg) { add('pass', 'Q', '这一段没有台词'); return; }
  // Q2 台词原文全段只出现一次
  const norm = s => s.toLowerCase().replace(/[^a-z0-9一-鿿' ]/g, ' ').replace(/\s+/g, ' ').trim();
  const dn = dlgTexts.map(norm);
  const quoteHits = [];
  lines.forEach((l, i) => {
    if (/^Dialogue:/.test(l) || /说[：:]\s*\{/.test(l)) return;
    for (const m of l.matchAll(/["“‘']([^"”’']{2,80})["”’']/g)) {
      const f = norm(m[1]);
      if (f.length >= 2 && dn.some(d => d.includes(f) && (f.split(' ').length >= 1))) { quoteHits.push(`第${i + 1}行：…${short(l.slice(Math.max(0, m.index - 30)), 70)}`); return; }
    }
    // 不带引号、连续 4 个词以上照抄台词
    const ln = norm(l);
    for (const d of dn) {
      const w = d.split(' ');
      if (w.length < 4) continue;
      for (let k = 0; k + 4 <= w.length; k++) { if (ln.includes(w.slice(k, k + 4).join(' '))) { quoteHits.push(`第${i + 1}行：…${short(l, 70)}`); return; } }
    }
  });
  if (quoteHits.length) add('fail', 'Q2', `台词原文在 Dialogue 行以外又出现了 ${quoteHits.length} 处：逐拍、状态、结束状态、戏的逻辑里不引用台词，改成"她开口时 / 这句说完时 / 她的回答"（台词出现两次，模型会多念、念乱）`, quoteHits.slice(0, 6));
  else add('pass', 'Q2', `台词原文只在台词行里出现（${dlgTexts.length} 句）`);
  // Q3 台词句数声明
  const W = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const decl = t.match(/only these (\w+) lines?/i);
  if (!decl) add('warn', 'Q3', `有 ${dlgTexts.length} 句台词，没写台词句数声明："This segment has only these ${dlgTexts.length} lines, each spoken once, word for word, by the person named; nobody says anything else."`);
  else {
    const n = /^\d+$/.test(decl[1]) ? +decl[1] : W[decl[1].toLowerCase()];
    if (n !== dlgTexts.length) add('fail', 'Q3', `台词句数声明写 ${decl[1]}，实际 ${dlgTexts.length} 句`);
    else add('pass', 'Q3', `台词句数声明和实际一致：${n} 句`);
  }
  // Q4 每句写起止秒
  const noRange = dlgLines.filter(l => !/^Dialogue:\s*[\d.]+\s*[–-]\s*[\d.]+\s*s\b/.test(l));
  if (noRange.length) add('warn', 'Q4', `${noRange.length} 句台词没写起止秒（写成 "Dialogue: 4–6s, 谁, to 谁, in American English, 语气: {台词}"，紧跟在说这句的那一拍后面）`);
  else if (dlgLines.length) add('pass', 'Q4', '每句台词都写了起止秒');
  // Q5 最后一句不压在段尾
  if (shots && shots.length) {
    const total = shots[shots.length - 1].b;
    const lastL = dlgLines[dlgLines.length - 1] || '';
    const r = lastL.match(/^Dialogue:\s*([\d.]+)\s*[–-]\s*([\d.]+)\s*s\b/);
    if (r && total - +r[2] < 1) add('warn', 'Q5', `最后一句台词说到 ${r[2]}s，离段尾 ${total}s 不到 1 秒：留 1 秒给听的人反应或停住（长提示词里最后一句丢得最多）`);
  }
  // Q8 语气别写太长；不写话题词靠人工
  const longTone = dlgLines.filter(l => l.slice(0, l.indexOf('{')).length > 170);
  if (longTone.length) add('warn', 'Q8', `${longTone.length} 句台词前面的说明太长（超过 170 字）：说话人、对谁、语言、语气一句写完，语气不超过 10 个英文词`, longTone.slice(0, 3).map(l => short(l, 90)));
  // 语言
  const noLang = dlgLines.filter(l => !/English|Mandarin|Chinese|Cantonese|英语|普通话|中文/i.test(l.slice(0, l.indexOf('{'))));
  if (noLang.length) add('warn', 'Q6', `${noLang.length} 句台词前面没写用什么语言说（每句都写 in American English；官方指南：多名说话人分别标注）`);
};
