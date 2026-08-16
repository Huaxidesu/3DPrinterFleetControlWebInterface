/**
 * 安装/启用前闸门 + 已装插件/主题按市场登录用户已购列表复查
 * - 内置包不受影响
 * - 非集市本地包放行（仅集市上架包强制归属校验）
 * - 未登录/USER_OFFLINE：关闭已装集市包
 * - 已登录但不在 ownedApps：关闭该包
 */
import {
  checkInstalledPlugins,
  marketHeartbeat,
  verifyAgainstMarket,
  type CheckInstalledResult
} from './marketVerify'
import {
  collectCheckItems,
  getSuspendedThemeId,
  markPluginLicenseSuspended,
  resolveDeviceId,
  setSuspendedThemeId,
  takePluginLicenseSuspended,
  type InstalledPackRef
} from './licenseStore'
import { getMarketBaseUrl, loadMarketCatalog } from '../marketplace/catalog'

function installedKind(
  installed: InstalledPackRef[],
  id: string,
  appType?: string
): 'plugin' | 'theme' {
  const hit = installed.find((p) => p.identifier === id)
  if (hit) return hit.kind
  return String(appType || '').toUpperCase() === 'THEME' ? 'theme' : 'plugin'
}

export type RecheckResult = CheckInstalledResult & {
  skippedBuiltin: string[]
  skippedNotInMarket: string[]
  allowUse?: boolean
  ownedApps?: CheckInstalledResult['ownedApps']
  user?: CheckInstalledResult['user']
  nextHeartbeatSec?: number
}

export function licenseEnforceEnabled(): boolean {
  return process.env.LICENSE_REQUIRED === '1' || process.env.LICENSE_ENFORCE === '1'
}

export async function isOnMarketCatalog(identifier: string): Promise<boolean> {
  const id = String(identifier || '').trim()
  if (!id) return false
  try {
    const cat = await loadMarketCatalog(false)
    if (!cat.reachable) return false
    return cat.catalog.packages.some((p) => p.identifier === id)
  } catch {
    return false
  }
}

export async function assertAppLicensed(opts: {
  dataRoot: string
  appIdentifier: string
  kind?: 'plugin' | 'theme'
}): Promise<{ ok: true } | { ok: false; message: string; code?: string }> {
  const deviceId = resolveDeviceId(opts.dataRoot)
  if (!deviceId) {
    return {
      ok: false,
      message: '缺少 MARKET_DEVICE_ID（请登录集市后在用户中心复制本机设备 ID）',
      code: 'MISSING_DEVICE'
    }
  }

  const result = await verifyAgainstMarket({
    marketBase: getMarketBaseUrl(),
    deviceId,
    appIdentifier: opts.appIdentifier
  })

  if (!(result.ok && result.allowUse)) {
    return {
      ok: false,
      message: result.message || '当前登录用户无权使用该应用',
      code: result.code
    }
  }
  return { ok: true }
}

/**
 * 集市包使用/启用前闸门：目录内必须归当前登录用户；本地/内置放行。
 */
export async function assertUsableIfMarketPack(opts: {
  dataRoot: string
  appIdentifier: string
  kind?: 'plugin' | 'theme'
  /** @deprecated 新模型忽略 */
  licenseKey?: string
}): Promise<{ ok: true; onMarket: boolean } | { ok: false; onMarket: boolean; message: string; code?: string }> {
  const onMarket = await isOnMarketCatalog(opts.appIdentifier)
  if (!onMarket) return { ok: true, onMarket: false }
  const gate = await assertAppLicensed({
    dataRoot: opts.dataRoot,
    appIdentifier: opts.appIdentifier,
    kind: opts.kind
  })
  if (!gate.ok) {
    return { ok: false, onMarket: true, message: gate.message, code: gate.code }
  }
  return { ok: true, onMarket: true }
}

export async function recheckInstalledLicenses(opts: {
  dataRoot: string
  installed: InstalledPackRef[]
  onPirate?: (identifier: string, kind: 'plugin' | 'theme', message: string) => Promise<void> | void
  /** 当前账号已拥有：恢复此前因授权被关闭的插件/主题 */
  onAllow?: (identifier: string, kind: 'plugin' | 'theme') => Promise<void> | void
}): Promise<RecheckResult | null> {
  const deviceId = resolveDeviceId(opts.dataRoot)
  if (!deviceId) {
    console.warn('[license] 跳过批量检查：未配置 MARKET_DEVICE_ID')
    return null
  }

  const collected = collectCheckItems(opts.dataRoot, { installed: opts.installed })

  // 拉集市目录：只强制校验上架包；本地示例包跳过
  let marketIds = new Set<string>()
  try {
    const cat = await loadMarketCatalog(false)
    if (cat.reachable) {
      marketIds = new Set(cat.catalog.packages.map((p) => p.identifier))
    }
  } catch {
    /* ignore */
  }

  const skippedNotInMarket: string[] = []
  const marketItems = collected.items.filter((it) => {
    if (marketIds.size && !marketIds.has(it.appIdentifier)) {
      skippedNotInMarket.push(it.appIdentifier)
      return false
    }
    // 目录不可达时仍送检，避免漏关
    return true
  })

  if (!marketItems.length) {
    console.log(
      `[license] 无可校验集市包（内置跳过 ${collected.skippedBuiltin.length}，本地跳过 ${skippedNotInMarket.length}）`
    )
    return {
      allGenuine: true,
      allAllowUse: true,
      genuineCount: 0,
      pirateCount: 0,
      total: 0,
      items: [],
      skippedBuiltin: collected.skippedBuiltin,
      skippedNotInMarket
    }
  }

  // 先心跳：未登录则关闭全部已装集市包
  const hb = await marketHeartbeat({
    marketBase: getMarketBaseUrl(),
    deviceId
  })

  if (!hb.allowUse) {
    const items = marketItems.map((it) => ({
      appIdentifier: it.appIdentifier,
      name: it.appIdentifier,
      appType: it.type,
      genuine: false,
      allowUse: false,
      code: hb.code || 'USER_OFFLINE',
      message: hb.message || '本机市场用户未登录或已下线，禁止使用集市应用',
      licenseKey: null as string | null
    }))
    const result: RecheckResult = {
      allGenuine: false,
      allAllowUse: false,
      genuineCount: 0,
      pirateCount: items.length,
      total: items.length,
      items,
      skippedBuiltin: collected.skippedBuiltin,
      skippedNotInMarket,
      allowUse: false,
      ownedApps: hb.ownedApps,
      user: hb.user || undefined,
      nextHeartbeatSec: hb.nextHeartbeatSec,
      raw: hb.raw
    }
    console.warn(
      `[license] 心跳未通过 (${hb.code}): ${hb.message} → 关闭 ${items.length} 个已装集市包`
    )
    if (opts.onPirate) {
      for (const it of items) {
        await opts.onPirate(
          it.appIdentifier,
          installedKind(opts.installed, it.appIdentifier, it.appType),
          it.message
        )
      }
    }
    return result
  }

  const remote = await checkInstalledPlugins({
    marketBase: getMarketBaseUrl(),
    deviceId,
    items: marketItems
  })

  const items: CheckInstalledResult['items'] = []
  for (const it of remote.items || []) {
    // 无 code 且不允许：通信异常，不禁用
    if (!it.allowUse && !it.code) {
      console.warn(`[license] 市场异常，跳过处理 ${it.appIdentifier}: ${it.message || ''}`)
      continue
    }
    items.push(it)
  }

  // 漏网条目：对照 ownedApps
  const owned = new Set((hb.ownedApps || remote.ownedApps || []).map((a) => a.appIdentifier))
  const returned = new Set(items.map((x) => x.appIdentifier))
  for (const src of marketItems) {
    if (returned.has(src.appIdentifier)) continue
    const ok = owned.has(src.appIdentifier)
    items.push({
      appIdentifier: src.appIdentifier,
      name: src.appIdentifier,
      appType: src.type,
      genuine: ok,
      allowUse: ok,
      code: ok ? 'OK' : 'NOT_OWNED',
      message: ok ? '当前登录用户已拥有' : '当前登录用户未购买该应用',
      licenseKey: null
    })
  }

  const genuineCount = items.filter((x) => x.allowUse).length
  const pirateCount = items.length - genuineCount
  const result: RecheckResult = {
    allGenuine: pirateCount === 0,
    allAllowUse: pirateCount === 0,
    genuineCount,
    pirateCount,
    total: items.length,
    checkedAt: remote.checkedAt || new Date().toISOString(),
    items,
    skippedBuiltin: collected.skippedBuiltin,
    skippedNotInMarket,
    allowUse: true,
    ownedApps: remote.ownedApps || hb.ownedApps,
    user: remote.user || hb.user || undefined,
    nextHeartbeatSec: hb.nextHeartbeatSec,
    raw: remote.raw || hb.raw
  }

  console.log(
    `[license] 用户 ${result.user?.username || '?'} 批量检查: total=${result.total} allow=${result.genuineCount} deny=${result.pirateCount} skipBuiltin=${result.skippedBuiltin.length} skipLocal=${result.skippedNotInMarket.length}`
  )

  if (opts.onPirate) {
    for (const it of result.items) {
      if (it.allowUse) continue
      await opts.onPirate(
        it.appIdentifier,
        installedKind(opts.installed, it.appIdentifier, it.appType),
        it.message || it.code || '未授权'
      )
    }
  }
  if (opts.onAllow) {
    for (const it of result.items) {
      if (!it.allowUse) continue
      await opts.onAllow(
        it.appIdentifier,
        installedKind(opts.installed, it.appIdentifier, it.appType)
      )
    }
  }
  return result
}

export function startLicenseRecheckLoop(opts: {
  dataRoot: string
  getInstalled: () => InstalledPackRef[]
  onPirate?: (identifier: string, kind: 'plugin' | 'theme', message: string) => Promise<void> | void
  onAllow?: (identifier: string, kind: 'plugin' | 'theme') => Promise<void> | void
  intervalMs?: number
}): () => void {
  const envMs = Number(process.env.LICENSE_RECHECK_MS || process.env.MARKET_HEARTBEAT_MS || 60_000)
  let ms = opts.intervalMs ?? (Number.isFinite(envMs) && envMs >= 15_000 ? envMs : 60_000)
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const schedule = (nextMs: number) => {
    if (stopped) return
    if (timer) clearInterval(timer)
    ms = Math.max(15_000, nextMs)
    timer = setInterval(tick, ms)
    if (typeof timer.unref === 'function') timer.unref()
  }

  const tick = () => {
    void recheckInstalledLicenses({
      dataRoot: opts.dataRoot,
      installed: opts.getInstalled(),
      onPirate: opts.onPirate,
      onAllow: opts.onAllow
    })
      .then((r) => {
        if (r?.nextHeartbeatSec && Number.isFinite(r.nextHeartbeatSec)) {
          const next = Math.max(15, r.nextHeartbeatSec) * 1000
          if (Math.abs(next - ms) > 5_000) schedule(next)
        }
      })
      .catch((e) => console.error('[license] 定时复查失败', e))
  }

  schedule(ms)
  return () => {
    stopped = true
    if (timer) clearInterval(timer)
  }
}

/**
 * 授权侧效应：未购关闭；切回账号已购时自动恢复启用（含此前被切走的主题）。
 */
export function createLicenseSideEffects(opts: {
  dataRoot: string
  setPluginAvailable?: (id: string, available: boolean) => Promise<unknown> | unknown
  getActiveThemeId?: () => string | Promise<string | null | undefined>
  setActiveTheme?: (id: string) => Promise<unknown> | unknown
}): {
  onPirate: (identifier: string, kind: 'plugin' | 'theme', message: string) => Promise<void>
  onAllow: (identifier: string, kind: 'plugin' | 'theme') => Promise<void>
} {
  const onPirate = async (
    id: string,
    kind: 'plugin' | 'theme',
    message: string
  ): Promise<void> => {
    console.warn(`[license] 未授权 ${kind}:${id} — ${message}，已禁止使用`)
    if (kind === 'plugin') {
      try {
        markPluginLicenseSuspended(opts.dataRoot, id)
        await opts.setPluginAvailable?.(id, false)
      } catch {
        /* ignore */
      }
      return
    }
    try {
      const active = String((await opts.getActiveThemeId?.()) || '')
      if (active === id) {
        setSuspendedThemeId(opts.dataRoot, id)
        await opts.setActiveTheme?.('default')
        console.warn(`[license] 已将主题从非正版 ${id} 切回 default（可切回账号后自动恢复）`)
      }
    } catch {
      /* ignore */
    }
  }

  const onAllow = async (id: string, kind: 'plugin' | 'theme'): Promise<void> => {
    if (kind === 'plugin') {
      try {
        if (!takePluginLicenseSuspended(opts.dataRoot, id)) return
        await opts.setPluginAvailable?.(id, true)
        console.log(`[license] 已恢复插件 ${id}`)
      } catch {
        /* ignore */
      }
      return
    }
    try {
      const suspended = getSuspendedThemeId(opts.dataRoot)
      const active = String((await opts.getActiveThemeId?.()) || '')
      if (suspended === id && (active === 'default' || !active)) {
        await opts.setActiveTheme?.(id)
        setSuspendedThemeId(opts.dataRoot, null)
        console.log(`[license] 已恢复主题 ${id}`)
      }
    } catch {
      /* ignore */
    }
  }

  return { onPirate, onAllow }
}
