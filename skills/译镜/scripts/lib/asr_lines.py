# v5 看片：把成片里说的话识别出来，和提示词里的台词逐句对。只读文件，不改任何东西。
# usage: python -I asr_lines.py <提示词文件夹> <成片文件夹> <模型文件夹> [ffmpeg 路径]
# 输出一段 JSON（标准输出）：每段每句台词说没说、像不像；有没有多出来的话；有没有中文。
# 识别会漏掉很短的词（hi、no），也分不清"说错一两个词"：结果是给人指路的，定论还得人听。
import json, os, re, subprocess, sys, difflib

prompts_dir, videos_dir, model_dir = sys.argv[1:4]
ffmpeg = sys.argv[4] if len(sys.argv) > 4 else 'ffmpeg'
import numpy as np
from faster_whisper import WhisperModel

def seg_no(name):
    m = re.search(r'段(\d+)', name)
    return int(m.group(1)) if m else None

prompts = {}
for f in os.listdir(prompts_dir):
    if re.search(r'段\d+.*提示词.*\.txt$', f):
        prompts[seg_no(f)] = open(os.path.join(prompts_dir, f), encoding='utf-8').read()
videos = {}
for f in sorted(os.listdir(videos_dir)):
    if f.lower().endswith(('.mp4', '.mov')) and seg_no(f) is not None and '历史' not in f:
        videos.setdefault(seg_no(f), os.path.join(videos_dir, f))

norm = lambda s: re.sub(r'[^a-z0-9 ]', '', s.lower()).strip()
CJK = re.compile(r'[一-鿿]')
model = WhisperModel(model_dir, device='cpu', compute_type='int8', cpu_threads=max(4, (os.cpu_count() or 8) - 2))
out = []
for n in sorted(videos):
    if n not in prompts:
        continue
    want = [(m.group(1), m.group(2), m.group(3)) for m in re.finditer(r'^Dialogue:\s*([\d.]+)[–-]([\d.]+)s,.*?\{(.+?)\}\s*$', prompts[n], flags=re.M)]
    if not want:
        want = [('', '', x) for x in re.findall(r'^Dialogue:.*?\{(.+?)\}', prompts[n], flags=re.M)]
    raw = subprocess.run([ffmpeg, '-v', 'error', '-i', videos[n], '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True, check=True).stdout
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    segs, info = model.transcribe(audio, beam_size=3, vad_filter=True, word_timestamps=False, multilingual=True, condition_on_previous_text=False)
    heard = [dict(start=round(s.start, 2), end=round(s.end, 2), text=s.text.strip(), lang=getattr(s, 'language', None)) for s in segs]
    full = norm(' '.join(h['text'] for h in heard))
    lines = []
    for a, b, text in want:
        w = norm(text)
        if not w:
            continue
        sm = difflib.SequenceMatcher(None, w, full, autojunk=False)
        ratio = sum(x.size for x in sm.get_matching_blocks() if x.size >= 4) / len(w)
        lines.append(dict(text=text, t0=a, t1=b, ratio=round(ratio, 2), said=ratio >= 0.6, words=len(w.split())))
    wfull = ' '.join(norm(x[2]) for x in want)
    extra = []
    for h in heard:
        nn = norm(h['text'])
        if len(nn) < 4:
            continue
        sm = difflib.SequenceMatcher(None, nn, wfull, autojunk=False)
        if sum(x.size for x in sm.get_matching_blocks() if x.size >= 4) / max(1, len(nn)) < 0.5:
            extra.append(dict(at=h['start'], text=h['text']))
    zh = [dict(at=h['start'], text=h['text']) for h in heard if CJK.search(h['text']) or (h['lang'] or '').startswith('zh')]
    out.append(dict(seg=n, video=os.path.basename(videos[n]), lang=info.language, lines=lines, extra=extra, zh=zh, heard=' | '.join(h['text'] for h in heard)))
    print(f'段{n} 识别完', file=sys.stderr, flush=True)
sys.stdout.reconfigure(encoding='utf-8')
print(json.dumps(out, ensure_ascii=False))
