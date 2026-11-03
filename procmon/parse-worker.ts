/**
 * 解析 Worker（Node worker_threads）
 *
 * 主进程把系统命令的原始 stdout 发到本线程完成解析（CSV / ps 文本可能有数百上千行），
 * 解析结果再 postMessage 回主进程，避免 CPU 密集的文本处理阻塞主进程事件循环。
 *
 * 协议：父线程发 { seq, platform, text }，本线程回 { seq, rows } 或 { seq, error }。
 * 本文件由 esbuild 单独打包为 dist/procmon-worker.js（见 scripts/build-main.mjs）。
 */
import { parentPort } from 'node:worker_threads'

import { parseUnixPs, parseWindowsCsv, type ParsedProc } from './parse'

parentPort?.on('message', (message: { seq: number; platform: string; text: string }) => {
  const { seq, platform, text } = message || { seq: 0, platform: '', text: '' }
  try {
    const rows: ParsedProc[] = platform === 'win32' ? parseWindowsCsv(text) : parseUnixPs(text)
    parentPort?.postMessage({ seq, rows })
  } catch (error) {
    parentPort?.postMessage({ seq, error: (error as Error)?.message || String(error) })
  }
})
