#!/usr/bin/env node
// 备份剪映草稿的时间线 JSON（不含媒体文件）。新下载的草稿在剪映里打开保存后会被加密，所以要趁还是明文时先备份。
// usage: node backup_drafts.mjs [名称过滤]
// 备份到 lib/draft.mjs 里的 BACKUP_ROOT（默认 用户主目录/漫剧剪辑/草稿JSON备份，可用环境变量 MANJU_DRAFT_BACKUP 改）。
// 规则：只备份明文的；同名备份内容不同时另存为“草稿名@时间戳”，从不覆盖旧备份；已加密的草稿跳过并提示。
import fs from 'node:fs';
import path from 'node:path';
import { listDrafts, isPlainJson, BACKUP_ROOT, findBackup } from './lib/draft.mjs';

const MEDIA = /\.(mp4|mov|mkv|avi|webm|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|gif|bmp|heic|psd)$/i;
const filter = process.argv[2];
const drafts = listDrafts().filter((d) => !filter || d.name.includes(filter));
if (!drafts.length) { console.log('没有匹配的草稿。'); process.exit(0); }
fs.mkdirSync(BACKUP_ROOT, { recursive: true });

function copyTree(src, dst) {
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), t = path.join(dst, e.name);
    if (e.isDirectory()) n += copyTree(s, t);
    else if (!MEDIA.test(e.name)) { fs.mkdirSync(dst, { recursive: true }); fs.copyFileSync(s, t); n++; }
  }
  return n;
}

let done = 0, skipped = 0, same = 0;
for (const d of drafts) {
  const f = path.join(d.dir, 'draft_content.json');
  if (!fs.existsSync(f)) { console.log(`跳过（没有 draft_content.json）  ${d.name}`); skipped++; continue; }
  if (!isPlainJson(f)) {
    const bak = findBackup(d.name);
    console.log(`已加密，无法备份  ${d.name}${bak ? `（已有明文备份：${path.dirname(bak)}）` : '  ← 没有任何明文备份，只能重新从云端下载一份'}`);
    skipped++; continue;
  }
  const bak = findBackup(d.name);
  if (bak && fs.readFileSync(bak).equals(fs.readFileSync(f))) { same++; continue; }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
  const dst = path.join(BACKUP_ROOT, bak ? `${d.name}@${stamp}` : d.name);
  const n = copyTree(d.dir, dst);
  console.log(`已备份 ${String(n).padStart(4)} 个文件  ${d.name}  →  ${dst}`);
  done++;
}
console.log(`\n新备份 ${done} 条 · 与已有备份相同 ${same} 条 · 跳过 ${skipped} 条 · 备份目录 ${BACKUP_ROOT}`);
