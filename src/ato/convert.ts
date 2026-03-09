/**
 * [INPUT]: Anthropic API 请求格式
 * [OUTPUT]: OpenAI Responses API 请求格式
 * [POS]: ATO 核心转换器，处理上行请求转换
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ---------------------- 类型定义 ----------------------
interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result'
  text?: string
  source?: { type: string; media_type: string; data: string }
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
}

interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

interface AnthropicRequest {
  model: string
  messages: AnthropicMessage[]
  system?: string | AnthropicContentBlock[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: AnthropicTool[]
  tool_choice?: { type: string } | { type: 'tool'; name: string } | 'auto' | 'any'
}

interface OpenAIResponsesRequest {
  model: string
  input: OpenAIInputItem[]
  instructions?: string
  stream?: boolean
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  tools?: { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }[]
  tool_choice?: 'auto' | 'required' | { type: 'function'; name: string }
}

type OpenAIInputItem =
  | { type: 'message'; role: 'user' | 'assistant'; content: OpenAIPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }

type OpenAIPart =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string }
  | { type: 'input_image'; image_url: string }

// ---------------------- 辅助函数 ----------------------
function resolveModel(model: string): string {
  const mapping: Record<string, string> = {
    'sonnet-gpt-5-codex-high': 'gpt-5.3-codex-xhigh',
    'sonnet-gpt-5-codex-medium': 'gpt-5.3-codex-xhigh',
    'sonnet-gpt-5-codex-low': 'gpt-5.3-codex-xhigh',
    'gpt-5-codex-high': 'gpt-5.3-codex-xhigh',
    'gpt-5-codex-medium': 'gpt-5.3-codex-xhigh',
    'gpt-5-codex-low': 'gpt-5.3-codex-xhigh',
  }
  return mapping[model] || model
}

function flattenTextBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(b => b?.type === 'text')
    .map(b => b.text || '')
    .join('')
}

function normalizeToolSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  return schema as Record<string, unknown>
}

function imageBlockToDataUrl(block: AnthropicContentBlock): string | null {
  if (block.type !== 'image' || !block.source) return null
  const { media_type, data } = block.source
  if (!media_type || !data) return null
  return `data:${media_type};base64,${data}`
}

// ---------------------- 核心转换 ----------------------
export function anthropicToOpenAIResponses(req: AnthropicRequest): OpenAIResponsesRequest {
  const input: OpenAIInputItem[] = []

  // System prompt
  const systemText = flattenTextBlocks(req.system)
  const instructions = systemText || undefined

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

    if (!Array.isArray(content)) {
      input.push({
        type: 'message',
        role,
        content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: String(content) }],
      })
      continue
    }

    // Assistant with tool_use
    if (role === 'assistant') {
      const textBlocks = content.filter(b => b.type === 'text')
      const toolUses = content.filter(b => b.type === 'tool_use')

      if (textBlocks.length > 0) {
        const parts: OpenAIPart[] = textBlocks.map(b => ({
          type: 'output_text' as const,
          text: b.text || ' ',
        }))
        input.push({ type: 'message', role: 'assistant', content: parts })
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

    // User with text/image/tool_result
    if (role === 'user') {
      const parts: OpenAIPart[] = []
      const toolResults = content.filter(b => b.type === 'tool_result')

      for (const block of content) {
        if (block.type === 'text') {
          parts.push({ type: 'input_text', text: block.text || ' ' })
        } else if (block.type === 'image') {
          const dataUrl = imageBlockToDataUrl(block)
          if (dataUrl) parts.push({ type: 'input_image', image_url: dataUrl })
        }
      }

      if (parts.length > 0) {
        input.push({ type: 'message', role: 'user', content: parts })
      }

      for (const tr of toolResults) {
        const outputText = typeof tr.content === 'string'
          ? tr.content
          : flattenTextBlocks(tr.content)
        input.push({
          type: 'function_call_output',
          call_id: tr.tool_use_id || '',
          output: outputText || ' ',
        })
      }
    }
  }

  const result: OpenAIResponsesRequest = {
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
      type: 'function' as const,
      name: t.name,
      description: t.description || '',
      parameters: normalizeToolSchema(t.input_schema),
    }))
  }

  if (req.tool_choice) {
    const tc = req.tool_choice
    if (tc === 'auto') {
      result.tool_choice = 'auto'
    } else if (tc === 'any') {
      result.tool_choice = 'required'
    } else if (typeof tc === 'object' && 'type' in tc) {
      if (tc.type === 'tool' && 'name' in tc) {
        result.tool_choice = { type: 'function', name: tc.name as string }
      }
    }
  }

  return result
}
