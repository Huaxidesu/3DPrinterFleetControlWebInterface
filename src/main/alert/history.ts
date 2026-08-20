/**
 * Persist alert notify history + retry queue under DATA_ROOT.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AlertNotifyPayload } from '../../shared/alertNotify'

export type AlertNotifyChannelResult = {
  channel: string
  ok: boolean
  message?: string
}

export type AlertHistoryEntry = {
  id: string
  at: string
  kind: string
  title: string
  content: string
  deviceId?: string
  deviceName?: string
  results: AlertNotifyChannelResult[]
  ok: boolean
  attempts: number
  status: 'ok' | 'partial' | 'failed' | 'retrying' | 'dead'
  nextRetryAt?: string
}

const MAX_HISTORY = 500
const MAX_ATTEMPTS = 5

let dataRoot: string | null = null
let cache: AlertHistoryEntry[] | null = null
let retryTimer: ReturnType<typeof setInterval> | null = null
let retryRunner: (() => Promise<void>) | null = null

export function setAlertHistoryDataRoot(root: string | null | undefined): void {
  dataRoot = root ? String(root) : null
  cache = null
}

function historyPath(): string {
  const root = dataRoot || join(process.cwd(), 'data')
  return join(root, 'alert-history.json')
}

function load(): AlertHistoryEntry[] {
  if (cache) return cache
  try {
    const p = historyPath()
    if (!existsSync(p)) {
      cache = []
      return cache
    }
    const j = JSON.parse(readFileSync(p, 'utf8')) as { entries?: AlertHistoryEntry[] }
    cache = Array.isArray(j.entries) ? j.entries : []
  } catch {
    cache = []
  }
  return cache
}

function save(entries: AlertHistoryEntry[]): void {
  cache = entries.slice(0, MAX_HISTORY)
  const p = historyPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ version: 1, entries: cache }, null, 2), 'utf8')
}

function newId(): string {
  return `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function statusOf(results: AlertNotifyChannelResult[], attempts: number): AlertHistoryEntry['status'] {
  if (!results.length) return 'failed'
  const okN = results.filter((r) => r.ok).length
  if (okN === results.length) return 'ok'
  if (okN > 0) return attempts >= MAX_ATTEMPTS ? 'partial' : 'retrying'
  return attempts >= MAX_ATTEMPTS ? 'dead' : 'retrying'
}

function nextBackoffMs(attempts: number): number {
  // 30s, 60s, 2m, 5m, 15m
  const table = [30_000, 60_000, 120_000, 300_000, 900_000]
  return table[Math.min(attempts - 1, table.length - 1)]!
}

export function appendAlertHistory(
  payload: AlertNotifyPayload,
  results: AlertNotifyChannelResult[],
  ok: boolean
): AlertHistoryEntry {
  const entries = load()
  const attempts = 1
  const st = statusOf(results, attempts)
  const entry: AlertHistoryEntry = {
    id: newId(),
    at: payload.at || new Date().toISOString(),
    kind: payload.kind,
    title: payload.title,
    content: payload.content,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    results,
    ok,
    attempts,
    status: st,
    nextRetryAt:
      st === 'retrying' || st === 'failed'
        ? new Date(Date.now() + nextBackoffMs(attempts)).toISOString()
        : undefined
  }
  if (st === 'failed' && results.some((r) => !r.ok)) {
    entry.status = 'retrying'
    entry.nextRetryAt = new Date(Date.now() + nextBackoffMs(attempts)).toISOString()
  }
  save([entry, ...entries])
  return entry
}

export function clearAlertHistory(): void {
  save([])
}

export function listAlertHistory(limit = 100): AlertHistoryEntry[] {
  return load().slice(0, Math.max(1, Math.min(500, limit)))
}

export function getAlertHistory(id: string): AlertHistoryEntry | null {
  return load().find((e) => e.id === id) || null
}

export function updateAlertHistory(entry: AlertHistoryEntry): void {
  const entries = load()
  const i = entries.findIndex((e) => e.id === entry.id)
  if (i < 0) {
    save([entry, ...entries])
    return
  }
  const next = entries.slice()
  next[i] = entry
  save(next)
}

export function markRetryResult(
  id: string,
  results: AlertNotifyChannelResult[],
  ok: boolean
): AlertHistoryEntry | null {
  const cur = getAlertHistory(id)
  if (!cur) return null
  const attempts = cur.attempts + 1
  const st = statusOf(results, attempts)
  const next: AlertHistoryEntry = {
    ...cur,
    results,
    ok: ok || cur.ok,
    attempts,
    status: st === 'failed' && attempts < MAX_ATTEMPTS ? 'retrying' : st,
    nextRetryAt:
      attempts < MAX_ATTEMPTS && results.some((r) => !r.ok)
        ? new Date(Date.now() + nextBackoffMs(attempts)).toISOString()
        : undefined
  }
  if (attempts >= MAX_ATTEMPTS && results.some((r) => !r.ok) && !results.every((r) => r.ok)) {
    next.status = results.some((r) => r.ok) ? 'partial' : 'dead'
    next.nextRetryAt = undefined
  }
  updateAlertHistory(next)
  return next
}

export function dueRetryEntries(now = Date.now()): AlertHistoryEntry[] {
  return load().filter((e) => {
    if (e.status !== 'retrying' && e.status !== 'failed') return false
    if (e.attempts >= MAX_ATTEMPTS) return false
    if (!e.nextRetryAt) return true
    return Date.parse(e.nextRetryAt) <= now
  })
}

export function startAlertRetryLoop(tick: () => Promise<void>): void {
  retryRunner = tick
  if (retryTimer) return
  retryTimer = setInterval(() => {
    void retryRunner?.().catch(() => undefined)
  }, 15_000)
  // unref so it doesn't keep process alive oddly in tests
  try {
    ;(retryTimer as NodeJS.Timeout).unref?.()
  } catch {
    /* ignore */
  }
}
