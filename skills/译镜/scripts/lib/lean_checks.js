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
  if (sceneBlock.length > 220) {
    // v5.1：场景卡格式的【场景】块里有 地图 / 站位 / 不入画，报出哪一行最长、怎么压
    const part = k => ((sceneBlock.match(new RegExp('^' + k + '：(.*)$', 'm')) || [])[1] || '').length;
    const [m1, m2, m3] = [part('地图'), part('站位'), part('不入画')];
    if (m1 + m2 + m3 > 0) dup.push(['warn', `【场景】有 ${sceneBlock.length} 字，参考上限 220（地图 ${m1}、站位 ${m2}、不入画 ${m3}）：这三行是从场景卡贴来的，改场景卡——地图一两句、站位只写主要人物、不入画只写这场真会拍到的，合起来 190 字以内；某一镜、某一段才有的安排写到那一段的"空间"里`]);
    else dup.push(['warn', `【场景】有 ${sceneBlock.length} 字：站位、距离写在【空间与视线】的 SPACE 里，【场景】只写"地点照参考图、什么时候、整段不换地点"和没有资产图的群演长相`]);
  }
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

  // ---------- T 表演（满血版，规则在 表演/rules_表演.md） ----------
  {
    const people = (t.match(/【人物与表演[^】]*】\n([\s\S]*?)(?=\n【)/) || [])[1] || '';
    const hasPeopleBlock = /【人物与表演/.test(t);
    if (hasPeopleBlock && !/[A-Za-z][\w .'-]{0,30} \([一-鿿·]{1,8}\)/.test(people)) add('warn', 'T2', '【人物与表演】里没有"英文称呼 (中文名): …"这一句：每个在场的人从人物表演档案里挑一句（T1、T2）');
    else if (hasPeopleBlock) add('pass', 'T2', '【人物与表演】里有每人一句的档案句');
    if (mode === '武戏' && !/FACES:/.test(t)) add('warn', 'T13', '【打斗】里没写 FACES 那一句（大招前憋气、挨打三层、害怕看哪），见骨架');
    // T12 表演坑词
    const tics = [
      [/\bsmirk(s|ing|ed)?\b/i, 'smirk → one corner of her mouth lifts and stays'],
      [/\bglar(e|es|ing|ed)\b/i, 'glare → his eyes hold on her without blinking'],
      [/\brolls? (her|his|their) eyes\b|\beye-?roll/i, 'rolls her eyes → her eyes slide away and back'],
      [/\bgrin(s|ning|ned)?\b|\bbeam(ing|ed)\b|\bbeams? (at|up at|with)\b/i, 'grins / beams → a smile reaches her eyes'],
      [/\b(shocked|stunned|surprised) (expression|look|face)\b/i, 'shocked expression → her eyes widen a fraction and her breath stops'],
      [/\bnods? (repeatedly|again and again)\b|\bkeeps? nodding\b/i, 'nods repeatedly → one small nod'],
      [/\b(trembl(es|ing)|shak(es|ing)) all over\b|\bwhole body (trembles|shakes)\b/i, 'trembles all over → the hand holding the glass is not quite steady'],
      [/\btears? stream(s|ing)?\b|\bstreaming tears\b/i, 'tears streaming → the rims of her eyes go wet（写进本段状态）'],
      [/\bburst(s)? out laughing\b|\blaughs? (loudly|hard|out loud)\b/i, 'laughs loudly → a breath of a laugh through the nose'],
      [/\bfreez(es|ing)\b|\bfrozen\b/i, 'freezes → goes still except for her breath'],
      [/\bstar(es|ing) blankly\b|\bblank stare\b/i, 'stares blankly → her eyes rest on <东西>, unblinking'],
    ];
    const ticHits = [];
    for (const [re, fix] of tics) { const m = body.match(re); if (m) ticHits.push(`${m[0]}：${fix}`); }
    if (ticHits.length) add('warn', 'T12', '用了 AI 表演的坑词（模型会演成卡通、面具脸或定格），照表改', ticHits);
    else add('pass', 'T12', '没有表演坑词');
    // T6 台词语气写声音，不写情绪副词
    const advLines = lines.filter(l => /^Dialogue:/.test(l) && /\b(angrily|sadly|happily|nervously|excitedly|anxiously|furiously|jealously|bitterly|lovingly)\b/i.test(l.slice(0, l.indexOf('{'))));
    if (advLines.length) add('warn', 'T6', '台词语气里写了情绪副词（angrily、sadly……）：改写声音的快慢、音量、音色，加一个意图短语', advLines.slice(0, 3).map(l => short(l, 90)));
    // T9 3 档的词出现在两个以上镜头
    const lv3 = /\btears? (spill|fall|run)\b|\bsobs?\b|\bscreams?\b|\bshouts?\b|\bvoice (breaks|cracks)\b|\bstumbles? back\b|\bslaps?\b/i;
    const lv3Shots = (shots || []).filter(s => lv3.test(s.text.split('\n').filter(l => !/^Dialogue:/.test(l)).join(' '))).map(s => s.n);
    if (lv3Shots.length > 1) add('warn', 'T9', `镜 ${lv3Shots.join('、')} 都有 3 档（破）的表演：一段最多一次，就在情绪最高的那一拍；同一时刻最多一个人在 3 档`);
    // T4 台词说完以后有没有留一拍
    const after = [];
    for (const s of shots || []) {
      const sl = s.text.split('\n');
      sl.forEach((l, i) => {
        const r = l.match(/^Dialogue:\s*([\d.]+)\s*[–-]\s*([\d.]+)\s*s\b/);
        if (!r) return;
        const next = (sl.slice(i + 1).find(x => x.trim()) || '');
        const isBeat = /^[\d.]+(?:[–-][\d.]+)?s: /.test(next);
        if (!isBeat && s.b - +r[2] >= 0.5) after.push(`镜${s.n}：台词说到 ${r[2]}s，镜头到 ${s.b}s，中间没写说完以后的那一拍`);
      });
    }
    if (after.length) add('warn', 'T4', '台词说完、切镜之前，没写说的人和听的人的反应（说后那一拍）', after);

    // ---------- v5.1（2026-11-11，GPT 试写第 29 集暴露的三样）----------
    // T14 画外的人：逐拍里写了画外的人在做什么。观众看不见，模型可能把人拉进画面
    const beatLines = lines.filter(l => /^[\d.]+(?:\s*[–-]\s*[\d.]+)?\s*s: /.test(l));
    // "声音从画外来"（the voice comes from off-screen、画外音）是正常写法，不算
    const voiceOff = /\b(from|coming from|comes from) off-?(screen|camera|frame)\b|\boff-?(screen|camera|frame) (voice|sound|laughter|applause|line)\b|画外音/gi;
    const offHits = beatLines.filter(l => /\boff-?screen\b|\boff-?camera\b|\boff-?frame\b|画外/i.test(l.replace(voiceOff, '')));
    if (offHits.length) add('warn', 'T14', `逐拍里有 ${offHits.length} 处写了画外（offscreen）的人：观众看不见，模型可能把他拉进画面。听的人不在这一镜里就不写他，或者只写画面里看得到的那一部分（压在下角的虚肩）；看向画外的谁，写 looks screen-LEFT / screen-RIGHT`, offHits.slice(0, 4).map(l => short(l, 100)));
    else add('pass', 'T14', '逐拍里没有写画外的人在做什么');
    // T15 设计用的档位写进了提示词
    const lvHits = body.match(/\bintensity (level )?(\d|one|two|three)\b|\b(level|tier) [123] (intensity|performance)\b|强度\s*[123一二三]\s*档|[123]\s*档（?[收显破]/gi) || [];
    if (lvHits.length) add('warn', 'T15', `写了 ${lvHits.length} 处表演档位（${[...new Set(lvHits.map(x => x.toLowerCase()))].slice(0, 3).join(' / ')}）：1 收、2 显、3 破是给你设计用的，模型不认识。删掉，用动作的幅度写：1 档 a fraction / barely，2 档 clearly，3 档 breaks / cannot hold`);
    // T16 写给人看的备注进了提示词
    const noteZh = t.match(/不强(行)?指定|不限死|不写死|不强求|待确认|待定|见分镜|按分镜|照分镜|见上面|同上[，。；]/g) || [];
    const noteEn = body.match(/\b(as|the) specified\b|\bas written\b|\bthe written\b|\bper the (storyboard|script)\b|\bin the storyboard\b|\bTBD\b/gi) || [];
    const notes = [...new Set([...noteZh, ...noteEn.map(x => x.toLowerCase())])];
    if (notes.length) add('warn', 'T16', `有像是写给人看的备注（${notes.slice(0, 4).join(' / ')}）：模型看不到分镜、手册和你的考虑，只会照字面演。直接写画面里是什么；拿不准的数量就不写数量`);
  }

  // ---------- U（V1.1，2026-11-19）：E01 补拍审出来、脚本原来查不到的几样 ----------
  {
    // U1 看镜头：竖屏短剧里人看镜头 = 对观众说话；规则 F3 单人镜头视线擦着镜头边过去。用户 2026-11-19 定：禁止，主观镜头也不例外
    const lensRe = /\b(?:look(?:s|ed|ing)?|stare[sd]?|staring|gaz(?:e|es|ed|ing)|glanc(?:e|es|ed|ing)|eyes?|point(?:s|ed|ing)?)\b[^.;:,\n]{0,45}?\b(?:into|at|to|on|toward|towards)\s+the\s+(?:lens|camera)\b|\bfaces?\b[^.;:,\n]{0,25}?\bturned\s+(?:to|toward|towards)\s+the\s+(?:lens|camera)\b|看镜头|看向镜头|直视镜头|盯着镜头|对着镜头看|指着镜头|指向镜头/gi;
    // 否定的不算："不看镜头"（群演资产行）、"never looking toward the lens"（第 29 集段 2）
    const lensHits = [...body.matchAll(lensRe)].filter(m => {
      const pre = body.slice(Math.max(0, m.index - 12), m.index);
      return !/\b(beside|past|just off|away from|never|not)\b/i.test(m[0]) && !/\b(never|not|without|no|avoids?|avoiding)\s*$|n't\s*$/i.test(pre) && !/[不别没勿无]$/.test(pre);
    });
    if (lensHits.length) add('fail', 'U1', `有 ${lensHits.length} 处让人看镜头或指着镜头：竖屏短剧里人看镜头就是在对观众说话；规则 F3 要单人镜头的视线擦着镜头边过去，固定句也这么写，两句打架。改成 looks screen-LEFT / screen-RIGHT just beside the lens；从某人座位拍的主观镜头，也让对方看镜头旁边`, lensHits.slice(0, 5).map(m => '…' + ctx(body, m.index, 50) + '…'));
    else add('pass', 'U1', '没有人看镜头');
    // U2 同一个动作再放一遍：固定句 "no action restarts after a cut"，模型只会让人把动作再做一次（E01 段7：伊森摸了两次眉毛，暗号成了小习惯）
    const replay = findAll(/\breplay(?:s|ed|ing)?\b|\b(?:shows?|see|sees|seen)\s+(?:that|the)\s+same\s+[a-z]+(?:\s+[a-z]+)?\s+again\b|\bthe same (?:touch|gesture|move|movement|action|signal|motion)\b[^.;]{0,30}\bagain\b|\bagain,? (?:in slow motion|slowed down)\b|重放|回放|再放一遍|慢放一遍/i, body);
    if (replay.length) add('fail', 'U2', '写了把同一个动作再放一遍：固定句写着 no action restarts after a cut，模型只会让人把动作真的再做一次。想让观众从另一个人那边再看一遍，单独出一条补镜头、剪辑时插进去；这一段里这个动作只发生一次', replay.slice(0, 3).map(m => '…' + ctx(body, m.index, 50) + '…'));
    // U3 风格锁"一张脸一次只属于一种光"，光句却给一张脸打暖光再加冷光：模型每段挑一边，同一个方向的脸一段暖一段冷
    if (/一张脸一次只属于一种光|一张脸只属于一种光/.test(lock)) {
      const two = lines.filter(l => /^FACING \d/.test(l)).filter(l => {
        const cl = l.replace(/^FACING \d+[^:]*:\s*/, '').split(';');
        const warm = cl.some(c => /\b(warm|amber)\b/i.test(c) && /\b(keys?|keyed|face|faces)\b/i.test(c));
        const cold = cl.some(c => /\b(cold|cool|blue|steel)\b/i.test(c) && (/\b(face|faces|cheek|cheeks)\b/i.test(c) || (/\brims?\b/i.test(c) && !/\b(hair|shoulders?|coat|fur|collar|back|edges?|sleeves?)\b/i.test(c))));
        return warm && cold;
      });
      if (two.length) add('warn', 'U3', '风格锁写着"一张脸一次只属于一种光"，这几句光又给同一张脸打了暖光再加冷光：模型每段挑一边，同一个方向的脸会一段暖一段冷。冷光只落在头发、肩膀、衣服边上，或者这个方向的脸只用一种光（改场景卡的"光"）', two.map(l => short(l, 90)));
    }
    // U4 险情模板的固定句写的是受惊的人；这一段的人是动手的一方（E01 段1：文森特暴怒抡树）
    if (hazard && /the fear leaking out|FACES: fear shows first/.test(t)) {
      const people = (t.match(/【人物与表演[^】]*】\n([\s\S]*?)(?=\n【)/) || [])[1] || '';
      const rage = people.split('\n').filter(l => /^[A-Z][\w .'-]{0,30} \([一-鿿·]{1,8}\):/.test(l) && /\b(force|rage|anger|angry|fury|furious|burst|smash|wrath|violen)/i.test(l) && !/\b(fear|afraid|frighten|shock|panic|terrif)/i.test(l));
      if (rage.length) add('warn', 'U4', '险情模板的固定句写的是受惊的人（the fear leaking out；FACES: fear shows first…），这一段的人是动手的一方，模型可能把他演成害怕。在段落源写"险情谁: 动手"，脚本换成写怒气的那两句', rage.map(l => short(l, 80)));
    }
    // U5 一条片子的第一拍写了"切到"：模型可能先给一两帧别的画面再切
    const firstBeat = (t.match(/^镜头1｜[^\n]*\n(?:[^\n]*\n){0,3}?([\d.]+(?:[–-][\d.]+)?s: [^\n]*)/m) || [])[1] || '';
    if (/\b(?:hard |smash |jump )?cuts? (?:in )?to\b|切到|切入/i.test(firstBeat)) add('warn', 'U5', '第一镜第一拍写了"切到"（cut to）：一条片子从头生成，前面没有画面可切，模型可能先给一两帧别的再切。直接写画面里是什么', [short(firstBeat, 80)]);
    // U6 同一个英文词连写两遍（highlights highlights：场景卡"高光"多写了 highlights，或者剧设定和模板接重了）
    const dbl = findAll(/\b([A-Za-z]{4,})\s+\1\b/gi, body);
    if (dbl.length) add('warn', 'U6', '同一个英文词连着写了两遍：' + [...new Set(dbl.map(m => m[0]))].join('、') + '。是"高光"那一格的话，场景卡里只写一个词（bulb、practical），不写 highlights', dbl.slice(0, 3).map(m => '…' + ctx(body, m.index) + '…'));
  }

  // ---------- W 台词和情绪（V1.2，2026-11-20，手册 7）----------
  // 依据：《黑帮老大的圣诞礼物》第 29 集段 5 对照测试。E 组情绪写"适中、别演过头"，模板和表演里还有十来句往回收的词，演出来平；
  // F 组写"过"、扫掉这些词，情绪出来了。省略问句 "And the rest…?" 语气写 pushing on，说成了陈述。写法只测过这一段，全部只报 ⚠️
  if (hasDlg) {
    const toneOf = l => l.slice(0, l.indexOf('{'));
    const innerOf = l => (l.match(/\{([^{}]+)\}/) || [])[1] || '';
    const emoLines = lines.filter(l => /^Emotion order\b/.test(l));
    // W1 问句的语气往下压（读法 4）：flat、final、pushing on 这类词会把标记少的问句压成陈述
    const down = /\b(flat|flatly|final|firm|firmly|closing|pushing on|stating|as a statement|falls? at the end|drops? at the end)\b/i;
    const up = /\b(asking|as an? questions?|as questions|rising|rises|uncertain|pleading|in disbelief|not really asking)\b/i;
    const w1 = [];
    for (const l of dlgLines) {
      const tone = toneOf(l), q = /[?？]/.test(innerOf(l));
      if (q && down.test(tone) && !up.test(tone)) w1.push('台词里有问句，语气写了 ' + tone.match(down)[0] + '，没写尾音：' + short(innerOf(l), 50));
      if (!q && /\b(as an? question|as questions|rising at the end)\b/i.test(tone)) w1.push('语气写了问，台词框里没有问号：' + short(innerOf(l), 50));
    }
    if (w1.length) add('warn', 'W1', '问句和语气打架：问句（尤其没有疑问词的省略问、陈述语序问）句尾打问号，语气写尾音往哪走（rising at the end as a question / falling, not really asking），不用 flat、final、pushing on 往下压（手册 7 三.1）', w1);
    // W2 情绪档 显 以上，别处还在往回收（读法 3：同一个通道上的指令被平均，方向相反就抵消）。风格锁是用户原文，不扫
    if (emoLines.some(l => /^Emotion order, (strong|overwhelming)/.test(l))) {
      const scan = lock ? body.split(lock).join('') : body;
      const pull = /\bnever overplayed\b|\brestrained\b|\bsmall (?:physical )?signals\b|\bthen control\b|\bkeeps? (?:it|the feeling|everything) (?:down|in|inside)\b|\bdoes(?:n't| not) show\b|\bsteadily\b|\bstays? quiet\b|\bdoes not blink\b|\bshoulders stay (?:square|still)\b|\b(?:voice|tone|delivery|words?) (?:stays?|is|kept|comes out|runs) (?:flat|level|even|steady)\b|\bfinishes it flat\b|\bflatly\b|\bwithout (?:emotion|expression)\b|\bexpressionless\b|\bpoker[- ]face/gi;
      const hits = [...scan.matchAll(pull)].filter(m => !/\b(never|not|no)\s*$/i.test(scan.slice(Math.max(0, m.index - 8), m.index)) || /^never/i.test(m[0]));
      if (hits.length) add('warn', 'W2', 'v1.2：这一段有情绪档 显 以上，下面这几处还在往回收：同一个人、同一个通道（脸、声音、身体）上方向相反的指令会抵消，情绪演出来平。是同一个人同一句的就改掉；人设管的是通道（越痛越慢），情绪换到眼睛、呼吸、声音质地上（手册 7 三.5）', hits.slice(0, 6).map(m => '…' + ctx(scan, m.index, 45) + '…'));
    }
    // W3 情绪写成藏起来的（读法 2：模型只演看得见、听得见的）
    const hide = /\b(?:hidden|hides?|hiding|suppress(?:ed|es|ing)?|buried|beneath the|under the surface|masked|conceal(?:ed|s|ing)?|keeps? (?:it )?down|does(?:n't| not) show|not letting it show|without showing)\b|藏着|压下去|不露/i;
    const w3 = [...emoLines, ...dlgLines.map(toneOf)].filter(l => hide.test(l));
    if (w3.length) add('warn', 'W3', '情绪写成了藏起来的（压下去的愧疚、声音里不露的轻松）：模型只演看得见的，藏起来的等于没写。人物在藏，就写他藏不住的那一下（it cracks on the last word、呼吸一卡）（手册 7 三.3）', w3.slice(0, 4).map(l => short(l.replace(/^Emotion order[^:]*:\s*/, '情绪顺序：'), 90)));
    // W4 情绪顺序：2–4 格，紧挨着它那句台词；一段最多一次"破"
    const w4 = [];
    lines.forEach((l, i) => {
      if (!/^Emotion order\b/.test(l)) return;
      const cells = l.replace(/^Emotion order[^:]*:\s*/, '').split(/→|->/).filter(s => s.trim()).length;
      if (!/^Dialogue:/.test(lines[i + 1] || '')) w4.push('情绪顺序下一行不是它那句台词：' + short(l, 60));
      else if (cells < 2) w4.push('只有一格，算不上顺序，写从什么到什么：' + short(l, 60));
      else if (cells > 4) w4.push(cells + ' 格太多（2–4 格）：' + short(l, 60));
    });
    const broke = emoLines.filter(l => /^Emotion order, overwhelming/.test(l)).length;
    if (broke > 1) w4.push('一段里有 ' + broke + ' 句是"破"：一段最多一次，放在情绪最高的那一句');
    if (w4.length) add('warn', 'W4', '情绪顺序（手册 7 三.3）', w4);
    // W5 不流畅：紧挨着重复的词（口吃、哽住）一句最多两处；uh、um 是原文没有的词（铁规矩 1）
    const rep = /(?:^|[^A-Za-z'])([A-Za-z']+(?: [A-Za-z']+){0,2})[\s,.…—–-]+\1(?![A-Za-z'])|([一-鿿]{1,3})[，,…—\s]+\2/gi;
    const w5 = [];
    for (const d of dlgTexts) {
      const n = [...d.matchAll(rep)].length;
      if (n > 2) w5.push('一句里重复了 ' + n + ' 处（一句最多两处，每处约多 0.4 秒）：' + short(d, 60));
      const f = d.match(/\b(?:uh+|um+|uhm|erm|hmm+)\b/i);
      if (f) w5.push('有 ' + f[0] + '：原文没有就是加台词（铁规矩 1），删掉，用重复已有的词或停顿表达：' + short(d, 60));
    }
    if (w5.length) add('warn', 'W5', '台词里的不流畅（手册 7 三.2）', w5);
  }

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
  const decl = t.match(/only these (\w+) lines?/i) || (/only this one line\b/i.test(t) ? [null, 'one'] : null);   // v5：只有一句时写 only this one line
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
