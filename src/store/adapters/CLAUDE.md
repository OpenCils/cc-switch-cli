# src/store/adapters/
> L2 | 父级: ../../CLAUDE.md

## 成员清单
index.ts: 统一分发器，readConfig/writeConfig 根据 Tool 类型路由到对应适配器
claude.ts: Claude Code 配置读写，settings.json 的 env.ANTHROPIC_MODEL/BASE_URL/AUTH_TOKEN
codex.ts: Codex 配置读写，config.toml 的 model/model_provider 及 [model_providers] section
gemini.ts: Gemini 配置读写，settings.json（OAuth 模式，model 字段可选）
openclaw.ts: OpenClaw 配置读写，openclaw.json 的 agents.defaults.model.primary

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
