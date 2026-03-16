# src/screens/
> L2 | 父级: ../CLAUDE.md

## 成员清单
ProviderSelect.tsx: 入口屏幕，展示所有检测到的安装实例与当前激活模型
ProviderList.tsx: 供应商列表屏幕，展示/激活/删除供应商；ATO 模式下默认走 18653，端口被占用时自动顺延空闲端口并回写供应商
ProviderForm.tsx: 供应商表单屏幕，添加或编辑供应商的名称/模型/URL/Key
ExitConfirm.tsx: 退出确认屏幕，决定退出时保留后台 ATO 还是先关闭再退出
UpdateConfirm.tsx: 更新确认屏幕，启动时检测到新版本则弹出询问用户，并在更新过程中显示阶段与下载进度

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
