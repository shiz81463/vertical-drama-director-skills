#!/usr/bin/env node
// 自测（2026-11-24）：反面案例必须被抓出来，正面范例必须没有 ❌，旧格式（V1）必须编得和以前一样。改了模板或检查脚本就跑一遍。
// 用法：node self_test.js [--bible <黑帮老大的圣诞礼物.md>] [--bible-v1 <320磅未婚妻不忍了.md>]（不在原来那台电脑上要给剧设定路径）
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const BIB = arg('--bible') ? ['--bible', arg('--bible')] : [], BIB1 = arg('--bible-v1') ? ['--bible', arg('--bible-v1')] : [];
const CHECK = path.join(__dirname, 'lib', 'check_v2.js');
const run = (s, a) => { const r = spawnSync(process.execPath, [s, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 }); return { code: r.status, text: (r.stdout || '') + (r.stderr || '') }; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yijing_'));
let bad = 0; const say = (ok, m) => { if (!ok) bad++; console.log((ok ? '✅ ' : '❌ ') + m); };

// 1 正面范例：编译没有 ❌
const EX = path.join(ROOT, 'examples');
const V2 = fs.readdirSync(EX).filter(d => /^V2_/.test(d) && fs.existsSync(path.join(EX, d, '源')));
for (const d of V2) { const r = run(path.join(__dirname, 'build.js'), [path.join(EX, d, '源'), '--out', path.join(tmp, d), ...BIB]); say(r.code === 0, `正面范例 ${d}：${(r.text.match(/==== .*? ====/) || ['编译失败：' + r.text.slice(-300)])[0]}`); }

// 2 反面案例：一条一条塞进好提示词，必须报出对应编号
const J = JSON.parse(fs.readFileSync(path.join(ROOT, '反面案例', '案例.json'), 'utf8'));
const pick = re => { for (const d of V2) { const dir = path.join(tmp, d); const f = fs.existsSync(dir) && fs.readdirSync(dir).find(x => re.test(x)); if (f) return fs.readFileSync(path.join(dir, f), 'utf8'); } return ''; };
const good = pick(/段1_.*提示词/) && (() => { const d = V2.find(x => /文戏/.test(x)) || V2[0]; const dir = path.join(tmp, d); return fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(x => /段1_.*提示词/.test(x))), 'utf8'); })();
const fired = (t, id) => { const f = path.join(tmp, 'case.txt'); fs.writeFileSync(f, t); const r = run(CHECK, [f]); return new RegExp('^(❌|⚠️) \\[' + id + '\\]', 'm').test(r.text); };
const lastLine = (t, re, add) => { const ls = t.split('\n'); const i = ls.map((l, k) => re.test(l) ? k : -1).filter(k => k >= 0)[0]; if (i === undefined) return t; ls[i] += add; return ls.join('\n'); };
// 没台词的那一镜（E30 段1 的镜头1）里加
const inject = c => {
  const t = good;
  switch (c.where) {
    case '构图': case '运镜': case '落幅': return lastLine(t, new RegExp('^' + c.where + '：'), c.bad);
    case '声音': return lastLine(t.slice(0, t.indexOf('【分镜】')) + t.slice(t.indexOf('【分镜】')), /^声音：/, c.bad);
    case '拍': { const i = t.indexOf('【分镜】'); return t.slice(0, i) + lastLine(t.slice(i), /^[\d.]+–[\d.]+s：/, c.bad); }
    case '场景': return t.replace('【人物与道具】', c.bad + '\n【人物与道具】');
    case '资产': return t.replace('Every named character appears exactly once.', c.bad + '\nEvery named character appears exactly once.');
    case '结尾声': return t.replace('无配乐，无字幕。', '无配乐，无字幕。' + c.bad);
    case '替换镜': { const ls = t.split('\n'); const i = ls.findIndex(l => /^机位：/.test(l)); ls[i] = ls[i].replace(/^机位：[^｜]+/, '机位：特写 85mm'); for (let k = i + 1; k < ls.length && !/^镜头\d/.test(ls[k]); k++) { if (/^运镜：/.test(ls[k])) ls[k] = '运镜：轻轻推近，停住。'; else if (/^[\d.]+–[\d.]+s：/.test(ls[k])) ls[k] = ls[k].replace(/：.*$/, '：短刀滑过木板，停在积水边。'); else if (/^(构图|光影|落幅|声音)：/.test(ls[k])) ls[k] = ls[k].replace(/：.*$/, '：短刀在左侧前景，水光亮着。'); } return ls.join('\n'); }
    case '全固定': return t.replace(/^运镜：.*$/gm, '运镜：固定。');
    case '删区块': return t.replace(/【机位与视线[^】]*】\n[\s\S]*?(?=【镜头语言)/, '');
    case '方向': return t.replace(/^(机位：[^｜]+｜)[^｜]+/m, '$1' + c.bad);
    default: return t;
  }
};
for (const c of J.cases) {
  const base = fired(good, c.id); const t = inject(c);
  if (t === good) { say(false, `反面案例 ${c.no}：没塞进去（where=${c.where}）`); continue; }
  say(!base && fired(t, c.id), `反面案例 ${c.no} [${c.id}] ${base ? '好稿本来就报，测不出来：' : '要报：'}${c.bad.slice(0, 24)}`);
}

// 3 反面成稿：整条旧提示词必须有 ❌
const DIR = path.join(ROOT, '反面案例', '成稿');
if (fs.existsSync(DIR)) for (const f of fs.readdirSync(DIR).filter(x => /^❌反面_.*\.txt$/.test(x))) {
  const t = fs.readFileSync(path.join(DIR, f), 'utf8');
  say(/^# ❌ 反面案例/.test(t), `${f}：第一行标了反面案例`);
  const r = run(CHECK, [path.join(DIR, f)]); say(r.code === 1, `${f}：${(r.text.match(/合计：.*/) || [''])[0]}`);
}

// 3b 机位术语：能展开、荷兰角会改地平线那句、两个角度要拦、没有的术语要报
{
  const src = path.join(EX, V2.find(x => /文戏/.test(x)), '源'); const d = path.join(tmp, 'terms');
  const build = term => { fs.rmSync(d, { recursive: true, force: true }); fs.cpSync(src, path.join(d, '源'), { recursive: true }); const f = path.join(d, '源', '段1.txt'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^运镜: /m, `术语: ${term}\n运镜: `)); const r = run(path.join(__dirname, 'build.js'), [path.join(d, '源'), ...BIB]); const o = fs.readdirSync(d).find(x => /段1_.*提示词/.test(x)); return { r, t: o ? fs.readFileSync(path.join(d, o), 'utf8') : '' }; };
  const a = build('四分之三侧面、前景遮挡'); say(a.r.code === 0 && /three-quarter view; shot through foreground/.test(a.t) && /^拍法：/m.test(a.t), '机位术语能展开');
  const b = build('荷兰角'); say(/除了镜头1故意倾斜/.test(b.t) && /deliberate tilt in shot 1/.test(b.t) && !/always level/.test(b.t), '荷兰角会改"地平线是平的"那两句');
  const c = build('低角度、高角度'); say(/❌ 段1 \[K29\]/.test(c.r.text), '一镜两个角度报 ❌');
  const e = build('无人机穿越'); say(/机位术语库里没有/.test(e.r.text), '没有的术语会报出能用哪些');
  const n = JSON.parse(fs.readFileSync(path.join(__dirname, 'templates', '机位术语.json'), 'utf8'))['术语'];
  say(n.length === 34 && n.every(x => x['名'] && x['英文'] && x['句'] && !/画面(上|下)[半方]|下角/.test(x['句'])), `术语库 ${n.length} 个，句子里没有上半下半`);
}

// 4 旧格式回归：有本机剧设定才跑
const old = path.join(EX, '320磅第29集');
if (fs.existsSync(path.join(old, '源'))) {
  const o = path.join(tmp, 'v1'); run(path.join(__dirname, 'build.js'), [path.join(old, '源'), '--v1', '--no-check', '--out', o, ...BIB1]);
  const fs1 = fs.readdirSync(old).filter(x => /提示词\.txt$/.test(x));
  if (fs.existsSync(o)) { const same = fs1.filter(x => fs.existsSync(path.join(o, x)) && fs.readFileSync(path.join(o, x), 'utf8').replace(/\r/g, '') === fs.readFileSync(path.join(old, x), 'utf8').replace(/\r/g, ''));
  console.log(`   旧格式回归（--v1）：${same.length}/${fs1.length} 段和存档的成稿一字不差（剧设定改过的话会不一样，只作参考）`); } else console.log('   旧格式回归：本机没有这部剧的剧设定，跳过');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n==== ❌ ${bad} 项没过 ====` : '\n==== 全过 ====');
process.exit(bad ? 1 : 0);
