/**
 * 应用集市账号会话（代理市场 /api/auth/*，本地持久化 am_session）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getMarketBaseUrl, getMarketDesktopSecret, resolveMarketBaseUrl } from './catalog'
import { ensureDeviceId, setDeviceId } from '../license/licenseStore'

export type MarketUser = {
  id: string
  email: string
  username: string
  role: string
  displayName?: string
  deviceId?: string
  tip?: string
}

type MarketAuthFile = {
  version: 1
  sessionToken?: string
  user?: MarketUser | null
  updatedAt?: string
}

function authPath(dataRoot: string): string {
  return join(dataRoot, 'market-auth.json')
}

export function loadMarketAuth(dataRoot: string): MarketAuthFile {
  const p = authPath(dataRoot)
  if (!existsSync(p)) return { version: 1 }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<MarketAuthFile>
    const token = String(raw.sessionToken || '').trim()
    return {
      version: 1,
      sessionToken: token || undefined,
      user: raw.user && typeof raw.user === 'object' ? (raw.user as MarketUser) : null,
      updatedAt: raw.updatedAt
    }
  } catch {
    return { version: 1 }
  }
}

export function saveMarketAuth(dataRoot: string, data: MarketAuthFile): void {
  const p = authPath(dataRoot)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ ...data, version: 1 }, null, 2), 'utf8')
}

export function getMarketSessionToken(dataRoot: string): string {
  return String(loadMarketAuth(dataRoot).sessionToken || '').trim()
}

export function clearMarketSession(dataRoot: string): void {
  saveMarketAuth(dataRoot, { version: 1 })
}

function parseAmSession(setCookie: string | null): string {
  if (!setCookie) return ''
  // 可能多条；取 am_session=
  const parts = setCookie.split(/,(?=[^;]+?=)/)
  for (const part of parts) {
    const m = /(?:^|,)\s*am_session=([^;]*)/i.exec(`,${part}`)
    if (m) return decodeURIComponent(String(m[1] || '').trim())
  }
  const m2 = /am_session=([^;]+)/i.exec(setCookie)
  return m2 ? decodeURIComponent(String(m2[1] || '').trim()) : ''
}

async function marketAuthFetch(
  path: string,
  opts: {
    method?: string
    body?: unknown
    sessionToken?: string
    timeoutMs?: number
    _retried?: boolean
  } = {}
): Promise<{
  status: number
  json: Record<string, unknown>
  sessionTokenFromSetCookie: string
}> {
  await resolveMarketBaseUrl(false)
  const base = getMarketBaseUrl().replace(/\/+$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'hanye-printer-monitor-marketplace'
  }
  const secret = getMarketDesktopSecret()
  if (secret) headers['X-Desktop-Secret'] = secret
  const token = String(opts.sessionToken || '').trim()
  if (token) headers.Cookie = `am_session=${token}`

  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      redirect: 'follow'
    })
    clearTimeout(t)
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      json = { ok: false, error: `市场返回非 JSON（HTTP ${res.status}）` }
    }
    const setCookie =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie().join(',')
        : res.headers.get('set-cookie')
    return {
      status: res.status,
      json,
      sessionTokenFromSetCookie: parseAmSession(setCookie)
    }
  } catch (e) {
    clearTimeout(t)
    // 当前线路失败时强制换线再试一次
    if (!opts._retried) {
      await resolveMarketBaseUrl(true)
      return marketAuthFetch(path, { ...opts, _retried: true, timeoutMs: opts.timeoutMs })
    }
    const msg = e instanceof Error ? e.message : String(e)
    return {
      status: 0,
      json: { ok: false, error: /abort|timeout/i.test(msg) ? '连接应用集市超时' : `无法连接应用集市：${msg}` },
      sessionTokenFromSetCookie: ''
    }
  }
}

function asUser(data: unknown): MarketUser | null {
  if (!data || typeof data !== 'object') return null
  const u = data as Record<string, unknown>
  const id = String(u.id || '').trim()
  const email = String(u.email || '').trim()
  const username = String(u.username || '').trim()
  if (!id || !username) return null
  return {
    id,
    email,
    username,
    role: String(u.role || 'USER'),
    displayName: u.displayName ? String(u.displayName) : username,
    deviceId: u.deviceId ? String(u.deviceId).trim() : undefined,
    tip: u.tip ? String(u.tip) : undefined
  }
}

function persistDeviceId(dataRoot: string, user: MarketUser | null, preferredLocal?: string): void {
  const local = String(preferredLocal || ensureDeviceId(dataRoot)).trim()
  const fromUser = String(user?.deviceId || '').trim()
  // 以市场实际绑定为准（正常应等于本机稳定 ID）；无返回则保留本机 ID
  const bound = fromUser || local
  if (fromUser && local && fromUser !== local) {
    console.warn(
      `[market-auth] 市场绑定 deviceId=${fromUser} 与本机 ${local} 不一致，已同步为本机心跳 ID=${bound}`
    )
  }
  if (bound) setDeviceId(dataRoot, bound)
}

/** 拉取当前登录用户；无效会话则清空本地 */
export async function fetchMarketMe(dataRoot: string): Promise<{
  ok: boolean
  loggedIn: boolean
  user: MarketUser | null
  message?: string
}> {
  const token = getMarketSessionToken(dataRoot)
  if (!token) return { ok: true, loggedIn: false, user: null }
  const r = await marketAuthFetch('/api/auth/me', { sessionToken: token })
  if (r.status === 0) {
    return { ok: false, loggedIn: false, user: null, message: String(r.json.error || '市场不可达') }
  }
  const user = r.json.ok ? asUser(r.json.data) : null
  if (!user) {
    clearMarketSession(dataRoot)
    return { ok: true, loggedIn: false, user: null }
  }
  saveMarketAuth(dataRoot, {
    version: 1,
    sessionToken: token,
    user,
    updatedAt: new Date().toISOString()
  })
  persistDeviceId(dataRoot, user)
  return { ok: true, loggedIn: true, user }
}

export async function marketLogin(
  dataRoot: string,
  input: { account: string; password: string }
): Promise<{ ok: boolean; user?: MarketUser; message?: string }> {
  const account = String(input.account || '').trim()
  const password = String(input.password || '')
  if (!account || !password) return { ok: false, message: '请输入账号和密码' }

  // 本机固定 deviceId：切换账号时复用，市场会踢掉同设备上的其他登录
  const deviceId = ensureDeviceId(dataRoot)
  const r = await marketAuthFetch('/api/auth/login', {
    method: 'POST',
    body: { account, password, deviceId }
  })
  if (r.status === 0) return { ok: false, message: String(r.json.error || '市场不可达') }
  if (!r.json.ok) {
    return { ok: false, message: String(r.json.error || r.json.message || '登录失败') }
  }
  const user = asUser(r.json.data)
  const token = r.sessionTokenFromSetCookie || getMarketSessionToken(dataRoot)
  if (!user || !token) {
    return { ok: false, message: '登录成功但未拿到会话，请检查集市 Cookie 配置' }
  }
  saveMarketAuth(dataRoot, {
    version: 1,
    sessionToken: token,
    user,
    updatedAt: new Date().toISOString()
  })
  persistDeviceId(dataRoot, user, deviceId)
  return { ok: true, user }
}

export async function marketRegister(
  dataRoot: string,
  input: { username: string; email: string; password: string; displayName?: string }
): Promise<{ ok: boolean; user?: MarketUser; message?: string }> {
  const username = String(input.username || '').trim()
  const email = String(input.email || '').trim()
  const password = String(input.password || '')
  const displayName = String(input.displayName || '').trim() || username
  if (username.length < 3) return { ok: false, message: '用户名至少 3 位' }
  if (!email.includes('@')) return { ok: false, message: '邮箱格式不正确' }
  if (password.length < 6) return { ok: false, message: '密码至少 6 位' }

  const deviceId = ensureDeviceId(dataRoot)
  const r = await marketAuthFetch('/api/auth/register', {
    method: 'POST',
    body: { username, email, password, displayName, deviceId }
  })
  if (r.status === 0) return { ok: false, message: String(r.json.error || '市场不可达') }
  if (!r.json.ok) {
    return { ok: false, message: String(r.json.error || r.json.message || '注册失败') }
  }

  // 注册成功后自动登录（同样带稳定 deviceId）
  return marketLogin(dataRoot, { account: username, password })
}

export async function marketLogout(dataRoot: string): Promise<{ ok: boolean; message?: string }> {
  const token = getMarketSessionToken(dataRoot)
  if (token) {
    await marketAuthFetch('/api/auth/logout', { method: 'POST', sessionToken: token }).catch(() => null)
  }
  clearMarketSession(dataRoot)
  // 保留本机 deviceId，便于下次登录绑定同一设备
  return { ok: true }
}

function installPayload(json: Record<string, unknown>): Record<string, unknown> {
  const data = json.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>
  }
  return json
}

function extractLicenseKey(payload: Record<string, unknown>): string {
  const lic = payload.license
  if (lic && typeof lic === 'object' && !Array.isArray(lic)) {
    return String((lic as { licenseKey?: string }).licenseKey || '').trim()
  }
  return String(payload.licenseKey || '').trim()
}

function extractPackagePath(payload: Record<string, unknown>): string {
  const pkg = payload.package
  if (pkg && typeof pkg === 'object' && !Array.isArray(pkg)) {
    return String((pkg as { packagePath?: string }).packagePath || '').trim()
  }
  return String(payload.packagePath || '').trim()
}

function requireInstallUser(dataRoot: string):
  | { ok: true; token: string }
  | { ok: false; message: string; code: string } {
  const token = getMarketSessionToken(dataRoot)
  if (!token) return { ok: false, message: '请先登录应用集市', code: 'AUTH_REQUIRED' }
  const role = String(loadMarketAuth(dataRoot).user?.role || '').trim()
  // 普通用户 + 开发者可安装；自己的插件/主题在市场侧按免费处理
  if (role && role !== 'USER' && role !== 'DEVELOPER') {
    return {
      ok: false,
      message:
        '请使用普通用户或开发者账号登录应用集市后再安装（管理员请另注册账号）。',
      code: 'ROLE_DENIED'
    }
  }
  return { ok: true, token }
}

export type MarketClaimResult =
  | {
      ok: true
      alreadyOwned?: boolean
      free?: boolean
      paid?: boolean
      licenseKey?: string
      packagePath?: string
      message?: string
    }
  | {
      ok: false
      needPay?: boolean
      amount?: number
      message: string
      code?: string
    }

export type MarketPaySessionResult =
  | {
      ok: true
      alreadyOwned?: boolean
      needPay: boolean
      amount?: number
      orderId?: string
      qrDataUrl?: string
      qrPayload?: string
      tip?: string
      mode?: string
      payChannel?: string
      channels?: Record<string, boolean>
      licenseKey?: string
      packagePath?: string
      message?: string
    }
  | {
      ok: false
      message: string
      code?: string
    }

/** 预览安装：是否需付费 / 是否已拥有 */
export async function marketPreviewInstall(
  dataRoot: string,
  opts: { appId: string }
): Promise<MarketPaySessionResult> {
  const appId = String(opts.appId || '').trim()
  if (!appId) return { ok: false, message: '缺少 appId', code: 'MISSING_APP_ID' }
  const auth = requireInstallUser(dataRoot)
  if (!auth.ok) return auth

  const previewRes = await marketAuthFetch('/api/install', {
    method: 'POST',
    sessionToken: auth.token,
    body: { appId, action: 'preview' }
  })
  if (previewRes.status === 0) {
    return { ok: false, message: String(previewRes.json.error || '市场不可达'), code: 'UNREACHABLE' }
  }
  if (!previewRes.json.ok) {
    return {
      ok: false,
      message: String(previewRes.json.error || previewRes.json.message || '预览安装失败'),
      code: 'INSTALL_PREVIEW_FAILED'
    }
  }
  const preview = installPayload(previewRes.json)
  if (preview.alreadyOwned) {
    return {
      ok: true,
      alreadyOwned: true,
      needPay: false,
      licenseKey: extractLicenseKey(preview) || undefined,
      packagePath: extractPackagePath(preview) || undefined,
      message: String(preview.message || '已拥有授权')
    }
  }
  if (preview.needPay) {
    return {
      ok: true,
      needPay: true,
      amount: typeof preview.amount === 'number' ? preview.amount : undefined,
      mode: preview.mode ? String(preview.mode) : undefined,
      channels:
        preview.channels && typeof preview.channels === 'object'
          ? (preview.channels as Record<string, boolean>)
          : undefined,
      message: String(preview.message || '该应用为收费应用，请扫码完成支付后安装')
    }
  }
  return {
    ok: true,
    needPay: false,
    amount: 0,
    message: String(preview.message || '免费应用，确认后即可安装')
  }
}

/** 创建待支付订单并返回付款二维码 */
export async function marketCreatePay(
  dataRoot: string,
  opts: {
    appId: string
    payChannel?: 'DEMO' | 'WECHAT' | 'ALIPAY' | 'THIRD_PARTY'
  }
): Promise<MarketPaySessionResult> {
  const appId = String(opts.appId || '').trim()
  if (!appId) return { ok: false, message: '缺少 appId', code: 'MISSING_APP_ID' }
  const auth = requireInstallUser(dataRoot)
  if (!auth.ok) return auth

  const res = await marketAuthFetch('/api/install', {
    method: 'POST',
    sessionToken: auth.token,
    body: {
      appId,
      action: 'create_pay',
      payChannel: opts.payChannel || 'DEMO'
    }
  })
  if (res.status === 0) {
    return { ok: false, message: String(res.json.error || '市场不可达'), code: 'UNREACHABLE' }
  }
  if (!res.json.ok) {
    return {
      ok: false,
      message: String(res.json.error || res.json.message || '创建支付订单失败'),
      code: 'CREATE_PAY_FAILED'
    }
  }
  const data = installPayload(res.json)
  return {
    ok: true,
    needPay: true,
    alreadyOwned: Boolean(data.alreadyOwned),
    amount: typeof data.amount === 'number' ? data.amount : undefined,
    orderId: data.orderId ? String(data.orderId) : undefined,
    qrDataUrl: data.qrDataUrl ? String(data.qrDataUrl) : undefined,
    qrPayload: data.qrPayload ? String(data.qrPayload) : undefined,
    tip: data.tip ? String(data.tip) : undefined,
    mode: data.mode ? String(data.mode) : undefined,
    payChannel: data.payChannel ? String(data.payChannel) : undefined,
    channels:
      data.channels && typeof data.channels === 'object'
        ? (data.channels as Record<string, boolean>)
        : undefined,
    message: String(data.message || '请扫码支付')
  }
}

/**
 * 首次安装/购买：调用集市 POST /api/install 领取授权（写入 ownedApps）。
 * 不要求事先已在购买列表中；免费直接签发。
 * 付费：传 orderId（或 autoConfirmDemoPay）后 confirm；默认不自动付款。
 */
export async function marketClaimInstall(
  dataRoot: string,
  opts: {
    appId: string
    /** 付费且为演示支付时使用；线上未购则返回 needPay */
    payChannel?: 'DEMO' | 'WECHAT' | 'ALIPAY' | 'THIRD_PARTY'
    /** 已创建的待支付订单；确认付款时一并提交 */
    orderId?: string
    /** 为 true 时：付费应用在演示模式下自动 confirm；默认 false，由前端扫码确认 */
    autoConfirmDemoPay?: boolean
  }
): Promise<MarketClaimResult> {
  const appId = String(opts.appId || '').trim()
  if (!appId) return { ok: false, message: '缺少 appId', code: 'MISSING_APP_ID' }

  const auth = requireInstallUser(dataRoot)
  if (!auth.ok) return auth
  const token = auth.token

  const previewRes = await marketAuthFetch('/api/install', {
    method: 'POST',
    sessionToken: token,
    body: { appId, action: 'preview' }
  })
  if (previewRes.status === 0) {
    return { ok: false, message: String(previewRes.json.error || '市场不可达'), code: 'UNREACHABLE' }
  }
  if (!previewRes.json.ok) {
    return {
      ok: false,
      message: String(previewRes.json.error || previewRes.json.message || '预览安装失败'),
      code: 'INSTALL_PREVIEW_FAILED'
    }
  }

  const preview = installPayload(previewRes.json)
  if (preview.alreadyOwned) {
    return {
      ok: true,
      alreadyOwned: true,
      licenseKey: extractLicenseKey(preview) || undefined,
      packagePath: extractPackagePath(preview) || undefined,
      message: String(preview.message || '已拥有授权')
    }
  }

  if (preview.needPay) {
    const mode = String(preview.mode || '').trim()
    const channels = (preview.channels || {}) as { demo?: boolean }
    const hasOrder = Boolean(String(opts.orderId || '').trim())
    const allowDemoAuto =
      opts.autoConfirmDemoPay === true && (mode === 'demo' || channels.demo === true)
    if (!hasOrder && !allowDemoAuto) {
      return {
        ok: false,
        needPay: true,
        amount: typeof preview.amount === 'number' ? preview.amount : undefined,
        message:
          String(preview.message || '该应用为收费应用，请先扫码完成支付后再安装'),
        code: 'NEED_PAY'
      }
    }
    const confirmRes = await marketAuthFetch('/api/install', {
      method: 'POST',
      sessionToken: token,
      body: {
        appId,
        action: 'confirm',
        orderId: opts.orderId || undefined,
        payChannel: opts.payChannel || 'DEMO'
      }
    })
    if (confirmRes.status === 0) {
      return { ok: false, message: String(confirmRes.json.error || '市场不可达'), code: 'UNREACHABLE' }
    }
    if (!confirmRes.json.ok) {
      return {
        ok: false,
        needPay: true,
        message: String(confirmRes.json.error || confirmRes.json.message || '支付确认失败'),
        code: 'PAY_CONFIRM_FAILED'
      }
    }
    const confirmed = installPayload(confirmRes.json)
    return {
      ok: true,
      paid: true,
      licenseKey: extractLicenseKey(confirmed) || undefined,
      packagePath: extractPackagePath(confirmed) || undefined,
      message: String(confirmed.message || '购买成功，已签发授权')
    }
  }

  // 免费：free_install / confirm 均可签发
  const freeRes = await marketAuthFetch('/api/install', {
    method: 'POST',
    sessionToken: token,
    body: { appId, action: 'free_install' }
  })
  if (freeRes.status === 0) {
    return { ok: false, message: String(freeRes.json.error || '市场不可达'), code: 'UNREACHABLE' }
  }
  if (!freeRes.json.ok) {
    return {
      ok: false,
      message: String(freeRes.json.error || freeRes.json.message || '免费安装领取失败'),
      code: 'FREE_INSTALL_FAILED'
    }
  }
  const freed = installPayload(freeRes.json)
  return {
    ok: true,
    free: true,
    alreadyOwned: Boolean(freed.alreadyOwned),
    licenseKey: extractLicenseKey(freed) || undefined,
    packagePath: extractPackagePath(freed) || undefined,
    message: String(freed.message || '免费安装成功，已签发授权')
  }
}
