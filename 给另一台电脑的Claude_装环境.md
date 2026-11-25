# 给另一台电脑的 Claude：把环境补齐

你在一台新电脑上，用户把这个包（`00_编导套装_最新版`）拷了过来，要你把三个技能装好，并把它们的脚本要的环境补齐：
- 分镜编导：剧本 → 分镜；
- 译镜：分镜 → 竖屏提示词；
- manju-edit：剪映剪辑、查夹帧卡帧、做音效。

照下面的顺序做。每一步做完都跑一次检查脚本，直到 ❌ 为 0。⚠️ 逐条告诉用户缺了什么、哪些功能用不了，让用户决定补不补。

## 先守的规矩

- 用中文跟用户说话，大白话；专业词第一次出现附一句解释。用户读不懂英文。
- **每下载一样东西之前先问用户**：说清楚文件名、从哪下、多大。
- **设环境变量、改系统设置之前也先问**：环境变量是长期设置，会影响以后所有程序。
- 剪映的安装、登录，账号、密码、验证码，都由用户自己操作。
- 不改技能文件（`skills\` 下面的东西）。发现技能本身有问题，列出来让用户决定。
- 装完要新开一个对话，技能才生效。

## 第 1 步：先看缺什么

在包的根目录：

```
node 检查环境.mjs
```

没有 Node 就跑不了这个检查。先做第 2 步，再回来跑。

## 第 2 步：Node.js 18 或更新（三个技能的脚本都靠它）

- Windows：`winget install OpenJS.NodeJS.LTS`
- Mac：`brew install node`

装完关掉终端再开一个，`node --version` 能出版本号就行。

## 第 3 步：ffmpeg 和 ffprobe

ffmpeg 是处理视频的命令行工具。译镜审片、剪辑查夹帧卡帧都要它。

- Windows：`winget install Gyan.FFmpeg`
- Mac：`brew install ffmpeg`

装完新开终端，`ffmpeg -version` 和 `ffprobe -version` 都要能跑。

## 第 4 步：把三个技能装进 AI 工具

Windows：先预演，看它会装到哪：

```
& ".\安装到这台电脑.ps1"
```

没问题再真装：

```
& ".\安装到这台电脑.ps1" -Apply
```

Mac：先 `bash 安装到这台电脑.sh` 预演，真装加 `--apply`。

说明：
- 默认装到用户文件夹下的 `.claude\skills` 和 `.agents\skills`。
- 旧版不删，挪到 `编导套装_替换前备份\`。
- 只装某几个技能，加 `-Skills manju-edit` 这样的参数。

## 第 5 步：译镜的剧设定放哪（先问用户选哪种）

剧设定是每部剧的风格、质感设定。译镜脚本默认去 `D:\漫剧公司\竖屏制作\剧设定\` 找。两种做法：

- **A（推荐，Windows 有 D 盘时）**：建这个文件夹，把包里 `附带资料\剧设定_竖屏\` 下的文件拷进去。以后编译、检查都不用另给路径。
- **B**：不建。每次编译加 `--bible <剧设定.md>`，单查提示词加 `--style <剧设定.md>`。

## 第 6 步：译镜审片听台词（可选；不装就审片时加 `--no-asr`）

审片脚本 `review.js` 会调用命令行里叫 `python` 的那个程序，用 faster-whisper（语音识别库）听成片里的台词。

1. **要一个真的 Python 3.10 或更新，叫 `python` 时能跑起来。**
   - Windows 上如果 `python` 返回 9009、或者弹出应用商店，那是系统自带的占位程序。
   - 处理办法：从 python.org 装正式版，安装时勾选加入 PATH。
   - 或者请用户自己在"设置 → 应用 → 高级应用设置 → 应用执行别名"里关掉 python 的别名。这是系统设置，让用户自己点。
2. 装库：`python -m pip install faster-whisper numpy`
3. **下载语音模型。** 先问用户：来自 Hugging Face 的 `Systran/faster-whisper-medium`，约 1.5 GB。下载命令：

   ```
   python -c "from huggingface_hub import snapshot_download; print(snapshot_download('Systran/faster-whisper-medium', local_dir=r'<放模型的文件夹>'))"
   ```

4. **问过用户后，设用户环境变量 `ASR_MODEL`，指向那个文件夹。** 不想设的话，每次审片加 `--asr-model <文件夹>`。

## 第 7 步：剪映专业版（剪辑技能读草稿要它）

- 用户自己装、自己登录。装好、建过一条草稿后，脚本会自己找到草稿目录（Windows、Mac 都行）。
- 草稿的明文备份默认放在用户文件夹下的 `漫剧剪辑\草稿JSON备份`。想放别处，问过用户后设环境变量 `MANJU_DRAFT_BACKUP`。
- 没有剪映，查成片的 `qc_media.mjs` 照样能用。

## 第 8 步：剪辑技能做音效用的合成器（可选）

剪辑技能用 Surge XT（开源合成器）现做重击、咚、呼、上升音、悬疑长音，也现写配乐（`surge_music.py`）。这两样是用户定的首选，剪映的音效库、曲库是备选，所以用户要做声音就值得装。脚本要一个装了 pedalboard 的 Python 来调用它。pedalboard 是一个能加载合成器插件的 Python 库。

1. **下载 Surge XT 插件版。** 先问用户：
   - 文件：`surge-xt-win64-1.3.4-pluginsonly.zip`，46.8 MB；
   - 来源：GitHub 上 surge-synthesizer 的 releases-xt 仓库，1.3.4 版本；
   - 下完对一下 MD5（一种文件指纹，用来确认文件没坏、没被换过）：应该是 `d318e95ca79a5ee70ddafec04313a00c`。
2. **解压到哪：**
   - Windows 有 D 盘时，最省事是解压到 `D:\漫剧公司\工具\音频\SurgeXT\`。这是脚本的默认位置，不用设什么。
   - 放别处：问过用户后，设环境变量 `MANJU_SURGE`，指向 `<解压位置>\Surge XT.vst3\Contents\x86_64-win\Surge XT.vst3`。注意要指到包里面这个文件，指外层文件夹会报错。
3. **单独建一个 Python 3.11 环境**（不和审片那个混用）：
   - Windows 默认位置：`python -m venv D:\漫剧公司\工具\音频\py311`
   - 然后：`D:\漫剧公司\工具\音频\py311\Scripts\python.exe -m pip install pedalboard==0.9.26 numpy`
   - 原来那台电脑用 uv 装的 Python 3.11.15，pedalboard 0.9.26。
   - 放别处时，检查加 `--sfx-python <python 路径>`；做音效时也用那个 python。
4. Mac 上没测过：插件是 `surge-xt-macos-1.3.4-pluginsonly.zip`，`MANJU_SURGE` 先试指向 `.vst3` 包本身。测出结果告诉用户。

## 第 9 步：真跑一遍

```
node 检查环境.mjs --试跑
```

它在系统临时文件夹里拿包里的范例真跑一遍：
- 查分镜、画机位图；
- 编译译镜第 29 集范例（旧格式），和原版逐字比；
- 跑译镜 V2 自测：正面范例编译没有 ❌，反面案例都要被抓出来；
- 用 ffmpeg 做一条测试片，跑剪辑的查成片；
- 合成器出一个重击、写一段 8 秒配乐；
- 载入语音模型。

合成器做出来的声音，脚本只能确认文件出来了，好不好听要用户听过才算。

跑到 ❌ 0 再告诉用户"装好了"，同时说明哪些 ⚠️ 还在、对应哪些功能用不了。

## 换了电脑仍要注意

技能文件里有原来那台电脑的路径（`D:\漫剧公司\...`），换算表见 `从这里开始_给AI读.md` 第 2 节。

拿到新下载的剪映草稿，**先跑 `backup_drafts.mjs`，再打开剪映**。剪映一打开就会把草稿加密，之后脚本读不了。
