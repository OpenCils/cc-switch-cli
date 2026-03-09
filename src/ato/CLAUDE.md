# src/ato/
> L2 | 父级: ../CLAUDE.md

## 成员清单
convert.ts: Anthropic → OpenAI Responses 请求格式转换
response.ts: OpenAI Responses → Anthropic 响应格式转换（流式/非流式）
server.ts: HTTP 代理服务器，接收 Claude Code 请求转发上游
manager.ts: ATO 进程管理器，启动/停止/状态检测
entry.mjs: 独立进程入口，detached spawn 启动
index.ts: 模块导出入口

## 架构预留
- 本模块设计为**可插拔**，未来模型协议统一后可整体删除
- `convert.ts`/`response.ts` 独立于其他模块，便于扩展**反向代理**（Codex 接 Claude 模型）

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
