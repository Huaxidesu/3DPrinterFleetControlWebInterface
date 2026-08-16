/**
 * 应用集市远程目录：GET {MARKET_BASE}/api/apps
 * 安装包：{MARKET_BASE}{packagePath}（通常 /uploads/xxx.zip）
 */
import { createHash } from 'crypto'

export function getMarketBaseUrl(): string {
  return String(process.env.MARKET_BASE_URL || 'http://103.40.13.103:65256')
    .trim()
    .replace(/\/+$/, '')
}

/** 兼容软件标识；空字符串表示不传 software 字段 */
export function getLicenseSoftware(): string {
  if (Object.prototype.hasOwnProperty.call(process.env, 'LICENSE_SOFTWARE')) {
    return String(process.env.LICENSE_SOFTWARE || '').trim()
  }
  if (Object.prototype.hasOwnProperty.call(process.env, 'MARKET_SOFTWARE')) {
    return String(process.env.MARKET_SOFTWARE || '').trim()
  }
  return 'hanye-printer-monitor'
}

/** 可选：部分桌面版市场下载接口需要 */
export function getMarketDesktopSecret(): string {
  return String(
    process.env.MARKET_DESKTOP_SECRET ||
      process.env.APP_MARKET_DESKTOP_SECRET ||
      'app-market-desktop-please-change-me'
  ).trim()
}

export const MARKET_REPO_URL = () => getMarketBaseUrl()

export type MarketPackageKind = 'plugin' | 'theme'

export type MarketPackage = {
  kind: MarketPackageKind
  identifier: string
  name: string
  version: string
  description?: string
  path: string
  icon?: string
  intro?: string
  size?: number
  sha256?: string
  pricingType?: string
  price?: number
  category?: string
  appId?: string
  compatibleSoftwares?: string[]
  /** 开发者展示名 */
  developerName?: string
  /** 开发者标签（如官方优选） */
  developerTags?: string[]
}

export type MarketCatalog = {
  version: number
  name?: string
  repo?: string
  updatedAt?: string
  layout?: string
  packages: MarketPackage[]
}

export type MarketPackageView = MarketPackage & {
  installed: boolean
  installedVersion: string | null
  updateAvailable: boolean
  downloadUrls: string[]
  iconUrls: string[]
  licensed?: boolean
  licenseKeyHint?: string
}

const CACHE_MS = 10 * 60 * 1000
let cache: { at: number; catalog: MarketCatalog } | null = null

function marketHeaders(extra?: Record<string, string>): Record<string, string> {
  const secret = getMarketDesktopSecret()
  const h: Record<string, string> = {
    'User-Agent': 'hanye-printer-monitor-marketplace',
    Accept: 'application/json, */*',
    ...(extra || {})
  }
  if (secret) {
    h['X-Desktop-Secret'] = secret
  }
  return h
}

function absUrl(pathOrUrl: string): string {
  const p = String(pathOrUrl || '').trim()
  if (!p) return ''
  if (/^https?:\/\//i.test(p)) return p
  const base = getMarketBaseUrl()
  return `${base}${p.startsWith('/') ? '' : '/'}${p}`
}

export function packageDownloadUrls(relPath: string): string[] {
  const p = String(relPath || '').trim()
  if (!p || p.includes('..')) return []
  const url = absUrl(p)
  return url ? [url] : []
}

async function fetchText(
  url: string,
  timeoutMs = 15_000
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: marketHeaders(),
      redirect: 'follow'
    })
    clearTimeout(t)
    if (!res.ok) return { ok: false, message: `HTTP ${res.status} @ ${url}` }
    return { ok: true, text: await res.text() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: /abort|timeout/i.test(msg) ? `超时 ${url}` : `失败 ${url}` }
  }
}

export async function fetchBinary(
  urls: string[],
  timeoutMs = 60_000,
  opts?: { sessionCookie?: string }
): Promise<{ ok: true; buf: Buffer; url: string } | { ok: false; message: string }> {
  const notes: string[] = []
  const sessionCookie = String(opts?.sessionCookie || '').trim()
  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      const headers = marketHeaders({ Accept: 'application/zip,application/octet-stream,*/*' })
      if (sessionCookie) headers.Cookie = `am_session=${sessionCookie}`
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers,
        redirect: 'follow'
      })
      clearTimeout(t)
      if (!res.ok) {
        notes.push(`HTTP ${res.status}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 64) {
        notes.push('文件过小')
        continue
      }
      const head = buf.subarray(0, 24).toString('utf8')
      if (/^\s*<(!DOCTYPE|html)/i.test(head)) {
        notes.push('返回了 HTML 而非 ZIP')
        continue
      }
      if (/^\s*\{/.test(head)) {
        // 可能是 download 元数据 JSON，尝试解析 packagePath 再下一次循环外处理
        try {
          const j = JSON.parse(buf.toString('utf8')) as {
            data?: { packagePath?: string; downloadUrl?: string }
            packagePath?: string
          }
          const next =
            j?.data?.packagePath || j?.data?.downloadUrl || j?.packagePath || ''
          if (next && absUrl(String(next)) && !urls.includes(absUrl(String(next)))) {
            urls.push(absUrl(String(next)))
            notes.push('解析到 packagePath')
            continue
          }
        } catch {
          /* ignore */
        }
        notes.push('返回了 JSON 而非 ZIP')
        continue
      }
      return { ok: true, buf, url }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      notes.push(/abort|timeout/i.test(msg) ? '超时' : '失败')
    }
  }
  return {
    ok: false,
    message: `下载失败：${notes.slice(0, 3).join('；') || '无可用镜像'}`
  }
}

function guessKind(row: Record<string, unknown>): MarketPackageKind {
  const raw = String(row.appType || row.kind || row.type || '').toUpperCase()
  if (raw === 'THEME' || raw === '主题') return 'theme'
  const cat = String(
    (row.category && typeof row.category === 'object'
      ? (row.category as { name?: string; slug?: string }).name ||
        (row.category as { slug?: string }).slug
      : row.category) || ''
  ).toLowerCase()
  if (cat.includes('theme') || cat.includes('主题')) return 'theme'
  return 'plugin'
}

function rowToPackage(row: Record<string, unknown>): MarketPackage | null {
  const identifier = String(row.identifier || row.appIdentifier || '').trim()
  if (!identifier) return null

  const latest =
    row.latestVersion && typeof row.latestVersion === 'object'
      ? (row.latestVersion as Record<string, unknown>)
      : Array.isArray(row.versions) && row.versions[0] && typeof row.versions[0] === 'object'
        ? (row.versions[0] as Record<string, unknown>)
        : null

  const pathRel = String(
    (latest && (latest.packagePath || latest.path || latest.downloadUrl)) ||
      row.packagePath ||
      row.path ||
      row.downloadUrl ||
      ''
  ).trim()
  if (!pathRel || pathRel.includes('..')) return null

  const version = String((latest && latest.version) || row.version || '0.0.0').trim() || '0.0.0'
  const summary = String(row.summary || '').trim()
  const description = String(row.description || summary || '').trim()
  const icon = String(row.iconUrl || row.coverUrl || row.icon || '').trim() || undefined
  const size =
    typeof latest?.fileSize === 'number'
      ? latest.fileSize
      : typeof row.size === 'number'
        ? row.size
        : undefined
  const category =
    row.category && typeof row.category === 'object'
      ? String((row.category as { name?: string }).name || '')
      : typeof row.category === 'string'
        ? row.category
        : undefined
  const softwares = Array.isArray(row.compatibleSoftwares)
    ? row.compatibleSoftwares.map((x) => String(x))
    : undefined

  const developer =
    row.developer && typeof row.developer === 'object' && !Array.isArray(row.developer)
      ? (row.developer as Record<string, unknown>)
      : null
  const developerName = developer
    ? String(developer.displayName || developer.username || '').trim() || undefined
    : undefined
  const rawTags = developer?.tags
  const developerTags = Array.isArray(rawTags)
    ? rawTags.map((t) => String(t).trim()).filter(Boolean)
    : typeof rawTags === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(rawTags) as unknown
            return Array.isArray(parsed)
              ? parsed.map((t) => String(t).trim()).filter(Boolean)
              : rawTags
                  .split(/[,，]/)
                  .map((t) => t.trim())
                  .filter(Boolean)
          } catch {
            return rawTags
              .split(/[,，]/)
              .map((t) => t.trim())
              .filter(Boolean)
          }
        })()
      : undefined

  return {
    kind: guessKind(row),
    identifier,
    name: String(row.name || identifier),
    version,
    description,
    path: pathRel,
    icon: icon && !icon.includes('..') ? icon : undefined,
    intro: summary || undefined,
    size,
    sha256: latest?.sha256 ? String(latest.sha256) : row.sha256 ? String(row.sha256) : undefined,
    pricingType: row.pricingType ? String(row.pricingType) : undefined,
    price: (() => {
      if (typeof row.price === 'number' && Number.isFinite(row.price)) return row.price
      const n = Number(row.price)
      return Number.isFinite(n) ? n : undefined
    })(),
    category: category || undefined,
    appId: row.id ? String(row.id) : undefined,
    compatibleSoftwares: softwares,
    developerName,
    developerTags: developerTags?.length ? developerTags : undefined
  }
}

function normalizeAppsPayload(raw: unknown): MarketCatalog {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const list = Array.isArray(o.data)
    ? o.data
    : Array.isArray(o.packages)
      ? o.packages
      : Array.isArray(o)
        ? o
        : []
  const packages: MarketPackage[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const status = String((row as Record<string, unknown>).status || 'APPROVED').toUpperCase()
    if (status && status !== 'APPROVED' && status !== 'PUBLISHED') continue
    const pkg = rowToPackage(row as Record<string, unknown>)
    if (pkg) packages.push(pkg)
  }
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    name: o.name ? String(o.name) : '应用集市',
    repo: getMarketBaseUrl(),
    updatedAt: o.updatedAt ? String(o.updatedAt) : new Date().toISOString(),
    layout: 'app-market:/api/apps',
    packages
  }
}

export async function loadMarketCatalog(force = false): Promise<{
  ok: boolean
  reachable: boolean
  catalog: MarketCatalog
  source?: string
  message: string
}> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return {
      ok: true,
      reachable: true,
      catalog: cache.catalog,
      source: 'cache',
      message: 'ok'
    }
  }
  if (force) cache = null

  const base = getMarketBaseUrl()
  const bust = `t=${Date.now()}`
  const notes: string[] = []
  const urls = [`${base}/api/apps?${bust}`]

  for (const url of urls) {
    const r = await fetchText(url)
    if (!r.ok) {
      notes.push(r.message)
      continue
    }
    try {
      const catalog = normalizeAppsPayload(JSON.parse(r.text))
      if (!catalog.packages.length) {
        notes.push('目录为空')
        continue
      }
      cache = { at: Date.now(), catalog }
      return {
        ok: true,
        reachable: true,
        catalog,
        source: url,
        message: 'ok'
      }
    } catch {
      notes.push('目录解析失败')
    }
  }

  return {
    ok: false,
    reachable: false,
    catalog: { version: 1, packages: [], name: '应用集市', repo: getMarketBaseUrl() },
    message: notes.slice(0, 2).join('；') || `无法读取应用集市（${getMarketBaseUrl()}）`
  }
}

function compareVersions(a: string, b: string): number {
  const pa = String(a || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10))
  const pb = String(b || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10))
  const n = Math.max(pa.length, pb.length, 1)
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(pa[i]!) ? pa[i]! : 0
    const y = Number.isFinite(pb[i]!) ? pb[i]! : 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

export function enrichPackages(
  catalog: MarketCatalog,
  installed: { plugins: Map<string, string>; themes: Map<string, string> },
  licenseHints?: Map<string, string>
): MarketPackageView[] {
  return catalog.packages.map((p) => {
    const map = p.kind === 'plugin' ? installed.plugins : installed.themes
    let installedVersion: string | null = map.get(p.identifier) || null
    if (!installedVersion) {
      for (const [k, v] of map.entries()) {
        if (k.toLowerCase() === p.identifier.toLowerCase()) {
          installedVersion = v
          break
        }
      }
    }
    const installedOk = Boolean(installedVersion)
    const marketVer = String(p.version || '').trim()
    const localVer = String(installedVersion || '').trim()
    const updateAvailable =
      installedOk && marketVer ? compareVersions(marketVer, localVer || '0') > 0 : false
    const iconPath = p.icon
    const lic = licenseHints?.get(p.identifier)
    return {
      ...p,
      version: marketVer || p.version,
      icon: iconPath,
      installed: installedOk,
      installedVersion: localVer || null,
      updateAvailable,
      downloadUrls: packageDownloadUrls(p.path),
      iconUrls: iconPath ? packageDownloadUrls(iconPath) : [],
      licensed: Boolean(lic),
      licenseKeyHint: lic ? `${lic.slice(0, 6)}…` : undefined
    }
  })
}

export function verifySha256(buf: Buffer, expect?: string): void {
  if (!expect || !expect.trim()) return
  const dig = createHash('sha256').update(buf).digest('hex')
  if (dig.toLowerCase() !== expect.trim().toLowerCase()) {
    throw new Error(`sha256 校验失败（期望 ${expect.trim()}，实际 ${dig}）`)
  }
}
