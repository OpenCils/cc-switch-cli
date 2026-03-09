#!/usr/bin/env node
// cc-switch-cli 入口，通过 tsx 直接运行 TypeScript 源码
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isWindows = process.platform === 'win32'
// Windows 需要用 .cmd 后缀，否则 spawnSync 找不到可执行文件
const tsxBin = join(__dirname, '..', 'node_modules', '.bin', isWindows ? 'tsx.cmd' : 'tsx')
const appEntry = join(__dirname, '..', 'src', 'app.tsx')

spawnSync(tsxBin, [appEntry], { stdio: 'inherit' })
