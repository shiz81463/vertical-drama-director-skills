# 从这里开始（给 AI 读）

你拿到的是"编导套装"：三个技能，把一集短剧从剧本做到提示词（漫影工坊 Seedance 2.5），成片回来再剪辑。

| 技能 | 做什么 | 入口 |
|---|---|---|
| 分镜编导 | 剧本 → 分镜脚本：拆戏、节拍、站位和机位、每个镜头拍什么、为什么切 | `skills/分镜编导/SKILL.md` |
| 译镜 | 分镜脚本 → 竖屏 9:16 提示词：写源文件、编译、检查、审片 | `skills/译镜/SKILL.md` |
| manju-edit（剪辑） | 剪映剪辑：按分镜剪、深度精剪、交付前查夹帧卡帧、救素材、做音效和配乐 | `skills/manju-edit/SKILL.md` |

版本见同一层的 `版本.md`。**这台电脑还没装环境的话，先读 `给另一台电脑的Claude_装环境.md`，照它补齐。**

## 1. 先读哪一份

1. 做分镜、写提示词：读 **`skills/分镜编导/编导套装/模型流程树.md`**。这是一张流程图，从树根往下走，看用户的任务该从哪一步做起、在哪停、下一步换对话时发什么。
1b. **写分镜、写提示词之前必读**（2026-11-24）：`skills/译镜/手册/0_V2写法.md`，再扫一遍 `skills/译镜/反面案例/README.md`（全是标了 ❌ 的坏写法，不要照抄）。和别的文件打架，以手册 0 为准。
2. 走到哪个节点，就读那个技能的 `SKILL.md`，再按它的指引读它下面的文件。不要一次全读：三个技能加起来 200 个文件。
3. 用的是 OpenAI 的 GPT 模型：写提示词前加读 `skills/译镜/GPT/执行规程.md`。别的模型不读这份。
4. 剪辑、查草稿、做声音：不走流程树，直接读 `skills/manju-edit/SKILL.md`，按用户要做的那件事进对应的工作流。

## 2. 路径换算

技能文件里写的是原来那台电脑的绝对路径。在这个包里对应这样换：

| 文件里写的 | 换成 |
|---|---|
| `D:\漫剧公司\.claude\skills\分镜编导\…` | `skills/分镜编导/…` |
| `D:\漫剧公司\.claude\skills\译镜\…` | `skills/译镜/…` |
| 项目的竖屏或横屏剧设定 | 用户提供；`附带资料/剧设定_竖屏/` 里的两个文件只用于示例试跑 |
| 导演反馈记录 | 公开版不附；项目提供了就读，没有则按本包规则执行 |
| `D:\漫剧公司\工具\音频\py311\Scripts\python.exe` | 这台电脑上装了 pedalboard 的 Python（见装环境说明第 8 步） |
| `D:\漫剧公司\工具\音频\SurgeXT\…` | 这台电脑上 Surge XT 的位置，脚本从环境变量 `MANJU_SURGE` 读 |
| 剧本、场景图、分镜、提示词放在哪 | 用户给；没给就问，不要猜 |
| 其他 `D:\…`、`E:\…`、`C:\Users\…` 路径（范例出处、备份、调研报告） | 只是出处说明，这台机器上没有，跳过 |

技能已经装进了这台电脑的 skills 文件夹的话，`skills/` 换成那个文件夹。

## 3. 跑脚本

脚本要 Node.js 18 或更新。路径按上表换。

| 做什么 | 命令 |
|---|---|
| 查分镜 | `node skills/分镜编导/scripts/check_storyboard.js <分镜脚本.md>`（只写了一部分加 `--partial`） |
| 画俯视机位图 | `node skills/分镜编导/scripts/draw_plan.js <分镜脚本.md>` |
| 编译提示词 | `node skills/译镜/scripts/build.js <源文件夹> --bible 附带资料/剧设定_竖屏/<剧名>.md`。也可以在集卡里写一行 `剧设定: <路径>`，就不用加 `--bible` |
| 译镜自测（改了模板、检查脚本、反面案例以后） | `node skills/译镜/scripts/self_test.js --bible 附带资料/剧设定_竖屏/黑帮老大的圣诞礼物.md --bible-v1 附带资料/剧设定_竖屏/320磅未婚妻不忍了.md` |
| 单查一份提示词 | `node skills/译镜/scripts/check.js <提示词.txt 或文件夹> --style 附带资料/剧设定_竖屏/<剧名>.md` |
| 审片 | `node skills/译镜/scripts/review.js <提示词文件夹> <成片文件夹> --ffmpeg <ffmpeg 路径> --asr-model <faster-whisper 模型文件夹>`；没有语音模型就加 `--no-asr`（ffmpeg 还是要有） |
| 列剪映草稿 | `node skills/manju-edit/scripts/list_drafts.mjs [名称]` |
| 备份草稿（新下载的草稿先跑，再开剪映） | `node skills/manju-edit/scripts/backup_drafts.mjs [名称]` |
| 打印时间线 | `node skills/manju-edit/scripts/dump_timeline.mjs <草稿>` |
| 交付自检（含夹帧卡帧） | `node skills/manju-edit/scripts/qc_draft.mjs <草稿>` |
| 查成片或单条素材 | `node skills/manju-edit/scripts/qc_media.mjs <视频.mp4>` |
| 现做音效 | `<装了 pedalboard 的 python> -I skills/manju-edit/scripts/sound/surge_sfx.py <输出文件夹> hit boom whoosh riser drone` |
| 现写配乐 | `<装了 pedalboard 的 python> -I skills/manju-edit/scripts/sound/surge_music.py <输出.wav> mood=悬疑:12,打戏:30,悲伤:45` |

注意：
- **不在原来那台电脑上，`build.js` 要给剧设定路径，`check.js` 一定要加 `--style`。** 不加的话脚本去 `D:\漫剧公司\竖屏制作\剧设定` 找，找不到会报风格锁的错，那是路径问题，不是提示词的问题。
- 脚本报 ❌ 必须改到 0；⚠️ 逐条看，保留的在回复里说为什么。

## 4. 不能跑命令时（网页聊天）

你没有文件和命令行工具，只能读用户上传的文件：

- 照技能做设计和写作的部分，脚本那一步跳过，交付时明说"检查脚本没跑，请在电脑上跑一次"，把要跑的命令写给用户。
- 做分镜，至少要这些文件：`skills/分镜编导/SKILL.md`、`环/` 下六个文件、`方向/` 下用到的那一个、`templates/分镜脚本模板.md`、`references/说话戏型谱.md`、`references/戏型拍法.md`、`references/镜头动作词典.md`、`references/导演方法.md`、`examples/格式样例_v5_惹火34_戏1开头.md`。
- 写提示词，至少要这些：`skills/译镜/SKILL.md`、`手册/` 下 0、1、2、3、7、8（有打戏加 4、6）、`反面案例/README.md`、`examples/V2_黑帮圣诞第30集_文戏/源/`、`模板/` 下要用的几个、`规则档案/可拍性规则.md`、这部剧的剧设定。编译是脚本做的，网页上只能写源文件，交给用户在电脑上编译。
- 剪辑，至少要这些：`skills/manju-edit/SKILL.md`，加要做那件事对应的 `references/` 文件（公司规范 `company-rules.md`、按分镜剪 `storyboard-cut.md`、夹帧卡帧 `frame-residue.md`、救素材 `rescue-playbook.md`、声音 `sound-design.md`）。网页上读不了剪映草稿，也跑不了音效和配乐脚本。
- 缺了哪份文件，直接跟用户要，别凭印象补。

## 5. 守的规矩

- 用中文回复，大白话。专业词第一次出现，附一句解释。用户读不懂英文：英文里的问题你自己查，改了什么用中文讲。
- 四件事不能猜，没给就先问：方向（竖屏 9:16 / 横屏 16:9）、单集时长、台词语言、场景资产图。剧本有几个版本、有扩写版、集数对不上，也先问。
- 剧本台词默认全留，不加剧情、不加台词、不加新的可识别角色。
- 剧设定里的风格锁是用户的原文，一字不改。
- 不替用户点平台上的"生成"；上传文件由用户做。
- 合成器做的音效和配乐，用户听过才进片。写实声音（脚步、衣服、门、风）不用代码或合成器做。
- 用户没让你改技能，就不要改技能文件。发现技能有问题，列出来让用户决定。
- 用了标着〔待验证〕〔导演方法〕〔外部实测〕的写法，在回复里说一声。测出了结果，记进 `skills/分镜编导/测试登记.md` 最后的"测试记录"表。
