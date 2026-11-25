"""用 Surge XT 合成器做"设计类"音效（重击、咚、呼、上升音、悬疑长音），再过一条效果链做质感。

写实的声音（脚步、衣服、门、纸、水、风）不要用这个做——见 references/sound-design.md。

用法（要用装了 pedalboard 的 Python，见 sound-design.md 第三节）：
    python -I surge_sfx.py <输出目录> [音效名 [len=长度] [pitch=半音] ...] ...
    不给音效名就五个各做一遍默认版。音效名：hit boom whoosh riser drone
    len   长度，秒（2.4）或帧（72f，按 fps 换算，fps 默认 30，可写 fps=24）。不写用默认长度。
          riser：文件结尾就是最高点，结尾对准切点放；whoosh：脚本会报"最响点在第几秒"，那一点对准切点；
          drone：整条长度（含结尾淡出）；hit、boom：尾音拖多长。
    pitch 音高，半音，-12 到 12。负数更低更沉更重，正数更高更轻。同一集多次用同一个声音时，换个音高就不像复制粘贴。
    例：surge_sfx.py out riser len=72f hit pitch=-3 drone len=20 whoosh len=0.6
    要这五种以外的声音：写一份 JSON 配方，直接跟在后面：surge_sfx.py out 我的配方.json（写法看 example_custom_sfx.json）
    要连贯的配乐：用同目录的 surge_music.py。
环境变量 MANJU_SURGE 可以指到 Surge XT.vst3 里面那个程序文件；不给就用默认安装位置。

脚本控制 Surge XT 的六个坑（2026-11-21 实测）：
1. 要加载 .vst3 包里 Contents\\x86_64-win\\ 下的那个文件，指外层文件夹会报 "scan failure"。
2. 没装出厂音色包时，滤波器 1、2 和失真模块默认是"关电源"状态（存档里 deactivated="1"），
   只改滤波器类型没用，声音不变。开机时改一次存档把它们打开（_activate_units）。
3. 改参数不是立刻生效，要先空跑一小段（_flush）；一个音中途改参数（自动化）要用小缓冲分段渲染。
4. 读回存档（reset）后，插件那边记的还是读档前的值，设成同样的值会被跳过；set() 先推一下再设回来。
5. 弯音轮不在存档里，上一个声音弯到顶会把下一个带高；reset() 里发"弯音回中"。
6. 分段渲染时，松键压在段尾可能被丢掉，音就停不下来；render() 按采样点分配事件。
"""
import json
import os
import re
import struct
import sys

sys.dont_write_bytecode = True

import numpy as np
from pedalboard import Compressor, Distortion, HighpassFilter, Limiter, LowpassFilter, Pedalboard, Reverb, load_plugin
from pedalboard.io import AudioFile

SR = 48000
DEFAULT_SURGE = r'D:\漫剧公司\工具\音频\SurgeXT\Surge XT.vst3\Contents\x86_64-win\Surge XT.vst3'

_B64 = '.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+'  # JUCE 自己的 base64 字母表
_B64I = {c: i for i, c in enumerate(_B64)}


def _jdec(s):
    size, _, body = s.partition('.')
    size = int(size)
    n = 0
    for i, c in enumerate(body):
        n |= _B64I[c] << (6 * i)
    return n.to_bytes((len(body) * 6 + 7) // 8, 'little')[:size]


def _jenc(b):
    n = int.from_bytes(b, 'little')
    k = (len(b) * 8 + 5) // 6
    return f'{len(b)}.' + ''.join(_B64[(n >> (6 * i)) & 63] for i in range(k))


class Surge:
    def __init__(self, path=None):
        self.p = load_plugin(path or os.environ.get('MANJU_SURGE') or DEFAULT_SURGE)
        self.params = self.p.parameters
        self._activate_units()
        self.base_state = self.p.raw_state

    def _flush(self, sec=0.3):
        self.p([], duration=sec, sample_rate=SR, num_channels=2, reset=False, buffer_size=256)

    def _activate_units(self):
        st = self.p.raw_state
        n = struct.unpack('<I', st[4:8])[0]
        xml = st[8:8 + n].decode('utf-8')
        m = re.search(r'<IComponent>([^<]+)</IComponent>', xml)
        inner = _jdec(m.group(1))
        fixed = inner.replace(b'deactivated="1"', b'deactivated="0"')  # 只有滤波器 1、2 和失真模块带这个标记
        xml2 = xml[:m.start(1)] + _jenc(fixed) + xml[m.end(1):]
        xb = xml2.encode('utf-8')
        self.p.raw_state = b'VC2!' + struct.pack('<I', len(xb)) + xb + b'\x00'
        self._flush()

    def reset(self):
        """回到开机时的默认音色（每做一个新音效前调用）。
        弯音轮不在音色存档里：上一个声音把弯音推到顶，读档也不会回中，下一个声音整体会被带高，所以这里发一个"弯音回中"。"""
        self.p.raw_state = self.base_state
        self.p.reset()
        self.p([(bytes([0xE0, 0x00, 0x40]), 0.0)], duration=0.3, sample_rate=SR, num_channels=2, reset=False, buffer_size=256)

    def set(self, name, value):
        """value 用界面上的读数写：'300 Hz'、'2600 ms'、'-14 dB'、'25 %'、'7 semitones'、'LP 24 dB'、'Sine'；开关用 True/False"""
        p = self.params[name]
        raw = p.get_raw_value_for(value) if isinstance(value, bool) else p.get_raw_value_for_text(str(value))
        # 先推到旁边再设回来：读回存档后插件这边记的还是旧值，设成"一样的值"会被当成没变而跳过
        p.raw_value = raw + (0.004 if raw < 0.5 else -0.004)
        p.raw_value = raw

    def render(self, duration, notes=(), bends=(), chunks=None):
        """notes: [(起始秒, 时长秒, 音高, 力度)]；bends: [(秒, 弯音 -1..1)]；
        chunks: [(秒, {参数: 读数})] 在这些时间点改参数（分段渲染实现自动化）"""
        ev = []
        for t, d, n, vel in notes:
            ev.append((t, 1, bytes([0x90, n, vel])))
            ev.append((t + d, 2, bytes([0x80, n, 0])))
        for t, b in bends:
            v = int(max(0, min(16383, round((b + 1) / 2 * 16383))))
            ev.append((t, 0, bytes([0xE0, v & 0x7F, v >> 7])))  # 同一时刻：先弯音再按键，起音就在弯好的音高上
        ev.sort(key=lambda x: (x[0], x[1]))
        self._flush(0.2)
        marks = sorted({0.0, duration, *[c[0] for c in (chunks or []) if c[0] < duration]})
        ticks = [int(round(m * SR)) for m in marks]
        timed = [(int(round(t * SR)), m) for t, _, m in ev]
        by_mark = {round(c[0] * SR): c[1] for c in (chunks or [])}
        out = []
        for ia, ib in zip(ticks, ticks[1:]):
            if ib <= ia:
                continue
            for k, v in by_mark.get(ia, {}).items():
                self.set(k, v)
            # 按采样点分段：事件正好压在段尾时，按秒算可能落到段外被丢掉，松键丢了音就停不下来
            seg = [(m, (k - ia + .25) / SR) for k, m in timed if ia <= k < ib]
            out.append(self.p(seg, duration=(ib - ia + .25) / SR, sample_rate=SR, num_channels=2, reset=False, buffer_size=256))
        return np.concatenate(out, axis=1)


def finish(x, chain, peak_db=-1.0, tail=0.0, balance=True, length=None, fade=0.03, trim_head=True):
    """效果链 + 左右平衡 + 头尾整理 + 峰值对齐到 -1 dBFS
    length：给了就把文件裁/补到正好这么长（秒），最后 fade 秒淡出；不给就把低于 -70 dB 的尾巴剪掉。
    trim_head：去掉开头的空白，让起音对准第一帧（上升音不去，长度要准）。有意甩声像的音效传 balance=False。"""
    if tail:
        x = np.concatenate([x, np.zeros((x.shape[0], int(tail * SR)), dtype=x.dtype)], axis=1)
    y = Pedalboard(chain)(x, SR)
    if balance and y.shape[0] == 2:  # 合成器多声部叠音会偏到一边，整体拉回中间
        l, r = np.sqrt((y ** 2).mean(axis=1)) + 1e-12
        g = np.sqrt(l * r)
        y = y * np.array([[g / l], [g / r]], dtype=y.dtype)
    env = np.abs(y).max(axis=0)
    nz = np.nonzero(env > env.max() * 10 ** (-70 / 20))[0]
    if trim_head and len(nz):
        y = y[:, max(0, nz[0] - 48):]
        nz = nz - max(0, nz[0] - 48)
    if length is None:
        y = y[:, :nz[-1] + 1] if len(nz) else y
    else:
        n = int(round(length * SR))
        y = y[:, :n] if y.shape[1] >= n else np.concatenate([y, np.zeros((y.shape[0], n - y.shape[1]), dtype=y.dtype)], axis=1)
    f = min(max(1, int(fade * SR)), y.shape[1])
    y[:, -f:] *= np.cos(np.linspace(0, np.pi / 2, f)) ** 2
    pk = np.abs(y).max()
    if pk > 0:
        y *= 10 ** (peak_db / 20) / pk
    return y.astype(np.float32)


def _hz(v):
    return f'{min(max(v, 14.0), 20000.0):.2f} Hz'


def _ms(v):
    return f'{v:.1f} ms'


def _add(mix, x, gain):
    n = min(mix.shape[1], x.shape[1])
    mix[:, :n] += x[:, :n] * gain


# ---------------------------------------------------------------- 配方
# 每个配方：(s, L, st)，L = 长度（秒，None 用默认），st = 音高（半音）。
# 默认参数就是 2026-11-21 用户听过、认可的那一版；加长短、音高时只按比例拉伸，不改声音的做法。

def hit(s, L=None, st=0):
    """影视重击：低频"轰"（正弦从高处滑下来）+ 噪声"啪"的瞬态 + 中频躯干，大厅混响。L = 整条长度（尾音拖多长）"""
    L = L or 4.6
    k, f = L / 4.6, 2 ** (st / 12)
    s.reset()
    s.set('a_pitch_bend_down_range', '24 semitones'); s.set('a_pitch_bend_up_range', '24 semitones')
    s.set('a_osc_1_type', 'Sine')
    s.set('a_amp_eg_attack', '0 ms'); s.set('a_amp_eg_decay', _ms(2600 * k)); s.set('a_amp_eg_sustain', '0 %'); s.set('a_amp_eg_release', _ms(900 * k))
    sub = s.render(0.7 * L, notes=[(0, 0.05, 28 + st, 127)],
                   bends=[(0.0, 0.6), (0.015, 0.45), (0.035, 0.3), (0.06, 0.18), (0.09, 0.09), (0.13, 0.03), (0.18, 0.0)])
    s.reset()
    s.set('a_osc_1_mute', True); s.set('a_noise_mute', False); s.set('a_noise_color', '-40 %')
    s.set('a_filter_configuration', 'Serial 1'); s.set('a_filter_1_type', 'LP 24 dB'); s.set('a_filter_1_cutoff', _hz(250 * f))
    s.set('a_filter_1_feg_mod_amount', '60 semitones')
    s.set('a_filter_eg_attack', '0 ms'); s.set('a_filter_eg_decay', '140 ms'); s.set('a_filter_eg_sustain', '0 %')
    s.set('a_amp_eg_attack', '0 ms'); s.set('a_amp_eg_decay', _ms(450 * min(1, k))); s.set('a_amp_eg_sustain', '0 %'); s.set('a_amp_eg_release', '200 ms')
    crack = s.render(1.0, notes=[(0, 0.02, 60, 127)])
    s.reset()
    s.set('a_osc_1_type', 'FM2'); s.set('a_osc_1_octave', '-1')
    s.set('a_filter_configuration', 'Serial 1'); s.set('a_filter_1_type', 'LP 12 dB'); s.set('a_filter_1_cutoff', _hz(900 * f))
    s.set('a_amp_eg_attack', '0 ms'); s.set('a_amp_eg_decay', _ms(700 * min(1, k))); s.set('a_amp_eg_sustain', '0 %'); s.set('a_amp_eg_release', '200 ms')
    body = s.render(1.5, notes=[(0, 0.05, 40 + st, 120)], bends=[(0, 0.1), (0.06, 0.0)])
    mix = sub * 1.0
    _add(mix, crack, 0.6)
    _add(mix, body, 0.4)
    return finish(mix, [HighpassFilter(28), Distortion(drive_db=6), Compressor(threshold_db=-14, ratio=3, attack_ms=8, release_ms=200),
                        Reverb(room_size=0.88, damping=0.55, wet_level=0.28, dry_level=0.9, width=1.0), Limiter(threshold_db=-1.5)],
                  tail=0.35 * L, length=L, fade=min(0.6, 0.25 * L))


def boom(s, L=None, st=0):
    """悬疑"咚"：短、闷、带音高的低鼓感，长尾巴。L = 整条长度"""
    L = L or 4.4
    k, f = L / 4.4, 2 ** (st / 12)
    s.reset()
    s.set('a_pitch_bend_down_range', '12 semitones'); s.set('a_pitch_bend_up_range', '12 semitones')
    s.set('a_osc_1_type', 'Sine'); s.set('a_osc_2_mute', False); s.set('a_osc_2_type', 'Sine'); s.set('a_osc_2_pitch', '7 semitones'); s.set('a_osc_2_volume', '-16 dB')
    s.set('a_amp_eg_attack', '0 ms'); s.set('a_amp_eg_decay', _ms(1500 * k)); s.set('a_amp_eg_sustain', '0 %'); s.set('a_amp_eg_release', _ms(600 * k))
    tone = s.render(0.55 * L, notes=[(0, 0.05, 33 + st, 127)], bends=[(0.0, 0.4), (0.03, 0.15), (0.08, 0.0)])
    s.reset()
    s.set('a_osc_1_mute', True); s.set('a_noise_mute', False)
    s.set('a_filter_configuration', 'Serial 1'); s.set('a_filter_1_type', 'BP 12 dB'); s.set('a_filter_1_cutoff', _hz(180 * f)); s.set('a_filter_1_resonance', '30 %')
    s.set('a_amp_eg_attack', '0 ms'); s.set('a_amp_eg_decay', '90 ms'); s.set('a_amp_eg_sustain', '0 %'); s.set('a_amp_eg_release', '60 ms')
    skin = s.render(0.5, notes=[(0, 0.02, 60, 127)])
    mix = tone.copy()
    _add(mix, skin, 0.8)
    return finish(mix, [HighpassFilter(30), LowpassFilter(5000), Compressor(threshold_db=-12, ratio=2.5, attack_ms=5, release_ms=250),
                        Reverb(room_size=0.95, damping=0.7, wet_level=0.33, dry_level=0.85, width=1.0), Limiter(threshold_db=-1.5)],
                  tail=0.45 * L, length=L, fade=min(0.6, 0.25 * L))


def whoosh(s, L=None, st=0):
    """呼：噪声过带通滤波，中心频率扫上去再落回来，声像从左甩到右。L = 整条长度（最响点大约在 1/4 处）"""
    L = L or 1.74
    k, f = L / 1.74, 2 ** (st / 12)
    s.reset()
    s.set('a_osc_1_mute', True); s.set('a_noise_mute', False); s.set('a_noise_color', '-35 %')
    s.set('a_filter_configuration', 'Serial 1'); s.set('a_filter_1_type', 'BP 24 dB'); s.set('a_filter_1_resonance', '30 %')
    s.set('a_amp_eg_attack', _ms(380 * k)); s.set('a_amp_eg_attack_shape', 'Concave'); s.set('a_amp_eg_decay', _ms(500 * k)); s.set('a_amp_eg_sustain', '0 %'); s.set('a_amp_eg_release', _ms(250 * k))
    dur, peak = 1.3 * k, 0.42 * k
    step = min(0.02, dur / 60)
    chunks = []
    for t in np.arange(0, dur, step):
        u = t / peak if t < peak else max(0.0, 1 - (t - peak) / (dur - peak))
        cut = 200 * f * (2200 / 200) ** (u ** 1.5)       # 200 Hz → 2.2 kHz → 回落（再高就成了"嘶"）
        pan = -70 + 140 * min(1.0, t / (peak * 1.8))       # 左 → 右
        chunks.append((round(float(t), 4), {'a_filter_1_cutoff': _hz(cut), 'a_pan': f'{pan:.1f} %'}))
    x = s.render(dur, notes=[(0, 0.75 * k, 60, 120)], chunks=chunks)
    return finish(x, [HighpassFilter(80), Compressor(threshold_db=-16, ratio=2), Reverb(room_size=0.5, wet_level=0.18, dry_level=0.95, width=1.0), Limiter(threshold_db=-1.5)],
                  tail=0.6 * k, balance=False, length=L, fade=min(0.15, 0.1 * L))


def riser(s, L=None, st=0):
    """上升音：锯齿多声部叠 + 噪声，音高往上弯 12 半音，滤波器逐段打开。L = 从开头到最高点，文件结尾就是最高点，结尾对准切点"""
    L = L or 3.0
    s.reset()
    s.set('a_pitch_bend_up_range', '12 semitones'); s.set('a_pitch_bend_down_range', '12 semitones')
    s.set('a_osc_1_unison_voices', '7 voices'); s.set('a_osc_1_unison_detune', '25 cents')
    s.set('a_noise_mute', False); s.set('a_noise_volume', '-12 dB')
    s.set('a_filter_configuration', 'Serial 1'); s.set('a_filter_1_type', 'LP 24 dB'); s.set('a_filter_1_resonance', '35 %')
    s.set('a_amp_eg_attack', _ms(2200 * L / 3.0)); s.set('a_amp_eg_attack_shape', 'Concave'); s.set('a_amp_eg_sustain', '100 %'); s.set('a_amp_eg_release', '60 ms')
    step = min(0.05, L / 60)
    ts = np.arange(0, L + 1e-9, step)
    bends = [(round(float(t), 4), float((t / L) ** 2)) for t in ts]
    chunks = [(round(float(t), 4), {'a_filter_1_cutoff': _hz(200.0 * (40 ** (t / L)))}) for t in ts if t < L]
    x = s.render(L, notes=[(0, L + 1, 48 + st, 110), (0, L + 1, 55 + st, 100)], bends=bends, chunks=chunks)
    return finish(x, [HighpassFilter(60), Compressor(threshold_db=-18, ratio=2.5), Reverb(room_size=0.7, wet_level=0.22, dry_level=0.9, width=1.0), Limiter(threshold_db=-1.5)],
                  length=L, fade=0.005, trim_head=False)


def drone(s, L=None, st=0):
    """悬疑长音：低频锯齿铺底 + 小二度不协和的高音，滤波器缓慢开合（5.5 秒一个来回），大混响。L = 整条长度（含结尾淡出）"""
    L = L or 9.0
    s.reset()
    s.set('a_osc_1_unison_voices', '5 voices'); s.set('a_osc_1_unison_detune', '14 cents')
    s.set('a_osc_2_mute', False); s.set('a_osc_2_type', 'Sine'); s.set('a_osc_2_octave', '2'); s.set('a_osc_2_pitch', '1 semitones'); s.set('a_osc_2_volume', '-20 dB')
    s.set('a_filter_configuration', 'Serial 1'); s.set('a_filter_1_type', 'LP Vintage Ladder'); s.set('a_filter_1_resonance', '20 %')
    s.set('a_amp_eg_attack', _ms(min(1500, 200 * L))); s.set('a_amp_eg_sustain', '100 %'); s.set('a_amp_eg_release', _ms(min(2000, 220 * L)))
    cut = lambda t: 160.0 + 520.0 * (0.5 - 0.5 * np.cos(2 * np.pi * t / 5.5))
    held = max(0.5 * L, L - 3.0)
    render = min(L, held + 2.0)
    chunks = [(round(float(t), 3), {'a_filter_1_cutoff': _hz(cut(t))}) for t in np.arange(0, render, 0.05)]
    # 音高 33/40（A1 + E2）：11-21 用户听过的那一版实际就是这个高度（当时上升音的弯音没回中，把原定的 31/38 带高了 2 个半音）
    x = s.render(render, notes=[(0, held, 33 + st, 100), (0, held, 40 + st, 80)], chunks=chunks)
    return finish(x, [HighpassFilter(30), Compressor(threshold_db=-20, ratio=2), Reverb(room_size=0.95, damping=0.6, wet_level=0.35, dry_level=0.8, width=1.0), Limiter(threshold_db=-1.5)],
                  tail=L - render, length=L, fade=min(1.5, 0.15 * L))


def _sweep(sw, dur):
    """{参数: [[秒, 读数], ...]} → 分段改参数。Hz 按倍数过渡（听感才均匀），其他按直线过渡"""
    keys = []
    for name, pts in sw.items():
        pts = sorted((float(t), str(v)) for t, v in pts)
        nums = [re.fullmatch(r'\s*(-?\d+(?:\.\d+)?)\s*(.*)', v) for _, v in pts]
        if not all(nums):
            raise SystemExit(f'{name} 的扫动值要写成数字加单位，如 "400 Hz"：{pts}')
        keys.append((name, [t for t, _ in pts], [float(m.group(1)) for m in nums], nums[0].group(2)))
    out = []
    for t in np.arange(0, dur, 0.02):
        ch = {}
        for name, ts, vs, unit in keys:
            if unit == 'Hz':
                v = float(np.exp(np.interp(t, ts, np.log(vs))))
                ch[name] = _hz(v)
            else:
                ch[name] = f'{float(np.interp(t, ts, vs)):.2f} {unit}'.strip()
        out.append((round(float(t), 3), ch))
    return out or None


def custom(s, spec):
    """按一份 JSON 配方现做任意设计类声音，不用改代码。写法见 sound-design.md 第三节"""
    L = float(spec['len'])
    mix = np.zeros((2, int(round(L * SR))), dtype=np.float32)
    for lay in spec['layers']:
        at = float(lay.get('at', 0))
        dur = float(lay.get('len', L - at))
        s.reset()
        s.set('a_filter_configuration', 'Serial 1')
        for k, v in lay.get('set', {}).items():
            if k not in s.params:
                raise SystemExit(f'合成器没有这个参数：{k}')
            s.set(k, v)
        x = s.render(dur, notes=[tuple(n) for n in lay.get('notes', [])], bends=[tuple(b) for b in lay.get('bends', [])],
                     chunks=_sweep(lay['sweep'], dur) if lay.get('sweep') else None)
        i = int(round(at * SR))
        n = min(x.shape[1], mix.shape[1] - i)
        mix[:, i:i + n] += x[:, :n] * float(lay.get('gain', 1.0))
    fx = spec.get('fx', {})
    chain = []
    if fx.get('highpass'):
        chain.append(HighpassFilter(float(fx['highpass'])))
    if fx.get('lowpass'):
        chain.append(LowpassFilter(float(fx['lowpass'])))
    if fx.get('drive'):
        chain.append(Distortion(drive_db=float(fx['drive'])))
    if fx.get('compress', True):
        chain.append(Compressor(threshold_db=-16, ratio=2.5, attack_ms=6, release_ms=180))
    if fx.get('reverb'):
        r = float(fx['reverb'])
        chain.append(Reverb(room_size=min(.97, .35 + .6 * r), damping=.55, wet_level=.4 * r, dry_level=.92, width=1.0))
    chain.append(Limiter(threshold_db=-1.5))
    return finish(mix, chain, balance=bool(spec.get('balance', True)), length=L, fade=min(.3, .1 * L), trim_head=False)


RECIPES = {'hit': ('影视重击', hit), 'boom': ('悬疑咚', boom), 'whoosh': ('呼_转场', whoosh), 'riser': ('上升音', riser), 'drone': ('悬疑长音', drone)}
LIMITS = {'hit': (1.0, 8.0), 'boom': (1.0, 8.0), 'whoosh': (0.3, 4.0), 'riser': (0.5, 15.0), 'drone': (3.0, 180.0)}


def parse(args):
    """[音效名 key=value ...] ... → [(音效名, {key: value})]；xxx.json 是自定义配方"""
    items = []
    for a in args:
        if a in RECIPES:
            items.append((a, {}))
        elif a.lower().endswith('.json'):
            items.append(('custom', {'spec': a}))
        elif '=' in a and items:
            k, v = a.split('=', 1)
            items[-1][1][k.strip().lower()] = v.strip()
        else:
            raise SystemExit(f'看不懂的参数：{a}（音效名只有 {" ".join(RECIPES)}；参数写成 len=2.4 / len=72f / pitch=-3 / fps=24，跟在音效名后面）')
    return items or [(n, {}) for n in RECIPES]


def resolve(name, opt):
    fps = float(opt.get('fps', 30))
    L = None
    if 'len' in opt:
        v = opt['len'].lower()
        L = float(v[:-1]) / fps if v.endswith('f') else float(v.rstrip('s'))
        lo, hi = LIMITS[name]
        if not lo <= L <= hi:
            raise SystemExit(f'{name} 的长度 {L:.2f} 秒超出范围（{lo}–{hi} 秒）')
    st = int(round(float(opt.get('pitch', 0))))
    if not -12 <= st <= 12:
        raise SystemExit(f'{name} 的音高 {st} 超出范围（-12 到 12 半音）')
    bad = set(opt) - {'len', 'pitch', 'fps'}
    if bad:
        raise SystemExit(f'{name} 不认识的参数：{" ".join(sorted(bad))}')
    return L, st


def loudest(y, win=0.01):
    w = int(win * SR)
    n = y.shape[1] // w
    e = (y[:, :n * w] ** 2).reshape(y.shape[0], n, w).mean(axis=(0, 2))
    return (int(np.argmax(e)) + 0.5) * win


def main():
    out = sys.argv[1]
    items = parse(sys.argv[2:])
    jobs = []                                         # 先查参数，错了不用等合成器加载
    for n, o in items:
        if n == 'custom':
            with open(o['spec'], encoding='utf-8') as f:
                spec = json.load(f)
            if not spec.get('layers') or not 0.05 <= float(spec.get('len', 0)) <= 180:
                raise SystemExit(f'{o["spec"]}：配方要有 layers 和 len（0.05–180 秒）')
            jobs.append((n, spec, 0))
        else:
            jobs.append((n, *resolve(n, o)))
    os.makedirs(out, exist_ok=True)
    s = Surge()
    used = set()
    for n, L, st in jobs:
        if n == 'custom':
            y = custom(s, L)
            base = re.sub(r'[\\/:*?"<>|]', '_', str(L.get('name', '自定义音效')))
            L = None
        else:
            zh, fn = RECIPES[n]
            y = fn(s, L, st)
            base = f'{zh}_{n}' + (f'_{L:.2f}s' if L else '') + (f'_{st:+d}半音' if st else '')
        name, i = base, 2
        while name in used:
            name, i = f'{base}_{i}', i + 1
        used.add(name)
        path = os.path.join(out, name + '.wav')
        with AudioFile(path, 'w', SR, y.shape[0], bit_depth=24) as f:
            f.write(y)
        dur = y.shape[1] / SR
        note = '最高点＝文件结尾，结尾对准切点' if n == 'riser' else f'最响点在 {loudest(y):.2f} 秒'
        print(f'{name}.wav\t{dur:.3f}s\t{note}')


if __name__ == '__main__':
    main()
