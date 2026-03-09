# src/ato/
> L2 | 父级: ../CLAUDE.md

## 成员清单
runtime.mjs: ATO 单一真相源，承载协议转换、流式桥接、HTTP 服务与健康检查，供 entry/server/convert/response 共同复用。
convert.ts: 请求转换的 TypeScript 类型壳，向外暴露 anthropicToOpenAIResponses 签名，并委托 runtime.mjs。
response.ts: 响应转换的 TypeScript 类型壳，非流式转换与 SSE 事件委托 runtime.mjs，保留 chunk 流工具导出。
server.ts: HTTP 服务的 TypeScript 类型壳，向外暴露 createAtoServer/startAtoProcess/checkAtoRunning/isPortInUse，并委托 runtime.mjs。
manager.ts: ATO 进程管理，隐藏 Windows/WSL 子进程窗口；Windows 源码态直启 entry.mjs，编译态走 --ato-child；WSL 同步复制 entry.mjs + runtime.mjs，并自动发现系统 node / nvm。
entry.mjs: 独立代理 CLI 壳，只做参数解析并调用 runtime.mjs 启动 ATO。
index.ts: 模块导出入口。

## 架构约束
- runtime.mjs 是 ATO 运行时唯一真相源，entry.mjs/server.ts/convert.ts/response.ts 只能做壳，禁止再内联第二套协议实现。
- Claude Code 启动期会调用 count_tokens，缺失该端点视为协议不兼容。
- 激活链必须先确认 ATO 可用，再写入 Claude 配置，禁止把用户切到坏状态。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
