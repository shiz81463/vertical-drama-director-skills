#!/usr/bin/env node
// 登记验证结果：一条提示词生成后用户验收通过，用它更新通用原句库 canon.json。
// 用法：node make_canon.js <验收通过的提示词.txt>
//   canon.json 里每一句通用原句：在这条提示词里找到的标成"验证过"，记下出处；找不到的列出来。
//   只登记，不删、不改任何原句。要改原句，先问用户。
//   各剧的风格锁、画面质感、特效质感不在这里：在 竖屏制作\剧设定\<剧名>.md，验证通过后手工把那份的"状态"改成"验证过"。
'use strict';
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('用法：node make_canon.js <验收通过的提示词.txt>'); process.exit(2); }

const canonPath = path.join(__dirname, 'canon.json');
const canon = JSON.parse(fs.readFileSync(canonPath, 'utf8'));
const t = fs.readFileSync(src, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
const name = path.basename(src);
const today = new Date().toISOString().slice(0, 10);

const found = [], notFound = [];
for (const r of canon.required) {
  if (t.includes(r.text)) {
    if (r.status !== 'verified') found.push(r.id);
    r.status = 'verified';
    r.source = `${name}（${today} 登记）`;
  } else notFound.push(r.id);
}
fs.writeFileSync(canonPath, JSON.stringify(canon, null, 2) + '\n');
console.log(`这次新标成验证过的原句：${found.length ? found.join('、') : '没有'}`);
console.log(`这条提示词里没用到的原句（状态不变）：${notFound.length ? notFound.join('、') : '没有'}`);
console.log('已写回 ' + canonPath);
console.log('别忘了：这部戏的剧设定（竖屏制作\\剧设定\\<剧名>.md）如果还是"未验证"，问过用户后把状态改成"验证过"，写清哪一行、哪天、用户原话。');
