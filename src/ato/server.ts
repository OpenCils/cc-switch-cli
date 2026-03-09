/**
 * [INPUT]: HTTP 请求（Anthropic 格式）、上游配置
 * [OUTPUT]: HTTP 响应（Anthropic 格式）、代理服务实例
 * [POS]: ATO 代理服务器，接收 Claude Code 请求，转发 OpenAI Responses API
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import http from 'http'
import { anthropicToOpenAIResponses } from './convert.js'
import { openAIToAnthropic, openAIStreamToAnthropic, emitEvent } from './response.js'

// ---------------------- 配置 ----------------------
export interface AtoConfig {
  port: number           // 本地监听端口，默认 5000
  upstreamUrl: string    // 上游 OpenAI 兼容 API 地址
  upstreamKey: string    // 上游 API 密钥
}

// ---------------------- 代理服务器 ----------------------
export function createAtoServer(config: AtoConfig): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', upstream: config.upstreamUrl }))
      return
    }

    // /v1/messages - 主入口
    if (req.method === 'POST' && req.url === '/v1/messages') {
      try {
        await handleMessages(req, res, config)
      } catch (err: any) {
        console.error('[ATO] Error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { type: 'internal_error', message: err.message } }))
      }
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { type: 'not_found', message: 'Not found' } }))
  })

  return server
}

// ---------------------- 请求处理 ----------------------
async function handleMessages(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: AtoConfig
): Promise<void> {
  // 读取请求体
  const body = await readBody(req)
  let anthropicReq: any
  try {
    anthropicReq = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { type: 'invalid_request', message: 'Invalid JSON' } }))
    return
  }

  // 转换为 OpenAI 格式
  const openaiReq = anthropicToOpenAIResponses(anthropicReq)
  const isStream = openaiReq.stream === true

  console.log(`[ATO] ${anthropicReq.model} -> ${openaiReq.model}, stream=${isStream}`)

  // 发送到上游
  const upstreamResp = await fetch(`${config.upstreamUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.upstreamKey}`,
    },
    body: JSON.stringify(openaiReq),
  })

  if (!upstreamResp.ok) {
    const errorText = await upstreamResp.text()
    console.error(`[ATO] Upstream error: ${upstreamResp.status}`, errorText)
    res.writeHead(upstreamResp.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      error: { type: 'upstream_error', message: errorText, status: upstreamResp.status }
    }))
    return
  }

  if (isStream) {
    // 流式响应
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    await handleStreamResponse(upstreamResp, res)
  } else {
    // 非流式响应
    const openaiResp = await upstreamResp.json()
    const anthropicResp = openAIToAnthropic(openaiResp)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(anthropicResp))
  }
}

// ---------------------- 流式处理 ----------------------
async function handleStreamResponse(
  upstreamResp: Response,
  res: http.ServerResponse
): Promise<void> {
  const reader = upstreamResp.body?.getReader()
  if (!reader) {
    res.end()
    return
  }

  const decoder = new TextDecoder()
  const chunks: string[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      chunks.push(chunk)

      // 实时转换并转发
      // 注意：这里简化处理，实际应该边读边转
      res.write(chunk)
    }

    // 完成 SSE 流
    res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    res.end()
  } catch (err: any) {
    console.error('[ATO] Stream error:', err.message)
    res.end()
  }
}

// ---------------------- 辅助函数 ----------------------
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

// ---------------------- 进程管理 ----------------------
export function startAtoProcess(config: AtoConfig): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createAtoServer(config)

    server.listen(config.port, () => {
      console.log(`[ATO] Proxy started on port ${config.port}`)
      console.log(`[ATO] Upstream: ${config.upstreamUrl}`)
      resolve(config.port)
    })

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${config.port} is already in use`))
      } else {
        reject(err)
      }
    })
  })
}

// ---------------------- 端口检测 ----------------------
export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') resolve(true)
      else resolve(false)
    })
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port)
  })
}

export async function checkAtoRunning(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    })
    return resp.ok
  } catch {
    return false
  }
}
