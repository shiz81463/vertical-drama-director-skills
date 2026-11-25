"""用 Surge XT 现写一段连贯的配乐：一个调、一个速度、一条贯穿的旋律，情绪按镜头变，有开头有结尾，换情绪的点正好落在切点上。

用法（Python 同 surge_sfx.py，见 references/sound-design.md 第三节）：
    python -I surge_music.py <输出.wav> mood=悬疑:12,打戏:30,悲伤:45 [参数...]
    python -I surge_music.py <输出.wav> plan=<配乐计划.json> [参数...]

mood    情绪:到第几秒，逗号分开，最后一个时间就是全长。时间可写秒（12.5）或帧（360f）。
        情绪：悬疑 压迫 打戏 爽点 悲伤 温情 甜（也认 tension dark battle triumph sad warm sweet）
key     调，默认 Am。可写 Dm、C、F#m。一条配乐全程一个调。
bpm     基础速度，默认 80。打戏靠十六分音符变快，不换速度，所以听起来是同一首。
start   开头：soft 先铺底再进（默认）/ hit 第一拍就全进
ending  结尾：ring 落到主和弦自然收（默认）/ stinger 最后砸一下收住（留悬念）/ loop 首尾无缝循环
hits    要砸重音的时间点，逗号分开：hits=8.2,16.4 或 hits=246f。音乐在这一下让开一点。
melody  on（默认）/ off。台词密的段落用 off，只留铺底和节奏，不和对白抢。
seed    换一个数字，旋律就换一条。stems=1 另存分轨，能在剪映里单独调每种乐器。fps 帧率，默认 30。

输出：<输出.wav>（48 kHz 24 位，长度准到采样）和 <输出>_配乐表.txt（每段起止、和弦、重音时间）。
"""
import itertools
import json
import math
import os
import random
import re
import sys
from collections import defaultdict

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from pedalboard import Chorus, Compressor, Delay, HighpassFilter, Limiter, LowpassFilter, Pedalboard, Reverb
from pedalboard.io import AudioFile

from surge_sfx import SR, Surge, _hz, boom

SCALE = [0, 2, 3, 5, 7, 8, 10]  # 自然小调；大调情绪用它的关系大调（同一组音），所以换情绪不跑调
NAMES = {'悬疑': 'tension', '压迫': 'dark', '打戏': 'battle', '爽点': 'triumph', '悲伤': 'sad', '温情': 'warm', '甜': 'sweet'}

# prog：和弦（离小调主音几个半音，m 小 / M 大）；chord：每个和弦几拍；cut：铺底亮度；home：结尾落在哪；e：能量，用来判断要不要做过门
# lv：各乐器音量（dB，0 = 平均 -18 dBFS），不写就是这段不用
MOODS = {
    'tension': dict(zh='悬疑', prog=[(0, 'm'), (0, 'm'), (1, 'M'), (0, 'm')], chord=4, cut=520, col=2, home=0, e=.25, bass='long', arp=None,
                    lead=('bell', 16, 4), drums='heart', lv=dict(pad=-2, bass=-6, bell=-9, drums=-7)),
    'dark': dict(zh='压迫', prog=[(0, 'm'), (8, 'M'), (1, 'M'), (7, 'M')], chord=4, cut=760, col=10, home=0, e=.55, bass='root', arp=None,
                 lead=('lead', 16, 5), drums='taiko', lv=dict(pad=0, bass=-2, lead=-7, drums=-1)),
    'battle': dict(zh='打戏', prog=[(0, 'm'), (8, 'M'), (3, 'M'), (10, 'M')], chord=4, cut=1500, col=0, home=0, e=1.0, bass='drive', arp=('pluck', 'p16'),
                   lead=('lead', 8, 99), drums='battle', lv=dict(pad=-4, bass=0, pluck=-5, lead=-3, drums=2)),
    'triumph': dict(zh='爽点', prog=[(8, 'M'), (10, 'M'), (0, 'm'), (3, 'M')], chord=4, cut=2400, col=2, home=3, e=.9, bass='pulse', arp=('pluck', 'p16'),
                    lead=('lead', 8, 99), drums='triumph', lv=dict(pad=0, bass=-1, pluck=-5, lead=-1, drums=1)),
    'sad': dict(zh='悲伤', prog=[(8, 'M'), (3, 'M'), (10, 'M'), (0, 'm')], chord=4, cut=900, col=2, home=0, e=.3, bass='long', arp=('keys', 'k8'),
                lead=('keys', 16, 99), drums=None, lv=dict(pad=-3, bass=-9, keys=-2)),
    'warm': dict(zh='温情', prog=[(3, 'M'), (10, 'M'), (0, 'm'), (8, 'M')], chord=4, cut=1300, col=2, home=3, e=.4, bass='root', arp=('keys', 'k8'),
                 lead=('bell', 16, 99), drums='shaker', lv=dict(pad=-4, bass=-6, keys=-2, bell=-8, drums=-10)),
    'sweet': dict(zh='甜', prog=[(3, 'M'), (0, 'm'), (8, 'M'), (10, 'M')], chord=4, cut=1800, col=2, home=3, e=.55, bass='pulse', arp=('pluck', 'p8'),
                  lead=('bell', 8, 99), drums='soft', lv=dict(pad=-7, bass=-5, pluck=-2, bell=-5, drums=-4)),
}

# 鼓：一小节 16 步，{步: 力度}
DRUMS = {
    'heart': dict(steps=8, kick={0: .85, 2: .55}),
    'taiko': dict(steps=16, taiko={0: 1, 6: .6, 8: .85, 11: .5}),
    'battle': dict(steps=16, kick={0: 1, 3: .7, 6: .8, 8: 1, 11: .7, 14: .7}, snare={4: 1, 12: 1}, taiko={0: .7, 8: .6},
                   hat={i: (.55 if i % 2 == 0 else .28) for i in range(16)}),
    'triumph': dict(steps=16, kick={0: 1, 8: .9, 10: .6}, snare={4: 1, 12: 1}, taiko={0: .6}, hat={i: .5 for i in range(0, 16, 2)}),
    'soft': dict(steps=16, kick={0: .7, 8: .6}, snare={4: .38, 12: .38}, shaker={i: .4 for i in range(0, 16, 2)}),
    'shaker': dict(steps=16, shaker={i: (.5 if i % 4 == 2 else .3) for i in range(0, 16, 2)}),
}
SHOT_GAIN = dict(kick=1.0, taiko=.9, snare=.55, hat=.16, shaker=.14)
MOOD_GAIN = dict(tension=-3, dark=-1, battle=0, triumph=0, sad=-5, warm=-5, sweet=-4)  # 整段的轻重：文戏要比打戏轻，一条配乐才有起伏
FX_SEND = dict(pad=.25, bass=.02, keys=.28, pluck=.2, bell=.5, lead=.32, drums=.1, accent=.35)


# ---------------------------------------------------------------- 读参数
def t_of(v, fps):
    v = str(v).strip().lower()
    return float(v[:-1]) / fps if v.endswith('f') else float(v.rstrip('s'))


def key_of(v):
    m = re.fullmatch(r'([A-Ga-g])([#b]?)(m?)', str(v).strip())
    if not m:
        raise SystemExit(f'看不懂的调：{v}（写成 Am、Dm、C、F#m）')
    pc = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[m.group(1).upper()] + {'#': 1, 'b': -1, '': 0}[m.group(2)]
    return (pc if m.group(3) else pc - 3) % 12   # 大调换算成它的关系小调主音


def mood_of(v):
    k = NAMES.get(v, v)
    if k not in MOODS:
        raise SystemExit(f'没有这个情绪：{v}（可用：{" ".join(NAMES)}）')
    return k


def config(args):
    opt = {}
    for a in args:
        if '=' not in a:
            raise SystemExit(f'看不懂的参数：{a}（写成 mood=悬疑:12,打戏:30）')
        k, v = a.split('=', 1)
        opt[k.strip().lower()] = v.strip()
    if 'plan' in opt:
        with open(opt.pop('plan'), encoding='utf-8') as f:
            base = json.load(f)
        base.update(opt)
        opt = base
    bad = set(opt) - {'mood', 'segments', 'key', 'bpm', 'start', 'ending', 'hits', 'melody', 'seed', 'stems', 'fps'}
    if bad:
        raise SystemExit('不认识的参数：' + ' '.join(sorted(bad)))
    fps = float(opt.get('fps', 30))
    raw = opt.get('segments') or [dict(zip(('mood', 'to'), p.split(':'))) for p in str(opt.get('mood', '')).split(',') if p]
    if not raw or any('to' not in r for r in raw):
        raise SystemExit('要写情绪和时间：mood=悬疑:12,打戏:30')
    segs, last = [], 0.0
    for r in raw:
        to = t_of(r['to'], fps)
        if to <= last + .4:
            raise SystemExit(f'时间要一段比一段靠后，且每段至少 0.5 秒：{r["to"]}')
        segs.append(dict(mood=mood_of(r['mood']), a=last, b=to))
        last = to
    if not 3 <= last <= 600:
        raise SystemExit('全长要在 3 到 600 秒之间')
    start, ending = opt.get('start', 'soft'), opt.get('ending', 'ring')
    if start not in ('soft', 'hit') or ending not in ('ring', 'stinger', 'loop'):
        raise SystemExit('start 只能是 soft/hit，ending 只能是 ring/stinger/loop')
    hv = opt.get('hits', [])
    hits = sorted(t_of(h, fps) for h in (hv.split(',') if isinstance(hv, str) and hv else hv))
    if any(not 0 <= h < last for h in hits):
        raise SystemExit('hits 的时间超出配乐长度')
    bpm = float(opt.get('bpm', 80))
    if not 40 <= bpm <= 200:
        raise SystemExit('bpm 要在 40 到 200 之间')
    return dict(segs=segs, len=last, tonic=key_of(opt.get('key', 'Am')), key=str(opt.get('key', 'Am')), bpm=bpm, start=start, ending=ending,
                hits=hits, melody=str(opt.get('melody', 'on')).lower() not in ('off', '0', 'false'), seed=int(opt.get('seed', 1)),
                stems=str(opt.get('stems', '0')) in ('1', 'on', 'true'))


# ---------------------------------------------------------------- 写谱
def pcs(tonic, root, q, col):
    r = (tonic + root) % 12
    third = 3 if q == 'm' else 4
    return [r, (r + third) % 12, (r + 7) % 12, (r + (col if not (q == 'M' and col == 10) else 0)) % 12]


def voicing(prev, tones, lo=48, hi=74):
    """选离上一个和弦最近的摆法：各声部走得最少，听起来才连"""
    best, cost = None, 1e9
    for perm in set(itertools.permutations(tones)):
        v = [min((n for n in range(lo, hi + 1) if n % 12 == pc), key=lambda n: abs(n - p)) for p, pc in zip(prev, perm)]
        s = sorted(v)
        c = sum(abs(a - b) for a, b in zip(v, prev)) + sum(5 for a, b in zip(s, s[1:]) if b - a < 2)
        if c < cost:
            best, cost = s, c
    return best


def motif(rng):
    """贯穿全曲的一条短旋律（8 拍）：各段用不同乐器奏同一条，这是"连贯"的来源"""
    r = rng.choice([[0, 1.5, 2, 3, 4, 5.5, 6], [0, 1, 2, 3.5, 4, 6], [0, .5, 1, 2, 4, 5, 6], [0, 2, 2.5, 3, 4, 6, 7]])
    d = [rng.choice([0, 2, 4])]
    for _ in r[1:]:
        d.append(max(-2, min(6, d[-1] + rng.choice([-2, -1, -1, 1, 1, 2]))))
    d[-1] = rng.choice([0, 2])
    return [(b, (r[i + 1] if i + 1 < len(r) else 8) - b, d[i]) for i, b in enumerate(r)]


def compose(cfg):
    rng = random.Random(cfg['seed'])
    mot, tonic, loop = motif(rng), cfg['tonic'], cfg['ending'] == 'loop'
    beat0, L = 60 / cfg['bpm'], cfg['len']
    last_dur = cfg['segs'][-1]['b'] - cfg['segs'][-1]['a']
    ring = 0.0 if loop else (min(1.6, last_dur * .5) if cfg['ending'] == 'stinger' else min(min(4.0, max(1.5, .12 * L)), max(.8, last_dur * .5)))
    end = L - ring
    notes, shots, chords, sc = defaultdict(list), [], [], []
    v = [57, 60, 64, 67]

    def add(inst, t, d, n, vel, jit=.006):
        t2 = max(0.0, t + rng.uniform(-jit, jit))
        notes[inst].append((t2, max(.02, d), int(n), int(max(1, min(127, vel + rng.randint(-5, 5))))))

    for si, sg in enumerate(cfg['segs']):
        m = MOODS[sg['mood']]
        a, b = sg['a'], min(sg['b'], end)
        n = max(1, round((b - a) / beat0))
        if loop:
            n = max(4, round(n / 4) * 4)
        beat = (b - a) / n                    # 这一段的拍长微调，让段尾正好落在切点上
        sg.update(end=b, beats=n, beat=beat, chords=[])
        intro = a + min(4, n // 2) * beat if si == 0 and cfg['start'] == 'soft' else a
        k_chords = math.ceil(n / m['chord'])
        for ci in range(k_chords):
            t0 = a + ci * m['chord'] * beat
            cb = min(m['chord'], n - ci * m['chord'])
            root, q = m['prog'][ci % len(m['prog'])]
            if not loop and si == len(cfg['segs']) - 1 and ci == k_chords - 1 and k_chords > 1:
                root, q = (m['home'] + 7) % 12, 'M'   # 结尾前放属和弦，落到主和弦才有"收住了"的感觉
            v = voicing(v, pcs(tonic, root, q, m['col']))
            dur = cb * beat
            chords.append(dict(t=t0, d=dur, tones={x % 12 for x in v}))
            sg['chords'].append((root, q))
            for x in v:
                add('pad', t0, dur, x, 92 if t0 >= intro else 74, .0)
            low = min((x for x in range(33, 45) if x % 12 == (tonic + root) % 12))
            if t0 + dur > intro:
                bass_steps = {'long': [(0, cb * .95)], 'root': [(i, 1.7) for i in range(0, cb, 2)],
                              'pulse': [(i / 2, .42) for i in range(cb * 2)],
                              'drive': [(i / 4, .2) for i in range(cb * 4) if i % 8 in (0, 2, 3, 4, 6, 7)]}[m['bass']]
                for st, ln in bass_steps:
                    if t0 + st * beat >= intro:
                        add('bass', t0 + st * beat, ln * beat, low, 112 if st % 2 == 0 else 92, .003)
            if m['arp']:
                inst, pat = m['arp']
                tn = v + [v[0] + 12]
                order = {'k8': [0, 2, 1, 3, 4, 3, 2, 1], 'p8': [0, 2, 4, 2, 3, 1, 4, 2], 'p16': [0, 2, 3, 4, 3, 2, 1, 2]}[pat]
                div = 4 if pat == 'p16' else 2
                up = 12 if inst == 'pluck' else 0
                for i in range(cb * div):
                    t = t0 + i / div * beat
                    if t >= intro:
                        add(inst, t, (1.6 if inst == 'keys' else .8) / div * beat, tn[order[i % len(order)]] + up, 100 if i % div == 0 else 78)
        # 贯穿旋律
        if cfg['melody'] and m['lead']:
            inst, every, max_notes = m['lead']
            reg = {'bell': 76, 'keys': 72, 'lead': 69}[inst]
            base = min((x for x in range(reg - 6, reg + 6) if x % 12 == tonic), key=lambda x: abs(x - reg))
            first = math.ceil((intro - a) / beat / 4) * 4 if intro > a else 0
            for kb in range(first, n, every):
                for j, (bb, ln, deg) in enumerate(mot[:max_notes]):
                    t = a + (kb + bb) * beat
                    if t >= b - .05:
                        break
                    c = next((c for c in chords if c['t'] <= t < c['t'] + c['d']), chords[-1])
                    p = base + SCALE[deg % 7] + 12 * (deg // 7)
                    if bb % 2 == 0 or not {(tonic + x) % 12 for x in SCALE} >= c['tones']:   # 强拍和弦外音会刺耳，贴到最近的和弦音
                        p = min((p + o for o in range(-6, 7) if (p + o) % 12 in c['tones']), key=lambda x: abs(x - p))
                    add(inst, t, min(ln, (b - t) / beat) * beat * .92, p, 104 if j == 0 else 92, .008)
        # 鼓
        if m['drums']:
            pt = DRUMS[m['drums']]
            step, steps = beat / 4, pt['steps']
            for i in range(n * 4):
                t = a + i * step
                if t < intro:
                    continue
                for name in ('kick', 'taiko', 'snare', 'hat', 'shaker'):
                    vel = pt.get(name, {}).get(i % steps)
                    if vel:
                        shots.append((name, t + rng.uniform(-.002, .002), vel * rng.uniform(.92, 1.05)))
                        if name == 'kick' and m['e'] >= .5:
                            sc.append((t, .28, .09))

    # 换到更有劲的段：前面一个上扬的气声，切点上一记太鼓
    swells = []
    for x, y in zip(cfg['segs'], cfg['segs'][1:]):
        if MOODS[y['mood']]['e'] - MOODS[x['mood']]['e'] >= .25:
            swells.append((y['a'], min(2 * x['beat'], (x['end'] - x['a']) * .6)))
            shots.append(('taiko', y['a'], 1.0))

    # 结尾
    if not loop:
        m = MOODS[cfg['segs'][-1]['mood']]
        q = 'M' if m['home'] == 3 else 'm'
        v = voicing(v, pcs(tonic, m['home'], q, 2))
        stab = cfg['ending'] == 'stinger'
        for x in v:
            add('pad', end, ring * (.45 if stab else .75), x, 104 if stab else 88, 0)
        low = min(x for x in range(33, 45) if x % 12 == (tonic + m['home']) % 12)
        add('bass', end, ring * (.4 if stab else .7), low, 112, 0)
        for i, x in enumerate(v):
            add('keys', end + (0 if stab else i * .035), ring * .8, x + 12, 96, 0)
        if stab:
            shots += [('taiko', end, 1.0), ('kick', end, 1.0)]
        chords.append(dict(t=end, d=ring, tones={x % 12 for x in v}))
    for h in cfg['hits']:
        sc.append((h, .45, .25))
    return dict(notes=notes, shots=shots, swells=swells, sc=sc, ring=ring, end=end, beat0=beat0)


def clean(ns, legato):
    """同一个音：铺底连着的并成一个长音（不重新起音），其他的前一个要在后一个开始前松开"""
    by = defaultdict(list)
    for t, d, n, v in sorted(ns):
        by[n].append([t, d, n, v])
    out = []
    for arr in by.values():
        cur = arr[0]
        for x in arr[1:]:
            if legato and x[0] <= cur[0] + cur[1] + .03:
                cur[1] = max(cur[1], x[0] + x[1] - cur[0])
                continue
            cur[1] = min(cur[1], x[0] - cur[0] - .004)
            out.append(tuple(cur))
            cur = x
        out.append(tuple(cur))
    return [x for x in out if x[1] > .005]


# ---------------------------------------------------------------- 音色
def base(s, **kw):
    s.reset()
    s.set('a_filter_configuration', 'Serial 1'); s.set('a_velocity_vca_gain', '-18 dB'); s.set('a_osc_drift', '20 %'); s.set('a_volume', '-12 dB')
    for k, v in kw.items():
        s.set(k, v)


PATCH = {
    'pad': dict(a_osc_1_unison_voices='5 voices', a_osc_1_unison_detune='14 cents', a_osc_2_mute=False, a_osc_2_octave='-1', a_osc_2_volume='-10 dB',
                a_filter_1_type='LP 24 dB', a_filter_1_resonance='10 %', a_amp_eg_attack='450 ms', a_amp_eg_decay='1000 ms', a_amp_eg_sustain='85 %', a_amp_eg_release='1200 ms'),
    'bass': dict(a_osc_1_sub_mix='40 %', a_filter_1_type='LP 24 dB', a_filter_1_cutoff='420 Hz', a_filter_1_resonance='15 %', a_filter_1_feg_mod_amount='24 semitones',
                 a_filter_eg_attack='0 ms', a_filter_eg_decay='180 ms', a_filter_eg_sustain='0 %', a_amp_eg_attack='3 ms', a_amp_eg_decay='400 ms', a_amp_eg_sustain='70 %', a_amp_eg_release='90 ms'),
    'keys': dict(a_osc_1_shape='-100 %', a_osc_2_mute=False, a_osc_2_type='Sine', a_osc_2_octave='1', a_osc_2_volume='-12 dB', a_filter_1_type='LP 12 dB', a_filter_1_cutoff='800 Hz',
                 a_filter_1_feg_mod_amount='30 semitones', a_filter_eg_attack='0 ms', a_filter_eg_decay='350 ms', a_filter_eg_sustain='0 %',
                 a_amp_eg_attack='2 ms', a_amp_eg_decay='1600 ms', a_amp_eg_sustain='0 %', a_amp_eg_release='350 ms'),
    'pluck': dict(a_osc_1_unison_voices='2 voices', a_filter_1_type='LP 24 dB', a_filter_1_cutoff='500 Hz', a_filter_1_feg_mod_amount='40 semitones',
                  a_filter_eg_attack='0 ms', a_filter_eg_decay='150 ms', a_filter_eg_sustain='0 %', a_amp_eg_attack='1 ms', a_amp_eg_decay='360 ms', a_amp_eg_sustain='0 %', a_amp_eg_release='150 ms'),
    'bell': dict(a_osc_1_type='Sine', a_osc_2_mute=False, a_osc_2_type='Sine', a_osc_2_octave='2', a_osc_2_volume='-14 dB', a_osc_3_mute=False, a_osc_3_type='Sine', a_osc_3_octave='3',
                 a_osc_3_pitch='7 semitones', a_osc_3_volume='-24 dB', a_amp_eg_attack='1 ms', a_amp_eg_decay='2400 ms', a_amp_eg_sustain='0 %', a_amp_eg_release='900 ms'),
    'lead': dict(a_osc_1_unison_voices='3 voices', a_osc_1_unison_detune='9 cents', a_filter_1_type='LP 24 dB', a_filter_1_cutoff='1400 Hz', a_filter_1_feg_mod_amount='18 semitones',
                 a_filter_eg_attack='5 ms', a_filter_eg_decay='250 ms', a_filter_eg_sustain='40 %', a_amp_eg_attack='25 ms', a_amp_eg_decay='300 ms', a_amp_eg_sustain='85 %', a_amp_eg_release='200 ms'),
}


def render_inst(s, inst, ns, total, cfg):
    base(s, **PATCH[inst])
    chunks = None
    if inst == 'pad':
        segs = cfg['segs']
        def cut(t):
            sg = next((x for x in segs if t < x['b']), segs[-1])
            c = MOODS[sg['mood']]['cut']
            prev = next((x for x in reversed(segs) if x['b'] <= sg['a'] + 1e-6), None)
            if prev is not None and t < sg['a'] + 1.0:
                c = MOODS[prev['mood']]['cut'] ** (1 - (t - sg['a'])) * c ** (t - sg['a'])
            return c * (1 + .12 * math.sin(2 * math.pi * t / 7.0))   # 慢慢呼吸，长音才不死板
        chunks = [(round(float(t), 2), {'a_filter_1_cutoff': _hz(cut(float(t)))}) for t in np.arange(0, total, .1)]
    return s.render(total, notes=clean(ns, inst == 'pad'), chunks=chunks)


def _pk(x):
    return x / (np.abs(x).max() + 1e-9)


def make_shots(s):
    out = defaultdict(list)
    bend = {'a_pitch_bend_down_range': '24 semitones', 'a_pitch_bend_up_range': '24 semitones', 'a_osc_1_type': 'Sine', 'a_amp_eg_attack': '0 ms', 'a_amp_eg_sustain': '0 %', 'a_amp_eg_release': '60 ms'}
    noise = {'a_osc_1_mute': True, 'a_noise_mute': False, 'a_amp_eg_attack': '0 ms', 'a_amp_eg_sustain': '0 %', 'a_amp_eg_release': '40 ms'}
    for _ in range(2):
        base(s, a_amp_eg_decay='280 ms', **bend)
        out['kick'].append(_pk(s.render(.45, [(0, .02, 33, 127)], [(0, .5), (.01, .3), (.025, .14), (.05, .05), (.09, 0)])))
        base(s, a_amp_eg_decay='620 ms', **bend)
        t = s.render(1.0, [(0, .03, 31, 127)], [(0, .32), (.02, .16), (.05, .06), (.1, 0)])
        base(s, a_amp_eg_decay='70 ms', a_filter_1_type='BP 12 dB', a_filter_1_cutoff='320 Hz', a_filter_1_resonance='25 %', **noise)
        n = s.render(1.0, [(0, .02, 60, 127)])
        out['taiko'].append(_pk(t + n * .9))
    for _ in range(3):
        base(s, a_amp_eg_decay='170 ms', a_filter_1_type='BP 12 dB', a_filter_1_cutoff='1800 Hz', a_filter_1_resonance='10 %', **noise)
        n = s.render(.4, [(0, .02, 60, 127)])
        base(s, a_osc_1_type='Sine', a_amp_eg_attack='0 ms', a_amp_eg_decay='90 ms', a_amp_eg_sustain='0 %', a_amp_eg_release='40 ms')
        out['snare'].append(_pk(n + s.render(.4, [(0, .02, 52, 120)]) * .5))
        base(s, a_amp_eg_decay='45 ms', a_filter_1_type='HP 24 dB', a_filter_1_cutoff='7500 Hz', **noise)
        out['hat'].append(_pk(s.render(.2, [(0, .01, 60, 127)])))
        kw = dict(noise); kw['a_amp_eg_attack'] = '15 ms'
        base(s, a_amp_eg_decay='60 ms', a_filter_1_type='BP 12 dB', a_filter_1_cutoff='5500 Hz', **kw)
        out['shaker'].append(_pk(s.render(.2, [(0, .03, 60, 110)])))
    return out


def make_swell(s, dur):
    base(s, a_osc_1_mute=True, a_noise_mute=False, a_noise_color='-20 %', a_filter_1_type='LP 24 dB', a_filter_1_resonance='20 %',
         a_amp_eg_attack=f'{dur * 1000:.0f} ms', a_amp_eg_attack_shape='Concave', a_amp_eg_sustain='100 %', a_amp_eg_release='30 ms')
    chunks = [(round(float(t), 3), {'a_filter_1_cutoff': _hz(400 * 18 ** (t / dur))}) for t in np.arange(0, dur, .03)]
    return _pk(s.render(dur, [(0, dur + 1, 60, 110)], chunks=chunks))


def place(buf, x, t, g, pan=0.0):
    i = int(round(t * SR))
    n = min(x.shape[1], buf.shape[1] - i)
    if n > 0 and i >= 0:
        buf[0, i:i + n] += x[0, :n] * g * (1 - max(pan, 0))
        buf[1, i:i + n] += x[1, :n] * g * (1 + min(pan, 0))


# ---------------------------------------------------------------- 混音
def level_norm(x):
    w = int(.05 * SR)
    k = x.shape[1] // w
    r = np.sqrt((x[:, :k * w] ** 2).reshape(2, k, w).mean(axis=(0, 2)))
    act = r[r > r.max() * .1] if r.max() > 0 else r
    return x * (10 ** (-18 / 20) / (np.sqrt((act ** 2).mean()) + 1e-9)) if len(act) else x


def env_of(inst, cfg, n):
    """每段这件乐器的音量；这段不用它时保持上一段的值，好让余音自然收掉"""
    xs, ys, cur = [0.0], [None], None
    group = 'drums' if inst == 'drums' else inst
    pts = []
    for sg in cfg['segs']:
        lv = MOODS[sg['mood']]['lv'].get(group)
        cur = (10 ** ((lv + MOOD_GAIN[sg['mood']]) / 20)) if lv is not None else cur
        pts.append((sg['a'], cur))
    first = next((g for _, g in pts if g is not None), 1.0)
    xs, ys = [], []
    for i, (t, g) in enumerate(pts):
        g = first if g is None else g
        if i:
            xs.append(t - .06); ys.append(ys[-1])
            xs.append(t + .06)
        else:
            xs.append(0.0)
        ys.append(g)
    xs.append(n / SR); ys.append(ys[-1])
    return np.interp(np.arange(n) / SR, xs, ys).astype(np.float32)


def mixdown(s, cfg, score):
    beat = score['beat0']
    total = cfg['len'] + 3.5
    N = int(total * SR)
    stems = {}
    FX = {
        'pad': [HighpassFilter(140)],
        'bass': [HighpassFilter(34), LowpassFilter(2200), Compressor(threshold_db=-18, ratio=3, attack_ms=10, release_ms=120)],
        'keys': [HighpassFilter(140)],
        'pluck': [HighpassFilter(220), Delay(delay_seconds=beat * .75, feedback=.22, mix=.16)],
        'bell': [HighpassFilter(400), Delay(delay_seconds=beat * .75, feedback=.3, mix=.2)],
        'lead': [HighpassFilter(180), Chorus(rate_hz=.6, depth=.12, centre_delay_ms=8, feedback=0, mix=.3)],
    }
    for inst, ns in score['notes'].items():
        x = render_inst(s, inst, ns, total, cfg)
        x = x[:, :N] if x.shape[1] >= N else np.pad(x, ((0, 0), (0, N - x.shape[1])))
        if inst == 'bass':
            x = np.repeat(x.mean(axis=0, keepdims=True), 2, axis=0)
        x = level_norm(Pedalboard(FX[inst])(x, SR))
        stems[inst] = x * env_of(inst, cfg, N)
    if score['shots']:
        lib = make_shots(s)
        d = np.zeros((2, N), dtype=np.float32)
        pick = random.Random(cfg['seed'] + 7)
        for name, t, v in score['shots']:
            place(d, pick.choice(lib[name]), t, SHOT_GAIN[name] * v, {'hat': .18, 'shaker': -.18}.get(name, 0))
        d = level_norm(Pedalboard([Compressor(threshold_db=-12, ratio=2.5, attack_ms=6, release_ms=90)])(d, SR))
        stems['drums'] = d * env_of('drums', cfg, N)
    acc = np.zeros((2, N), dtype=np.float32)
    used = False
    for t, dur in score['swells']:
        sw = make_swell(s, dur)
        place(acc, sw, t - sw.shape[1] / SR, .16)
        used = True
    if cfg['hits'] or cfg['ending'] == 'stinger':
        st = ((cfg['tonic'] - 9 + 6) % 12) - 6
        b = boom(s, 2.0, st)
        for h in cfg['hits'] + ([score['end']] if cfg['ending'] == 'stinger' else []):
            place(acc, b, h, .42)
        used = True
    if used:
        stems['accent'] = acc
    # 重音、底鼓响的时候其他乐器让一下
    if score['sc']:
        duck = np.ones(N, dtype=np.float32)
        for t, depth, tau in score['sc']:
            i = int(t * SR)
            m = min(int(tau * 6 * SR), N - i)
            if m > 0:
                duck[i:i + m] = np.minimum(duck[i:i + m], 1 - depth * np.exp(-np.arange(m) / (tau * SR)))
        for inst in ('pad', 'keys', 'pluck'):
            if inst in stems:
                stems[inst] = stems[inst] * duck
    send = sum(stems[k] * FX_SEND[k] for k in stems)
    hall = Pedalboard([Reverb(room_size=.85, damping=.5, wet_level=1.0, dry_level=0.0, width=1.0), HighpassFilter(220), LowpassFilter(6500)])(send, SR)
    stems['hall'] = hall * .8
    mix = sum(stems.values())
    Ln = int(round(cfg['len'] * SR))
    master = [HighpassFilter(28), Compressor(threshold_db=-14, ratio=2, attack_ms=20, release_ms=200), Limiter(threshold_db=-1.5)]
    if cfg['ending'] == 'loop':
        # 把结尾多出来的余音叠回开头，再按"循环两遍取第二遍"过总线，首尾才真正接得上
        def wrap(x):
            y = x[:, :Ln].copy()
            k = min(x.shape[1] - Ln, Ln)
            y[:, :k] += x[:, Ln:Ln + k]
            return y
        m = wrap(mix)
        y = Pedalboard(master)(np.concatenate([m, m], axis=1), SR)[:, Ln:]
        stems = {k: wrap(v) for k, v in stems.items()}
    else:
        y = Pedalboard(master)(mix, SR)[:, :Ln]
        stems = {k: v[:, :Ln].copy() for k, v in stems.items()}
        f = max(1, int(min(1.6, score['ring'] * .5) * SR))
        fade = np.cos(np.linspace(0, np.pi / 2, f)) ** 2
        y[:, -f:] *= fade
        for v in stems.values():
            v[:, -f:] *= fade
        if cfg['start'] == 'soft':
            g = max(1, int(min(.4, cfg['segs'][0]['b'] * .15) * SR))
            ramp = np.sin(np.linspace(0, np.pi / 2, g)) ** 2
            y[:, :g] *= ramp
            for v in stems.values():
                v[:, :g] *= ramp
    gain = 10 ** (-1 / 20) / (np.abs(y).max() + 1e-9)
    return (y * gain).astype(np.float32), {k: (v * gain).astype(np.float32) for k, v in stems.items()}


CH = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab']
STEM_ZH = dict(pad='铺底', bass='低音', keys='琴', pluck='拨弦', bell='钟琴', lead='主旋律', drums='鼓', accent='重音过门', hall='混响')


def write(path, y):
    with AudioFile(path, 'w', SR, y.shape[0], bit_depth=24) as f:
        f.write(y)


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    out = sys.argv[1]
    cfg = config(sys.argv[2:])          # 先查参数，错了不用等合成器加载
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    score = compose(cfg)
    s = Surge()
    y, stems = mixdown(s, cfg, score)
    write(out, y)
    stem_base = os.path.splitext(out)[0]
    if cfg['stems']:
        os.makedirs(stem_base + '_分轨', exist_ok=True)
        for k, v in stems.items():
            write(os.path.join(stem_base + '_分轨', f'{STEM_ZH[k]}.wav'), v)
    lines = [f'调 {cfg["key"]}  基础速度 {cfg["bpm"]:.0f}  全长 {y.shape[1] / SR:.3f} 秒  开头 {cfg["start"]}  结尾 {cfg["ending"]}  旋律 seed={cfg["seed"]}', '']
    for sg in cfg['segs']:
        cs = ' '.join(CH[(cfg['tonic'] - 9 + r) % 12] + ('m' if q == 'm' else '') for r, q in sg['chords'][:8])
        lines.append(f'{sg["a"]:7.2f} → {sg["end"]:7.2f} 秒  {MOODS[sg["mood"]]["zh"]}  {sg["beats"]} 拍（{60 / sg["beat"]:.1f} BPM）  和弦 {cs}')
    if score['ring']:
        lines.append(f'{score["end"]:7.2f} → {cfg["len"]:7.2f} 秒  结尾和弦收住')
    if cfg['hits']:
        lines.append('重音：' + ' '.join(f'{h:.2f}' for h in cfg['hits']))
    with open(stem_base + '_配乐表.txt', 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'ok {y.shape[1] / SR:.3f}s  segments={len(cfg["segs"])}  stems={len(stems) if cfg["stems"] else 0}')


if __name__ == '__main__':
    main()
