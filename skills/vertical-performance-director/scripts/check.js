#!/usr/bin/env node
// 竖屏编导满血版 · 总检查：自动分辨文戏 / 武戏 / 险情，先跑格式检查（check_prompt.js，含 N 字数、Q 台词、T 表演），再跑可拍性检查（check_shootable.js）。
// 用法：node check.js <提示词.txt> [--budget 11000] [--style 剧名] [--allow P3:镜头2] [--legacy]
//   有【打斗】或【险情】或 STEADY HAZARD 的按武戏查，其余按文戏查。--budget 只有总控能用。
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const valued = new Set(['--budget', '--style', '--allow']);
let file = null;
const pass = { prompt: [], shoot: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (valued.has(a)) {
    const v = argv[i + 1];
    if (a === '--allow') pass.shoot.push(a, v); else pass.prompt.push(a, v);
    i++;
  } else if (a === '--legacy') pass.shoot.push(a);
  else if (!a.startsWith('--')) file = a;
}
if (!file || !fs.existsSync(file)) { console.error('用法：node check.js <提示词.txt> [--budget 11000] [--style 剧名] [--allow P3:镜头2]'); process.exit(2); }

const t = fs.readFileSync(file, 'utf8');
const mode = /【打斗|【险情|STEADY HAZARD:/.test(t) ? '武戏' : '文戏';
const kind = /STEADY HAZARD:/.test(t) ? '险情（武戏规则 + STEADY HAZARD）' : mode;
const root = path.join(__dirname, '..');
console.log(`\n==== 竖屏编导满血版：按【${kind}】检查 ====`);

const run = (script, extra) => spawnSync(process.execPath, [path.join(root, mode, 'scripts', script), file, ...extra], { stdio: 'inherit' }).status;
const a = run('check_prompt.js', pass.prompt);
console.log('\n==== 可拍性检查（P 节） ====');
const b = run('check_shootable.js', pass.shoot);
const bad = (a !== 0) || (b !== 0);
console.log(`\n==== 总结：格式检查${a === 0 ? '没有 ❌' : '有 ❌'}；可拍性检查${b === 0 ? '没有 ❌' : '有 ❌'} ====`);
console.log(bad ? '先把 ❌ 改完再跑。' : '下一步：照 SKILL.md 派审查员（文戏用 文戏/references/审查清单.md，武戏、险情用 武戏/references/审查清单.md），表演再过一遍 表演/rules_表演.md 的 T 节。');
process.exit(bad ? 1 : 0);
