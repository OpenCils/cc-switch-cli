# src/ato/
> L2 | 父级: ../CLAUDE.md

## 成员清单
convert.ts: Anthropic -> OpenAI Responses 请求转换，保留模型透传与别名映射。
response.ts: OpenAI Responses -> Anthropic 响应转换，覆盖流式/非流式语义。
server.ts: 内嵌 HTTP 代理，兼容 /health /ready /v1/messages /v1/messages/count_tokens，含同构流式转换器。
manager.ts: ATO 进程管理，Windows 直接启动 entry.mjs（启动轮询 6×500ms），WSL 同步复制同一 entry.mjs 并托管生命周期。
entry.mjs: 独立代理入口，含完整流式转换器 openAIResponsesStreamToAnthropic（OpenAI SSE → Anthropic SSE，tool_use 延迟发出）。
index.ts: 模块导出入口。

## 架构约束
- Windows/WSL 必须共享同一份 entry.mjs，禁止再内联第二套代理实现。
- Claude Code 启动期会调用 count_tokens，缺失该端点视为协议不兼容。
- 激活链必须先确认 ATO 可用，再写入 Claude 配置，禁止把用户切到坏状态。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
