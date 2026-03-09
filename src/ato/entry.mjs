#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Claude Code 的 Anthropic 请求、上游 OpenAI 兼容接口配置
 * [OUTPUT]: 对外提供独立 ATO 代理进程，兼容 /health /ready /v1/messages /v1/messages/count_tokens
 * [POS]: ATO 模块的独立入口，供 manager.ts 在 Windows / WSL 启动，需与 server.ts 保持协议同构
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import http from 'http'
import { parseArgs } from 'util'

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '18653' },
    upstream: { type: 'string', short: 'u', default: '' },
    key: { type: 'string', short: 'k', default: '' },
  },
})

const PORT = parseInt(values.port || '18653', 10)
const UPSTREAM_URL = values.upstream || process.env.ATO_UPSTREAM_URL || ''
const UPSTREAM_KEY = values.key || process.env.ATO_UPSTREAM_KEY || ''

if (!UPSTREAM_URL) {
  console.error('[ATO] Error: upstream URL is required')
  process.exit(1)
}

// ---------------------- 协议转换 ----------------------
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
    .map(block => block.text || '')
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

function anthropicToOpenAI(req) {
  const input = []
  const instructions = flattenTextBlocks(req.system)

  for (const msg of req.messages || []) {
    const role = msg.role || 'user'
    const content = msg.content

    if (typeof content === 'string') {
      input.push({
        type: 'message',
        role,
        content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: content || ' ' }],
      })
      continue
    }

    if (!Array.isArray(content)) continue

    if (role === 'assistant') {
      const textBlocks = content.filter(block => block.type === 'text')
      const toolUses = content.filter(block => block.type === 'tool_use')

      if (textBlocks.length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: textBlocks.map(block => ({ type: 'output_text', text: block.text || ' ' })),
        })
      }

      for (let i = 0; i < toolUses.length; i++) {
        const toolUse = toolUses[i]
        input.push({
          type: 'function_call',
          call_id: toolUse.id || `tool_${i}`,
          name: toolUse.name || '',
          arguments: JSON.stringify(toolUse.input || {}),
        })
      }
      continue
    }

    if (role === 'user') {
      const parts = []
      const toolResults = content.filter(block => block.type === 'tool_result')

      for (const block of content) {
        if (block.type === 'text') {
          parts.push({ type: 'input_text', text: block.text || ' ' })
        } else if (block.type === 'image' && block.source) {
          parts.push({
            type: 'input_image',
            image_url: `data:${block.source.media_type};base64,${block.source.data}`,
          })
        }
      }

      if (parts.length > 0) {
        input.push({ type: 'message', role: 'user', content: parts })
      }

      for (const toolResult of toolResults) {
        input.push({
          type: 'function_call_output',
          call_id: toolResult.tool_use_id || '',
          output: flattenTextBlocks(toolResult.content) || ' ',
        })
      }
    }
  }

  const result = {
    model: resolveModel(req.model),
    input,
    stream: req.stream ?? false,
  }

  if (instructions) result.instructions = instructions
  if (req.max_tokens) result.max_output_tokens = req.max_tokens
  if (req.temperature !== undefined) result.temperature = req.temperature
  if (req.top_p !== undefined) result.top_p = req.top_p

  if (req.tools) {
    result.tools = req.tools.map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description || '',
      parameters: normalizeToolSchema(tool.input_schema),
    }))
  }

  return result
}

function openAIToAnthropic(res) {
  const output = res.output || res.response?.output || []
  const text = output
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text' || part.type === 'text')
    .map(part => part.text || '')
    .join('')

  const toolCalls = output
    .filter(item => item.type === 'function_call' || item.type === 'tool_call')
    .map(item => ({
      id: item.call_id || item.id || 'tool_unknown',
      name: item.name || '',
      arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.input || {}),
    }))

  const content = []
  if (text) content.push({ type: 'text', text })
  for (const toolCall of toolCalls) {
    let input = {}
    try { input = JSON.parse(toolCall.arguments) } catch {}
    content.push({ type: 'tool_use', id: toolCall.id, name: toolCall.name, input })
  }
  if (content.length === 0) content.push({ type: 'text', text: '' })

  const usage = res.usage || res.response?.usage || {}

  return {
    id: res.id || res.response?.id || 'msg_unknown',
    type: 'message',
    role: 'assistant',
    content,
    model: res.model || res.response?.model || 'unknown',
    stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
    },
  }
}

// ---------------------- SSE 辅助 ----------------------
function sseEvent(eventType, data) {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
}

// ---------------------- 流式转换：OpenAI Responses → Anthropic SSE ----------------------
// 移植自 Python async_stream.py：延迟发 tool_use 块（等 arguments 完整拼接后统一发出）
async function* openAIResponsesStreamToAnthropic(upstreamBody) {
  const reader = upstreamBody.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const toolCalls = []
  let lastText = ''
  let textStarted = false
  let blockIndex = 0

  // --- 握手帧 ---
  yield sseEvent('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_stream', type: 'message', role: 'assistant',
      content: [], model: 'unknown', stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
  yield sseEvent('ping', { type: 'ping' })

  // --- 逐行解析上游 SSE ---
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
      try { event = JSON.parse(dataStr) } catch { continue }
      const type = event.type ?? ''

      if (type === 'response.output_text.delta') {
        const delta = event.delta ?? ''
        if (!textStarted) {
          textStarted = true
          yield sseEvent('content_block_start', {
            type: 'content_block_start', index: blockIndex,
            content_block: { type: 'text', text: '' },
          })
        }
        yield sseEvent('content_block_delta', {
          type: 'content_block_delta', index: blockIndex,
          delta: { type: 'text_delta', text: delta },
        })
        lastText += delta

      } else if (type === 'response.output_item.done') {
        const item = event.item ?? {}
        if (item.type === 'function_call') toolCalls.push(item)

      } else if (type === 'response.completed') {
        // fallback：从 completed response 提取（防止 delta 丢失）
        const output = event.response?.output ?? []
        if (!lastText) {
          for (const item of output) {
            if (item.type === 'message') {
              lastText += (item.content ?? [])
                .filter(p => p.type === 'output_text' || p.type === 'text')
                .map(p => p.text || '')
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

  // --- 关闭文本 block ---
  if (textStarted) {
    yield sseEvent('content_block_stop', { type: 'content_block_stop', index: blockIndex })
    blockIndex++
  }

  // --- 延迟发 tool_use blocks（arguments 此时已完整）---
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]
    const idx = blockIndex + i
    const argsStr = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {})
    yield sseEvent('content_block_start', {
      type: 'content_block_start', index: idx,
      content_block: { type: 'tool_use', id: tc.call_id || tc.id || `tool_${idx}`, name: tc.name || '', input: {} },
    })
    yield sseEvent('content_block_delta', {
      type: 'content_block_delta', index: idx,
      delta: { type: 'input_json_delta', partial_json: argsStr },
    })
    yield sseEvent('content_block_stop', { type: 'content_block_stop', index: idx })
  }

  const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn'
  yield sseEvent('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 0 },
  })
  yield sseEvent('message_stop', { type: 'message_stop' })
}

// ---------------------- HTTP 处理 ----------------------
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf-8')
}

function estimateInputTokens(req) {
  let totalChars = flattenTextBlocks(req?.system).length
  for (const msg of req?.messages || []) {
    totalChars += flattenTextBlocks(msg?.content).length
  }
  return Math.max(1, Math.floor(totalChars / 4))
}

async function handleMessages(req, res) {
  const body = await readBody(req)
  let anthropicReq
  try {
    anthropicReq = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { type: 'invalid_request', message: 'Invalid JSON' } }))
    return
  }

  const openaiReq = anthropicToOpenAI(anthropicReq)
  const isStream = openaiReq.stream

  console.log(`[ATO] ${anthropicReq.model} -> ${openaiReq.model}, stream=${isStream}`)

  const upstreamResp = await fetch(`${UPSTREAM_URL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${UPSTREAM_KEY}`,
    },
    body: JSON.stringify(openaiReq),
  })

  if (!upstreamResp.ok) {
    const errorText = await upstreamResp.text()
    console.error(`[ATO] Upstream error: ${upstreamResp.status}`, errorText.slice(0, 200))
    res.writeHead(upstreamResp.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { type: 'upstream_error', message: errorText, status: upstreamResp.status } }))
    return
  }

  if (isStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    try {
      for await (const chunk of openAIResponsesStreamToAnthropic(upstreamResp.body)) {
        res.write(chunk)
      }
    } catch (err) {
      console.error('[ATO] Stream error:', err.message)
    }
    res.end()
    return
  }

  const openaiResp = await upstreamResp.json()
  const anthropicResp = openAIToAnthropic(openaiResp)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(anthropicResp))
}

async function handleCountTokens(req, res) {
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

// ---------------------- 服务器 ----------------------
const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0]

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
    res.end(JSON.stringify({ status: 'ok', upstream: UPSTREAM_URL }))
    return
  }

  if (req.method === 'POST' && url === '/v1/messages/count_tokens') {
    await handleCountTokens(req, res)
    return
  }

  if (req.method === 'POST' && url === '/v1/messages') {
    try {
      await handleMessages(req, res)
    } catch (err) {
      console.error('[ATO] Error:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { type: 'internal_error', message: err.message } }))
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { type: 'not_found', message: 'Not found' } }))
})

server.listen(PORT, () => {
  console.log(`[ATO] Proxy started on port ${PORT}`)
  console.log(`[ATO] Upstream: ${UPSTREAM_URL}`)
})
