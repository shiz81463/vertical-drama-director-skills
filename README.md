# 竖屏短剧编导 Skills · v4

把一集剧本做成可复查的分镜，再把分镜交给 Seedance 写作技能，产出 **9:16 分段提示词、编导设计单和检查报告**。这套技能把演员站哪、镜头朝哪、每句台词在哪一拍说、下一段还能不能接上，落实成可交接的文件。

适用于 **Codex** 和 **Claude Code**。[下载 v4 整合 ZIP](https://github.com/shiz81463/vertical-drama-director-skills/releases/tag/v4.0.0)。

## 两版怎么选

| 版本 | 适合什么 | 装哪些技能 |
| --- | --- | --- |
| **小版 · 字数与台词** | 文戏和武戏分开交付；重点是压提示词长度、保留台词原文、控制镜头与背景连续性。 | [分镜编导](skills/storyboard-director/SKILL.md) + [竖屏文戏](skills/vertical-dialogue-director/SKILL.md) + [竖屏武戏](skills/vertical-action-director/SKILL.md) |
| **满血版 · 人物表演** | 对话、动作、险情切换频繁，或者同一人物跨集、跨编导时要保持同一种演法。 | [分镜编导](skills/storyboard-director/SKILL.md) + [竖屏编导满血版](skills/vertical-performance-director/SKILL.md) |

已有分镜时可以跳过分镜技能。两版可以共装，共用同一个 `storyboard-director`；写提示词时点名选哪一个。分镜另附 16:9 方向规则，横屏提示词技能不在本包内，横屏方向按源包标记为待验证。

## 厉害在哪

1. **一场戏拆成多段，背景和光还有同一套依据。** 分镜阶段定 2–4 个镜头方向，画场景总览，再为每个方向准备独立背景图。把场景块、总览、背景资产行和每个方向的光句写进 **场景锁**，各段沿用。`check_scene.js` 查文字、方向和光句；`scene_sheet.js` 按同场同方向拼成片帧，方便肉眼核对。
2. **压提示词有顺序，台词原文有位置。** 台词只在对应的 `Dialogue` 行出现一次，标起止秒和段内句数。两版的经验区间都是：有台词的文戏 7,000–10,000 字，有台词的武戏／险情 7,000–11,000 字，无台词 7,000–12,000 字。超长先减重复描述，保留原台词、固定风格句和关键可拍性约束。
3. **满血版能写出「谁在演、怎么演」。** 先定人物表演档案，把说话前的信号、说话时的声音、说完后的反应排进节拍，同时给听者具体一拍的反应。情绪按「收／显／破」设计；遇到动作混合段和虚构险情，有对应的骨架和说明。
4. **出问题能找到该改哪一步。** 分镜按开工卡 → 拆戏 → 节拍与情绪 → 空间与机位 → 镜头配方 → 逐镜分镜六环输出；检查脚本按环或规则编号回报。提示词还有格式、可拍性和跨段规则检查，团队可以按同一份结果返工。

源包记录：《320 磅》第 29 集使用场景卡流程后，10 段中有 9 段的背景与光对得上。该数字是单集制作记录；表演、嘴型和生成画面的实际连续性仍要看片验收。

## 安装

下载并解压 ZIP。从 `skills/` 复制上表所需的**整个技能文件夹**到你的剧集项目根目录下：

| 客户端 | 项目安装位置 | 显式调用示例 |
| --- | --- | --- |
| [Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) | `.agents/skills/` | `$storyboard-director` |
| [Claude Code](https://code.claude.com/docs/en/skills) | `.claude/skills/` | `/storyboard-director` |

例如满血版装好后，Codex 项目里应有 `.agents/skills/storyboard-director/SKILL.md` 和 `.agents/skills/vertical-performance-director/SKILL.md`。在该项目打开新会话。你也可以用自然语言点名「分镜编导」「小版文戏」或「竖屏编导满血版」。

- **Node.js** 用于跑检查脚本，无需 `npm install`。可先运行 `node --version`。
- **FFmpeg** 只在看片抽帧时使用。`scene_sheet.js` 从 PATH 找 `ffmpeg`，也可以传 `--ffmpeg` 加可执行文件路径。缺少文字滤镜或字体时，仍会输出无时间码拼图。单段拉片工具另需 `ffprobe` 和支持 `drawtext` 的 FFmpeg 构建。
- **项目素材**放在你自己的剧集项目中。技能文档中的 `<项目根目录>` 和 `<本技能目录>` 要换成实际路径；历史案例提到的其他项目资料、生成平台及账号不随包提供。

## 从剧本跑一集

**1. 先做分镜。** 准备剧本、画幅、单集目标时长、台词语言、场景图和角色资产。将下句中的文件名和参数改成你的：

> 用 $storyboard-director 把 `第1集_剧本.md` 做成 9:16 分镜，单集约 90 秒，台词为普通话。按 `场景资产/` 定站位、轴线和机位，每场附 3.5 场景卡与出图清单。先交分镜和检查结果。

**2. 校对场景资产，再写提示词。** 先核对场景总览与各方向背景图的左右、识别物和光向，再记录场景锁。用满血版时，带上人物表演档案；新角色可以用[表演档案模板](skills/vertical-performance-director/表演/人物表演档案模板.md)先起草并确认。

> 用 $vertical-performance-director 按 `第1集_分镜.md` 写前两段提示词。每段约 15–20 秒、最多 5 镜，按分镜切点切段。保留台词原文和剧本括号里的表演提示。先写 `第1集_场景锁.txt`，每段沿用对应场景锁，只引用实际用到的方向图。输出 `第1集_段1_提示词.txt`、`第1集_段2_提示词.txt`、设计单和检查结果。

走小版时，把技能名换成 `$vertical-dialogue-director`（文戏）或 `$vertical-action-director`（武戏）。在 Claude Code 中将示例开头改为对应的 `/技能名`。

**3. 检查、生成、复盘。** 先把机械检查的 ❌ 清零，并说明保留的 ⚠️。提示词可交给你自己的 Seedance 环境生成；这套技能包不包含模型或账号。成片下载后，按段号核对台词漏没漏、表演是否清楚、反打和跨段的背景与光是否一致。

## 手动跑检查

以下命令在解压后的整合包根目录运行；输入换成你的实际文件或目录，带空格的路径保留引号。从剧集项目启动时，用实际安装路径替换 `skills/…`。

```sh
# 分镜格式样例（旧样例没有 v4 场景卡，预期会有提醒）
node "skills/storyboard-director/scripts/check_storyboard.js" "skills/storyboard-director/examples/格式样例_惹火34_戏1开头.md" --partial

# 满血版逐段检查：自动选择文戏或武戏检查，识别险情骨架
node "skills/vertical-performance-director/scripts/check.js" "提示词/第1集_段1_提示词.txt"

# 小版逐段检查：武戏把目录换成 vertical-action-director
node "skills/vertical-dialogue-director/scripts/check_prompt.js" "提示词/第1集_段1_提示词.txt"
node "skills/vertical-dialogue-director/scripts/check_shootable.js" "提示词/第1集_段1_提示词.txt"

# 跨段检查：仓库自带两段可试跑样例；实战传入整集提示词文件夹
node "skills/vertical-performance-director/scripts/check_scene.js" "examples/continuity-check"

# 按「场景 + 方向」输出审片拼图
node "skills/vertical-performance-director/scripts/scene_sheet.js" "提示词" "成片" "审片拼图"
```

小版文戏或武戏目录也有 `check_scene.js` 和 `scene_sheet.js`。提示词文件名需带 `段N` 和 `提示词`（例如 `第1集_段1_提示词.txt`），对应成片也要带相同 `段N`（如 `第1集_段1.mp4`）。跨段检查会在提示词目录里自动找文件名含 `场景锁` 的 `.txt`；有多份时用 `--lock "路径"` 显式指定。

## 包里有什么

- [分镜模板](skills/storyboard-director/templates/分镜脚本模板.md)、[场景资产出图清单模板](skills/storyboard-director/templates/场景资产出图清单模板.md)与[第 29 集场景锁案例](skills/storyboard-director/examples/320磅第29集_场景卡/)。
- 两版各自的提示词骨架、规则、审查清单和 Node.js 脚本。两套原包逐文件相同的分镜模块只保留一份。
- [《320 磅》剧设定示例](examples/show-settings/320磅未婚妻不忍了.md)：保留了共同剧设定和满血版附加的人物表演档案草稿；为新项目使用时换成自己的剧设定。

整合依据：2026-11-09 的 v4 小版本（字数台词）与满血版（表演）技能包。原包案例中的「已验证」和「待验证」指当时的制作记录，和整合包的安装、脚本测试是两回事。
