# cc-switch-cli — TUI 模型切换器
Node.js + Ink + TypeScript + figlet

## 启动
```bash
node bin/cc.mjs         # 直接运行
npm start               # 等价
```

## 顶层文件
- `README.md` — GitHub 项目首页文档，负责对外展示项目定位、预览图、上手方式与核心能力
- `preview.png` — README 首屏真实终端截图，仓库内托管，确保 GitHub 页面直接展示当前界面

## 架构

<directory>
src/              - 源码根目录
  app.tsx         - 根组件 + 三屏路由状态机，外加退出前的 ATO 保留/关闭确认，启动后台更新检测与自更新入口
  types.ts        - 类型定义：Tool、Environment、Installation、ProviderConfig、AppStore、TOOLS
  version.ts      - 版本常量 VERSION，CI 编译前自动注入 tag 版本号
  updater.ts      - 更新模块：查 GitHub Releases API、归一化版本号、纠正升级后的缓存状态，并在自更新时回传阶段与下载进度
  components/     - 通用组件
    Banner.tsx    - 首屏顶部品牌字标，按终端宽度在大字 / 小字 / 纯文本间切换，避免窄窗口 ASCII 断裂
    StableTextInput.tsx - 稳定文本输入组件，用 ref 紧贴 stdin 最新值，修复 raw mode 下多段粘贴覆盖前段内容
  screens/        - 四个屏幕组件
    ProviderSelect.tsx - 入口屏：Banner + 检测到的所有安装实例列表
    ProviderList.tsx   - 供应商列表：展示/激活/删除/跳转添加，ATO 模式默认走 18653，端口被占用时自动顺延空闲端口并回写存储
    ProviderForm.tsx   - 表单屏：添加或编辑供应商配置，支持 ATO 代理开关，并对长密钥显示摘要、拦截空白字符、避免截断后静默落盘
    ExitConfirm.tsx   - 退出确认屏：退出时选择保留后台 ATO 或一并关闭
  store/
    detect.ts     - 多环境安装检测器：扫描 Windows 原生 + WSL 各发行版
    local.ts      - 本地持久化层：管理 ~/.cc-switch.json，供应商 CRUD
    write-wsl.ts  - WSL 写入桥接器：通过 wsl 命令写回 WSL 文件系统
    adapters/     - 工具配置适配器层
      index.ts    - 统一分发器，根据 Tool 类型路由到对应适配器
      claude.ts   - Claude Code 适配器：读写 settings.json 的 env 字段
      codex.ts    - Codex 适配器：读写 config.toml 的 model/provider 字段
      gemini.ts   - Gemini 适配器：读写 settings.json（OAuth 模式）
      openclaw.ts - OpenClaw 适配器：读写 openclaw.json 的 agents.defaults.model
  ato/            - ATO 代理模块（Anthropic → OpenAI 协议转换）
    convert.ts    - 请求转换：Anthropic API → OpenAI Responses API
    response.ts   - 响应转换：OpenAI Responses → Anthropic 格式
    server.ts     - HTTP 代理服务器：兼容 /v1/messages 与 /v1/messages/count_tokens
    manager.ts    - 进程管理：启动/停止/状态检测，Windows/WSL 统一复用 entry.mjs
    entry.mjs     - 独立进程入口
bin/
  cc.mjs          - 跨平台入口，spawnSync tsx（Windows 用 .cmd）
</directory>

## 核心概念
- **Tool**: 四种 AI 编码工具（Claude Code / Codex / Gemini / OpenClaw）
- **Environment**: 运行环境（Windows / WSL:发行版 / Linux / macOS）
- **Installation**: 检测到的具体安装实例 = Tool + Environment + 配置路径
- **ProviderConfig**: 用户保存的供应商配置 = 名称 + 模型 + URL + Key + ATO 代理设置
- **AppStore**: 本地持久化，每个安装实例下可存多个供应商，随时切换激活
- **ATO**: 内置代理模块，让 Claude Code 能使用 OpenAI 兼容的模型

## 配置文件
- `~/.cc-switch.json` — CC Switch 自身存储，保存所有供应商配置和激活状态
- 各工具原生配置 — 激活供应商时写入对应工具的配置文件

## ATO 代理
- 供应商表单中开启「通过 ATO 代理」后，激活时自动启动独立代理进程
- 代理进程 detached 运行，CC Switch 关闭后继续后台服务
- 供应商切换时自动管理代理启停，启动失败时不写入坏配置；默认 18653，被占用时自动切到后续空闲端口
- 退出 CC Switch 时会弹出确认：可保留 ATO 继续后台运行，也可一并关闭

## 键盘快捷键
| 屏幕 | 按键 | 动作 |
|------|------|------|
| ProviderSelect | ↑↓ | 移动光标 |
| | Enter | 进入配置编辑 |
| | q / Esc | 打开退出确认 |
| 全局 | Ctrl+C | 打开退出确认 |
| ConfigEdit | Tab / Shift+Tab | 切换字段 |
| | Enter | 下一字段/提交 |
| | Ctrl+S | 保存 |
| | Esc | 取消 |

## 依赖
- `ink` v6 — React-based TUI 渲染器
- `ink-text-input` — 表单文本输入组件
- `figlet` — ASCII art 字体渲染（ANSI Shadow 字体）
- `tsx` — TypeScript 直接运行

## 变更日志
- v1.2.13  粘贴根因修复：移除对 ink-text-input 的关键依赖路径，改用本地稳定输入组件；多段 paste 不再因 React 受控输入闭包滞后而丢失前缀
- v1.2.12  密钥完整性修复：表单为长密钥显示首尾摘要与长度，拦截空格/换行损坏，并要求二次确认后再保存，避免 WSL/终端粘贴异常时把截断密钥静默写盘
- v1.2.11  更新体验修复：更新确认页展示准备/下载/替换阶段与下载进度，完成后短暂停留再退出；Linux/macOS 前台下载后原地替换，避免“确认后直接弹出”却看不见过程
- v1.2.10  交互修复：顶部 Banner 按终端宽度自动切到紧凑字标，避免窄窗口 ASCII 断裂；同步统一发布版本号来源
- v1.2.6  发布修复：GitHub Actions 改为稳定注入 tag 版本，避免产物出现 当前版本: vundefined
- v1.2.5  修复尝试：补上版本归一化与发布注入，但 Actions 中的 heredoc 脚本失败，未生成有效产物
- v1.2.4  体验修复：首屏显示当前版本，加入一键自更新 u，并清理升级后仍提示更新的缓存误判
- v1.2.3  ATO 修复：递归规范化 tool schema，补齐 object/properties，避免上游 400 invalid_function_parameters
- v2.0.0  架构重构：多环境检测（Windows + WSL），工具配置适配器，直接编辑安装实例配置
- v1.0.0  初始实现：四提供商选择、模型增删改激活、ASCII banner
