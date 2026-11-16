#!/usr/bin/env node
// 可拍性检查（v2）：查"这一镜模型拍不拍得出来"，和 check_prompt.js 互补（那个查格式和风格锁）。
// 规则编号对应 执行包/可拍性规则.md 的 P 节。规则来自《320磅》第 1-10 集 87 段成片的逐段复盘。
// 用法：node check_shootable.js <提示词.txt 或 分镜脚本.md> [--legacy] [--allow P3:镜头2,P7:镜头4] [--json]
//   --legacy  回测旧提示词用：只有新写法才要求的项（P5 指南针、P15 固定句）降成 ⚠️
//   --allow   总控批准的例外，写在设计单里并说明理由；执行模型不能自己加
// 结果：❌ 必须改；⚠️ 要看一眼。有 ❌ 时退出码为 1。
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
const legacy = argv.includes('--legacy');
const asJson = argv.includes('--json');
const allowArg = argv.includes('--allow') ? (argv[argv.indexOf('--allow') + 1] || '') : '';
const allow = new Set(allowArg.split(',').filter(Boolean));
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--allow');
if (!file) { console.error('用法：node check_shootable.js <文件> [--legacy] [--allow P3:镜头2] [--json]'); process.exit(2); }
const t = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');

const out = [];
const add = (level, id, where, msg, quote = '') => {
  if (allow.has(`${id}:${where}`) || allow.has(id)) level = 'allowed';
  out.push({ level, id, where, msg, quote: quote.slice(0, 90) });
};
const SIZES = ['大远景', '大全景', '全景', '中景', '中近景', '近景', '特写', '大特写'];

// ---------- 机位和运镜的规则（提示词和分镜共用） ----------
const TABLETOP = /桌面|台面|梳妆台|书桌|体重秤|秤面|首饰盒|信封|desk|table|counter|scale\b|jewel(le)?ry box/i;
const TIGHT = /特写|close-?up/i;

function camRules(where, cam, move, title, mode) {
  const all = `${cam} ${move}`;
  let m;

  // P1 机位在实体里
  if ((m = cam.match(/from the glass|from the (big )?window(?! side)|from outside the (window|glass)|窗玻璃(的位置|外|里)|玻璃(外面|外侧|那一面|的位置)|隔着(窗|玻璃)|贴着(窗|玻璃)(?!地板)/i)))
    add('fail', 'P1', where, '机位放在玻璃或窗里：模型会把脸和窗外景叠在一起。改成机位站在屋里、背对窗，这一镜不提玻璃（配方 R12）', m[0]);

  // P2 机位悬空
  if ((m = cam.match(/悬在|夜空里|夜空中|半空|楼外|大楼外|in mid-?air|outside the (building|tower)|floating in/i)))
    add('fail', 'P2', where, '机位悬在空中：没有地方站，模型会造一个方盒子或把重力画反。改成人站在实地上往下看或平视（配方 R13、R14）', m[0]);

  // P3 正上方拍人
  if ((m = cam.match(/正上方|垂直往下|俯视往下|straight down|directly overhead|top[- ]?down|鸟瞰|bird'?s[- ]eye/i))) {
    const insert = mode === 'storyboard'
      ? (TABLETOP.test(cam) || (TIGHT.test(cam) && !/跪|趴|玻璃|地板|城市/.test(title)))
      : (TABLETOP.test(cam) && TIGHT.test(cam));
    if (!insert) add('fail', 'P3', where, '正上方垂直往下拍人或大场面：人会倒挂、透视崩。正上方只留给桌面、台面的特写（配方 R08）；拍人用低机位平视或从高处斜俯', m[0]);
  }

  // P4 地板下、贴透明地板往下
  if ((m = cam.match(/地板下面(?![是的])|地板下(?![面是的])|玻璃(下面|底下)往|under the (floor|glass)|beneath the (floor|glass)|贴着玻璃地板往下|隔着玻璃地板/i)))
    add('fail', 'P4', where, '机位在透明地板下面或贴着地板往下拍：上下关系会乱。只从地板以上拍，地板下的城市只做虚焦的背景', m[0]);

  // P5 指南针（新写法不用；分镜的平面图和机位表可以留，不查）
  if (mode === 'prompt') {
    if ((m = cam.match(/画面上方是[东南西北](?![墙岸窗边头])/))) add('fail', 'P5', where, '"画面上方是某方向"会把朝向定反。删掉，写画面里实际看到什么', m[0]);
    else if ((m = `${cam} ${title}`.match(/(朝|偏|往)[东南西北]|[东南西北](侧|头|边|墙|岸|方向|角)|\b(north|south|east|west)\b/i)))
      add(legacy ? 'warn' : 'fail', 'P5', where, '指南针方位模型不懂。按官方指南改成围绕稳定的东西写：门、窗、楼梯、桌子在画面哪边、谁在它前后', m[0]);
  }

  // P6 拼贴语言
  if ((m = cam.match(/竖着叠|叠[两三]层|分成上下|上下两半|一分为二|split|最上面.{0,40}最下面|top half.{0,40}bottom half|stacked in (the )?frame/i)))
    add('fail', 'P6', where, '"叠几层""上半下半"会被当成分屏。两个人同框写远近：谁离镜头近、谁在她身后多远，同一个空间一个画面（配方 R03）', m[0]);
  else if ((m = cam.match(/叠在画面/))) add('warn', 'P6', where, '"叠在画面"有分屏风险，换成"近处、远处"', m[0]);

  // P7 窗玻璃倒影
  const reflect = /倒影|reflection/i.test(`${cam} ${title}`);
  if (reflect && /玻璃|窗|glass|window/i.test(`${cam} ${title}`) && !/镜子|全身镜|梳妆镜|mirror/i.test(`${cam} ${title}`))
    add('fail', 'P7', where, '窗玻璃里的倒影：模型对不上人和影子，手臂会悬空。把机位放在玻璃的位置、人看镜头边，这一镜不拍玻璃（配方 R12）', (cam.match(/.{0,18}(倒影|reflection).{0,18}/i) || [''])[0]);

  // P8 一镜景别跨度
  if ((m = cam.match(/^\[?\s*([^\s,，|]+?)→([^\s,，|]+)/)) || (m = cam.match(/(大远景|大全景|全景|中景|中近景|近景|特写|大特写)→(大远景|大全景|全景|中景|中近景|近景|特写|大特写)/))) {
    const a = SIZES.indexOf(m[1]), b = SIZES.indexOf(m[2]);
    if (a >= 0 && b >= 0) {
      const d = Math.abs(a - b);
      if (d >= 4) add('fail', 'P8', where, `一镜景别跨 ${d} 级（${m[1]}→${m[2]}）：模型做不出连续运动。拆成两镜硬切`, m[0]);
      else if (d === 3) add('warn', 'P8', where, `一镜景别跨 3 级（${m[1]}→${m[2]}）：确认这一镜够长、路径简单`, m[0]);
    }
  }

  // P9 镜头穿物、大幅升降
  if ((m = move.match(/穿过(?!灯的高度)|穿进|穿出|钻过|through the (wall|hedge|door|floor|glass|gap)|冲过夜空/i)))
    add('fail', 'P9', where, '镜头穿过实物：会被画成穿墙或一片黑。改成硬切到另一边，或人走近把镜头挡住再切（配方 R15）', m[0]);
  if ((m = all.match(/升到约?[三四五六七八九十\d]+\s*米|笔直往上升|一路(往上)?升/)))
    add('fail', 'P9', where, '一镜内机位大幅升高：地板会被画成立起来的墙。要交代全场，硬切到一个固定的高机位（配方 R05）', m[0]);
}

// ---------- 提示词 ----------
function lintPrompt() {
  const parts = t.split(/(?=^镜头\d+｜)/m);
  const head = parts[0];
  const shots = parts.slice(1);
  const ending = t.slice(t.lastIndexOf('【结束状态】') >= 0 ? t.lastIndexOf('【结束状态】') : t.length);

  // P21（v4，2026-11-09）纵深同框"近的在下、远的在上"只在真有高低差时写：两人站在同一地面、镜头在人眼高时，
  // 模型为了做出"近的在下"，会把近的人埋进地里、显得特别矮（第 29 集段 2 镜头 2：温蒂站着、"near the lens and low in the frame"，朱利安"higher"）
  const p21 = [];
  const tall = (head.match(/^TALL FRAME:[^\n]*/m) || [''])[0];
  if (/(nearer|near the lens)[^.;]{0,30}low in the frame/i.test(tall)) p21.push(['TALL FRAME', tall.match(/[^.;:]*low in the frame[^.;]*/i)[0].trim().slice(0, 80)]);
  shots.forEach((block, i) => {
    for (const b of block.split('\n').filter(l => /^\d+(\.\d+)?[–-]\d+(\.\d+)?s:/.test(l))) {
      const m = b.match(/[^.;]*near(er)? (to )?the lens[^.;]*low in the frame[^.;]*/i);
      if (m && /\bstand/i.test(m[0]) && !/\b(sit|sits|seated|sitting|kneel|crouch|step|stair|below|from (high|above))/i.test(m[0])) p21.push([`镜头${i + 1}`, m[0].trim().slice(0, 80)]);
    }
  });
  for (const [where, s] of p21) add('warn', 'P21', where, '"近的在下、远的在上"只在真有高低差时写（坐着、跪着、蹲着对站着，台阶上下，镜头在高处往下拍）。两人都站在同一地面、镜头在人眼高时写：both stand on the same floor at their real heights, heads at about the same level, the nearer one larger；不然近的人会被埋进地里、显得特别矮（第 29 集段 2）', s);

  const corners = [];
  shots.forEach((block, i) => {
    const where = `镜头${i + 1}`;
    const lines = block.split('\n');
    const h = lines[0].split('｜');
    const title = h[h.length - 1] || '';
    const cam = lines.find(l => l.startsWith('[')) || '';
    const move = lines.find(l => l.startsWith('运镜')) || '';
    camRules(where, cam, move, title, 'prompt');
    const beats = lines.filter(l => /^\d+(\.\d+)?[–-]\d+(\.\d+)?s:/.test(l));

    // P10 人穿过实物（上下车、过门、过树篱）给的时间太短
    beats.forEach(b => {
      const mt = b.match(/^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)s:/);
      const dur = parseFloat(mt[2]) - parseFloat(mt[1]);
      const hit = b.match(/rises? out of|steps? out of|gets? out of|climbs? (in|out)|out of the (car|bentley)|(walks?|steps?|pushes|squeezes|goes|runs?|ducks?) through the (door|doorway|gap|opening|hedge)|穿过|下车|上车/i);
      if (hit) {
        if (dur <= 2) add('fail', 'P10', where, `人穿过实物只给了 ${dur} 秒：会穿模。切在动作中间，上一镜脚落地、下一镜人已经站在门外（配方 R15）`, hit[0]);
        else add('warn', 'P10', where, '人穿过实物：写清门开到多大、人从哪一侧过', hit[0]);
      }
    });

    // P11 一镜状态变化过多（官方：一个阶段一个主要状态变化）
    const body = beats.join(' ');
    const stems = ['crack', 'white', 'sag', 'drop', 'fall', 'break', 'slam', 'catch|hook', 'swing', 'collaps', 'shatter', 'plung'];
    const n = stems.filter(s => new RegExp(`\\b(${s})`, 'i').test(body)).length;
    if (n >= 4) add('warn', 'P11', where, `一镜写了 ${n} 个物理变化：拆镜，一镜只做一个变化，写清这一镜开头和结尾各是什么状态`);

    // P12 碎裂特效
    if ((m12 = block.match(/behind (him|her|them)[^.]{0,40}(web|crack)/i)))
      add('fail', 'P12', where, '裂纹位置写成"他身后"：画面里他身后是窗，裂纹就上了窗。写死在哪块地板、从谁的手或膝盖下开始', m12[0]);
    if ((m12 = block.match(/spider-?\s?web|蛛网/i)))
      add(legacy ? 'warn' : 'fail', 'P12', where, '"蛛网"会出弹孔式放射纹加中心黑洞。用剧设定"玻璃地板开裂"的分级写法', m12[0]);

    // P13 声音行里没写稿的人声
    const sound = lines.find(l => l.startsWith('Sound:')) || '';
    const hasLine = lines.some(l => l.startsWith('Dialogue:'));
    const sv = sound.match(/\b(voices|murmur\w*|whisper\w*|chatter\w*|mutter\w*|gossip\w*|talking)\b|人声|议论|窃窃/i);
    if (sv) add('warn', 'P13', where, hasLine ? '这一镜有台词，声音行又写了别的人声：没写稿的人声容易被说成中文。改成不带话语的声音（gasps, breath, footsteps）' : '这一镜没有台词，声音行却写了人声：没写稿的人声容易被说成中文。改成不带话语的声音', sv[0]);

    // P16 过肩肩膀和角落
    const os = cam.match(/(左肩|右肩|left shoulder|right shoulder)[^；;]{0,60}?(左下|右下|lower[- ]left|lower[- ]right)/i);
    if (os) {
      const sh = /^(左|left)/i.test(os[1]) ? '左' : '右';
      const co = /左|left/i.test(os[2]) ? '左' : '右';
      if (sh === co) add(legacy ? 'warn' : 'fail', 'P16', where, `过${sh}肩，肩应该在画面${sh === '左' ? '右' : '左'}下角，这里写反了：会越轴`, os[0]);
      corners.push({ i, co });
    }
  });

  // P17 连续两个过肩落在同一个角（反打应该对角）
  for (let k = 1; k < corners.length; k++) {
    if (corners[k].i === corners[k - 1].i + 1 && corners[k].co === corners[k - 1].co) {
      const a = (shots[corners[k - 1].i].split('\n').find(l => l.startsWith('[')) || '').slice(0, 40);
      const b = (shots[corners[k].i].split('\n').find(l => l.startsWith('[')) || '').slice(0, 40);
      if (a.split('，')[0] !== b.split('，')[0]) add('warn', 'P17', `镜头${corners[k].i + 1}`, '连着两个过肩的前景在同一个角：如果是反打，两边应该一左一右，不然越轴');
    }
  }

  // P18 一段跨两个场景资产
  const sceneAssets = head.split('\n').filter(l => /^\S+ @\S+ ?：外形照参考图，不采用参考图的光线和CG质感/.test(l));
  if (sceneAssets.length >= 2) add('warn', 'P18', '全段', `一段写了 ${sceneAssets.length} 个场景：模型容易合并镜头、串场景。能拆就拆成两段`);

  // P19 画面要出现、但没有资产的景
  const facade = /外观|立面|楼外/.test(sceneAssets.join(' ').replace(/悬挑在大楼外面/g, ''));
  const whole = shots.join('\n');
  const fh = whole.match(/[^.\n]{0,30}(楼外|glass garden glows|jutting from)[^.\n]{0,20}/i);
  const fw = whole.match(/[^.\n]{0,30}(楼顶的玻璃花园|大楼立面直上)[^.\n]{0,20}/);
  if (fh && !facade) add('fail', 'P19', '全段', '画面要拍大楼外观，但没有这张资产图：模型会自己造（空中方盒子就是这样来的）。不拍外观，用站在实地能看到的画面交代高度（配方 R13）', fh[0]);
  else if (fw && !facade) add('warn', 'P19', '全段', '提到了资产图里没有的高处建筑：写成虚焦或出画，不要让它成为画面主体', fw[0]);

  // P20 资产行里的格子描述
  const grid = head.match(/[^，。\n]{0,10}(两米一格|一米一格|方格|网格)[^，。\n]{0,10}/);
  if (grid) add('warn', 'P20', '资产行', '"X 米一格"这种结构词交给参考图，文字别再强调，容易被画成格子盒子', grid[0]);

  // P14 骨架错配
  const skel = t.match(/never holds still|knocked by every|tumbles with whoever/i);
  if (skel && !/\bpunch|\bsword|\bkick|\bblade|\bfist/i.test(whole)) add('warn', 'P14', '全段', '这段没有人对打，却用了打戏的"镜头永远在动"：灾难、摔倒戏用稳的机位，只让东西动', skel[0]);

  // P15 新固定句
  const need = [
    ['UPRIGHT:', '画面永远正着：地在下、天花板在上'],
    ['ONE IMAGE:', '一个连续画面：不分屏、不画中画'],
    ['ENGLISH ONLY:', '全部人声只说英语'],
  ];
  need.forEach(([k, d]) => { if (!t.includes(k)) add(legacy ? 'warn' : 'fail', 'P15', '全段', `缺固定句 ${k}（${d}）`); });
  if (!shots.length) add('fail', 'P0', '全段', '没切出镜头：标题要写成"镜头1｜0–3s｜…"');
}

// ---------- 分镜脚本：查机位表和分镜表 ----------
function lintStoryboard() {
  const lines = t.split('\n');
  lines.forEach((line, n) => {
    if (!line.startsWith('|')) return;
    const cells = line.split('|').map(s => s.trim());
    if (cells.length < 5) return;
    if (/^机位$|^镜$/.test(cells[1]) || /^-+$/.test(cells[1])) return;
    if (/^[A-Z]{1,2}\d{1,3}$/.test(cells[1])) {            // 机位表
      const where = `机位${cells[1]}`;
      camRules(where, `${cells[2]} ${cells[3]} ${cells[4]} ${cells[5] || ''}`, '', '', 'storyboard');
    } else if (/^\d+$/.test(cells[1]) && cells.length >= 9) { // 分镜表
      const where = `镜${cells[1]}`;
      camRules(where, `${cells[5]} ${cells[6]}`, cells[6] || '', cells[7] || '', 'storyboard');
      const pass = `${cells[6]} ${cells[7]}`.match(/下车|上车|穿过|钻过|扫过画面|挡满画面/);
      if (pass) add('warn', 'P10', where, '人或镜头要穿过实物：确认切在动作中间，不在一镜里穿过去（配方 R15）', pass[0]);
    }
  });
}

let m12;
if (/^镜头\d+｜/m.test(t)) lintPrompt();
else lintStoryboard();

const fails = out.filter(r => r.level === 'fail');
const warns = out.filter(r => r.level === 'warn');
if (asJson) {
  console.log(JSON.stringify({ file, fails: fails.length, warns: warns.length, items: out }));
} else {
  console.log(`\n可拍性检查：${file.split(/[\\/]/).pop()}\n`);
  out.forEach(r => {
    const mark = r.level === 'fail' ? '❌' : r.level === 'warn' ? '⚠️' : '☑️ 已批准';
    console.log(`${mark} [${r.id}] ${r.where}：${r.msg}${r.quote ? `\n     原文：${r.quote}` : ''}`);
  });
  console.log(`\n合计：❌ ${fails.length}  ⚠️ ${warns.length}`);
}
process.exit(fails.length ? 1 : 0);
