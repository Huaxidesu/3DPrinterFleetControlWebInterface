/**
 * 应用集市运行时鉴权（官方新文档）
 * POST {MARKET_BASE}/api/license/heartbeat
 * POST {MARKET_BASE}/api/license/check-installed
 * POST {MARKET_BASE}/api/license/verify  （与心跳相同，只认用户）
 *
 * 只认：deviceId（本机设备 ID）+ 当前登录用户已购列表 ownedApps。
 * 不再需要 licenseKey / siteKey。
 */
import http from 'http'
import https from 'https'
import { URL } from 'url'
import { getMarketBaseUrl, resolveMarketBaseUrl, setMarketBaseUrl } from '../marketplace/catalog'

export type OwnedApp = {
  appIdentifier: string
  name?: string
  appType?: string
  licenseKey?: string | null
  status?: string
}

export type HeartbeatResult = {
  ok: boolean
  allowUse: boolean
  /** 兼容旧字段：与 allowUse 同义 */
  genuine: boolean
  code?: string
  message: string
  user?: { id: string; username: string; displayName?: string; role?: string } | null
  ownedApps: OwnedApp[]
  nextHeartbeatSec: number
  raw?: unknown
}

export type MarketVerifyResult = {
  ok: boolean
  genuine: boolean
  allowUse: boolean
  code?: string
  message: string
  ownedApps?: OwnedApp[]
  user?: HeartbeatResult['user']
  raw?: unknown
}

export type CheckInstalledItem = {
  appIdentifier: string
  type?: 'PLUGIN' | 'THEME' | 'plugin' | 'theme'
  /** @deprecated 新模型不再需要 */
  licenseKey?: string
}

export type CheckInstalledResult = {
  allGenuine: boolean
  allAllowUse: boolean
  genuineCount: number
  pirateCount: number
  total: number
  checkedAt?: string
  user?: HeartbeatResult['user']
  ownedApps?: OwnedApp[]
  items: Array<{
    appIdentifier: string
    name?: string
    appType?: string
    genuine: boolean
    allowUse: boolean
    code?: string
    message?: string
    licenseKey?: string | null
  }>
  raw?: unknown
}

function postJson(
  urlStr: string,
  bodyObj: unknown,
  timeoutMs: number
): Promise<{ status: number; text: string }> {
  const url = new URL(urlStr)
  const body = JSON.stringify(bodyObj)
  const lib = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search || ''}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'hanye-printer-monitor-license',
          Accept: 'application/json'
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString('utf8')
          })
        )
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('license heartbeat timeout'))
    })
    req.write(body)
    req.end()
  })
}

function parseOwnedApps(raw: unknown): OwnedApp[] {
  if (!Array.isArray(raw)) return []
  const out: OwnedApp[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = String(r.appIdentifier || '').trim()
    if (!id) continue
    out.push({
      appIdentifier: id,
      name: r.name ? String(r.name) : undefined,
      appType: r.appType ? String(r.appType) : undefined,
      licenseKey: r.licenseKey == null ? null : String(r.licenseKey),
      status: r.status ? String(r.status) : undefined
    })
  }
  return out
}

function parseHeartbeatData(json: Record<string, unknown> | null): HeartbeatResult {
  const data =
    json?.data && typeof json.data === 'object' ? (json.data as Record<string, unknown>) : {}
  const allowUse = !!json?.ok && !!data.allowUse
  const user =
    data.user && typeof data.user === 'object'
      ? {
          id: String((data.user as Record<string, unknown>).id || ''),
          username: String((data.user as Record<string, unknown>).username || ''),
          displayName: (data.user as Record<string, unknown>).displayName
            ? String((data.user as Record<string, unknown>).displayName)
            : undefined,
          role: (data.user as Record<string, unknown>).role
            ? String((data.user as Record<string, unknown>).role)
            : undefined
        }
      : null
  const next = Number(data.nextHeartbeatSec)
  return {
    ok: !!json?.ok,
    allowUse,
    genuine: allowUse,
    code: data.code ? String(data.code) : undefined,
    message: String(data.message || (allowUse ? '允许使用' : '未授权')),
    user: user && user.id ? user : null,
    ownedApps: parseOwnedApps(data.ownedApps),
    nextHeartbeatSec: Number.isFinite(next) && next > 0 ? next : 60,
    raw: json
  }
}

const HB_CACHE_MS = 5_000
const HB_TIMEOUT_MS = 8_000
let hbMemo: { key: string; at: number; result: HeartbeatResult } | null = null
const hbInflight = new Map<string, Promise<HeartbeatResult>>()

function heartbeatKey(deviceId: string, appIdentifier: string | undefined, base: string): string {
  return `${deviceId}|${appIdentifier || ''}|${base}`
}

/** 心跳：确认本机登录用户 + 已购列表（只打当前锁定线路，短缓存避免登录叠打） */
export async function marketHeartbeat(input: {
  marketBase?: string
  deviceId: string
  appIdentifier?: string
  timeoutMs?: number
}): Promise<HeartbeatResult> {
  const deviceId = String(input.deviceId || '').trim()
  if (!deviceId) {
    return {
      ok: false,
      allowUse: false,
      genuine: false,
      code: 'MISSING_DEVICE',
      message: '缺少 MARKET_DEVICE_ID（请从用户中心复制本机设备 ID）',
      ownedApps: [],
      nextHeartbeatSec: 60
    }
  }

  const preferred = String(input.marketBase || (await resolveMarketBaseUrl(false))).replace(/\/$/, '')
  const key = heartbeatKey(deviceId, input.appIdentifier, preferred)
  if (hbMemo && hbMemo.key === key && Date.now() - hbMemo.at < HB_CACHE_MS) {
    return hbMemo.result
  }
  const pending = hbInflight.get(key)
  if (pending) return pending

  const run = (async (): Promise<HeartbeatResult> => {
    try {
      let lastErr: unknown
      let payload: { status: number; text: string } | null = null
      const timeoutMs = input.timeoutMs ?? HB_TIMEOUT_MS
      for (let i = 0; i < 2; i++) {
        try {
          payload = await postJson(
            `${preferred}/api/license/heartbeat`,
            {
              deviceId,
              ...(input.appIdentifier ? { appIdentifier: input.appIdentifier } : {})
            },
            timeoutMs
          )
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          if (i === 0) await new Promise((r) => setTimeout(r, 200))
        }
      }
      if (!payload) throw lastErr || new Error('heartbeat failed')
      setMarketBaseUrl(preferred)
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(payload.text) as Record<string, unknown>
      } catch {
        return {
          ok: false,
          allowUse: false,
          genuine: false,
          message: `市场返回非 JSON（HTTP ${payload.status}）`,
          ownedApps: [],
          nextHeartbeatSec: 60
        }
      }
      const result = parseHeartbeatData(json)
      if (result.allowUse) {
        hbMemo = { key, at: Date.now(), result }
      }
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        allowUse: false,
        genuine: false,
        message: /timeout/i.test(msg) ? '心跳超时' : `心跳失败：${msg}`,
        ownedApps: [],
        nextHeartbeatSec: 60
      }
    }
  })()

  hbInflight.set(key, run)
  try {
    return await run
  } finally {
    hbInflight.delete(key)
  }
}

/** 单应用校验（与心跳相同，可带 appIdentifier） */
export async function verifyAgainstMarket(input: {
  marketBase?: string
  deviceId: string
  appIdentifier: string
  timeoutMs?: number
}): Promise<MarketVerifyResult> {
  const hb = await marketHeartbeat({
    marketBase: input.marketBase,
    deviceId: input.deviceId,
    appIdentifier: input.appIdentifier,
    timeoutMs: input.timeoutMs
  })
  return {
    ok: hb.ok,
    genuine: hb.allowUse,
    allowUse: hb.allowUse,
    code: hb.code,
    message: hb.message,
    ownedApps: hb.ownedApps,
    user: hb.user,
    raw: hb.raw
  }
}

export async function checkInstalledPlugins(input: {
  marketBase?: string
  deviceId: string
  items: CheckInstalledItem[]
  timeoutMs?: number
}): Promise<CheckInstalledResult> {
  const preferred = String(input.marketBase || (await resolveMarketBaseUrl(false))).replace(/\/$/, '')
  const deviceId = String(input.deviceId || '').trim()
  const items = (input.items || []).slice(0, 100)
  if (!items.length) {
    return {
      allGenuine: true,
      allAllowUse: true,
      genuineCount: 0,
      pirateCount: 0,
      total: 0,
      items: []
    }
  }
  if (!deviceId) {
    return {
      allGenuine: false,
      allAllowUse: false,
      genuineCount: 0,
      pirateCount: items.length,
      total: items.length,
      items: items.map((it) => ({
        appIdentifier: it.appIdentifier,
        genuine: false,
        allowUse: false,
        code: 'MISSING_DEVICE',
        message: '缺少 MARKET_DEVICE_ID'
      }))
    }
  }

  try {
    let lastErr: unknown
    let payload: { status: number; text: string } | null = null
    const timeoutMs = input.timeoutMs ?? HB_TIMEOUT_MS
    for (let i = 0; i < 2; i++) {
      try {
        payload = await postJson(
          `${preferred}/api/license/check-installed`,
          {
            deviceId,
            items: items.map((it) => ({
              appIdentifier: it.appIdentifier,
              ...(it.type ? { type: String(it.type).toUpperCase() } : {})
            }))
          },
          timeoutMs
        )
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        if (i === 0) await new Promise((r) => setTimeout(r, 200))
      }
    }
    if (!payload) throw lastErr || new Error('check-installed failed')
    setMarketBaseUrl(preferred)

    let json: Record<string, unknown> | null = null
    try {
      json = JSON.parse(payload.text) as Record<string, unknown>
    } catch {
      return {
        allGenuine: false,
        allAllowUse: false,
        genuineCount: 0,
        pirateCount: items.length,
        total: items.length,
        items: items.map((it) => ({
          appIdentifier: it.appIdentifier,
          genuine: false,
          allowUse: false,
          message: `市场返回非 JSON（HTTP ${payload.status}）`
        }))
      }
    }

    const data =
      json?.data && typeof json.data === 'object' ? (json.data as Record<string, unknown>) : {}
    const list = Array.isArray(data.items) ? data.items : []
    const mapped = list.map((row) => {
      const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      const allowUse = !!r.allowUse || !!r.genuine
      return {
        appIdentifier: String(r.appIdentifier || ''),
        name: r.name ? String(r.name) : undefined,
        appType: r.appType ? String(r.appType) : undefined,
        genuine: allowUse,
        allowUse,
        code: r.code ? String(r.code) : undefined,
        message: r.message ? String(r.message) : undefined,
        licenseKey: r.licenseKey == null ? null : String(r.licenseKey)
      }
    })
    const allowCount = mapped.filter((x) => x.allowUse).length
    return {
      allGenuine: !!data.allAllowUse || !!data.allGenuine,
      allAllowUse: !!data.allAllowUse || !!data.allGenuine,
      genuineCount:
        typeof data.allowCount === 'number'
          ? data.allowCount
          : typeof data.genuineCount === 'number'
            ? data.genuineCount
            : allowCount,
      pirateCount:
        typeof data.pirateCount === 'number'
          ? data.pirateCount
          : mapped.length - allowCount,
      total: typeof data.total === 'number' ? data.total : mapped.length,
      checkedAt: data.checkedAt ? String(data.checkedAt) : undefined,
      user:
        data.user && typeof data.user === 'object'
          ? {
              id: String((data.user as Record<string, unknown>).id || ''),
              username: String((data.user as Record<string, unknown>).username || ''),
              displayName: (data.user as Record<string, unknown>).displayName
                ? String((data.user as Record<string, unknown>).displayName)
                : undefined,
              role: (data.user as Record<string, unknown>).role
                ? String((data.user as Record<string, unknown>).role)
                : undefined
            }
          : undefined,
      ownedApps: parseOwnedApps(data.ownedApps),
      items: mapped,
      raw: json
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      allGenuine: false,
      allAllowUse: false,
      genuineCount: 0,
      pirateCount: items.length,
      total: items.length,
      items: items.map((it) => ({
        appIdentifier: it.appIdentifier,
        genuine: false,
        allowUse: false,
        message: msg
      }))
    }
  }
}

/** 启动硬拦截：LICENSE_REQUIRED=1 时心跳必须 allowUse */
export async function assertLicensedOrExit(): Promise<void> {
  if (process.env.LICENSE_REQUIRED !== '1') return

  const marketBase = getMarketBaseUrl()
  const deviceId = String(process.env.MARKET_DEVICE_ID || '').trim()
  if (!marketBase || !deviceId) {
    console.error('[license] 缺少 MARKET_BASE_URL / MARKET_DEVICE_ID')
    process.exit(1)
  }

  const result = await marketHeartbeat({ marketBase, deviceId })
  if (!result.allowUse) {
    console.error('[license] 心跳失败:', result.code, result.message)
    process.exit(1)
  }
  console.log(
    `[license] 心跳通过：用户 ${result.user?.username || '?'}，可使用 ${result.ownedApps.length} 个应用`
  )
}

/** @deprecated 使用 assertLicensedOrExit */
export const runStartupLicenseGate = async (_opts?: { domain?: string }): Promise<void> => {
  await assertLicensedOrExit()
}
