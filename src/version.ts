/**
 * [INPUT]: 无外部依赖
 * [OUTPUT]: 对外提供 VERSION 常量，编译时由 CI 注入
 * [POS]: src/ 的版本基准，被 updater.ts 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export const VERSION = '1.2.9'
