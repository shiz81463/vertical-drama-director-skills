// 检查环境：看这台电脑还缺什么，三个技能（分镜编导、译镜、剪辑 manju-edit）的脚本才能跑。只查不装。
//
// 用法（在这个包的根目录）：
//   node 检查环境.mjs                     只查装没装
//   node 检查环境.mjs --试跑              再拿包里的范例真跑一遍每个脚本（在系统临时文件夹里跑，不动包里的文件）
//   可选：--skills <skills 文件夹>        查装好的那一份，不查包里的（默认查包里的 skills/）
//         --sfx-python <python 路径>     装了 pedalboard 的 Python（剪辑技能做合成器音效用），不在默认位置时给
//         --asr-python <python 路径>     装了 faster-whisper 的 Python（译镜审片听台词用）。只用来检查；译镜审片脚本自己只认 PATH 里的 python
//
// 每一项出 ✅ 能用 / ⚠️ 缺了，有一部分功能用不了 / ❌ 缺了，主要功能用不了。怎么补见 给另一台电脑的Claude_装环境.md。
// 结尾一行"合计：❌ N 个，⚠️ M 个"；有 ❌ 退出码 1。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : '');
const TRY = argv.includes('--试跑') || argv.includes('--try');
const SK = path.resolve(opt('--skills') || path.join(HERE, 'skills'));
const WIN = process.platform === 'win32';
const rows = [];
const add = (lv, item, who, detail, fix = '') => rows.push({ lv, item, who, detail, fix });
const run = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, timeout: o.timeout || 300000, cwd: o.cwd, env: o.env || process.env });
  return { ok: r.status === 0, code: r.error ? r.error.code : r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
const last = (s) => (s || '').split(/\r?\n/).filter(Boolean).pop() || '';
const exists = (p) => !!p && fs.existsSync(p);
// 不用 fs.cpSync：新版 Node 在 Windows 上碰到中文路径会直接崩掉、不报错（这台电脑 Node 24 实测）
const copyDir = (a, b) => { fs.mkdirSync(b, { recursive: true }); for (const e of fs.readdirSync(a, { withFileTypes: true })) { const s = path.join(a, e.name), d = path.join(b, e.name); e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } };

console.log(`检查环境：${os.type()} ${os.release()}，${process.platform}\n技能：${SK}\n`);
for (const s of ['分镜编导', '译镜', 'manju-edit']) if (!exists(path.join(SK, s, 'SKILL.md'))) add('❌', `技能 ${s}`, s, `${SK} 下面没有 ${s}`, '用 --skills 指到放着三个技能的文件夹');

// 1. Node
const nodeMajor = Number(process.versions.node.split('.')[0]);
add(nodeMajor >= 18 ? '✅' : '❌', 'Node.js', '三个技能的全部脚本', `版本 ${process.version}${nodeMajor >= 18 ? '' : '，要 18 或更新'}`, '第 2 步');

// 2. ffmpeg / ffprobe
for (const t of ['ffmpeg', 'ffprobe']) {
  const r = run(t, ['-version']);
  add(r.ok ? '✅' : '❌', t, '译镜审片；剪辑的查夹帧卡帧、查成片', r.ok ? r.out.split('\n')[0].slice(0, 70) : '命令行里找不到（要在 PATH 里）', '第 3 步');
}

// 3. 译镜：剧设定放在默认位置没有
const bibleDir = 'D:\\漫剧公司\\竖屏制作\\剧设定';
if (WIN && exists(bibleDir)) add('✅', '译镜的剧设定', '译镜编译、单查提示词', `在默认位置 ${bibleDir}，编译和检查不用另给路径`);
else add('⚠️', '译镜的剧设定', '译镜编译、单查提示词', `默认位置 ${bibleDir} 没有：编译要加 --bible <剧设定.md>，单查要加 --style <剧设定.md>（剧设定在包里 附带资料/剧设定_竖屏/）`, '第 5 步');

// 4. 译镜审片的语音识别：review.js 直接调 PATH 里的 python
const pyName = 'python';
const pyv = run(pyName, ['-c', 'import sys;print(sys.version.split()[0])']);
let fwOk = false;
if (!pyv.ok) add('⚠️', '审片用的 python', '译镜审片听台词', `命令行里的 python 跑不起来（${pyv.code}${pyv.code === 9009 ? '：多半是 Windows 应用商店的占位 python' : ''}）。审片可以加 --no-asr 跳过听台词`, '第 6 步');
else {
  const fw = run(pyName, ['-c', 'import faster_whisper,numpy;print(faster_whisper.__version__)']);
  fwOk = fw.ok;
  add(fw.ok ? '✅' : '⚠️', '审片用的 python', '译镜审片听台词', fw.ok ? `python ${pyv.out}，faster-whisper ${fw.out}` : `python ${pyv.out} 没装 faster-whisper 或 numpy。审片可以加 --no-asr 跳过听台词`, '第 6 步');
}
const asrPy = opt('--asr-python');
if (asrPy) {
  const r = run(asrPy, ['-c', 'import faster_whisper,numpy;print(faster_whisper.__version__)']);
  add(r.ok ? '✅' : '⚠️', '另给的 --asr-python', '译镜审片听台词', r.ok ? `faster-whisper ${r.out}。注意：审片脚本只认 PATH 里的 python，这一个要排到 PATH 前面才会被用上` : `跑不起来：${last(r.err)}`);
}
let reviewDefault = '';
try { reviewDefault = (fs.readFileSync(path.join(SK, '译镜', 'scripts', 'review.js'), 'utf8').match(/process\.env\.ASR_MODEL \|\| '([^']+)'/) || [])[1] || ''; } catch {}
reviewDefault = reviewDefault.replace(/\\\\/g, '\\');
const model = process.env.ASR_MODEL || reviewDefault;
const modelOk = exists(path.join(model, 'model.bin'));
add(modelOk ? '✅' : '⚠️', '语音识别模型', '译镜审片听台词', modelOk ? `${model}${process.env.ASR_MODEL ? '（来自环境变量 ASR_MODEL）' : '（审片脚本的默认位置）'}` : `${model || '（没设）'} 下面没有 model.bin。设环境变量 ASR_MODEL 指到模型文件夹，或者审片时加 --asr-model <文件夹>；没有就 --no-asr`, '第 6 步');

// 5. 剪辑：剪映草稿、备份目录
let draftLib = null;
try { draftLib = await import(pathToFileURL(path.join(SK, 'manju-edit', 'scripts', 'lib', 'draft.mjs')).href); } catch (e) { add('❌', '剪辑技能的脚本', 'manju-edit', `读不了 scripts/lib/draft.mjs：${e.message}`); }
if (draftLib) {
  const idx = draftLib.draftIndexPath();
  const n = exists(idx) ? draftLib.listDrafts().length : 0;
  add(exists(idx) ? '✅' : '⚠️', '剪映专业版', '剪辑：读草稿的脚本（列草稿、打印时间线、交付自检）', exists(idx) ? `找到草稿目录，${n} 条草稿` : `没找到剪映的草稿目录（${idx}）：没装剪映，或者装了还没建过草稿。查成片的 qc_media 不受影响`, '第 7 步');
  add('✅', '草稿明文备份放在', '剪辑：backup_drafts', `${draftLib.BACKUP_ROOT}${process.env.MANJU_DRAFT_BACKUP ? '（来自环境变量 MANJU_DRAFT_BACKUP）' : '（默认）'}`);
}

// 6. 剪辑：合成器音效（Surge XT + 装了 pedalboard 的 Python）
let surgeDefault = '';
try { surgeDefault = (fs.readFileSync(path.join(SK, 'manju-edit', 'scripts', 'sound', 'surge_sfx.py'), 'utf8').match(/DEFAULT_SURGE = r'([^']+)'/) || [])[1] || ''; } catch {}
const surge = process.env.MANJU_SURGE || surgeDefault;
const surgeOk = exists(surge);
add(surgeOk ? '✅' : '⚠️', 'Surge XT 合成器', '剪辑：现做重击、咚、呼、上升音、长音，现写配乐', surgeOk ? `${surge}${process.env.MANJU_SURGE ? '（来自环境变量 MANJU_SURGE）' : '（脚本的默认位置）'}` : `${surge || '（没设）'} 不存在。装好后设环境变量 MANJU_SURGE 指到它，或者装到这个默认位置。没有它，强调点声音和配乐只能去剪映的音效库、曲库找`, '第 8 步');
const sfxDefault = WIN ? 'D:\\漫剧公司\\工具\\音频\\py311\\Scripts\\python.exe' : path.join(os.homedir(), '漫剧工具', '音频', 'py311', 'bin', 'python');
const sfxPy = opt('--sfx-python') || sfxDefault;
let sfxOk = false;
if (!exists(sfxPy)) add('⚠️', '合成器用的 python', '剪辑：现做音效', `${sfxPy} 不存在（不在这个位置就加 --sfx-python <路径> 再查）`, '第 8 步');
else {
  const r = run(sfxPy, ['-I', '-c', 'import sys,pedalboard,numpy;print(sys.version.split()[0],pedalboard.__version__)']);
  sfxOk = r.ok;
  add(r.ok ? '✅' : '⚠️', '合成器用的 python', '剪辑：现做音效', r.ok ? `${sfxPy}：python ${r.out.replace(' ', '，pedalboard ')}` : `${sfxPy} 没装 pedalboard 或 numpy：${last(r.err)}`, '第 8 步');
}

// 7. 装进 AI 工具了没有（只报告，不算问题）
const homeSkills = [path.join(os.homedir(), '.claude', 'skills'), path.join(os.homedir(), '.agents', 'skills')];
if (WIN && exists('D:\\漫剧公司')) homeSkills.push('D:\\漫剧公司\\.claude\\skills', 'D:\\漫剧公司\\.agents\\skills');
const count = (d) => { let n = 0; const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? walk(path.join(p, e.name)) : n++; }; try { walk(d); } catch { return -1; } return n; };
for (const s of ['分镜编导', '译镜', 'manju-edit']) {
  const pk = count(path.join(HERE, 'skills', s));
  const where = homeSkills.filter((d) => exists(path.join(d, s, 'SKILL.md'))).map((d) => { const n = count(path.join(d, s)); return `${d}（${n} 个文件${pk > 0 && n !== pk ? `，包里 ${pk} 个，不一样` : ''}）`; });
  add('✅', `装好的 ${s}`, '装进 AI 工具', where.length ? where.join('；') : '还没装进任何 skills 文件夹（跑 安装到这台电脑.ps1 / .sh）');
}

// 8. 试跑：拿包里的范例真跑
if (TRY) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '编导套装试跑_'));
  console.log(`试跑放在：${tmp}\n`);
  const node = process.execPath;
  // 分镜编导：查分镜、画机位图
  const fjEx = path.join(SK, '分镜编导', 'examples', '格式样例_v5_惹火34_戏1开头.md');
  if (exists(fjEx)) {
    const md = path.join(tmp, path.basename(fjEx));
    fs.copyFileSync(fjEx, md);
    const r1 = run(node, [path.join(SK, '分镜编导', 'scripts', 'check_storyboard.js'), md, '--partial']);
    const sum = (r1.out.match(/合计：.*/) || [''])[0];
    add(/合计：❌ 0 个/.test(sum) ? '✅' : '❌', '试跑 分镜编导 查分镜', '分镜编导', sum || `没跑出合计：${last(r1.err)}`);
    const r2 = run(node, [path.join(SK, '分镜编导', 'scripts', 'draw_plan.js'), md]);
    const html = md.replace(/\.md$/, '_机位图.html');
    add(r2.ok && exists(html) ? '✅' : '❌', '试跑 分镜编导 画机位图', '分镜编导', r2.ok && exists(html) ? html : last(r2.err) || last(r2.out));
  } else add('⚠️', '试跑 分镜编导', '分镜编导', `没有范例 ${fjEx}`);
  // 译镜：编译第 29 集范例，和范例里的成品逐字比
  const yjEx = path.join(SK, '译镜', 'examples', '320磅第29集');
  const bible = [path.join(HERE, '附带资料', '剧设定_竖屏', '320磅未婚妻不忍了.md'), path.join(bibleDir, '320磅未婚妻不忍了.md')].find(exists);
  if (exists(path.join(yjEx, '源')) && bible) {
    const src = path.join(tmp, '译镜范例', '源');
    copyDir(path.join(yjEx, '源'), src);
    const out = path.join(tmp, '译镜范例', '编译结果');
    const r = run(node, [path.join(SK, '译镜', 'scripts', 'build.js'), src, '--out', out, '--bible', bible]);
    const want = fs.readdirSync(yjEx).filter((f) => f.endsWith('_提示词.txt'));
    const got = exists(out) ? fs.readdirSync(out).filter((f) => f.endsWith('_提示词.txt')) : [];
    const same = want.filter((f) => got.includes(f) && fs.readFileSync(path.join(out, f), 'utf8') === fs.readFileSync(path.join(yjEx, f), 'utf8'));
    add(same.length === want.length && want.length ? '✅' : '❌', '试跑 译镜 编译第 29 集范例', '译镜', `${same.length}/${want.length} 段和范例一字不差${r.ok ? '' : `；编译退出码 ${r.code}：${last(r.out)}`}`);
  } else add('⚠️', '试跑 译镜', '译镜', '没有范例或剧设定，跳过');
  // 译镜 V2：跑自测（正面范例编译、反面案例都要被抓出来、机位术语）
  const st = path.join(SK, '译镜', 'scripts', 'self_test.js');
  const bible2 = [path.join(HERE, '附带资料', '剧设定_竖屏', '黑帮老大的圣诞礼物.md'), path.join(bibleDir, '黑帮老大的圣诞礼物.md')].find(exists);
  if (exists(st) && bible2) {
    const r = run(node, [st, '--bible', bible2, ...(bible ? ['--bible-v1', bible] : [])]);
    add(r.ok ? '✅' : '❌', '试跑 译镜 V2 自测', '译镜', r.ok ? '全过：正面范例没有 ❌，反面案例都抓出来了' : (r.out.split('\n').filter((l) => /^❌/.test(l)).slice(0, 3).join('；') || last(r.err) || last(r.out)));
  } else add('⚠️', '试跑 译镜 V2 自测', '译镜', '没有自测脚本或《黑帮老大的圣诞礼物》剧设定，跳过');
  // 剪辑：ffmpeg 做一条 3 秒测试片，跑查成片
  const vid = path.join(tmp, '测试片.mp4');
  const mk = run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', vid]);
  if (mk.ok) {
    const r = run(node, [path.join(SK, 'manju-edit', 'scripts', 'qc_media.mjs'), vid, '--out', path.join(tmp, '查成片')]);
    add(r.ok ? '✅' : '❌', '试跑 剪辑 查成片（qc_media）', 'manju-edit', r.ok ? `跑通，报告在 ${path.join(tmp, '查成片')}` : `退出码 ${r.code}：${last(r.err) || last(r.out)}`);
  } else add('❌', '试跑 剪辑 查成片', 'manju-edit', `ffmpeg 做不出测试片：${last(mk.err)}`);
  // 剪辑：合成器出一个重击
  if (surgeOk && sfxOk) {
    const env = { ...process.env, MANJU_SURGE: surge };
    const r = run(sfxPy, ['-I', path.join(SK, 'manju-edit', 'scripts', 'sound', 'surge_sfx.py'), path.join(tmp, '音效'), 'hit'], { env });
    const dir = path.join(tmp, '音效');
    const wav = exists(dir) ? fs.readdirSync(dir).find((f) => /hit.*\.wav$/i.test(f)) : '';   // 文件名会带中文名、长度、音高，只认 hit
    add(r.ok && wav ? '✅' : '❌', '试跑 剪辑 合成器出重击', 'manju-edit', r.ok && wav ? path.join(dir, wav) : `退出码 ${r.code}：${last(r.err) || '没出 wav'}`);
    const song = path.join(tmp, '音效', '配乐试跑.wav');
    const m = run(sfxPy, ['-I', path.join(SK, 'manju-edit', 'scripts', 'sound', 'surge_music.py'), song, 'mood=悬疑:4,打戏:8'], { env });
    add(m.ok && exists(song) ? '✅' : '❌', '试跑 剪辑 合成器写 8 秒配乐', 'manju-edit', m.ok && exists(song) ? song : `退出码 ${m.code}：${last(m.err) || '没出 wav'}`);
  } else add('⚠️', '试跑 剪辑 合成器', 'manju-edit', 'Surge XT 或合成器用的 python 没装好，跳过');
  // 译镜审片：只试能不能载入语音模型
  if (fwOk && modelOk) {
    const r = run(pyName, ['-c', "import sys;from faster_whisper import WhisperModel;WhisperModel(sys.argv[1],device='cpu',compute_type='int8');print('ok')", model]);
    add(r.ok ? '✅' : '❌', '试跑 译镜审片 载入语音模型', '译镜', r.ok ? '载入成功' : last(r.err));
  } else add('⚠️', '试跑 译镜审片 语音模型', '译镜', 'python、faster-whisper 或模型没装好，跳过（审片可以 --no-asr）');
}

// 输出
for (const r of rows) {
  console.log(`${r.lv} ${r.item}  —  ${r.detail}`);
  console.log(`     管：${r.who}${r.lv !== '✅' && r.fix ? `；怎么补：给另一台电脑的Claude_装环境.md ${r.fix}` : ''}`);
}
const nE = rows.filter((r) => r.lv === '❌').length, nW = rows.filter((r) => r.lv === '⚠️').length;
console.log(`\n合计：❌ ${nE} 个，⚠️ ${nW} 个。${TRY ? '' : '装好后加 --试跑 再查一次。'}`);
process.exit(nE ? 1 : 0);
