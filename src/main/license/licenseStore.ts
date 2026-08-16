/**
 * 应用集市授权本地存储：每个已装插件/主题对应的 licenseKey
 * 文件：data/market-licenses.json
 */
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export type MarketLicenseEntry = {
  licenseKey: string
  kind?: 'plugin' | 'theme'
  updatedAt?: string
}

export type MarketLicenseFile = {
  version: 1
  /** @deprecated 旧模型安装实例密钥；新模型改用 deviceId */
  siteKey?: string
  /** 本机设备 ID（主机固定；登录集市时绑定，勿随账号随机变化） */
  deviceId?: string
  /**
   * 因授权被切回 default 前的集市主题；账号切回且仍拥有时自动恢复
   */
  suspendedThemeId?: string
  /** 因授权被关闭的插件；切回已购账号时自动恢复启用 */
  suspendedPluginIds?: string[]
  apps: Record<string, MarketLicenseEntry>
}

export type InstalledPackRef = {
  identifier: string
  kind: 'plugin' | 'theme'
  /** 内置包不参与正版校验 */
  builtin?: boolean
}

function defaultPath(dataRoot: string): string {
  return join(dataRoot, 'market-licenses.json')
}

export function loadMarketLicenses(dataRoot: string): MarketLicenseFile {
  const p = defaultPath(dataRoot)
  if (!existsSync(p)) return { version: 1, apps: {} }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<MarketLicenseFile>
    const apps: Record<string, MarketLicenseEntry> = {}
    if (raw.apps && typeof raw.apps === 'object') {
      for (const [id, v] of Object.entries(raw.apps)) {
        if (!v || typeof v !== 'object') continue
        const key = String((v as MarketLicenseEntry).licenseKey || '').trim()
        if (!key) continue
        apps[id] = {
          licenseKey: key,
          kind: (v as MarketLicenseEntry).kind === 'theme' ? 'theme' : 'plugin',
          updatedAt: (v as MarketLicenseEntry).updatedAt
        }
      }
    }
    return {
      version: 1,
      siteKey: raw.siteKey ? String(raw.siteKey).trim() : undefined,
      deviceId: typeof (raw as { deviceId?: unknown }).deviceId === 'string'
        ? String((raw as { deviceId?: string }).deviceId).trim() || undefined
        : undefined,
      suspendedThemeId:
        typeof (raw as { suspendedThemeId?: unknown }).suspendedThemeId === 'string'
          ? String((raw as { suspendedThemeId?: string }).suspendedThemeId).trim() ||
            undefined
          : undefined,
      suspendedPluginIds: Array.isArray((raw as { suspendedPluginIds?: unknown }).suspendedPluginIds)
        ? [
            ...new Set(
              ((raw as { suspendedPluginIds?: unknown[] }).suspendedPluginIds || [])
                .map((x) => String(x || '').trim())
                .filter(Boolean)
            )
          ]
        : undefined,
      apps
    }
  } catch {
    return { version: 1, apps: {} }
  }
}

export function saveMarketLicenses(dataRoot: string, data: MarketLicenseFile): void {
  const p = defaultPath(dataRoot)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ ...data, version: 1 }, null, 2), 'utf8')
}

export function resolveSiteKey(dataRoot: string): string {
  const file = loadMarketLicenses(dataRoot)
  return String(file.siteKey || process.env.SITE_KEY || '').trim()
}

/** 本机设备 ID：本地文件优先，其次环境变量 */
export function resolveDeviceId(dataRoot: string): string {
  const file = loadMarketLicenses(dataRoot)
  return String(file.deviceId || process.env.MARKET_DEVICE_ID || '').trim()
}

/**
 * 确保本机有稳定 deviceId（首次自动生成并持久化）。
 * 账号切换必须复用同一 ID，否则心跳会 USER_OFFLINE / 授权对不上。
 */
export function ensureDeviceId(dataRoot: string): string {
  const existing = resolveDeviceId(dataRoot)
  if (existing) {
    const file = loadMarketLicenses(dataRoot)
    if (!file.deviceId) setDeviceId(dataRoot, existing)
    return existing
  }
  const id = randomUUID()
  setDeviceId(dataRoot, id)
  return id
}

export function setDeviceId(dataRoot: string, deviceId: string): MarketLicenseFile {
  const file = loadMarketLicenses(dataRoot)
  file.deviceId = String(deviceId || '').trim() || undefined
  saveMarketLicenses(dataRoot, file)
  return file
}

export function setSuspendedThemeId(
  dataRoot: string,
  themeId: string | null | undefined
): MarketLicenseFile {
  const file = loadMarketLicenses(dataRoot)
  const id = String(themeId || '').trim()
  file.suspendedThemeId = id || undefined
  saveMarketLicenses(dataRoot, file)
  return file
}

export function getSuspendedThemeId(dataRoot: string): string {
  return String(loadMarketLicenses(dataRoot).suspendedThemeId || '').trim()
}

export function markPluginLicenseSuspended(dataRoot: string, pluginId: string): void {
  const id = String(pluginId || '').trim()
  if (!id) return
  const file = loadMarketLicenses(dataRoot)
  const set = new Set(file.suspendedPluginIds || [])
  set.add(id)
  file.suspendedPluginIds = [...set]
  saveMarketLicenses(dataRoot, file)
}

export function takePluginLicenseSuspended(dataRoot: string, pluginId: string): boolean {
  const id = String(pluginId || '').trim()
  if (!id) return false
  const file = loadMarketLicenses(dataRoot)
  const set = new Set(file.suspendedPluginIds || [])
  if (!set.has(id)) return false
  set.delete(id)
  file.suspendedPluginIds = set.size ? [...set] : undefined
  saveMarketLicenses(dataRoot, file)
  return true
}

export function setSiteKey(dataRoot: string, siteKey: string): MarketLicenseFile {
  const file = loadMarketLicenses(dataRoot)
  file.siteKey = String(siteKey || '').trim() || undefined
  saveMarketLicenses(dataRoot, file)
  return file
}

export function setAppLicense(
  dataRoot: string,
  identifier: string,
  licenseKey: string,
  kind?: 'plugin' | 'theme'
): MarketLicenseFile {
  const id = String(identifier || '').trim()
  const key = String(licenseKey || '').trim()
  const file = loadMarketLicenses(dataRoot)
  if (!id) return file
  if (!key) {
    delete file.apps[id]
  } else {
    file.apps[id] = {
      licenseKey: key,
      kind: kind === 'theme' ? 'theme' : 'plugin',
      updatedAt: new Date().toISOString()
    }
  }
  saveMarketLicenses(dataRoot, file)
  return file
}

export function getAppLicenseKey(dataRoot: string, identifier: string): string {
  const file = loadMarketLicenses(dataRoot)
  const fromFile = file.apps[identifier]?.licenseKey
  if (fromFile) return fromFile
  const primary = String(process.env.APP_IDENTIFIER || '').trim()
  if (primary && primary === identifier) {
    return String(process.env.LICENSE_KEY || '').trim()
  }
  return ''
}

/**
 * 收集需批量校验的条目：跳过内置；其余由上层按「是否在集市目录」再过滤
 */
export function collectCheckItems(
  _dataRoot: string,
  opts: {
    installed: InstalledPackRef[]
  }
): {
  items: Array<{ appIdentifier: string; type: 'PLUGIN' | 'THEME' }>
  skippedBuiltin: string[]
} {
  const out: Array<{ appIdentifier: string; type: 'PLUGIN' | 'THEME' }> = []
  const seen = new Set<string>()
  const skippedBuiltin: string[] = []

  for (const pack of opts.installed) {
    const id = String(pack.identifier || '').trim()
    if (!id) continue
    if (pack.builtin) {
      skippedBuiltin.push(id)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      appIdentifier: id,
      type: pack.kind === 'theme' ? 'THEME' : 'PLUGIN'
    })
  }

  return { items: out, skippedBuiltin }
}
