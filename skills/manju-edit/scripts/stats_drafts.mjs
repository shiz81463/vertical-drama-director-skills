#!/usr/bin/env node
// 学习定稿：对一个文件夹下的多条剪映草稿（每条一个子文件夹，内含明文 draft_content.json）做剪辑操作统计。
// usage: node stats_drafts.mjs <草稿根目录> [--skip 名称前缀,名称前缀]
// 输出逐条概览 + 汇总（镜头时长、掐头去尾、变速、放大、镜像、叠盖、转场、特效、音频音量与淡变、音效名排行、字幕样式）。
// 只统计启用的片段。用它在拿到新一批定稿后刷新 references/house-style.md。
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const skipArg = process.argv.indexOf('--skip');
const skips = skipArg > 0 ? process.argv[skipArg + 1].split(',') : [];

const S = (us) => +(us / 1e6).toFixed(3);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(0) + '%' : '-');
const q = (arr, p) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const dist = (arr, d = 2) => arr.length ? `n=${arr.length} min=${Math.min(...arr).toFixed(d)} p25=${q(arr, .25).toFixed(d)} med=${q(arr, .5).toFixed(d)} p75=${q(arr, .75).toFixed(d)} p90=${q(arr, .9).toFixed(d)} max=${Math.max(...arr).toFixed(d)}` : 'n=0';
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const top = (o, n = 40) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}×${v}`).join('  ');
const dB = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');

const G = {
  drafts: 0, shotDur: [], speeds: {}, speedVals: [], scaleVals: [], scaled: 0, vsegs: 0, mainSegs: 0, flips: 0, rot: 0, offset: 0,
  kf: 0, kfProps: {}, freeze: 0, reverse: 0, curve: 0, transitions: {}, vfx: {}, filters: {}, anim: {}, masks: {}, combos: 0,
  headTrim: [], tailTrim: [], trimmedHead: 0, trimmedTail: 0, srcReuse: [], tinySegs: 0, sub05: 0,
  vVolMuted: 0, vVolKept: 0, vVolVals: [], sepAudio: 0,
  aType: {}, sfxNames: {}, sfxCat: {}, musicNames: {}, aVol: {}, fadeIn: {}, fadeOut: {}, aSegsByType: {}, aFaded: {}, aSpeed: 0, aKf: 0, aDur: {},
  vocalSep: {}, afx: {}, loud: 0,
  subLen: [], subDur: [], subPunct: 0, subMulti: 0, subs: 0, subFont: {}, subSize: {}, subY: {}, subScale: {}, subStyle: {}, textItems: [],
  overlayDur: [], overlayKinds: {}, trackLayouts: {}, vTracks: [], aTracks: [], tTracks: [], adjSegs: 0, hslSegs: 0, effTypes: {},
  matNames: {}, algo: {}, canvas: {}, cps: [],
};

const PUNCT = /[，。！？、；：,.!?;:“”"'‘’…—~《》（）()【】]/;

for (const name of fs.readdirSync(root)) {
  if (skips.some((s) => name.startsWith(s))) continue;
  const f = path.join(root, name, 'draft_content.json');
  if (!fs.existsSync(f)) continue;
  let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  for (const t of j.tracks) t.segments = t.segments.filter((s) => s.visible !== false);
  j.tracks = j.tracks.filter((t) => t.segments.length);
  G.drafts++;
  const M = j.materials;
  const byId = new Map();
  for (const [k, arr] of Object.entries(M)) if (Array.isArray(arr)) for (const m of arr) if (m && m.id) byId.set(m.id, { kind: k, m });
  const refs = (seg) => (seg.extra_material_refs || []).map((id) => byId.get(id)).filter(Boolean);

  const L = { name, dur: S(j.duration), canvas: `${j.canvas_config.width}x${j.canvas_config.height}`, fps: j.fps || '?' };
  bump(G.canvas, L.canvas);
  const layout = j.tracks.map((t) => t.type[0].toUpperCase() + t.segments.length).join(' ');
  const vt = j.tracks.filter((t) => t.type === 'video');
  const at = j.tracks.filter((t) => t.type === 'audio');
  const tt = j.tracks.filter((t) => t.type === 'text');
  G.vTracks.push(vt.length); G.aTracks.push(at.length); G.tTracks.push(tt.length);
  const D = { transitions: [], vfx: [], anim: [], speeds: [], scaled: 0, kf: 0, freeze: 0, tiny: 0, combos: 0, masks: [], filters: [] };

  // ---- video
  vt.forEach((t, ti) => {
    const isMain = ti === 0;
    const perSrc = {};
    for (const s of t.segments) {
      G.vsegs++;
      const mat = byId.get(s.material_id)?.m || {};
      const dur = S(s.target_timerange.duration);
      const sp = s.speed ?? 1;
      if (isMain) { G.mainSegs++; G.shotDur.push(dur); if (dur < 0.17) { G.tinySegs++; D.tiny++; } if (dur < 0.5) G.sub05++; }
      else { G.overlayDur.push(dur); bump(G.overlayKinds, mat.type === 'photo' ? (mat.freeze ? 'freeze' : 'photo') : (byId.get(s.material_id)?.kind || '?')); }
      // speed
      const spMat = refs(s).find((r) => r.kind === 'speeds')?.m;
      const curve = spMat && (spMat.mode === 1 || spMat.curve_speed);
      if (curve) { G.curve++; D.speeds.push('curve'); }
      else if (Math.abs(sp - 1) > 0.001) { G.speedVals.push(sp); bump(G.speeds, sp < 0.5 ? '<0.5x' : sp < 0.8 ? '0.5-0.8x' : sp < 1 ? '0.8-1x' : sp <= 1.25 ? '1-1.25x' : sp <= 1.5 ? '1.25-1.5x' : sp <= 2 ? '1.5-2x' : '>2x'); D.speeds.push(sp.toFixed(2)); }
      // transform
      const sc = s.clip?.scale; const sx = sc?.x ?? 1;
      if (Math.abs(sx - 1) > 0.005) { G.scaled++; D.scaled++; G.scaleVals.push(sx); }
      const tr = s.clip?.transform || {};
      if (Math.abs(tr.x || 0) > 0.005 || Math.abs(tr.y || 0) > 0.005) G.offset++;
      if (s.clip?.flip?.horizontal || s.clip?.flip?.vertical) G.flips++;
      if (Math.abs(s.clip?.rotation || 0) > 0.01) G.rot++;
      if ((s.common_keyframes || []).length) { G.kf++; D.kf++; for (const k of s.common_keyframes) bump(G.kfProps, k.property_type); }
      if (mat.type === 'photo' && mat.freeze) { G.freeze++; D.freeze++; }
      if (s.reverse) G.reverse++;
      if (byId.get(s.material_id)?.kind === 'drafts') { G.combos++; D.combos++; }
      // volume
      const vol = s.volume ?? 1;
      if (mat.type === 'video') { if (vol === 0) G.vVolMuted++; else { G.vVolKept++; G.vVolVals.push(vol); } if (mat.has_sound_separated) G.sepAudio++; }
      // trims
      if (mat.type === 'video' && mat.duration) {
        const st = S(s.source_timerange.start || 0), sd = S(s.source_timerange.duration);
        const tail = S(mat.duration) - st - sd;
        G.headTrim.push(st); G.tailTrim.push(Math.max(0, tail));
        if (st > 0.05) G.trimmedHead++; if (tail > 0.05) G.trimmedTail++;
        bump(perSrc, mat.path || mat.material_name);
        const mn = (mat.material_name || '').replace(/\d+/g, '#'); bump(G.matNames, mn);
        for (const [k, v] of Object.entries(mat.video_algorithm || {})) if (v && typeof v !== 'object' ? true : (Array.isArray(v) ? v.length : Object.keys(v || {}).length)) bump(G.algo, k);
      }
      for (const r of refs(s)) {
        if (r.kind === 'transitions') { bump(G.transitions, `${r.m.name}(${S(r.m.duration)}s)`); D.transitions.push(r.m.name); }
        if (r.kind === 'material_animations' && r.m.animations?.length) for (const a of r.m.animations) { bump(G.anim, `${a.type}:${a.name}`); D.anim.push(a.name); }
        if (r.kind === 'common_mask' && r.m.name) { bump(G.masks, r.m.name); D.masks.push(r.m.name); }
        if (r.kind === 'effects') bump(G.effTypes, r.m.type);
        if (r.kind === 'video_effects') { bump(G.vfx, 'clip:' + r.m.name); D.vfx.push(r.m.name); }
      }
      if (refs(s).some((r) => r.kind === 'effects' && !['filter'].includes(r.m.type))) G.adjSegs++;
      if (s.enable_hsl) G.hslSegs++;
    }
    if (isMain) for (const n of Object.values(perSrc)) G.srcReuse.push(n);
  });
  // ---- effect / filter tracks
  for (const t of j.tracks.filter((t) => t.type === 'effect')) for (const s of t.segments) { const m = byId.get(s.material_id)?.m; if (m) { bump(G.vfx, 'track:' + m.name); D.vfx.push(m.name + `[${S(s.target_timerange.duration)}s]`); } }
  for (const t of j.tracks.filter((t) => t.type === 'filter')) for (const s of t.segments) { const m = byId.get(s.material_id)?.m; if (m) { bump(G.filters, m.name || m.type); D.filters.push(m.name); } }

  // ---- audio
  const aTrackDesc = [];
  for (const t of at) {
    const kinds = {};
    for (const s of t.segments) {
      const m = byId.get(s.material_id)?.m || {};
      const ty = m.type || '?';
      bump(kinds, ty); bump(G.aType, ty);
      const vol = s.volume ?? 1;
      (G.aVol[ty] ||= []).push(vol);
      (G.aDur[ty] ||= []).push(S(s.target_timerange.duration));
      bump(G.aSegsByType, ty);
      if (ty === 'sound') { bump(G.sfxNames, m.name); bump(G.sfxCat, m.category_name || '?'); }
      if (ty === 'music' || ty === 'extract_music') bump(G.musicNames, `${ty}:${m.name}`);
      const fade = refs(s).find((r) => r.kind === 'audio_fades')?.m;
      if (fade && (fade.fade_in_duration || fade.fade_out_duration)) {
        bump(G.aFaded, ty);
        if (fade.fade_in_duration) (G.fadeIn[ty] ||= []).push(S(fade.fade_in_duration));
        if (fade.fade_out_duration) (G.fadeOut[ty] ||= []).push(S(fade.fade_out_duration));
      }
      if (Math.abs((s.speed ?? 1) - 1) > 0.001) G.aSpeed++;
      if ((s.common_keyframes || []).length) G.aKf++;
      for (const r of refs(s)) {
        if (r.kind === 'audio_effects') bump(G.afx, r.m.name);
        if (r.kind === 'vocal_separations' && r.m.choice) bump(G.vocalSep, `audio:choice=${r.m.choice}`);
        if (r.kind === 'loudnesses' && r.m.enable) G.loud++;
      }
    }
    aTrackDesc.push(Object.entries(kinds).map(([k, v]) => `${k}:${v}`).join('+'));
  }
  for (const t of vt) for (const s of t.segments) for (const r of refs(s)) if (r.kind === 'vocal_separations' && r.m.choice) bump(G.vocalSep, `video:choice=${r.m.choice}`);

  // ---- text
  const tDesc = [];
  for (const t of tt) {
    let nSub = 0, nTxt = 0;
    for (const s of t.segments) {
      const m = byId.get(s.material_id)?.m || {};
      let c = {}; try { c = JSON.parse(m.content || '{}'); } catch {}
      const text = c.text ?? '';
      const st = (c.styles || [])[0] || {};
      const dur = S(s.target_timerange.duration);
      if (m.type === 'subtitle') {
        nSub++; G.subs++;
        G.subLen.push([...text.replace(/\s/g, '')].length); G.subDur.push(dur);
        if (dur > 0) G.cps.push([...text].length / dur);
        if (PUNCT.test(text)) G.subPunct++;
        if (/\n/.test(text.trim())) G.subMulti++;
        bump(G.subFont, (st.font?.path || m.font_path || '').split(/[\\/]/).pop() || 'default');
        bump(G.subSize, String(st.size ?? m.font_size));
        bump(G.subY, (s.clip?.transform?.y ?? 0).toFixed(2));
        bump(G.subScale, (s.clip?.scale?.x ?? 1).toFixed(2));
        const stroke = (st.strokes || [])[0];
        const fill = st.fill?.content?.solid?.color?.map((x) => Math.round(x * 255)).join(',');
        bump(G.subStyle, `fill=${fill} stroke=${stroke ? (stroke.width ?? '?') + '/' + (stroke.content?.solid?.color || []).map((x) => Math.round(x * 255)).join(',') : 'none'} shadow=${st.shadows ? 'y' : (m.has_shadow ? 'y' : 'n')} bold=${st.bold ? 'y' : 'n'}`);
      } else {
        nTxt++;
        G.textItems.push(`${name.slice(0, 8)} | ${JSON.stringify(text.slice(0, 40))} | ${S(s.target_timerange.start)}s +${dur}s | y=${(s.clip?.transform?.y ?? 0).toFixed(2)} size=${st.size}`);
      }
    }
    tDesc.push(`sub:${nSub}/text:${nTxt}`);
  }

  console.log(`\n## ${name} — ${L.dur}s ${L.canvas} fps=${L.fps}`);
  console.log(`  tracks: ${layout}`);
  console.log(`  video: main=${vt[0]?.segments.length} shots, overlays=[${vt.slice(1).map((t) => t.segments.length).join(',')}] scaled=${D.scaled} keyframed=${D.kf} freeze=${D.freeze} compound=${D.combos} tiny(<5f)=${D.tiny}`);
  console.log(`  speed changes: ${D.speeds.length} [${D.speeds.slice(0, 30).join(' ')}]`);
  console.log(`  transitions: [${D.transitions.join(', ')}]  vfx: [${D.vfx.join(', ')}]  filters: [${D.filters.join(', ')}]  masks: [${D.masks.join(', ')}]  anims: [${[...new Set(D.anim)].join(', ')}]`);
  console.log(`  audio tracks: ${aTrackDesc.map((d, i) => `A${i + 1}{${d}}`).join(' ')}`);
  console.log(`  text tracks: ${tDesc.join(' | ')}`);
}

console.log('\n\n================ AGGREGATE over', G.drafts, 'drafts ================');
console.log('canvas:', top(G.canvas));
console.log('track counts  video:', dist(G.vTracks, 0), '| audio:', dist(G.aTracks, 0), '| text:', dist(G.tTracks, 0));
console.log('\n-- VIDEO');
console.log('main-track shots:', G.mainSegs, ' shot length(s):', dist(G.shotDur));
console.log(`shots <5 frames: ${G.tinySegs} | <0.5s: ${G.sub05} (${pct(G.sub05, G.mainSegs)})`);
console.log(`segments per source clip (main track): ${dist(G.srcReuse, 0)} | sources used >1×: ${G.srcReuse.filter((n) => n > 1).length}/${G.srcReuse.length}`);
console.log(`head trimmed (>0.05s): ${G.trimmedHead}/${G.vsegs} (${pct(G.trimmedHead, G.vsegs)}) head trim s: ${dist(G.headTrim)}`);
console.log(`tail trimmed (>0.05s): ${G.trimmedTail}/${G.vsegs} (${pct(G.trimmedTail, G.vsegs)}) tail trim s: ${dist(G.tailTrim)}`);
console.log(`speed-changed segs: ${G.speedVals.length}/${G.vsegs} (${pct(G.speedVals.length, G.vsegs)}) + curve=${G.curve} | buckets: ${top(G.speeds)} | values: ${dist(G.speedVals)}`);
console.log(`scaled segs: ${G.scaled}/${G.vsegs} (${pct(G.scaled, G.vsegs)}) scale: ${dist(G.scaleVals)} | offset=${G.offset} flip=${G.flips} rotate=${G.rot}`);
console.log(`keyframed segs: ${G.kf} props: ${top(G.kfProps)}`);
console.log(`freeze frames: ${G.freeze} | reversed: ${G.reverse} | compound clips: ${G.combos}`);
console.log(`overlay-track segs: ${G.overlayDur.length} kinds: ${top(G.overlayKinds)} dur: ${dist(G.overlayDur)}`);
console.log('transitions:', top(G.transitions) || 'none');
console.log('video effects:', top(G.vfx));
console.log('filters:', top(G.filters));
console.log('clip animations:', top(G.anim));
console.log('masks:', top(G.masks));
console.log(`colour-adjusted segs: ${G.adjSegs} | hsl segs: ${G.hslSegs} | adjust types: ${top(G.effTypes)}`);
console.log(`video-clip own audio: muted=${G.vVolMuted} kept=${G.vVolKept} (separated-to-audio-track=${G.sepAudio}) kept vol dB: ${dist(G.vVolVals.map((v) => 20 * Math.log10(v)), 1)}`);
console.log('video algorithms:', top(G.algo));
console.log('vocal separation:', top(G.vocalSep));
console.log('source clip name patterns:', top(G.matNames, 25));
console.log('\n-- AUDIO');
console.log('segments by type:', top(G.aType));
for (const ty of Object.keys(G.aType)) {
  const v = G.aVol[ty];
  console.log(`  ${ty}: vol dB ${dist(v.filter((x) => x > 0).map((x) => 20 * Math.log10(x)), 1)} | dur s ${dist(G.aDur[ty])} | faded ${G.aFaded[ty] || 0}/${G.aSegsByType[ty]} | fade-in ${dist(G.fadeIn[ty] || [])} | fade-out ${dist(G.fadeOut[ty] || [])}`);
}
console.log(`audio speed-changed: ${G.aSpeed} | volume-keyframed: ${G.aKf} | loudness-normalised: ${G.loud} | audio fx: ${top(G.afx)}`);
console.log('SFX categories:', top(G.sfxCat));
console.log('SFX names (top 120):', top(G.sfxNames, 120));
console.log('music:', top(G.musicNames, 60));
console.log('\n-- SUBTITLES');
console.log(`subtitles: ${G.subs} | with punctuation: ${G.subPunct} | multi-line: ${G.subMulti}`);
console.log('chars/subtitle:', dist(G.subLen, 0), '| duration s:', dist(G.subDur), '| chars/s:', dist(G.cps, 1));
console.log('font:', top(G.subFont)); console.log('size:', top(G.subSize)); console.log('y:', top(G.subY)); console.log('scale:', top(G.subScale)); console.log('style:', top(G.subStyle, 12));
console.log('\n-- NON-SUBTITLE TEXT'); for (const l of G.textItems) console.log('  ' + l);
