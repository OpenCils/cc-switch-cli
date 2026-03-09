/**
 * [INPUT]: Anthropic API 请求格式
 * [OUTPUT]: 对外提供带类型的请求转换结果
 * [POS]: ato/ 的 TypeScript 类型壳，向上游暴露请求转换签名，向下游委托 runtime.mjs 单一真相源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const runtime = await import(new URL('./runtime.mjs', import.meta.url).href)

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

// ---------------------- 核心转换 ----------------------
export function anthropicToOpenAIResponses(req: AnthropicRequest): OpenAIResponsesRequest {
  return runtime.anthropicToOpenAIResponses(req) as OpenAIResponsesRequest
}
