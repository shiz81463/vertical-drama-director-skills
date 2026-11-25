# 安装到这台电脑：把这个包里的 分镜编导、译镜、剪辑技能 manju-edit 装进这台电脑的 skills 文件夹（Windows）。
#
# 先预演（只列出会做什么，不动文件）：
#   & ".\安装到这台电脑.ps1"
# 确认没问题再真装：
#   & ".\安装到这台电脑.ps1" -Apply
# 只装其中几个技能：
#   & ".\安装到这台电脑.ps1" -Skills manju-edit -Apply
# 只装到指定的 skills 文件夹（可以写几个，用逗号隔开）：
#   & ".\安装到这台电脑.ps1" -Targets "D:\我的项目\.claude\skills","D:\我的项目\.agents\skills" -Apply
#
# 默认装到：
#   %USERPROFILE%\.claude\skills   （Claude Code 读这里）
#   %USERPROFILE%\.agents\skills   （Codex 等读 .agents 的工具读这里）
#   这台电脑有 D:\漫剧公司 的话，再加它下面的 .claude\skills、.agents\skills（只装分镜编导、译镜；剪辑技能原来就只装在用户文件夹下）
# 路径里有 \.agents\ 的，分镜编导、译镜的 SKILL.md 换成英文 name 行的那一份（agents版SKILL\）。manju-edit 本来就是英文名，不换。
#
# 不删东西：这台电脑上原来的同名技能先整个挪到 %USERPROFILE%\编导套装_替换前备份\<时间>\，要退回就从那里拷回去。
# 备份想放别处：加 -BackupTo <文件夹>。
param(
  [string[]]$Targets,
  [string[]]$Skills = @('分镜编导', '译镜', 'manju-edit'),
  [string]$BackupTo = (Join-Path $HOME '编导套装_替换前备份'),
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$UserOnly = @('manju-edit')   # 默认目标时，这些只装到用户文件夹下
foreach ($s in $Skills) {
  if (-not (Test-Path (Join-Path $Here "skills\$s\SKILL.md"))) { throw "包里没有 skills\$s：技能名写错了，或者这个脚本没放在包的根目录跑" }
}
$Plan = @()   # 每一项：装到哪个 skills 文件夹、装哪几个技能
if ($Targets) {
  foreach ($T in $Targets) { $Plan += , @($T, $Skills) }
} else {
  foreach ($T in @("$HOME\.claude\skills", "$HOME\.agents\skills")) { $Plan += , @($T, $Skills) }
  if (Test-Path 'D:\漫剧公司') {
    $proj = @($Skills | Where-Object { $UserOnly -notcontains $_ })
    if ($proj.Count) { foreach ($T in @('D:\漫剧公司\.claude\skills', 'D:\漫剧公司\.agents\skills')) { $Plan += , @($T, $proj) } }
  }
}
$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$Keep = Join-Path $BackupTo $Stamp

Write-Host "包：$Here"
if (Test-Path (Join-Path $Here '版本.md')) { Get-Content (Join-Path $Here '版本.md') -Encoding UTF8 | Select-String '^\| (分镜编导|译镜|manju-edit)' | ForEach-Object { Write-Host "  $($_.Line)" } }
Write-Host "装到："
foreach ($item in $Plan) {
  $T = $item[0]
  $isAgents = $T -match '[\\/]\.agents[\\/]'
  $tag = ($T -replace '[:\\/ ]+', '_').Trim('_')
  foreach ($s in $item[1]) {
    $cur = Join-Path $T $s
    $agSkill = Join-Path $Here "agents版SKILL\${s}_SKILL.md"
    $useAg = $isAgents -and (Test-Path $agSkill)
    $note = if ($useAg) { '（SKILL.md 用英文 name 行）' } else { '' }
    if (Test-Path $cur) { Write-Host "  $cur：原来的挪到 $Keep\$tag\$s，换成包里的$note" }
    else { Write-Host "  $cur：新装$note" }
    if ($Apply) {
      New-Item -ItemType Directory -Force $T | Out-Null
      if (Test-Path $cur) {
        New-Item -ItemType Directory -Force (Join-Path $Keep $tag) | Out-Null
        Move-Item $cur (Join-Path (Join-Path $Keep $tag) $s)
      }
      Copy-Item (Join-Path $Here "skills\$s") $cur -Recurse
      if ($useAg) { Copy-Item $agSkill (Join-Path $cur 'SKILL.md') -Force }
      $n1 = (Get-ChildItem (Join-Path $Here "skills\$s") -Recurse -File).Count
      $n2 = (Get-ChildItem $cur -Recurse -File).Count
      if ($n1 -ne $n2) { Write-Host "    ⚠️ 文件数对不上：包里 $n1 个，装好 $n2 个" }
    }
  }
}
if ($Apply) {
  Write-Host "装好了。新开一个对话才生效。"
  if (Test-Path $Keep) { Write-Host "原来的版本在：$Keep" }
} else {
  Write-Host "这是预演，什么都没动。确认后加 -Apply 再跑一次。"
}
Write-Host "提醒：技能里写死了 D:\漫剧公司\... 的路径；脚本要的 Node、ffmpeg、Python 这些也要另装。换了电脑，让 AI 读包里的 给另一台电脑的Claude_装环境.md，或者自己看 说明_给人看.md 第 3、4 节。"
