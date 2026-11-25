<p align="right"><a href="README.md">中文</a> | <strong>English</strong></p>

# 🎬 AI Vertical Drama Director Toolkit

**An industrial-grade, end-to-end AI agent production pipeline for vertical short dramas & AI comic dramas (Manju) — turning AI video generation from a slot machine into a compilable, testable, NLE-ready production system.**

> **This is NOT a collection of casual prompt templates.**
> Battle-tested on real commercial vertical dramas (both Chinese Manju and overseas TikTok English short dramas), this toolkit packages **3 decoupled agent skills, 217 structured files, 37 zero-dependency engineering scripts (~7,800 lines of Node.js & Python), and a 750K-character production rulebook**. Natively compatible with **Claude Code, Codex, Cursor, Antigravity (Gemini), and GPT**.

[📦 Download Release ZIP (v2026.11.24)](https://github.com/shiz81463/vertical-drama-director-skills/releases/download/v2026.11.24/ai-drama-director-toolkit-2026-11-24.zip) · [🔥 Why It Stands Out](#1-why-this-toolkit-stands-out) · [🎯 Pain Points Solved](#2-real-production-pain-points-solved) · [💰 Commercial ROI](#3-commercial-value-and-roi) · [⚡ 10-Min Quickstart](#5-10-minute-zero-account-quickstart) · [🎬 6-Step Tutorial](#6-end-to-end-tutorial-script-to-editable-jianyingcapcut-draft) · [🤖 AI Entrypoint](从这里开始_给AI读.md)

---

## 1. Why This Toolkit Stands Out

Most AI short-drama workflows still boil down to the same fragile loop: *write a massive prompt → burn credits rolling the dice → tweak random words when it breaks → fix sloppy cuts by eye in post.*

**This toolkit solves the problem with hard software engineering — taming generative randomness through compilers, static linters, regression tests, and frame-accurate NLE tooling:**

### 1. Hybrid "LLM + Deterministic Compiler" Architecture
LLMs are great at dramatic pacing and performance direction — and terrible at exact timestamp math, enforcing 30+ formatting invariants, and tracking props across segments. **Yijing V2.0 (`译镜`)** separates the two cleanly:
* **The LLM writes lean, structured source files** (Episode Card, Scene Card, Character Card, Segment Sources) so it focuses purely on blocking, acting, and beats;
* **A deterministic compiler (`build.js`) handles everything mechanical**: injects verbatim show style locks, calculates exact beat timestamps and hard-cut timings, expands **34 callable cinematography/camera terms**, enforces a 4-field cross-segment state ledger (`Carry-Over Frame` = previous segment's `End Frame`), and runs dozens of static checks — **zero ❌ errors required before you spend a cent on video generation.**

### 2. TDD-Style Failure Case Library Backed by Real Rendered Frames
Every constraint comes from real production failures, not guesswork:
* Ships with a **[23-Item Anti-Pattern & Failure Case Library](skills/译镜/反面案例/README.md)** paired with real rendered frame screenshots showing exact AI failure triggers:
  * Writing *"upper half / lower half of frame"* → **triggers accidental split-screen**
  * Writing *"eyes blood-red"* → **renders monster-red eyeballs**
  * Writing *"coat hem sweeps across lens"* → **0.54s pure black screen**
  * Omitting mouth state in an action sprint → **model invents random profanity on its own**
  * Writing *"freeze / hold completely still"* → **10+ dead frozen frames at shot tail**
* Backed by an automated regression suite (`self_test.js`): bad lines are injected into known-good prompts and the linter must catch 100% of them with exact rule IDs. **Once a production team hits a failure mode, it is locked into code forever.**

### 3. Clean Decoupling Between Storytelling & Video Models
* **Upstream — `Storyboard Director v6` (`分镜编导`)**: Owns platform-agnostic cinematic craft — a 6-ring pipeline, 11 scene-type shot recipes, 19 action-choreography patterns, a dialogue-pacing taxonomy, plus a script (`draw_plan.js`) that renders text floor plans into an interactive **HTML overhead camera-blocking diagram** for director review.
* **Midstream — `Yijing V2.0` (`译镜`)**: Owns platform-specific prompt translation (heavily validated on 9:16 vertical video / Seedance 2.5).
* **When a new generation model launches six months from now, you only re-calibrate the Yijing layer — your storyboards, rules, and show bibles stay intact.**

### 4. Automated Multimodal Video Review (`review.js`)
Once raw clips come back from the generation platform, one command runs three tedious checks automatically:
* **Cross-Segment Lighting & Continuity Sheets**: Uses FFmpeg to extract and tile frames from the same scene & camera direction across segments so lighting drift and background shifts jump out instantly;
* **Cut-Point Reconciliation**: Detects actual visual cuts in rendered clips and flags segments that *under-cut* (catching dropped tail shots automatically);
* **Dialogue Verification**: Runs local `faster-whisper` ASR against the script to flag dropped lines, misspoken words, hallucinated speech, or accidental language switches.

### 5. Last-Mile NLE Integration (Jianying / CapCut Pro): Frame-Level QC, Footage Rescue, Procedural Audio & Direct Draft Writing
Most open-source pipelines stop at dumping raw MP4s — right where commercial post-production headaches begin. **`manju-edit`** bridges straight into the editing bay:
* **Calibrated Frame-Level Flash-Frame & Freeze-Frame Detection**: AI clips (24fps) cut onto 30fps NLE timelines frequently leak 1–3 stray frames ("flash frames" / blended transition frames / frozen heads) — the #1 reason commercial edits get rejected. Calibrated against 21 shipped final episodes to match Jianying's exact floor-rounding frame sampling rule, the checker reports **exact clip, head/tail side, and how many timeline frames to trim**;
* **Empirical Footage Rescue Playbook**: Distilled from 20+ shipped episodes (head/tail trims, punch-in reframing, horizontal mirroring, reaction-shot B-roll overlays, speed ramps) following *"pick before fixing, fix before patching, regenerate only as a last resort"*;
* **Procedural Sound Effects & Score via Surge XT + pedalboard**: Generates broadcast-clean 48kHz/24-bit hits, risers, whooshes, drones, and unified multi-mood scores aligned to exact cut timestamps (0–2ms precision) — no cheesy sine-wave synth scripts;
* **Direct Editable Draft Generation (`write_draft.mjs`)**: Writes brand-new, multi-track Jianying Pro project drafts with uncut media handles, separated audio roles (dialogue / SFX / music), and TikTok English subtitle standards baked in (verified item-for-item across 256 timeline segments). Open it in the NLE and start fine-cutting immediately.

---

## 2. Real Production Pain Points Solved

| Pain Point in Real AI Short Dramas | The Old Broken Loop | How This Toolkit Eliminates It |
| :--- | :--- | :--- |
| **Reverse-Shot Continuity Breaks** | Doors jump sides, lighting flips, characters teleport; creators keep spamming *"keep background consistent"* in prompts. | **Overview-Map Direction Derivation + HTML Blocking Diagram + 4-Field State Ledger**: Directions are derived directly from the actual `@`-referenced overview map; unmapped angles are blocked with ❌; segment end-states lock verbatim into the next segment's opening (validated 9/10 background & lighting consistency across a 10-segment episode). |
| **Prompt Copy-Paste Chaos** | Editing a 9,000-char prompt by hand breaks timestamps, drifts wardrobe descriptions, and spawns phantom extras. | **Source-to-Prompt Compilation + 30+ Static Checks + 23 Failure-Case Traps**: Edit the source file once, recompile cleanly, and stop split-screens, red eyeballs, frozen tails, and rushed lines locally before generating. |
| **Flat Acting & Clipped Dialogue** | Questions sound like statements, arguments lack rhythm, lines get cut mid-word, silent listeners move their mouths. | **Dialogue Archetype Taxonomy + 4-Tier Emotional Intensity + Per-Segment Audio Binding**: Storyboard defines beat accents, delivery cadence (smooth / stutter / clipped / staccato), and listener reactions; compiler binds voice refs strictly to active speakers and flags any duration extensions for producer sign-off. |
| **Floaty, Aimless Action Scenes** | Weapons appear/vanish, strikes lack cause-and-effect, shots drag like slow-motion dance. | **Mandatory Action Choreography Sheet**: Action segments fail compilation unless fighter specs, rounds, and attack/defense tables are defined first; pairs with 19 fight-blocking patterns and tight 1.5–2.5s action shot windows. |
| **Endless Post-Production Rejections** | Human reviewers miss 1–2 stray flash frames, >4-frame subtitle drift, unwanted AI BGM, or loudness clipping. | **Automated Delivery QC Against Studio Redlines**: `qc_draft.mjs` and `qc_media.mjs` inspect flash frames, freezes, black frames, hard audio cuts, loudness peaks, and subtitle specs, returning exact `MM:SS:FF` fix instructions. |
| **Blame-Shifting During Revisions** | When a cut feels wrong, nobody knows whether to blame the script, storyboard, prompt, or edit. | **End-to-End Root-Cause Matrix**: Maps every visual/narrative symptom to the exact layer to fix (Storyboard Ring 0–5, Yijing source card, asset image, or NLE trim) for surgical rework. |

---

## 3. Commercial Value and ROI

Built for **AI drama studios, producers, AIGC pipeline leads, and commercial solo creators**, this system targets four bottom-line metrics:

1. **💰 Slashes Reroll & Compute Burn**
   * Catches doomed prompts locally at zero compute cost before touching the generation platform;
   * Recovers mildly flawed clips on the editing timeline via the empirical Rescue Playbook instead of burning credits regenerating (in verified V2 Episode 30 production, all 6 segments / 24 shots made the final cut).
2. **🚀 Breaks the Senior-Talent Bottleneck (Scalable Daily Output)**
   * Commercial vertical drama and overseas TikTok Manju live or die by daily episode throughput. By codifying director craft, studio delivery rules, **TikTok English subtitle standards, and trailer workflows** into executable skills and scripts, junior operators can reliably hit senior-grade output — enabling parallel multi-show scaling.
3. **⏱️ Compresses Review & Delivery Turnaround**
   * Automating lighting contact sheets, cut verification, Whisper line checks, frame-accurate flash-frame scanning, and initial NLE draft assembly removes ~80% of mechanical QA and assembly grunt work — letting directors and editors focus on pacing, hooks, and dramatic payoff.
4. **📈 Compounds Studio Know-How into Versioned Code Assets**
   * Handoffs rely on structured files and audit reports rather than buried chat logs;
   * Every new failure caught in review gets added to the failure-case library and regression tests — making your studio faster and sharper with every episode, immune to staff turnover or video-model churn.

---

## 4. Architecture: Three Decoupled Skills

Use the full end-to-end pipeline, or plug in any individual skill standalone:

```text
[ Script + Reference Assets ]
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Storyboard Director v6 (skills/分镜编导 | Codex: fenjing-biandao)     │
│    6-Ring Breakdown · 11 Scene Recipes · Dialogue Taxonomy · HTML Map   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Yijing V2.0 (skills/译镜 | Codex: yijing)                             │
│    4 Source Files → Compiler · State Ledger · 34 Camera Terms · 23 Traps│
│    ──▶ Video Platform Render ──▶ review.js (Sheets / Cuts / Whisper)    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. manju-edit (skills/manju-edit)                                       │
│    Storyboard Cut & 8-Pass Polish · Flash-Frame QC · Rescue · Surge XT  │
│    ──▶ write_draft.mjs → Editable Multi-Track Jianying/CapCut Pro Draft │
└─────────────────────────────────────────────────────────────────────────┘
```

| What You Have Right Now | Skill to Run | Deliverables |
| :--- | :--- | :--- |
| Script + character/scene reference images | **[Storyboard Director v6](skills/分镜编导/SKILL.md)** | Shot-by-shot storyboard, scene cards, dialogue reconciliation, HTML overhead camera map |
| Approved storyboard ready for 9:16 video generation | **[Yijing V2.0](skills/译镜/SKILL.md)** | Editable source cards, compiled segment prompts, build/audit report, action choreography sheet, automated video review |
| Rendered video clips or an NLE draft to edit / QA | **[manju-edit](skills/manju-edit/SKILL.md)** | Shot-selection sheet, rescue edit plan, frame-level QC report, procedural SFX/music WAVs, new editable Jianying Pro draft |

> **Modular by design**: Already have a storyboard? Start straight at Yijing. Only want to QA an exported MP4 or Jianying draft? Run `manju-edit` scripts standalone.

---

## 5. 10-Minute Zero-Account Quickstart

**No video platform account or GPU credits required.** With **Node.js 18+**, you can compile and audit a real commercial episode sample locally in minutes.

> *Note: Repository file paths and built-in scripts keep their original Chinese filenames (Codex aliases `fenjing-biandao`, `yijing`, and `manju-edit` are included for English-only skill loaders). Copy-paste commands below directly from the repo root.*

### Step 1: Download, Unzip & Run Environment Diagnostics

Download and extract the [Public Release ZIP](https://github.com/shiz81463/vertical-drama-director-skills/releases/download/v2026.11.24/ai-drama-director-toolkit-2026-11-24.zip), then open a terminal at the toolkit root:

```sh
node --version
node 检查环境.mjs --试跑
```

> **Tiered dependencies (install only what you need):**
> * **Node.js 18+ (Required)**: Zero `npm install` needed — powers storyboard checks, HTML camera maps, and the full prompt compiler/linter.
> * **FFmpeg / ffprobe (Recommended)**: Powers automated review contact sheets, cut detection, and frame-accurate flash-frame/freeze QC.
> * **Python + `faster-whisper` / Surge XT + `pedalboard` (Optional)**: Powers local ASR dialogue verification and procedural SFX/music synthesis. See [Environment Setup Guide](给另一台电脑的Claude_装环境.md) (your AI agent can read and install these step-by-step).

### Step 2: Install into Your AI Coding Agent (Optional)

**Option A — Native Skill Install (Claude Code / Codex):**

Windows (PowerShell):
```powershell
& ".\安装到这台电脑.ps1"          # Dry-run preview
& ".\安装到这台电脑.ps1" -Apply   # Actual install (auto-backs up existing skills)
```

macOS / Linux:
```sh
bash 安装到这台电脑.sh            # Dry-run preview
bash 安装到这台电脑.sh --apply    # Actual install
```
Start a **new conversation** after installing. Invoke via `分镜编导` / `译镜` / `manju-edit` in Claude Code, or `fenjing-biandao` / `yijing` / `manju-edit` in Codex.

**Option B — Zero-Install Workspace Mode (Cursor / Antigravity / any local file-reading agent):**
Open the extracted folder as your workspace and start with:
```text
Read 从这里开始_给AI读.md first and follow its routing tree and rules.
```

### Step 3: Compile a Real V2 Episode Sample Locally

Run the compiler and linter against the included V2 drama sample (writing into a fresh test folder):

```sh
node "skills/译镜/scripts/build.js" "skills/译镜/examples/V2_黑帮圣诞第30集_文戏/源" --bible "附带资料/剧设定_竖屏/黑帮老大的圣诞礼物.md" --out "试跑结果/V2文戏"
node "skills/译镜/scripts/check.js" "试跑结果/V2文戏" --style "附带资料/剧设定_竖屏/黑帮老大的圣诞礼物.md"
```

**Inspect two outputs right away to see the magic:**
1. Open `试跑结果/V2文戏/第30集_编译报告.md`: 4 segments, 70s total, **0 ❌ errors, 1 K15 ⚠️ warning** (pinpointing an isolated object-only tail shot in Segment 4 for human review — showing how the linter flags exact creative risks without overriding the director);
2. Compare the lean [source files](skills/译镜/examples/V2_黑帮圣诞第30集_文戏/源/) against the compiled TXT prompts to see automatic timing math, style locking, and cross-segment state carry-over in action.

---

## 6. End-to-End Tutorial: Script to Editable Jianying/CapCut Draft

Let's walk a complete 15-second elevator scene through all 6 production stages:
> **Scene**: As elevator doors begin to close, Lin Lan catches the door, holds out an envelope of evidence to Zhou Yu, and says: *"Read it first, then ask me."* Zhou Yu says nothing; his hand reaches toward the envelope — and stops mid-air.
> **Dramatic Accent**: Not the spoken line, but the hesitation of his uncompleted reach.

> 💡 **Best Practice**: Follow the [Model Flow Tree](skills/分镜编导/编导套装/模型流程树.md) — **always split Storyboard and Yijing into separate conversations** to prevent context pollution and token bloat.

---

### Step 1 | Gather Four Non-Negotiable Inputs

Organize a clean per-episode folder (`Episode01/` containing `源/`, `提示词/`, `成片/`, `审片/`, plus a shared show folder for show bible and reference assets) and lock four facts upfront:
1. **Aspect Ratio & Target Runtime**: e.g., `9:16` vertical, ~`90s` per episode (test with one scene first);
2. **Locked Script & Dialogue Language**: Specify Mandarin or US English (word rate dictates shot duration); include previous ending / next opening to prevent continuity overlap;
3. **Scene Overview + Character/Prop Refs**: Prefer a scene overview that includes an overhead grid showing doors, corridors, and key light; one image per character, one state per prop;
4. **Show Bible (Verbatim Style Lock)**: For a new show, draft one first with the [New Show Input Card](skills/译镜/规则档案/新剧输入卡.md).

---

### Step 2 | Session 1: Storyboard & Camera Blocking (`Storyboard Director`)

Open a fresh chat and prompt your agent:

```text
Use Storyboard Director (fenjing-biandao).
Read the locked script in "Episode01_Script.md". Vertical 9:16, ~90s episode, English dialogue.
Reference scene and character images are in "assets/".
Do ONLY the elevator scene for now — do NOT write video prompts.
The dramatic accent is Zhou Yu reaching out and stopping before taking the envelope.
Deliver all 6 rings: kickoff card, beat sheet, scene card, shot-by-shot storyboard (with start→end state per shot), dialogue reconciliation, and checker output.
```

Run the automated storyboard validator and render the overhead camera map:

```sh
# 1. Validate format, dialogue fidelity, shootability & rules (--partial for a single scene)
node "skills/分镜编导/scripts/check_storyboard.js" "Episode01_Storyboard.md" --partial

# 2. Generate interactive HTML overhead camera-blocking map; open in browser to verify axis
node "skills/分镜编导/scripts/draw_plan.js" "Episode01_Storyboard.md"
```

**✅ Gate to pass**: Zero ❌ errors and director sign-off on axis, beats, and dialogue. Close this chat.

---

### Step 3 | Session 2: Compile Prompts via Source Cards (`Yijing V2.0`)

Open a **new chat** and hand off the approved storyboard + show bible:

```text
Use Yijing (yijing) to read the approved "Episode01_Storyboard.md" and "ElevatorTest_ShowBible.md".
Follow V2 format for the elevator segment and preserve all dialogue verbatim.
Derive camera directions strictly from the actual @-referenced overview map in "assets/"; flag any unmapped angles as needing reference renders.
Deliver 集卡.txt, 场景卡.txt, 人物卡.txt, 段1.txt, compiled prompts, semantic review findings, and the build report.
List any dialogue duration extensions or time jumps for my approval.
```

Compile and lint locally:

```sh
node "skills/译镜/scripts/build.js" "Episode01/源" --bible "ElevatorTest_ShowBible.md" --out "Episode01/提示词"
node "skills/译镜/scripts/check.js" "Episode01/提示词" --style "ElevatorTest_ShowBible.md"
```

When revising later, edit only the single source of truth and recompile:
* Door flipped / wrong light direction → edit `场景卡.txt`
* Wardrobe drift / wrong `@` reference → edit `人物卡.txt`
* Pacing / eyeline / handoff state mismatch → edit `段N.txt`

**✅ Gate to pass**: Zero ❌ errors in build report, semantic checklist completed, and producer approval on flagged extensions.

---

### Step 4 | Render on Your Video Platform (Test 1 Segment First)

1. Register the required character, prop, and scene-overview assets on your video platform (e.g. Seedance 2.5), matching `@` names verbatim from the build report;
2. Verify `9:16` ratio and exact segment duration, then render `Segment 1` first. Only generate extra single-direction background references if multi-segment backgrounds drift or when inserting pickup shots (see [Manual](编导套装_使用手册.md) §3);
3. Save outputs with segment numbers (`Episode01_段1.mp4`, `Episode01_段2.mp4`, ...).

> Note: Video platform accounts, credits, and assets are not bundled. Scripts never upload files or trigger paid generations automatically.

---

### Step 5 | Automated Video Review & Surgical Rework

Drop rendered clips into `Episode01/成片/` and run:

```sh
# Fast mode (same-direction lighting contact sheets + cut-point audit, without ASR)
node "skills/译镜/scripts/review.js" "Episode01/提示词" "Episode01/成片" "Episode01/审片" --no-asr

# Full mode (adds local faster-whisper ASR line-by-line dialogue verification)
node "skills/译镜/scripts/review.js" "Episode01/提示词" "Episode01/成片" "Episode01/审片" --asr-model "<path-to-whisper-model>"
```

Inspect `审片报告.md` and contact sheets, then fix at the exact root cause:

| Issue Spotted in Review | Exact Fix |
| :--- | :--- |
| Door flipped sides / lighting shifted on reverse shot | Fix camera direction in `场景卡.txt` against overview map (add directional ref if needed). Don't spam *"consistent background"*. |
| Envelope teleported between segments | Align previous `End Frame` with next `Carry-Over Frame` in source files; regenerate only affected segment(s). |
| Under-cut (missing tail shot) or clipped dialogue | Check words-per-second and 1s tail buffer; adjust timing in storyboard/source and recompile. |
| 1–2 stray frames at a cut or minor tail artifact | **Don't burn credits regenerating!** Trim or rescue it in 3 seconds during Step 6. |

> ⚠️ Rule: If you hand-edit a compiled prompt to verify a quick fix, ask the agent to write it back into the source files so future builds never overwrite it.

---

### Step 6 | Edit, Rescue, Score & Write an Editable NLE Draft (`manju-edit`)

Open a new chat with `manju-edit`:

1. **Storyboard Assembly / Rescue Plan / 8-Pass Polish**:
   ```text
   Use manju-edit with "Episode01_Storyboard.md" and the raw clips in "Episode01/成片/".
   Build the shot-selection sheet, apply the rescue playbook to any imperfect clips, and output an editable draft plan JSON.
   ```
2. **(Optional) Procedural Cut-Synced SFX & Score** (requires Surge XT + `pedalboard`):
   ```sh
   # Frame-accurate risers, hits, and drones
   <python-exe> -I "skills/manju-edit/scripts/sound/surge_sfx.py" "Episode01/audio" riser len=72f hit pitch=-3 drone len=15

   # Continuous multi-mood score locked to exact cut timestamps (stems=1 exports separate tracks)
   <python-exe> -I "skills/manju-edit/scripts/sound/surge_music.py" "Episode01/audio/ep01_score.wav" mood=悬疑:12,压迫:28,悲伤:45 hits=12,28 stems=1
   ```
3. **Generate a Brand-New Jianying Pro Multi-Track Draft** (never overwrites existing projects):
   ```sh
   node "skills/manju-edit/scripts/write_draft.mjs" "Episode01/edit_plan.json" --dry-run
   node "skills/manju-edit/scripts/write_draft.mjs" "Episode01/edit_plan.json"
   ```
4. **Double-Layer Frame-Accurate Delivery QC** (draft before opening + exported master MP4):
   ```sh
   # Audit draft against all 10 studio redlines + source-level head/tail flash-frame check
   node "skills/manju-edit/scripts/qc_draft.mjs" "<draft-name-or-path>"

   # Audit exported master MP4 for flash frames, freezes, black frames, audio hard-cuts, loudness & shot contact sheets
   node "skills/manju-edit/scripts/qc_media.mjs" "Episode01/成片/ep01_master.mp4" --out "Episode01/qc_out"

   # Export 12-frame forensic strips around suspect timestamps to verify visually in seconds
   node "skills/manju-edit/scripts/qc_media.mjs" "Episode01/成片/ep01_master.mp4" --strip 25.6,58.8
   ```

**✅ Final Delivery**: Every frame-level defect is caught and pinned to `MM:SS:FF`; the editor opens the generated multi-track draft in Jianying Pro for final creative sign-off and export.

---

## 7. Solo Creators vs. Commercial Production Teams

* **Solo Creators**: Run the included V2 sample first, then push one 15s scene through Steps 1–6. Once dialed in, expect immediate savings in reroll credits and manual trimming time.
* **Multi-Episode Commercial Studios**:
  * **Shared Asset Layer**: Maintain a single show bible, character cards, scene cards, and director feedback log across the entire season;
  * **Role-Based Relay**: Directors review `Storyboard + HTML Camera Map` → Prompt Engineers/AI run `Yijing Compile + Render + Auto-Review` → Editors receive `Editable Jianying Draft + Frame-Accurate QC Report`. **Zero reliance on monolithic chat histories.**
* **Teams Who Only Want Automated QA**: Keep your existing creation stack and run `qc_media.mjs` / `qc_draft.mjs` standalone as a pre-delivery safety net.

---

## 8. Validation Scope & Honest Boundaries

We value engineering honesty and clearly state what is proven vs. environment-dependent:
* **Proven & Regression-Tested**: 6-ring storyboard checks & HTML camera maps; Yijing V2.0 compiler & 23-case automated anti-pattern regression tests; V1 backward compatibility; Jianying Pro draft JSON writer (256-segment exact structural parity); 24→30fps flash-frame sampling calibration (21 shipped episodes); sample-accurate Surge XT audio rendering.
* **Requires Validation in Your Own Environment**: Automated scripts verify structural integrity, rule compliance, and frame-level defects — they do not replace human taste or guarantee 100% single-take video generation on every external model. 16:9 widescreen rules are currently marked experimental; local `faster-whisper` and Surge XT require optional local setup.

---

## Further Reading

* **Setup & Packaging**: [User Guide](说明_给人看.md) · [Environment Setup (for AI)](给另一台电脑的Claude_装环境.md) · [Version Manifest](版本.md)
* **Directing & Prompting**: [Full Production Manual](编导套装_使用手册.md) · [V2.0 Specification](skills/译镜/手册/0_V2写法.md) · [23-Item Failure Case Library](skills/译镜/反面案例/README.md) · [34 Camera Terms](skills/译镜/手册/8_机位术语.md)
* **Editing & Sound**: [Flash-Frame & Freeze Calibration](skills/manju-edit/references/frame-residue.md) · [AI Footage Rescue Playbook](skills/manju-edit/references/rescue-playbook.md) · [Jianying Draft Writer Spec](skills/manju-edit/references/write-draft.md) · [Sound & Music Synthesis Guide](skills/manju-edit/references/sound-design.md)
* **Legacy**: [v4.0.0 Release](https://github.com/shiz81463/vertical-drama-director-skills/releases/tag/v4.0.0)
