#!/usr/bin/env node
// List the 剪映 drafts on this machine and whether their timeline can be read directly.
// usage: node list_drafts.mjs [name-filter]
import fs from 'node:fs';
import path from 'node:path';
import { listDrafts } from './lib/draft.mjs';

const filter = process.argv[2];
const rows = listDrafts().filter((d) => !filter || d.name.includes(filter));
if (!rows.length) { console.log('没有找到草稿（剪映草稿索引为空，或过滤词没有匹配）。'); process.exit(0); }
for (const d of rows) {
  const f = path.join(d.dir, 'draft_content.json');
  let state = '缺少 draft_content.json';
  if (fs.existsSync(f)) state = fs.readFileSync(f, 'utf8').trimStart()[0] === '{' ? '可读' : '已加密';
  let timelines = '';
  const pj = path.join(d.dir, 'Timelines', 'project.json');
  if (fs.existsSync(pj)) {
    try { timelines = ' 时间线: ' + JSON.parse(fs.readFileSync(pj, 'utf8')).timelines.map((t) => t.name).join(' | '); } catch { /* ignore */ }
  }
  console.log(`${d.duration.toFixed(1).padStart(6)}s  [${state}]  ${d.name}${timelines}\n         ${d.dir}`);
}
console.log('\n注意：多时间线草稿里，根目录的 draft_content.json 只对应其中一条时间线（通常是最后打开的那条），先用 dump_timeline.mjs 看时长确认是不是正片。');
