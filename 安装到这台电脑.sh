#!/usr/bin/env bash
# 安装到这台电脑（Mac / Linux）：把这个包里的 分镜编导、译镜、剪辑技能 manju-edit 装进 skills 文件夹。
#
# 先预演（只列出会做什么，不动文件）：  bash 安装到这台电脑.sh
# 确认没问题再真装：                    bash 安装到这台电脑.sh --apply
# 只装其中几个技能：                    bash 安装到这台电脑.sh --apply --skills manju-edit
# 只装到指定的 skills 文件夹：          bash 安装到这台电脑.sh --apply ~/项目/.claude/skills ~/项目/.agents/skills
#
# 默认装到 ~/.claude/skills 和 ~/.agents/skills。路径里有 /.agents/ 的，分镜编导、译镜的 SKILL.md 换成英文 name 行的那一份；
# manju-edit 本来就是英文名，不换。
# 不删东西：原来的同名技能先挪到 ~/编导套装_替换前备份/<时间>/。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APPLY=0
TARGETS=()
SKILLS=(分镜编导 译镜 manju-edit)
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --skills) shift; IFS=',' read -r -a SKILLS <<< "$1" ;;
    *) TARGETS+=("$1") ;;
  esac
  shift
done
if [ ${#TARGETS[@]} -eq 0 ]; then TARGETS=("$HOME/.claude/skills" "$HOME/.agents/skills"); fi
STAMP="$(date +%Y%m%d_%H%M%S)"
KEEP="$HOME/编导套装_替换前备份/$STAMP"
for s in "${SKILLS[@]}"; do
  [ -f "$HERE/skills/$s/SKILL.md" ] || { echo "包里没有 skills/${s}：技能名写错了，或者这个脚本没放在包的根目录跑"; exit 2; }
done
echo "包：$HERE"
for T in "${TARGETS[@]}"; do
  case "$T/" in */.agents/*) AG=1 ;; *) AG=0 ;; esac
  TAG="$(echo "$T" | sed 's#[/: ]\{1,\}#_#g; s#^_##')"
  for s in "${SKILLS[@]}"; do
    CUR="$T/$s"
    AGF="$HERE/agents版SKILL/${s}_SKILL.md"
    if [ $AG -eq 1 ] && [ -f "$AGF" ]; then USEAG=1; else USEAG=0; fi
    if [ -e "$CUR" ]; then echo "  ${CUR}：原来的挪到 $KEEP/$TAG/${s}，换成包里的"; else echo "  ${CUR}：新装"; fi
    if [ $APPLY -eq 1 ]; then
      mkdir -p "$T"
      if [ -e "$CUR" ]; then mkdir -p "$KEEP/$TAG"; mv "$CUR" "$KEEP/$TAG/$s"; fi
      cp -R "$HERE/skills/$s" "$CUR"
      if [ $USEAG -eq 1 ]; then cp "$AGF" "$CUR/SKILL.md"; fi
    fi
  done
done
if [ $APPLY -eq 1 ]; then echo "装好了。新开一个对话才生效。"; else echo "这是预演，什么都没动。确认后加 --apply 再跑一次。"; fi
echo "提醒：技能里写死了 D:\\漫剧公司\\... 的路径；脚本要的 Node、ffmpeg、Python 这些也要另装。换了电脑，让 AI 读包里的 给另一台电脑的Claude_装环境.md。"
