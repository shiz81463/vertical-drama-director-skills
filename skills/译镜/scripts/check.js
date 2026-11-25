#!/usr/bin/env node
// v5 统一检查：一个命令查一段，或者查一整集的文件夹。自动分辨文戏、武戏、险情。
// 用法：node check.js <提示词.txt 或 提示词文件夹> [--style 剧名或剧设定路径] [--budget 11000] [--allow P3:镜头2] [--legacy] [--quiet]
//   一段：格式和内容检查（规则档案里的 B–X 各节）+ 可拍性检查（P 节）。
//   文件夹：每段各查一遍，再做跨段检查（同一场戏各段的场景卡文字一字不差）。有 ❌ 时退出码 1。
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LIB = path.join(__dirname, 'lib');
const run = (script, args) => { const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 }); return { code: r.status, text: (r.stdout || '') + (r.stderr || '') }; };
const tally = text => { let f = 0, w = 0; for (const m of text.matchAll(/合计：❌ (\d+)\s+⚠️ (\d+)/g)) { f += +m[1]; w += +m[2]; } return { f, w }; };

function checkFile(file, opt = {}) {
  const t = fs.readFileSync(file, 'utf8');
  // V2（2026-11-24）：有【承接画面】的是 V2 统一结构，走 check_v2.js；没有的还是旧检查
  if (/^【承接画面】$/m.test(t)) {
    const a = [file]; if (opt.budget) a.push('--budget', String(opt.budget));
    const r = run(path.join(LIB, 'check_v2.js'), a); const c = tally(r.text);
    const crash = /(TypeError|ReferenceError|SyntaxError|Cannot find module)/.test(r.text);
    return { file, mode: 'V2', fails: c.f + (crash ? 1 : 0), warns: c.w, issues: r.text.split('\n').filter(l => /^\s*(❌|⚠️)/.test(l)).map(l => l.trim()), text: r.text, crash };
  }
  const mode = /【打斗|【险情|STEADY HAZARD:/.test(t) ? '武戏' : '文戏';
  const a1 = [file]; if (opt.style) a1.push('--style', opt.style); if (opt.budget) a1.push('--budget', String(opt.budget));
  const a2 = [file]; for (const x of opt.allow || []) a2.push('--allow', x); if (opt.legacy) a2.push('--legacy');
  const p = run(path.join(LIB, mode, 'check_prompt.js'), a1);
  const s = run(path.join(LIB, 'check_shootable.js'), a2);
  const crash = /(TypeError|ReferenceError|SyntaxError|Cannot find module)/.test(p.text + s.text);
  const tp = tally(p.text), ts = tally(s.text);
  const issues = (p.text + '\n' + s.text).split('\n').filter(l => /^\s*(❌|⚠️)/.test(l)).map(l => l.trim());
  return { file, mode: /【险情|STEADY HAZARD:/.test(t) ? '险情' : mode, fails: tp.f + ts.f + (crash ? 1 : 0), warns: tp.w + ts.w, issues, text: p.text + '\n' + s.text, crash };
}
// V1.1：单镜补拍（文件名带"单镜"）也查，排在各段后面（E01 的单镜31 按文件夹查时被跳过了）；跨段检查 check_scene.js 只比各段
const segNo = f => /单镜/.test(f) ? 1e6 + +((f.match(/单镜(\d+)/) || [0, 0])[1]) : /衔接/.test(f) ? 2e6 + +((f.match(/衔接镜?(\d+)/) || [0, 0])[1]) : +f.match(/段(\d+)/)[1];
const promptFiles = dir => fs.readdirSync(dir).filter(f => /(段\d+|单镜|衔接镜?\d+).*提示词.*\.txt$/.test(f)).sort((a, b) => segNo(a) - segNo(b)).map(f => path.join(dir, f));
function checkScene(dir) { const r = run(path.join(LIB, 'check_scene.js'), [dir]); const t = tally(r.text); return { fails: t.f, warns: t.w, text: r.text, issues: r.text.split('\n').filter(l => /^\s*(❌|⚠️)/.test(l)) }; }

module.exports = { checkFile, checkScene, promptFiles };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const valued = new Set(['--style', '--budget', '--allow']);
  const opt = { allow: [] }; let target = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--style') opt.style = argv[++i];
    else if (a === '--budget') opt.budget = argv[++i];
    else if (a === '--allow') opt.allow.push(argv[++i]);
    else if (a === '--legacy') opt.legacy = true;
    else if (a === '--quiet') opt.quiet = true;
    else if (!a.startsWith('--')) target = a;
    else if (valued.has(a)) i++;
  }
  if (!target || !fs.existsSync(target)) { console.error('用法：node check.js <提示词.txt 或 提示词文件夹> [--style 剧名或剧设定路径] [--budget 11000] [--allow P3:镜头2]'); process.exit(2); }
  let fails = 0;
  if (fs.statSync(target).isDirectory()) {
    const files = promptFiles(target);
    if (!files.length) { console.error('文件夹里没有"段N…提示词….txt"或"单镜…提示词….txt"'); process.exit(2); }
    for (const f of files) {
      const r = checkFile(f, opt); fails += r.fails;
      console.log(`${r.fails ? '❌' : r.warns ? '⚠️' : '✅'} ${path.basename(f)}  ${r.mode}  ❌ ${r.fails}  ⚠️ ${r.warns}`);
      if (!opt.quiet) for (const l of r.issues) console.log('     ' + l);
    }
    // V2 的跨段接续在 build.js 的账本里查；check_scene.js 只认旧格式的场景卡文字
    const allV2 = files.every(f => /^【承接画面】$/m.test(fs.readFileSync(f, 'utf8')));
    const sc = allV2 ? { fails: 0, warns: 0, issues: [] } : checkScene(target); fails += sc.fails;
    console.log(`\n跨段检查（同一场戏各段的场景卡文字）：❌ ${sc.fails}  ⚠️ ${sc.warns}`);
    for (const l of sc.issues) console.log('     ' + l.trim());
    console.log(`\n==== 总结：${files.length} 个文件，${fails ? '还有 ❌ ' + fails + ' 个，改到 0' : '没有 ❌'} ====`);
  } else {
    const r = checkFile(target, opt); fails = r.fails;
    console.log(r.text.trim());
    console.log(`\n==== 总结（${r.mode}）：${r.fails ? '❌ ' + r.fails + ' 个，改到 0' : '没有 ❌'}；⚠️ ${r.warns} 个 ====`);
  }
  process.exit(fails ? 1 : 0);
}
