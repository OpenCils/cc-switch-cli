/**
 * [INPUT]: Anthropic/OpenAI 协议数据、HTTP 请求与 ATO 配置
 * [OUTPUT]: 对外提供 ATO 运行时核心：协议转换、流式桥接、HTTP 服务与进程启动
 * [POS]: ato/ 的单一真相源，被 entry.mjs、server.ts、convert.ts、response.ts 共同复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import http from 'http'

// ---------------------- SSE 辅助 ----------------------
export function emitEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// ---------------------- 请求转换：Anthropic -> OpenAI ----------------------
function resolveModel(model) {
  const mapping = {
    'sonnet-gpt-5-codex-high': 'gpt-5.3-codex-xhigh',
    'sonnet-gpt-5-codex-medium': 'gpt-5.3-codex-xhigh',
    'sonnet-gpt-5-codex-low': 'gpt-5.3-codex-xhigh',
    'gpt-5-codex-high': 'gpt-5.3-codex-xhigh',
    'gpt-5-codex-medium': 'gpt-5.3-codex-xhigh',
    'gpt-5-codex-low': 'gpt-5.3-codex-xhigh',
  }
  return mapping[model] || model
}

function isSchemaObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function flattenTextBlocks(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text')
    .map(block => block?.text || '')
    .join('')
}

function normalizeSchemaNode(schema, forceObject = false) {
  if (!isSchemaObject(schema)) {
    return forceObject ? { type: 'object', properties: {} } : {}
  }

  const normalized = { ...schema }

  if (forceObject || normalized.type === 'object' || normalized.properties !== undefined) {
    const rawProperties = isSchemaObject(normalized.properties) ? normalized.properties : {}
    normalized.type = 'object'
    normalized.properties = Object.fromEntries(
      Object.entries(rawProperties).map(([key, value]) => [key, normalizeSchemaNode(value)]),
    )
  }

  if (normalized.type === 'array' && normalized.items !== undefined) {
    normalized.items = normalizeSchemaNode(normalized.items)
  }

  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(normalized[key])) {
      normalized[key] = normalized[key].map(item => normalizeSchemaNode(item))
    }
  }

  if (isSchemaObject(normalized.additionalProperties)) {
    normalized.additionalProperties = normalizeSchemaNode(normalized.additionalProperties)
  }

  if (isSchemaObject(normalized.not)) {
    normalized.not = normalizeSchemaNode(normalized.not)
  }

  return normalized
}

function normalizeToolSchema(schema) {
  return normalizeSchemaNode(schema, true)
}

function imageBlockToDataUrl(block) {
  if (block?.type !== 'image' || !block.source) return null
  const { media_type, data } = block.source
  if (!media_type || !data) return null
  return `data:${media_type};base64,${data}`
}

export function anthropicToOpenAIResponses(req) {
  const input = []
  const instructions = flattenTextBlocks(req?.system) || undefined

  for (const msg of req?.messages || []) {
    const role = msg?.role || 'user'
    const content = msg?.content

    if (typeof content === 'string') {
      input.push({
        type: 'message',
        role,
        content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: content || ' ' }],
      })
      continue
    }

    if (!Array.isArray(content)) {
      input.push({
        type: 'message',
        role,
        content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: String(content ?? '') || ' ' }],
      })
      continue
    }

    if (role === 'assistant') {
      const textBlocks = content.filter(block => block?.type === 'text')
      const toolUses = content.filter(block => block?.type === 'tool_use')

      if (textBlocks.length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: textBlocks.map(block => ({ type: 'output_text', text: block?.text || ' ' })),
        })
      }

      for (let i = 0; i < toolUses.length; i++) {
        const toolUse = toolUses[i]
        input.push({
          type: 'function_call',
          call_id: toolUse?.id || `tool_${i}`,
          name: toolUse?.name || '',
          arguments: JSON.stringify(toolUse?.input || {}),
        })
      }
      continue
    }

    if (role === 'user') {
      const parts = []
      const toolResults = content.filter(block => block?.type === 'tool_result')

      for (const block of content) {
        if (block?.type === 'text') {
          parts.push({ type: 'input_text', text: block?.text || ' ' })
        } else if (block?.type === 'image') {
          const dataUrl = imageBlockToDataUrl(block)
          if (dataUrl) {
            parts.push({ type: 'input_image', image_url: dataUrl })
          }
        }
      }

      if (parts.length > 0) {
        input.push({ type: 'message', role: 'user', content: parts })
      }

      for (const toolResult of toolResults) {
        const output = typeof toolResult?.content === 'string'
          ? toolResult.content
          : flattenTextBlocks(toolResult?.content)
        input.push({
          type: 'function_call_output',
          call_id: toolResult?.tool_use_id || '',
          output: output || ' ',
        })
      }
    }
  }

  const result = {
    model: resolveModel(req?.model),
    input,
    stream: req?.stream ?? false,
  }

  if (instructions) result.instructions = instructions
  if (req?.max_tokens) result.max_output_tokens = req.max_tokens
  if (req?.temperature !== undefined) result.temperature = req.temperature
  if (req?.top_p !== undefined) result.top_p = req.top_p

  if (req?.tools) {
    result.tools = req.tools.map(tool => ({
      type: 'function',
      name: tool?.name,
      description: tool?.description || '',
      parameters: normalizeToolSchema(tool?.input_schema),
    }))
  }

  if (req?.tool_choice) {
    const toolChoice = req.tool_choice
    if (toolChoice === 'auto') {
      result.tool_choice = 'auto'
    } else if (toolChoice === 'any') {
      result.tool_choice = 'required'
    } else if (typeof toolChoice === 'object' && toolChoice?.type === 'tool' && toolChoice?.name) {
      result.tool_choice = { type: 'function', name: toolChoice.name }
    }
  }

  return result
}

// ---------------------- 响应转换：OpenAI -> Anthropic ----------------------
function extractOutput(res) {
  return res?.output || res?.response?.output || []
}

function extractUsage(res) {
  return res?.usage || res?.response?.usage || {}
}

function extractModel(res) {
  return res?.model || res?.response?.model || 'unknown'
}

function extractMessageId(res) {
  return res?.id || res?.response?.id || 'msg_unknown'
}

function extractTextFromOutput(items) {
  const parts = []
  for (const item of items || []) {
    if (item?.type !== 'message') continue
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' || part?.type === 'text') {
        parts.push(part?.text || '')
      }
    }
  }
  return parts.join('')
}

function extractToolCalls(items) {
  const calls = []
  for (const item of items || []) {
    if (item?.type === 'function_call' || item?.type === 'tool_call') {
      calls.push({
        id: item?.call_id || item?.id || 'tool_unknown',
        name: item?.name || '',
        arguments: typeof item?.arguments === 'string' ? item.arguments : JSON.stringify(item?.input || {}),
      })
    }
  }
  return calls
}

export function openAIToAnthropic(res) {
  const output = extractOutput(res)
  const text = extractTextFromOutput(output)
  const toolCalls = extractToolCalls(output)
  const usage = extractUsage(res)

  const content = []
  if (text) {
    content.push({ type: 'text', text })
  }

  for (const toolCall of toolCalls) {
    let input = {}
    try {
      input = JSON.parse(toolCall.arguments)
    } catch {
      input = {}
    }
    content.push({ type: 'tool_use', id: toolCall.id, name: toolCall.name, input })
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  return {
    id: extractMessageId(res),
    type: 'message',
    role: 'assistant',
    content,
    model: extractModel(res),
    stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: usage?.input_tokens || 0,
      output_tokens: usage?.output_tokens || 0,
    },
  }
}

// ---------------------- 流式桥接：OpenAI Responses -> Anthropic SSE ----------------------
export async function* openAIResponsesStreamToAnthropic(upstreamBody) {
  const reader = upstreamBody.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const toolCalls = []
  let textStarted = false
  let blockIndex = 0

  yield emitEvent('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_stream',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'unknown',
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
  yield emitEvent('ping', { type: 'ping' })

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

      let event
      try {
        event = JSON.parse(dataStr)
      } catch {
        continue
      }

      const type = event?.type ?? ''

      if (type === 'response.output_text.delta') {
        const delta = event?.delta ?? ''
        if (!textStarted) {
          textStarted = true
          yield emitEvent('content_block_start', {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'text', text: '' },
          })
        }
        yield emitEvent('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text: delta },
        })
      } else if (type === 'response.output_item.done') {
        const item = event?.item ?? {}
        if (item?.type === 'function_call') {
          toolCalls.push(item)
        }
      } else if (type === 'response.completed') {
        const output = event?.response?.output ?? []
        if (toolCalls.length === 0) {
          for (const item of output) {
            if (item?.type === 'function_call') {
              toolCalls.push(item)
            }
          }
        }
      }
    }
  }

  if (textStarted) {
    yield emitEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex })
    blockIndex++
  }

  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i]
    const argsStr = typeof toolCall?.arguments === 'string'
      ? toolCall.arguments
      : JSON.stringify(toolCall?.arguments ?? {})
    const index = blockIndex + i

    yield emitEvent('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: toolCall?.call_id || toolCall?.id || `tool_${index}`,
        name: toolCall?.name || '',
        input: {},
      },
    })
    yield emitEvent('content_block_delta', {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: argsStr },
    })
    yield emitEvent('content_block_stop', { type: 'content_block_stop', index })
  }

  const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn'
  yield emitEvent('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 0 },
  })
  yield emitEvent('message_stop', { type: 'message_stop' })
}

// ---------------------- HTTP 服务 ----------------------
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

function estimateInputTokens(payload) {
  let totalChars = flattenTextBlocks(payload?.system).length
  for (const msg of payload?.messages || []) {
    totalChars += flattenTextBlocks(msg?.content).length
  }
  return Math.max(1, Math.floor(totalChars / 4))
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function attachCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version')
}

async function handleCountTokens(req, res) {
  try {
    const body = await readBody(req)
    const anthropicReq = JSON.parse(body || '{}')
    writeJson(res, 200, { input_tokens: estimateInputTokens(anthropicReq) })
  } catch {
    writeJson(res, 200, { input_tokens: 0 })
  }
}

async function handleMessages(req, res, config) {
  const body = await readBody(req)
  let anthropicReq
  try {
    anthropicReq = JSON.parse(body)
  } catch {
    writeJson(res, 400, { error: { type: 'invalid_request', message: 'Invalid JSON' } })
    return
  }

  const openaiReq = anthropicToOpenAIResponses(anthropicReq)
  const isStream = openaiReq.stream === true

  console.log(`[ATO] ${anthropicReq?.model} -> ${openaiReq?.model}, stream=${isStream}`)

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
    console.error(`[ATO] Upstream error: ${upstreamResp.status}`, errorText.slice(0, 200))
    writeJson(res, upstreamResp.status, {
      error: { type: 'upstream_error', message: errorText, status: upstreamResp.status },
    })
    return
  }

  if (isStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    if (!upstreamResp.body) {
      res.end()
      return
    }

    try {
      for await (const chunk of openAIResponsesStreamToAnthropic(upstreamResp.body)) {
        res.write(chunk)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[ATO] Stream error:', message)
    }
    res.end()
    return
  }

  const openaiResp = await upstreamResp.json()
  writeJson(res, 200, openAIToAnthropic(openaiResp))
}

export function createAtoServer(config) {
  return http.createServer(async (req, res) => {
    const url = (req?.url || '').split('?')[0]

    attachCorsHeaders(res)

    if (req?.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    if (req?.method === 'GET' && (url === '/health' || url === '/ready')) {
      writeJson(res, 200, { status: 'ok', upstream: config.upstreamUrl })
      return
    }

    if (req?.method === 'POST' && url === '/v1/messages/count_tokens') {
      await handleCountTokens(req, res)
      return
    }

    if (req?.method === 'POST' && url === '/v1/messages') {
      try {
        await handleMessages(req, res, config)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[ATO] Error:', message)
        writeJson(res, 500, { error: { type: 'internal_error', message } })
      }
      return
    }

    writeJson(res, 404, { error: { type: 'not_found', message: 'Not found' } })
  })
}

export function startAtoProcess(config) {
  return new Promise((resolve, reject) => {
    const server = createAtoServer(config)

    server.listen(config.port, () => {
      console.log(`[ATO] Proxy started on port ${config.port}`)
      console.log(`[ATO] Upstream: ${config.upstreamUrl}`)
      resolve(config.port)
    })

    server.on('error', error => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${config.port} is already in use`))
        return
      }
      reject(error)
    })
  })
}

// ---------------------- 健康与端口探测 ----------------------
export async function isPortInUse(port) {
  return new Promise(resolve => {
    const server = http.createServer()
    server.once('error', error => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        resolve(false)
      }
    })
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port)
  })
}

export async function checkAtoRunning(port) {
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
