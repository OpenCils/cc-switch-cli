# src/store/
> L2 | 父级: ../CLAUDE.md

## 成员清单
detect.ts: 多环境安装检测器，扫描 Windows 原生 + WSL 发行版，返回 Installation[]
local.ts: 本地持久化层，管理 ~/.cc-switch.json，存储用户保存的供应商配置和激活状态
write-wsl.ts: WSL 写入桥接器，通过 wsl -- cp 将修改后的配置写回 WSL 文件系统
adapters/: 工具配置适配器层（见 adapters/CLAUDE.md）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
