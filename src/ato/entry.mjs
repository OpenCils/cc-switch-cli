#!/usr/bin/env node
/**
 * ATO 代理进程入口
 * 通过 detached spawn 启动，独立于父进程运行
 */

import http from 'http'
import { parseArgs } from 'util'

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '5000' },
    upstream: { type: 'string', short: 'u', default: '' },
    key: { type: 'string', short: 'k', default: '' },
  },
})

const PORT = parseInt(values.port || '5000', 10)
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

function anthropicToOpenAI(req) {
  const input = []

  // System
  let instructions = ''
  if (typeof req.system === 'string') instructions = req.system
  else if (Array.isArray(req.system)) {
    instructions = req.system.filter(b => b?.type === 'text').map(b => b.text || '').join('')
  }

  // Messages
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

    // Assistant
    if (role === 'assistant') {
      const textBlocks = content.filter(b => b.type === 'text')
      const toolUses = content.filter(b => b.type === 'tool_use')

      if (textBlocks.length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          content: textBlocks.map(b => ({ type: 'output_text', text: b.text || ' ' })),
        })
      }

      for (let i = 0; i < toolUses.length; i++) {
        const tu = toolUses[i]
        input.push({
          type: 'function_call',
          call_id: tu.id || `tool_${i}`,
          name: tu.name || '',
          arguments: JSON.stringify(tu.input || {}),
        })
      }
      continue
    }

    // User
    if (role === 'user') {
      const parts = []
      const toolResults = content.filter(b => b.type === 'tool_result')

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

      for (const tr of toolResults) {
        const outputText = typeof tr.content === 'string' ? tr.content : ''
        input.push({
          type: 'function_call_output',
          call_id: tr.tool_use_id || '',
          output: outputText || ' ',
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
    result.tools = req.tools.map(t => ({
      type: 'function',
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} },
    }))
  }

  return result
}

function openAIToAnthropic(res) {
  const output = res.output || res.response?.output || []
  const text = output
    .filter(i => i.type === 'message')
    .flatMap(i => i.content || [])
    .filter(p => p.type === 'output_text' || p.type === 'text')
    .map(p => p.text || '')
    .join('')

  const toolCalls = output
    .filter(i => i.type === 'function_call' || i.type === 'tool_call')
    .map(i => ({
      id: i.call_id || i.id || 'tool_unknown',
      name: i.name || '',
      arguments: typeof i.arguments === 'string' ? i.arguments : JSON.stringify(i.input || {}),
    }))

  const content = []
  if (text) content.push({ type: 'text', text })
  for (const tc of toolCalls) {
    let input = {}
    try { input = JSON.parse(tc.arguments) } catch {}
    content.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
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

// ---------------------- HTTP 处理 ----------------------
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf-8')
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
    // 简化：直接透传上游流
    const reader = upstreamResp.body.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(decoder.decode(value, { stream: true }))
      }
      res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
      res.end()
    } catch (err) {
      console.error('[ATO] Stream error:', err.message)
      res.end()
    }
  } else {
    const openaiResp = await upstreamResp.json()
    const anthropicResp = openAIToAnthropic(openaiResp)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(anthropicResp))
  }
}

// ---------------------- 服务器 ----------------------
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', upstream: UPSTREAM_URL }))
    return
  }

  if (req.method === 'POST' && req.url === '/v1/messages') {
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
