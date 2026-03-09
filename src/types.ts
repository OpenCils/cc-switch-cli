/**
 * [INPUT]: 无外部依赖，纯类型定义
 * [OUTPUT]: 对外提供 Tool、EnvType、Installation、ToolMeta 等核心类型
 * [POS]: src/ 的类型系统基石，被所有模块消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ---------------------- 工具枚举 ----------------------
export type Tool = 'claude' | 'codex' | 'gemini' | 'openclaw'

// ---------------------- 环境类型 ----------------------
export type EnvType = 'windows' | 'wsl' | 'linux' | 'mac'

// ---------------------- 环境描述 ----------------------
export interface Environment {
  type: EnvType
  label: string       // 如 "Windows", "WSL: Ubuntu-24.04"
  distro?: string     // WSL 发行版名，如 "Ubuntu-24.04"
  homePath: string    // 该环境的 home 目录
}

// ---------------------- 安装实例的当前配置 ----------------------
export interface ToolConfig {
  model: string       // 当前模型 ID
  baseUrl: string     // API 请求地址
  apiKey: string      // 密钥（可能为空，如 OAuth 模式）
}

// ---------------------- 用户保存的供应商配置 ----------------------
export interface ProviderConfig {
  id: string          // UUID
  name: string        // 显示名称，如 "官方 Anthropic" 或 "NewCLI 代理"
  model: string       // 模型 ID
  // 直接模式：
  baseUrl: string     // API 请求地址
  apiKey: string      // 密钥
  // ATO 代理模式：
  useAto: boolean     // 是否通过 ATO 代理
  atoUpstreamUrl?: string  // ATO 代理的上游地址
  atoApiKey?: string       // ATO 代理的上游密钥
  atoPort?: number         // ATO 监听端口，默认 18653
}

// ---------------------- 检测到的安装实例 ----------------------
export interface Installation {
  tool: Tool
  env: Environment
  configPath: string  // 配置文件绝对路径
  current: ToolConfig // 当前生效的配置
}

// ---------------------- 安装实例的唯一键 ----------------------
export function instKey(inst: Installation): string {
  return `${inst.tool}:${inst.env.label}`
}

// ---------------------- 本地持久化存储 ----------------------
export interface AppStore {
  // 键: instKey，值: 该安装实例下保存的供应商列表
  providers: Record<string, ProviderConfig[]>
  // 键: instKey，值: 当前激活的供应商 ID
  active: Record<string, string | null>
  // 用户选择的界面语言，undefined 表示首次启动未选择
  language?: string
}

// ---------------------- 工具元数据 ----------------------
export interface ToolMeta {
  id: Tool
  label: string
  configDir: string   // 配置目录名，如 ".claude"
  color: string
}

export const TOOLS: ToolMeta[] = [
  { id: 'claude',   label: 'Claude Code', configDir: '.claude',   color: '#D97706' },  // 橙棕色
  { id: 'codex',    label: 'Codex',       configDir: '.codex',    color: '#10B981' },  // 翠绿
  { id: 'gemini',   label: 'Gemini',      configDir: '.gemini',   color: '#3B82F6' },  // 蓝色
  { id: 'openclaw', label: 'OpenClaw',    configDir: '.openclaw', color: '#A855F7' },  // 紫色
]
