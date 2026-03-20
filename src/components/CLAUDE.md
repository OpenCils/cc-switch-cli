# src/components/
> L2 | 父级: ../CLAUDE.md

## 成员清单
Banner.tsx: 顶部品牌字标组件，按终端宽度在 ANSI Shadow / 紧凑 ASCII / 纯文本之间切换，监听 resize 避免窄窗口乱码，字体数据来自 assets/ansiShadowFont.ts 内嵌常量
StableTextInput.tsx: 稳定文本输入组件，用 ref 持有最新 value/cursor，修复 raw mode 下长文本粘贴被拆成多段后前缀丢失的问题

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
