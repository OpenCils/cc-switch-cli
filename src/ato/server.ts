/**
 * [INPUT]: HTTP 请求（Anthropic 格式）、上游配置
 * [OUTPUT]: HTTP 响应（Anthropic 格式）、代理服务实例
 * [POS]: ATO 代理服务器，接收 Claude Code 请求，转发 OpenAI Responses API
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import http from 'http'
import { anthropicToOpenAIResponses } from './convert.js'
import { openAIToAnthropic } from './response.js'

// ---------------------- 配置 ----------------------
export interface AtoConfig {
  port: number           // 本地监听端口，默认 18653
  upstreamUrl: string    // 上游 OpenAI 兼容 API 地址
  upstreamKey: string    // 上游 API 密钥
}

// ---------------------- 代理服务器 ----------------------
export function createAtoServer(config: AtoConfig): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0]

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    if (req.method === 'GET' && (url === '/health' || url === '/ready')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', upstream: config.upstreamUrl }))
      return
    }

    if (req.method === 'POST' && url === '/v1/messages/count_tokens') {
      await handleCountTokens(req, res)
      return
    }

    if (req.method === 'POST' && url === '/v1/messages') {
      try {
        await handleMessages(req, res, config)
      } catch (err: any) {
        console.error('[ATO] Error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { type: 'internal_error', message: err.message } }))
      }
      return
    }

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
  const body = await readBody(req)
  let anthropicReq: any
  try {
    anthropicReq = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { type: 'invalid_request', message: 'Invalid JSON' } }))
    return
  }

  const openaiReq = anthropicToOpenAIResponses(anthropicReq)
  const isStream = openaiReq.stream === true

  console.log(`[ATO] ${anthropicReq.model} -> ${openaiReq.model}, stream=${isStream}`)

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
      error: { type: 'upstream_error', message: errorText, status: upstreamResp.status },
    }))
    return
  }

  if (isStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    await handleStreamResponse(upstreamResp, res)
    return
  }

  const openaiResp = await upstreamResp.json()
  const anthropicResp = openAIToAnthropic(openaiResp)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(anthropicResp))
}

async function handleCountTokens(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const body = await readBody(req)
    const anthropicReq = JSON.parse(body || '{}')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ input_tokens: estimateInputTokens(anthropicReq) }))
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ input_tokens: 0 }))
  }
}

// ---------------------- 流式转换：OpenAI Responses → Anthropic SSE ----------------------
// 与 entry.mjs 保持同构：延迟发 tool_use 块
async function* openAIResponsesStreamToAnthropic(upstreamBody: ReadableStream<Uint8Array>) {
  const reader = upstreamBody.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const toolCalls: any[] = []
  let lastText = ''
  let textStarted = false
  let blockIndex = 0

  const sse = (eventType: string, data: object) =>
    `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`

  yield sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_stream', type: 'message', role: 'assistant',
      content: [], model: 'unknown', stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
  yield sse('ping', { type: 'ping' })

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const dataStr = line.slice(6).trim()
      if (dataStr === '[DONE]') continue

      let event: any
      try { event = JSON.parse(dataStr) } catch { continue }
      const type = event.type ?? ''

      if (type === 'response.output_text.delta') {
        const delta = event.delta ?? ''
        if (!textStarted) {
          textStarted = true
          yield sse('content_block_start', {
            type: 'content_block_start', index: blockIndex,
            content_block: { type: 'text', text: '' },
          })
        }
        yield sse('content_block_delta', {
          type: 'content_block_delta', index: blockIndex,
          delta: { type: 'text_delta', text: delta },
        })
        lastText += delta

      } else if (type === 'response.output_item.done') {
        const item = event.item ?? {}
        if (item.type === 'function_call') toolCalls.push(item)

      } else if (type === 'response.completed') {
        const output = event.response?.output ?? []
        if (!lastText) {
          for (const item of output) {
            if (item.type === 'message') {
              lastText += (item.content ?? [])
                .filter((p: any) => p.type === 'output_text' || p.type === 'text')
                .map((p: any) => p.text || '')
                .join('')
            }
          }
        }
        if (!toolCalls.length) {
          for (const item of output) {
            if (item.type === 'function_call') toolCalls.push(item)
          }
        }
      }
    }
  }

  if (textStarted) {
    yield sse('content_block_stop', { type: 'content_block_stop', index: blockIndex })
    blockIndex++
  }

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]
    const idx = blockIndex + i
    const argsStr = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {})
    yield sse('content_block_start', {
      type: 'content_block_start', index: idx,
      content_block: { type: 'tool_use', id: tc.call_id || tc.id || `tool_${idx}`, name: tc.name || '', input: {} },
    })
    yield sse('content_block_delta', {
      type: 'content_block_delta', index: idx,
      delta: { type: 'input_json_delta', partial_json: argsStr },
    })
    yield sse('content_block_stop', { type: 'content_block_stop', index: idx })
  }

  const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn'
  yield sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 0 },
  })
  yield sse('message_stop', { type: 'message_stop' })
}

// ---------------------- 流式处理 ----------------------
async function handleStreamResponse(
  upstreamResp: Response,
  res: http.ServerResponse
): Promise<void> {
  if (!upstreamResp.body) {
    res.end()
    return
  }

  try {
    for await (const chunk of openAIResponsesStreamToAnthropic(upstreamResp.body)) {
      res.write(chunk)
    }
  } catch (err: any) {
    console.error('[ATO] Stream error:', err.message)
  }
  res.end()
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

function estimateInputTokens(payload: any): number {
  let totalChars = flattenTokenText(payload?.system).length

  for (const msg of payload?.messages ?? []) {
    totalChars += flattenTokenText(msg?.content).length
  }

  return Math.max(1, Math.floor(totalChars / 4))
}

function flattenTokenText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block: any) => block?.type === 'text')
    .map((block: any) => block?.text || '')
    .join('')
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