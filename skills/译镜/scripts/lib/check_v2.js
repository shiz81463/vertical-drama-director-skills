#!/usr/bin/env node
// V2 提示词检查（2026-11-24）。规则 K1–K27，说明见 手册/0_V2写法.md，每条的反面案例见 反面案例/。
// 用法：node check_v2.js <提示词.txt>。❌ 必须改；⚠️ 看一眼，保留的在回复里说明。台词类规则（Q、W、U、T）复用 lean_checks.js。
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith('--') && !['--style', '--budget'].includes(argv[i - 1]));
if (!file) { console.error('用法：node check_v2.js <提示词.txt>'); process.exit(2); }
// 反面案例文件开头那几行 # 标注不算提示词
const t = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r/g, '').split('\n').filter((l, i) => !(i < 12 && /^#/.test(l))).join('\n').replace(/\n+$/, '');
const results = [];
const add = (level, id, msg, details = []) => results.push({ level, id, msg, details });
const ctx = (s, i, n = 22) => s.slice(Math.max(0, i - n), i + n).replace(/\n/g, ' ');
const short = (s, n = 60) => s.slice(0, n) + (s.length > n ? '…' : '');
const findAll = (re, s = t) => [...s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
const hit = (re, s = t) => findAll(re, s).map(m => '…' + ctx(s, m.index, 26) + '…');

// ---------- 切块 ----------
const secs = {}; const order = []; let cur = 'head'; secs.head = [];
for (const l of t.split('\n')) {
  const m = l.match(/^【([^】]+)】$/);
  if (m && !/^第.+集/.test(m[1])) { cur = m[1].replace(/——.*$/, ''); secs[cur] = []; order.push(cur); continue; }
  secs[cur].push(l);
}
const S = k => (secs[k] || []).join('\n');
const style = S('全局视觉风格');
const noStyle = style ? t.split(style).join('') : t;     // 风格锁是总控定的，不扫 K2 以外的词

// K1 区块
const NEED = ['全局视觉风格', '画面质感', '实拍光影规范', '场景与方位', '人物与道具', '承接画面', '戏的逻辑', '人物与表演', '机位与视线', '镜头语言', '本段变化', '分镜', '结束画面', '声音'];
const miss = NEED.filter(k => !secs[k] || !S(k).trim());
const seq = order.filter(k => NEED.includes(k)); const want = NEED.filter(k => seq.includes(k));
if (miss.length) add('fail', 'K1', '缺区块：' + miss.join('、') + '（每一段同一套章节，武戏也一样，不准用缩写版）');
else if (seq.join() !== want.join()) add('fail', 'K1', '区块顺序不对');
else add('pass', 'K1', '14 个区块都在，顺序对');

// K2 上半下半、分屏
const split = /上半部|下半部|上半(?!身|句|年|夜|场)|下半(?!身|句|年|夜|场|分)|上三分|下三分|三分之二|画面(的)?(上方|下方|上部|下部|上沿|下沿|顶部|底部|中上|中下)|分屏|拼图|四格|画中画|叠[两三]层|上下叠|\b(upper|lower) (two thirds|half|third|part)\b|\b(top|bottom) of (the )?frame\b|\bsplit[- ]screen\b|\bpanels?\b|picture in picture|low in (the )?frame|high(er)? in (the )?frame/gi;
const s2 = hit(split); if (s2.length) add('fail', 'K2', `写了画面上半、下半或分屏（${s2.length} 处）：成片会分开。改成三分线、黄金分割点、左侧 / 右侧、左上侧 / 左下侧、前景 / 中景 / 深处，高低用站、跪、坐写`, s2.slice(0, 6));
else add('pass', 'K2', '没有上半下半和分屏的词');

// K3 配乐
const nb = (t.match(/无配乐/g) || []).length;
const mus = findAll(/不生成\s*BGM|BGM|不要音乐|配乐、|旋律|背景音乐|\bmusic\b|\bscore\b/gi, t.replace(/无配乐/g, ''));
const hum = hit(/嗡嗡|\bhum(s|ming)?\b|心跳|heartbeat|鼓点|节拍器/gi, S('分镜') + '\n' + S('声音'));
if (nb !== 1) add('fail', 'K3', `"无配乐"要恰好出现一次（在【声音】最后），现在 ${nb} 次`);
if (mus.length) add('fail', 'K3', '除了"无配乐"四周又提了音乐：说得越多模型越记得有。【声音】只正着写现场声', mus.slice(0, 4).map(m => m[0]));
if (hum.length) add('fail', 'K3', '有会被当成配乐底噪的声音（嗡嗡、心跳）：删掉', hum.slice(0, 4));
if (nb === 1 && !mus.length && !hum.length) add('pass', 'K3', '配乐只说了一次');

// K4 固定站位
const lockpos = hit(/(身后|背后|背景)(永远|始终|一直)是|永远是方向|站成一排|始终站在|永远站在|方向\s*\d+(?!\d)/g, S('场景与方位') + '\n' + S('机位与视线') + '\n' + S('人物与道具'));
if (lockpos.length) add('fail', 'K4', '写了整集固定的站位：段和段之间人会动，每段重复同一句，下一段就回到开场。人的位置只写在【承接画面】【分镜】【结束画面】', lockpos.slice(0, 4));
else add('pass', 'K4', '没有固定站位');

// ---------- 镜头 ----------
const shotText = S('分镜');
const heads = findAll(/^镜头(\d+)｜([\d.]+)[–-]([\d.]+)s｜(.*)$/gm, shotText);
const shots = heads.map((h, i) => ({ n: +h[1], a: +h[2], b: +h[3], title: h[4], text: shotText.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : undefined) }));
const line = (s, k) => ((s.text.match(new RegExp('^' + k + '：(.*)$', 'm')) || [])[1] || '').trim();
const beatsOf = s => s.text.split('\n').filter(l => /^[\d.]+[–-][\d.]+s：/.test(l));
const names = (secs['人物与道具'] || []).filter(l => /^\S+ @/.test(l) && !/^(队员|群演)/.test(l) && /成片里只有一个/.test(l)).map(l => l.split(' ')[0]);

if (!shots.length) add('fail', 'K9', '没切出镜头（镜头1｜0–3s｜标题）');
else {
  // K9 时间轴
  let p = 0, ok = true;
  for (const s of shots) {
    if (Math.abs(s.a - p) > 1e-6) { ok = false; add('fail', 'K9', `镜${s.n} 从 ${s.a}s 开始，上一镜停在 ${p}s`); }
    let q = s.a; for (const l of beatsOf(s)) { const m = l.match(/^([\d.]+)[–-]([\d.]+)s/); if (Math.abs(+m[1] - q) > 1e-6) { ok = false; add('fail', 'K9', `镜${s.n} 的拍不连：${short(l, 30)}`); } q = +m[2]; }
    if (Math.abs(q - s.b) > 1e-6) { ok = false; add('fail', 'K9', `镜${s.n} 的拍只排到 ${q}s，镜头到 ${s.b}s`); }
    p = s.b;
  }
  const hd = t.match(/全长 ([\d.]+) 秒，(\d+) 个镜头/);
  if (hd && (+hd[1] !== p || +hd[2] !== shots.length)) { ok = false; add('fail', 'K9', `片头写 ${hd[1]} 秒 ${hd[2]} 镜，实际 ${p} 秒 ${shots.length} 镜`); }
  if (ok) add('pass', 'K9', `时间轴 0–${p}s 连续，${shots.length} 镜`);
  if (shots.length > 5) add('fail', 'K9', `一段 ${shots.length} 镜，最多 5 镜`);
  const frac = shots.filter(s => s.b !== p && Math.abs(s.b * 2 - Math.round(s.b * 2)) > 1e-6).map(s => s.b);
  if (frac.length) add('warn', 'K9', `切点 ${frac.join('、')} 不是整秒或半秒：成片切点会偏 ±0.5 秒，重要的切点放整秒`);

  // K10 每镜六行
  for (const s of shots) {
    const m1 = ['机位', '运镜', '构图'].filter(k => !line(s, k)), m2 = ['光影', '落幅', '声音'].filter(k => !line(s, k));
    if (m1.length) add('fail', 'K10', `镜${s.n} 缺：${m1.join('、')}`);
    if (m2.length) add('warn', 'K10', `镜${s.n} 缺：${m2.join('、')}`);
  }
  // K5 方向
  const declared = (secs['场景与方位'] || []).map(l => (l.match(/^(朝[^：（(]{1,10})(?:[（(][^）)]*[）)])?：/) || [])[1]).filter(Boolean);
  const used = shots.map(s => ({ n: s.n, d: (line(s, '机位').split('｜')[1] || '').replace(/[（(].*$/, '').trim() }));
  const undecl = used.filter(u => !declared.includes(u.d)); const unused = declared.filter(d => !used.some(u => u.d === d));
  if (undecl.length) add('fail', 'K5', '镜头用了【场景与方位】里没写的方向：' + undecl.map(u => `镜${u.n}"${u.d || '（没写）'}"`).join('、'));
  if (unused.length) add('warn', 'K5', '【场景与方位】写了没用到的方向：' + unused.join('、') + '，删掉');
  if (!undecl.length && !unused.length) add('pass', 'K5', '方向都对得上：' + declared.join('、'));
  // K7 切点
  const nocut = shots.filter(s => s.n > 1 && !/^(接着|随着|顺着|跟着上一镜|动作接着)/.test(line(s, '运镜'))).map(s => s.n);
  if (nocut.length) add('warn', 'K7', `镜 ${nocut.join('、')} 的运镜没用"接着 / 随着 / 顺着上一镜的什么"开头：写清这一刀接的是哪个眼神、哪句话、哪个动作`);
  // K8 运镜
  const fixed = shots.filter(s => /固定(?!在)/.test(line(s, '运镜')) && !/推|拉|跟|移|摇|滑|绕|浮|起伏|压近|后退/.test(line(s, '运镜')));
  if (fixed.length === shots.length && shots.length > 1) add('fail', 'K8', '全段都是固定机位：看着呆板。每一镜写起点、怎么动、停在哪（推、拉、跟、移、绕、移焦选一种），固定一段最多一镜，写清为什么不动');
  else if (fixed.length > 1) add('warn', 'K8', `镜 ${fixed.map(s => s.n).join('、')} 固定：一段最多一镜固定`);
  const noend = shots.filter(s => !/停|落定|稳|收住|落在|定住|刹住/.test(line(s, '运镜'))).map(s => s.n);
  if (noend.length) add('warn', 'K8', `镜 ${noend.join('、')} 的运镜没写停在哪（落点）`);
  if (!fixed.length) add('pass', 'K8', '每镜都有运动');
  // K15 孤立特写
  const lone = shots.filter(s => /特写/.test(line(s, '机位').split('｜')[0]) && !names.some(n => s.text.includes(n)) && !/[他她]/.test(beatsOf(s).join('')) && !/焦点|移焦|带出|滑到/.test(s.text));
  if (lone.length) add('warn', 'K15', `镜 ${lone.map(s => s.n).join('、')} 是只有东西的孤立特写，看不出接下来是谁：移焦带出人，或者并进前后镜`);
  // K16 落幅写死
  const dead = shots.filter(s => /静止|定格|完全停|纹丝不动|一动不动|凝固/.test(line(s, '落幅') + line(s, '运镜')));
  if (dead.length) add('warn', 'K16', `镜 ${dead.map(s => s.n).join('、')} 的落幅写死了（静止、定格、一动不动）：尾巴会出十几帧静帧，剪的时候只能砍。写还在动的东西：呼吸、衣角、雾、火苗`);
  // K17 镜长
  const ds = shots.map(s => Math.round((s.b - s.a) * 10) / 10);
  if (shots.length >= 3 && new Set(ds).size === 1) add('warn', 'K17', `每镜都是 ${ds[0]} 秒：节奏像节拍器，长短要有变化`);
  const slow = shots.filter(s => s.b - s.a > 3 && !/Dialogue:/.test(s.text) && /冲|扑|踹|踢|刺|砍|甩|推开|摔|砸|追|跑/.test(s.title + beatsOf(s).join('')));
  if (slow.length) add('warn', 'K17', `镜 ${slow.map(s => s.n).join('、')} 是没有台词的动作镜，超过 3 秒：E27 这类镜最后都被剪到 1–1.5 秒，生成时多给的都是拖`);
  const long = shots.filter(s => s.b - s.a > 7); if (long.length) add('warn', 'K17', `镜 ${long.map(s => s.n).join('、')} 超过 7 秒`);
  // K18 没台词的镜头里冲喊
  const hasDlg = /Dialogue:/.test(t);
  const shout = shots.filter(s => hasDlg && !/Dialogue:/.test(s.text) && /嘶吼|大喊|吼|冲向|扑向|举起.{0,6}刀/.test(beatsOf(s).join('')) && !/(嘴|牙|唇).{0,8}(闭|咬|合)|只有.{0,6}(喘|呼吸)|不成词|尖叫/.test(s.text));
  if (shout.length) add('warn', 'K18', `镜 ${shout.map(s => s.n).join('、')} 没有台词，人在冲或者吼，没写嘴：模型会自己配一句脏话。写"牙咬着，只有粗喘"`);
  // K19 乱看没依据
  const look = shots.filter(s => /左顾右盼|眼珠乱闪|四下张望|东张西望|眼睛乱转/.test(beatsOf(s).join('')) && !/(听见|听到|传来|响起|亮起|闪过|扫过).{0,12}(声|响|光|灯|脚步|警笛)|警笛|脚步声/.test(s.text));
  if (look.length) add('warn', 'K19', `镜 ${look.map(s => s.n).join('、')} 写了乱看，没写他听见或看见了什么：观众看不懂他在看什么`);
  // K20 单人镜头构图里写了别人
  const multi = shots.filter(s => /^(大?特写|近景)/.test(line(s, '机位')) && !/肩|同框|叠|怀|抱|双人/.test(line(s, '机位') + line(s, '构图')) && names.filter(n => line(s, '构图').includes(n)).length > 1);
  if (multi.length) add('warn', 'K20', `镜 ${multi.map(s => s.n).join('、')} 是单人近景或特写，构图里写了两个人：画外那个人会露半张脸进来。只写这一个人，看谁写"看画面左侧镜头旁"`);
  // K21b 同框左右
}

// K6 承接 / 结束
if (!/^\S+：\S+/m.test(S('承接画面').replace(/^第一帧.*$/m, ''))) add('fail', 'K6', '【承接画面】没写每个人开场的姿态、位置、手里的东西');
if (/上一段|段\d|衔接镜|上集|下一段/.test(S('承接画面') + S('结束画面'))) add('warn', 'K6', '承接 / 结束里写了"上一段、段N"：模型看不到别的段，直接写这一刻的状态');

// K11 眼睛红
const red = hit(/通红的(眼|双眼|眼睛|眼珠)|(眼睛|双眼|眼珠|瞳孔)[^，。；]{0,4}(通红|血红|发红|充血)|充血的眼|红着眼|血丝|bloodshot|red eyes/gi, shotText + S('人物与表演') + S('戏的逻辑'));
if (red.length) add('fail', 'K11', '写了眼睛通红、充血、红着眼：模型会把眼珠画成红色（E27 段 1）。写泪、眼眶湿、睫毛上的水', red.slice(0, 4)); else add('pass', 'K11', '没有会把眼珠画红的词');
// K12 遮挡整幅
const occ = hit(/(风衣|衣摆|下摆|斗篷|披风|大衣|身体|后背)[^，。；]{0,8}(扫过镜头|从镜头前扫过|盖满|挡满|遮住镜头|掠过镜头)/g, shotText).filter(x => !/一侧|边缘|一角/.test(x));
if (occ.length) add('fail', 'K12', '写了衣服扫过、挡满镜头：会出半秒整幅全黑（E27 段 2 黑 0.54 秒）。写"从画面一侧边缘擦过，主体始终看得见"', occ.slice(0, 3));
// K13 人被遮没
const gone = hit(/整个(人)?(裹|包|挡|盖|罩|藏)(进|住|在)|完全(挡|遮|盖)住(她|他)|把(她|他)整个(裹|包|挡|盖|罩)/g, shotText + S('结束画面'));
if (gone.length) add('fail', 'K13', '写了把人"整个裹进去、整个挡住"：那个人会从画面里消失（E27 段 7）。写还露在外面的部分：头发、半张脸、攥着衣服的手', gone.slice(0, 3));
// K14 光源在镜头身后
const behind = hit(/(从|在)?镜头(身后|背后|后面)[^，。；]{0,10}(光|灯|扫|照|推)|光(源)?[^，。；]{0,6}(在|来自)(镜头|画面)(身后|背后|外)/g, shotText);
if (behind.length) add('fail', 'K14', '写了从镜头身后来的光：模型会把光源画进画面，再莫名消失（E27 段 7 警车一闪就没了）。会变的光，光源要在画面里看得见、全程都在', behind.slice(0, 3));

// K21 资产
const assets = (secs['人物与道具'] || []).filter(l => /^\S+ @/.test(l));
const refs = findAll(/@[^\s：:，,；;）)]+/g, assets.join('\n') + '\n' + (secs['场景与方位'] || [])[0]).map(m => m[0]);
const dupR = refs.filter((r, i) => refs.indexOf(r) !== i);
if (dupR.length) add('fail', 'K21', '同一个主体 @ 了两次：' + [...new Set(dupR)].join('、') + '（会出两个同样的人）');
const doing = refs.filter(r => /警灯|警车|烟花|爆炸|海风|水雾|飘雪|雪效|火光|灯光效果|手铐/.test(r));
if (doing.length) add('fail', 'K21', '@ 了"正在发生"的东西：' + doing.join('、') + '。模型会直接渲染进去，只用文字写');
const spk = new Set(findAll(/^Dialogue: [^,]+, ([A-Za-z]+)/gm).map(m => m[1]));
const au = refs.filter(r => /音频$/.test(r));
if (au.length > spk.size) add('warn', 'K21', `挂了 ${au.length} 条音频，这一段说话的只有 ${spk.size} 个人：不说话的人别挂音频，会张嘴`);

// K22 风格锁
const films = findAll(/《[^》]{1,12}》|Netflix|HBO|漫威|迪士尼|\bMarvel\b/g, style + '\n' + (t.match(/^Shot on .*$/m) || [''])[0]);
if (films.length) add('warn', 'K22', '风格里有片名或平台名：' + [...new Set(films.map(m => m[0]))].join('、') + '。换成质感描述（低调暖光、冷峻钢蓝……），少一个被判版权的理由');
const off = findAll(/烟花|圣诞树|香槟|雪茄|壁炉|烛火|霓虹|礼服|皮草/g, style.split('负面提示词')[0]).map(m => m[0]).filter(w => !noStyle.includes(w));
if (off.length) add('warn', 'K22', '风格锁里有这一场用不到的东西：' + [...new Set(off)].join('、') + '。场景卡写"风格锁"场景版，删掉，免得混进画面');

// K23 字数（平台计数 = 字数 + 每个 @ 多算 1）
const count = t.length + findAll(/@[^\s：:，,；;）)]+/g).length;
const total = shots.length ? shots[shots.length - 1].b : 0;
const lo = total <= 6 ? 5000 : 7000, hi = /Dialogue:/.test(t) ? 10000 : 12000;
if (count > 14000) add('fail', 'K23', `平台计数约 ${count}，过了 14,000 台词会成片丢`);
else if (count > hi) add('warn', 'K23', `平台计数约 ${count}，比 ${hi} 长`);
else if (count < lo) add('warn', 'K23', `平台计数约 ${count}，比 ${lo} 短：查一下是不是砍掉了验证过的固定句（用户 2026-11-23：改完只剩几千字不行）。中文比英文密，折成同一种语言算信息量，别低于旧稿`);
else add('pass', 'K23', `平台计数约 ${count}（区间 ${lo}–${hi}）`);

// K25 否定词
const neg = findAll(/不要|禁止|严禁|不得|不能出现|没有[^，。]{0,6}(人|车|字)/g, noStyle).map(m => m[0]);
if (neg.length > 3) add('warn', 'K25', `否定词 ${neg.length} 处（${[...new Set(neg)].slice(0, 5).join('、')}）：模型会记住那个词。能正着写就正着写`);
// K27 备注
const note = hit(/待确认|待定|见分镜|照分镜|同上|这一镜要|给观众|观众(先|会|知道)|下一场|引信|铺垫/g, noStyle);
if (note.length) add('warn', 'K27', '有给人看的话进了提示词', note.slice(0, 4));

// ---------- 台词、表演：复用 lean_checks，只留对 V2 成立的 ----------
try {
  const keep = new Set(['T6', 'T12', 'T15', 'T16', 'U1', 'U2', 'U6', 'W1', 'W2', 'W3', 'W4', 'W5', 'Q2', 'Q4', 'Q5', 'Q6', 'Q8']);
  const end = t.lastIndexOf('【声音】');
  require('./lean_checks.js')({ t, body: t.slice(0, end > 0 ? end : undefined), lock: style, shots, endingStart: -1, assetLines: assets, mode: '文戏', argv, findAll, ctx, short,
    add: (lv, id, msg, d) => { if (keep.has(id) && !(id === 'Q2' && lv === 'pass')) add(lv, id, msg, d); } });
} catch (e) { add('fail', '脚本', 'lean_checks 出错：' + e.message); }
// J 台词语速、语言
for (const l of t.split('\n').filter(x => /^Dialogue:/.test(x))) {
  const m = l.match(/^Dialogue: ([\d.]+)[–-]([\d.]+)s, .*\{([^{}]*)\}\s*(.*)$/);
  if (!m) { add('fail', 'J1', '台词行格式不对：' + short(l)); continue; }
  if (m[4]) add('fail', 'J1', '台词 } 后面还有字：' + short(m[4], 20));
  const w = (m[3].match(/[A-Za-z']+/g) || []).length, z = (m[3].match(/[一-鿿]/g) || []).length, d = +m[2] - +m[1];
  if (w && w / d > 2.55) add('warn', 'J3', `每秒 ${(w / d).toFixed(1)} 词，超过 2.5：${short(m[3], 40)}`);
  if (z && z / d > 4) add('warn', 'J3', `每秒 ${(z / d).toFixed(1)} 字，超过 4：${short(m[3], 30)}`);
  if (!t.split('\n').some(x => x.startsWith(`${m[1]}–${m[2]}s：`))) add('warn', 'J4', `台词 ${m[1]}–${m[2]}s 没有对应的一拍（说的时候画面里在发生什么）`);
}

const icon = { fail: '❌', warn: '⚠️', pass: '✅' };
const by = l => results.filter(r => r.level === l);
console.log(`\n检查（V2）：${path.basename(file)}\n`);
for (const lv of ['fail', 'warn', 'pass']) for (const r of by(lv)) { console.log(`${icon[lv]} [${r.id}] ${r.msg}`); for (const d of r.details || []) console.log('      ' + d); }
console.log(`\n合计：❌ ${by('fail').length}  ⚠️ ${by('warn').length}  ✅ ${by('pass').length}`);
process.exit(by('fail').length ? 1 : 0);
