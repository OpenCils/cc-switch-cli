/**
 * [INPUT]: ATO 配置（端口、上游地址、密钥）+ 目标环境
 * [OUTPUT]: 启动/停止/检测 ATO 进程
 * [POS]: ATO 进程管理器，支持 Windows 和 WSL 独立运行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { spawn, spawnSync, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { checkAtoRunning, isPortInUse } from './server.js'

// ---------------------- ATO 进程记录 ----------------------
interface AtoProcessRecord {
  pid: number
  port: number
  upstreamUrl: string
  startedAt: string
  env: 'windows' | 'wsl'  // 运行环境
  distro?: string         // WSL 发行版名
}

const PID_DIR = path.join(os.homedir(), '.cc-switch-ato')
const PID_FILE = (port: number, env: string, distro?: string) =>
  path.join(PID_DIR, `ato-${env}${distro ? `-${distro}` : ''}-${port}.json`)

function ensurePidDir() {
  if (!fs.existsSync(PID_DIR)) fs.mkdirSync(PID_DIR, { recursive: true })
}

function savePidRecord(port: number, record: AtoProcessRecord) {
  ensurePidDir()
  const file = PID_FILE(port, record.env, record.distro)
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf-8')
}

function loadPidRecord(port: number, env: string, distro?: string): AtoProcessRecord | null {
  try {
    const file = PID_FILE(port, env, distro)
    const raw = fs.readFileSync(file, 'utf-8')
    return JSON.parse(raw) as AtoProcessRecord
  } catch {
    return null
  }
}

function removePidRecord(port: number, env: string, distro?: string) {
  try {
    fs.unlinkSync(PID_FILE(port, env, distro))
  } catch {
    // ignore
  }
}

// ---------------------- 检测进程是否存活 ----------------------
function isProcessAliveWindows(pid: number): boolean {
  try {
    const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
      encoding: 'utf-8',
      timeout: 3000,
    })
    return (result.stdout || '').includes(pid.toString())
  } catch {
    return false
  }
}

function isProcessAliveWsl(distro: string, pid: number): boolean {
  try {
    const result = spawnSync('wsl', ['-d', distro, '--', 'kill', '-0', String(pid)], {
      encoding: 'utf-8',
      timeout: 3000,
    })
    return result.status === 0
  } catch {
    return false
  }
}

// ---------------------- 杀死进程 ----------------------
function killProcessWindows(pid: number): boolean {
  try {
    spawnSync('taskkill', ['/F', '/PID', String(pid)], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function killProcessWsl(distro: string, pid: number): boolean {
  try {
    spawnSync('wsl', ['-d', distro, '--', 'kill', String(pid)], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

// ---------------------- 启动 ATO（Windows）----------------------
async function startAtoWindows(options: {
  port: number
  upstreamUrl: string
  upstreamKey: string
}): Promise<AtoStartResult> {
  const { port, upstreamUrl, upstreamKey } = options

  // 检测端口
  const running = await checkAtoRunning(port)
  if (running) {
    return { success: true, port, env: 'windows', error: 'ATO already running' }
  }

  const inUse = await isPortInUse(port)
  if (inUse) {
    return { success: false, port, env: 'windows', error: `Port ${port} is in use` }
  }

  // 启动独立进程
  const entryPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'entry.mjs')
  const args = ['--port', String(port), '--upstream', upstreamUrl, '--key', upstreamKey]

  const child = spawn(process.execPath, [entryPath, ...args], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ATO_PORT: String(port),
      ATO_UPSTREAM_URL: upstreamUrl,
      ATO_UPSTREAM_KEY: upstreamKey,
    },
  })

  child.unref()

  // 等待启动
  await new Promise(resolve => setTimeout(resolve, 500))

  const ok = await checkAtoRunning(port)
  if (!ok) {
    return { success: false, port, env: 'windows', error: 'Failed to start ATO process' }
  }

  if (child.pid) {
    savePidRecord(port, { pid: child.pid, port, upstreamUrl, startedAt: new Date().toISOString(), env: 'windows' })
  }

  return { success: true, port, env: 'windows', pid: child.pid }
}

// ---------------------- 启动 ATO（WSL）----------------------
async function startAtoWsl(options: {
  port: number
  upstreamUrl: string
  upstreamKey: string
  distro: string
}): Promise<AtoStartResult> {
  const { port, upstreamUrl, upstreamKey, distro } = options

  // 检测 WSL 内端口
  const running = await checkAtoRunningWsl(distro, port)
  if (running) {
    return { success: true, port, env: 'wsl', distro, error: 'ATO already running in WSL' }
  }

  // 确保 WSL 里有目录
  spawnSync('wsl', ['-d', distro, '--', 'bash', '-c', `mkdir -p ~/.cc-switch-ato`], {
    encoding: 'utf-8',
    timeout: 5000,
  })

  // 写入 entry 脚本（.cjs 使用 CommonJS）
  const entryContent = generateEntryScript()
  const entryBase64 = Buffer.from(entryContent).toString('base64')
  spawnSync('wsl', ['-d', distro, '--', 'bash', '-c',
    `echo "${entryBase64}" | base64 -d > ~/.cc-switch-ato/entry.cjs`], {
    encoding: 'utf-8',
    timeout: 10000,
  })

  // 写入启动脚本（使用 disown 让进程完全脱离）
  const startScript = `#!/bin/bash
set -e
source ~/.nvm/nvm.sh
cd ~/.cc-switch-ato

# 检查是否已运行
if curl -s --noproxy '*' http://127.0.0.1:$1/health > /dev/null 2>&1; then
  echo "ALREADY_RUNNING"
  exit 0
fi

# 杀掉旧进程
pkill -f "entry.cjs.*--port $1" 2>/dev/null || true
sleep 0.5

# 后台启动并完全脱离
nohup node entry.cjs --port $1 --upstream "$2" --key "$3" > ato.log 2>&1 &
PID=$!
disown $PID

# 等待启动
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.5
  if curl -s --noproxy '*' http://127.0.0.1:$1/health > /dev/null 2>&1; then
    echo "STARTED_PID=$PID"
    exit 0
  fi
done

echo "FAILED"
tail -5 ato.log
exit 1
`
  const scriptBase64 = Buffer.from(startScript).toString('base64')
  spawnSync('wsl', ['-d', distro, '--', 'bash', '-c',
    `echo "${scriptBase64}" | base64 -d > ~/.cc-switch-ato/start-ato.sh && chmod +x ~/.cc-switch-ato/start-ato.sh`], {
    encoding: 'utf-8',
    timeout: 10000,
  })

  // 启动（异步，不阻塞 UI）
  const startCmd = `source ~/.nvm/nvm.sh && setsid ~/.cc-switch-ato/start-ato.sh ${port} "${upstreamUrl}" "${upstreamKey}" > ~/.cc-switch-ato/start.log 2>&1 &`
  spawn('wsl', ['-d', distro, '--', 'bash', '-l', '-c', startCmd], {
    detached: true,
    stdio: 'ignore',
  })

  // 等待服务启动（轮询检测）
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500))
    const ok = await checkAtoRunningWsl(distro, port)
    if (ok) {
      savePidRecord(port, {
        pid: 0,
        port,
        upstreamUrl,
        startedAt: new Date().toISOString(),
        env: 'wsl',
        distro,
      })
      return { success: true, port, env: 'wsl', distro }
    }
  }

  // 检查启动日志
  const logResult = spawnSync('wsl', ['-d', distro, '--', 'bash', '-l', '-c',
    'cat ~/.cc-switch-ato/start.log 2>/dev/null | head -5'], {
    encoding: 'utf-8',
    timeout: 5000,
  })
  const logOutput = (logResult.stdout || '').trim()

  if (logOutput.includes('ALREADY_RUNNING')) {
    return { success: true, port, env: 'wsl', distro, error: 'ATO already running' }
  }

  console.log('[ATO] WSL start log:', logOutput)
  return { success: false, port, env: 'wsl', distro, error: 'Failed to start ATO in WSL' }
}

async function getWslUser(distro: string): Promise<string> {
  const result = spawnSync('wsl', ['-d', distro, '--', 'whoami'], {
    encoding: 'utf-8',
    timeout: 5000,
  })
  return (result.stdout || '').trim()
}

async function checkAtoRunningWsl(distro: string, port: number): Promise<boolean> {
  try {
    // 用进程检测代替 HTTP（避免代理干扰）
    const result = spawnSync('wsl', ['-d', distro, '--', 'bash', '-l', '-c',
      `pgrep -f "entry.cjs.*--port ${port}"`], {
      encoding: 'utf-8',
      timeout: 5000,
    })
    return (result.stdout || '').trim().length > 0
  } catch {
    return false
  }
}

// ---------------------- 公共 API ----------------------
export interface AtoStartResult {
  success: boolean
  port: number
  env: 'windows' | 'wsl'
  distro?: string
  pid?: number
  error?: string
}

export async function startAto(options: {
  port: number
  upstreamUrl: string
  upstreamKey: string
  distro?: string  // WSL 发行版，undefined = Windows
}): Promise<AtoStartResult> {
  if (options.distro) {
    return startAtoWsl({ ...options, distro: options.distro })
  }
  return startAtoWindows(options)
}

export async function stopAto(port: number, env: 'windows' | 'wsl' = 'windows', distro?: string): Promise<boolean> {
  const record = loadPidRecord(port, env, distro)

  if (env === 'windows' && record?.pid) {
    if (isProcessAliveWindows(record.pid)) {
      killProcessWindows(record.pid)
    }
  } else if (env === 'wsl' && distro) {
    // WSL: 通过端口找进程并杀掉
    spawnSync('wsl', ['-d', distro, '--', 'bash', '-c', `pkill -f "entry.cjs.*--port ${port}" || true`], {
      encoding: 'utf-8',
      timeout: 5000,
    })
  }

  await new Promise(resolve => setTimeout(resolve, 300))

  const stillRunning = env === 'windows'
    ? await checkAtoRunning(port)
    : distro ? await checkAtoRunningWsl(distro, port) : false

  if (!stillRunning) {
    removePidRecord(port, env, distro)
  }

  return !stillRunning
}

export interface AtoStatus {
  running: boolean
  port: number
  env: 'windows' | 'wsl'
  distro?: string
  upstreamUrl?: string
  pid?: number
  startedAt?: string
}

export async function getAtoStatus(port: number, env: 'windows' | 'wsl' = 'windows', distro?: string): Promise<AtoStatus> {
  const record = loadPidRecord(port, env, distro)
  const running = env === 'windows'
    ? await checkAtoRunning(port)
    : distro ? await checkAtoRunningWsl(distro, port) : false

  return {
    running,
    port,
    env,
    distro,
    upstreamUrl: record?.upstreamUrl,
    pid: record?.pid,
    startedAt: record?.startedAt,
  }
}

// ---------------------- 生成入口脚本 ----------------------
function generateEntryScript(): string {
  return `#!/usr/bin/env node
const http = require('http');

const PORT = parseInt(process.env.ATO_PORT || process.argv[process.argv.indexOf('--port') + 1] || '5000', 10);
const UPSTREAM_URL = process.env.ATO_UPSTREAM_URL || process.argv[process.argv.indexOf('--upstream') + 1] || '';
const UPSTREAM_KEY = process.env.ATO_UPSTREAM_KEY || process.argv[process.argv.indexOf('--key') + 1] || '';

if (!UPSTREAM_URL) {
  console.error('[ATO] Error: upstream URL is required');
  process.exit(1);
}

function resolveModel(model) {
  const mapping = {
    'sonnet-gpt-5-codex-high': 'gpt-5.3-codex-xhigh',
    'sonnet-gpt-5-codex-medium': 'gpt-5.3-codex-xhigh',
    'sonnet-gpt-5-codex-low': 'gpt-5.3-codex-xhigh',
    'gpt-5-codex-high': 'gpt-5.3-codex-xhigh',
    'gpt-5-codex-medium': 'gpt-5.3-codex-xhigh',
    'gpt-5-codex-low': 'gpt-5.3-codex-xhigh',
  };
  return mapping[model] || model;
}

function anthropicToOpenAI(req) {
  const input = [];
  let instructions = '';
  if (typeof req.system === 'string') instructions = req.system;
  else if (Array.isArray(req.system)) {
    instructions = req.system.filter(b => b?.type === 'text').map(b => b.text || '').join('');
  }

  for (const msg of req.messages || []) {
    const role = msg.role || 'user';
    const content = msg.content;

    if (typeof content === 'string') {
      input.push({ type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: content || ' ' }] });
      continue;
    }
    if (!Array.isArray(content)) continue;

    if (role === 'assistant') {
      const textBlocks = content.filter(b => b.type === 'text');
      const toolUses = content.filter(b => b.type === 'tool_use');
      if (textBlocks.length > 0) {
        input.push({ type: 'message', role: 'assistant', content: textBlocks.map(b => ({ type: 'output_text', text: b.text || ' ' })) });
      }
      for (let i = 0; i < toolUses.length; i++) {
        const tu = toolUses[i];
        input.push({ type: 'function_call', call_id: tu.id || 'tool_' + i, name: tu.name || '', arguments: JSON.stringify(tu.input || {}) });
      }
      continue;
    }

    if (role === 'user') {
      const parts = [];
      const toolResults = content.filter(b => b.type === 'tool_result');
      for (const block of content) {
        if (block.type === 'text') parts.push({ type: 'input_text', text: block.text || ' ' });
        else if (block.type === 'image' && block.source) parts.push({ type: 'input_image', image_url: 'data:' + block.source.media_type + ';base64,' + block.source.data });
      }
      if (parts.length > 0) input.push({ type: 'message', role: 'user', content: parts });
      for (const tr of toolResults) {
        input.push({ type: 'function_call_output', call_id: tr.tool_use_id || '', output: typeof tr.content === 'string' ? tr.content : ' ' });
      }
    }
  }

  const result = { model: resolveModel(req.model), input, stream: req.stream ?? false };
  if (instructions) result.instructions = instructions;
  if (req.max_tokens) result.max_output_tokens = req.max_tokens;
  if (req.temperature !== undefined) result.temperature = req.temperature;
  if (req.top_p !== undefined) result.top_p = req.top_p;
  return result;
}

function openAIToAnthropic(res) {
  const output = res.output || res.response?.output || [];
  const text = output.filter(i => i.type === 'message').flatMap(i => i.content || []).filter(p => p.type === 'output_text' || p.type === 'text').map(p => p.text || '').join('');
  const toolCalls = output.filter(i => i.type === 'function_call' || i.type === 'tool_call').map(i => ({ id: i.call_id || i.id || 'tool_unknown', name: i.name || '', arguments: typeof i.arguments === 'string' ? i.arguments : JSON.stringify(i.input || {}) }));

  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const tc of toolCalls) {
    let input = {};
    try { input = JSON.parse(tc.arguments); } catch {}
    content.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });

  const usage = res.usage || res.response?.usage || {};
  return {
    id: res.id || res.response?.id || 'msg_unknown',
    type: 'message',
    role: 'assistant',
    content,
    model: res.model || res.response?.model || 'unknown',
    stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 },
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function handleMessages(req, res) {
  const body = await readBody(req);
  let anthropicReq;
  try { anthropicReq = JSON.parse(body); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_request', message: 'Invalid JSON' } }));
    return;
  }

  const openaiReq = anthropicToOpenAI(anthropicReq);
  const isStream = openaiReq.stream;
  console.log('[ATO] ' + anthropicReq.model + ' -> ' + openaiReq.model + ', stream=' + isStream);

  const upstreamResp = await fetch(UPSTREAM_URL + '/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + UPSTREAM_KEY },
    body: JSON.stringify(openaiReq),
  });

  if (!upstreamResp.ok) {
    const errorText = await upstreamResp.text();
    console.error('[ATO] Upstream error:', upstreamResp.status, errorText.slice(0, 200));
    res.writeHead(upstreamResp.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'upstream_error', message: errorText, status: upstreamResp.status } }));
    return;
  }

  if (isStream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const reader = upstreamResp.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.write('event: message_stop\\ndata: {"type":"message_stop"}\\n\\n');
      res.end();
    } catch (err) {
      console.error('[ATO] Stream error:', err.message);
      res.end();
    }
  } else {
    const openaiResp = await upstreamResp.json();
    const anthropicResp = openAIToAnthropic(openaiResp);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(anthropicResp));
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', upstream: UPSTREAM_URL }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/messages') {
    try { await handleMessages(req, res); }
    catch (err) {
      console.error('[ATO] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'internal_error', message: err.message } }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { type: 'not_found', message: 'Not found' } }));
});

server.listen(PORT, () => {
  console.log('[ATO] Proxy started on port ' + PORT);
  console.log('[ATO] Upstream: ' + UPSTREAM_URL);
});
`
}
