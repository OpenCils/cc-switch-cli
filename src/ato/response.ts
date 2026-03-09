/**
 * [INPUT]: OpenAI Responses API 响应格式（流式/非流式）
 * [OUTPUT]: 对外提供带类型的响应转换结果与 SSE 事件辅助函数
 * [POS]: ato/ 的 TypeScript 类型壳；非流式转换与 SSE 事件委托 runtime.mjs，chunk 流工具保持独立导出
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// @ts-ignore runtime.mjs 是给 entry.mjs 和 Bun 单文件编译共用的原生 ESM 运行时
import { emitEvent as emitEventImpl, openAIToAnthropic as openAIToAnthropicImpl } from './runtime.mjs'

// ---------------------- SSE 辅助 ----------------------
export function emitEvent(event: string, data: unknown): string {
  return emitEventImpl(event, data) as string
}

function parseSSEEvents(chunks: string[]): [string, unknown][] {
  const results: [string, unknown][] = []
  let buffer = ''

  for (const chunk of chunks) {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    let currentEvent = ''
    let currentData = ''

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        currentData = line.slice(5).trim()
      } else if (line === '' && currentEvent && currentData) {
        try {
          results.push([currentEvent, JSON.parse(currentData)])
        } catch {
          // ignore parse error
        }
        currentEvent = ''
        currentData = ''
      }
    }
  }

  return results
}

// ---------------------- 非流式响应转换 ----------------------
interface OpenAIResponse {
  id?: string
  model?: string
  output?: OpenAIOutputItem[]
  response?: {
    id?: string
    model?: string
    output?: OpenAIOutputItem[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface OpenAIOutputItem {
  type: string
  content?: OpenAIPart[]
  id?: string
  name?: string
  arguments?: string
  input?: unknown
  call_id?: string
}

interface OpenAIPart {
  type: string
  text?: string
}

interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: AnthropicContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'tool_use'
  usage: { input_tokens: number; output_tokens: number }
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

function extractTextFromOutput(items: OpenAIOutputItem[]): string {
  const parts: string[] = []
  for (const item of items || []) {
    if (item.type !== 'message') continue
    for (const part of item.content || []) {
      if (part.type === 'output_text' || part.type === 'text') {
        parts.push(part.text || '')
      }
    }
  }
  return parts.join('')
}

function extractToolCalls(items: OpenAIOutputItem[]): { id: string; name: string; arguments: string }[] {
  const calls: { id: string; name: string; arguments: string }[] = []
  for (const item of items || []) {
    if (item.type === 'function_call' || item.type === 'tool_call') {
      calls.push({
        id: item.call_id || item.id || 'tool_unknown',
        name: item.name || '',
        arguments: typeof item.arguments === 'string'
          ? item.arguments
          : JSON.stringify(item.input || {}),
      })
    }
  }
  return calls
}

export function openAIToAnthropic(res: OpenAIResponse): AnthropicResponse {
  return openAIToAnthropicImpl(res) as AnthropicResponse
}

// ---------------------- 流式响应转换 ----------------------
export function* openAIStreamToAnthropic(chunks: string[]): Generator<string> {
  const events = parseSSEEvents(chunks)

  let messageStarted = false
  let textBlockStarted = false
  let textBlockIndex = 0
  const toolCalls: { id: string; name: string; arguments: string }[] = []
  let messageId = 'msg_unknown'
  let model = 'unknown'

  function* emitMessageStart(): Generator<string> {
    if (messageStarted) return
    messageStarted = true
    yield emitEvent('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })
  }

  for (const [eventName, payload] of events) {
    if (eventName === '[DONE]') break
    if (!payload || typeof payload !== 'object') continue

    if (eventName === 'response.created') {
      const resp = (payload as any).response || {}
      messageId = resp.id || messageId
      model = resp.model || model
      yield* emitMessageStart()
    } else if (eventName === 'response.output_text.delta') {
      const delta = (payload as any).delta || ''
      if (delta) {
        if (!messageStarted) yield* emitMessageStart()
        if (!textBlockStarted) {
          textBlockStarted = true
          yield emitEvent('content_block_start', {
            type: 'content_block_start',
            index: textBlockIndex,
            content_block: { type: 'text', text: '' },
          })
        }
        yield emitEvent('content_block_delta', {
          type: 'content_block_delta',
          index: textBlockIndex,
          delta: { type: 'text_delta', text: delta },
        })
      }
    } else if (eventName === 'response.output_item.done') {
      const item = (payload as any).item || {}
      if (item.type === 'function_call' || item.type === 'tool_call') {
        toolCalls.push({
          id: item.call_id || item.id || 'tool_unknown',
          name: item.name || '',
          arguments: typeof item.arguments === 'string'
            ? item.arguments
            : JSON.stringify(item.input || {}),
        })
      }
    } else if (eventName === 'response.completed') {
      const resp = (payload as any).response || {}
      messageId = resp.id || messageId
      model = resp.model || model
      const output = resp.output || []

      const extractedText = extractTextFromOutput(output)
      const extractedTools = extractToolCalls(output)

      if (!textBlockStarted && extractedText) {
        if (!messageStarted) yield* emitMessageStart()
        textBlockStarted = true
        yield emitEvent('content_block_start', {
          type: 'content_block_start',
          index: textBlockIndex,
          content_block: { type: 'text', text: '' },
        })
        yield emitEvent('content_block_delta', {
          type: 'content_block_delta',
          index: textBlockIndex,
          delta: { type: 'text_delta', text: extractedText },
        })
      }

      if (toolCalls.length === 0 && extractedTools.length > 0) {
        toolCalls.push(...extractedTools)
      }
    }
  }

  if (textBlockStarted) {
    yield emitEvent('content_block_stop', {
      type: 'content_block_stop',
      index: textBlockIndex,
    })
  }

  let nextIndex = textBlockStarted ? textBlockIndex + 1 : 0
  if (toolCalls.length > 0 && !messageStarted) {
    yield* emitMessageStart()
  }

  for (const tc of toolCalls) {
    yield emitEvent('content_block_start', {
      type: 'content_block_start',
      index: nextIndex,
      content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} },
    })
    yield emitEvent('content_block_delta', {
      type: 'content_block_delta',
      index: nextIndex,
      delta: { type: 'input_json_delta', partial_json: tc.arguments },
    })
    yield emitEvent('content_block_stop', {
      type: 'content_block_stop',
      index: nextIndex,
    })
    nextIndex++
  }

  const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn'
  if (messageStarted) {
    yield emitEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 0 },
    })
    yield emitEvent('message_stop', { type: 'message_stop' })
  }
}
