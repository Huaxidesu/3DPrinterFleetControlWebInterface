import type { IncomingMessage, ServerResponse } from 'http'
import type { PluginManager } from '../plugin/manager'
import type { ThemeManager } from '../theme/manager'
import {
  enrichPackages,
  fetchBinary,
  getLicenseSoftware,
  getMarketBaseUrl,
  loadMarketCatalog,
  packageDownloadUrls,
  verifySha256,
  type MarketPackageKind
} from '../marketplace/catalog'
import {
  loadMarketLicenses,
  resolveSiteKey,
  resolveDeviceId,
  setAppLicense,
  setSiteKey,
  setDeviceId
} from '../license/licenseStore'
import { createLicenseSideEffects, recheckInstalledLicenses } from '../license/licenseGate'
import { marketHeartbeat, verifyAgainstMarket } from '../license/marketVerify'
import {
  fetchMarketMe,
  getMarketSessionToken,
  marketClaimInstall,
  marketCreatePay,
  marketLogin,
  marketLogout,
  marketPreviewInstall,
  marketRegister
} from '../marketplace/marketAuth'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

export async function handleMarketplaceApi(opts: {
  method: string
  path: string
  req: IncomingMessage
  res: ServerResponse
  sendJson: SendJson
  readBody: ReadBody
  isAdmin: boolean
  dataRoot: string
  getPluginManager: () => PluginManager | null
  getThemeManager: () => ThemeManager | null
}): Promise<boolean> {
  const {
    method,
    path,
    req,
    res,
    sendJson,
    readBody,
    isAdmin,
    dataRoot,
    getPluginManager,
    getThemeManager
  } = opts

  if (!path.startsWith('/api/v1/marketplace')) return false

  if (!isAdmin) {
    sendJson(res, 403, { ok: false, message: '仅管理员可使用应用集市' })
    return true
  }

  const pm = getPluginManager()
  const tm = getThemeManager()
  const marketBase = getMarketBaseUrl()

  const licenseEffects = createLicenseSideEffects({
    dataRoot,
    setPluginAvailable: async (id, available) => {
      if (!pm) return
      await pm.setAvailable(id, available)
    },
    getActiveThemeId: async () => {
      if (!tm) return ''
      try {
        const active = await tm.getActiveUiPayload()
        return active?.packId || ''
      } catch {
        return ''
      }
    },
    setActiveTheme: async (id) => {
      if (!tm) return
      await tm.setActive(id)
    }
  })

  const runLicenseRecheck = async () => {
    const installed = [
      ...(pm
        ? pm.list().map((p) => ({
            identifier: p.identifier,
            kind: 'plugin' as const,
            builtin: false
          }))
        : []),
      ...(tm
        ? tm.list().map((t) => ({
            identifier: t.identifier,
            kind: 'theme' as const,
            builtin: t.builtin === true
          }))
        : [])
    ]
    return recheckInstalledLicenses({
      dataRoot,
      installed,
      onPirate: licenseEffects.onPirate,
      onAllow: licenseEffects.onAllow
    })
  }

  if (method === 'GET' && path === '/api/v1/marketplace/auth/me') {
    const me = await fetchMarketMe(dataRoot)
    sendJson(res, me.ok ? 200 : 502, {
      ok: me.ok,
      loggedIn: me.loggedIn,
      user: me.user,
      marketBase,
      registerUrl: `${marketBase}/register`,
      loginUrl: `${marketBase}/login`,
      message: me.message
    })
    return true
  }

  if (method === 'POST' && path === '/api/v1/marketplace/auth/login') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const result = await marketLogin(dataRoot, {
        account: String(body.account || body.username || body.email || ''),
        password: String(body.password || '')
      })
      let license: Awaited<ReturnType<typeof runLicenseRecheck>> = null
      if (result.ok) {
        try {
          license = await runLicenseRecheck()
        } catch (e) {
          console.warn('[marketplace] 登录后授权复查失败', e)
        }
      }
      sendJson(res, result.ok ? 200 : 400, {
        ok: result.ok,
        user: result.user || null,
        loggedIn: Boolean(result.ok && result.user),
        deviceId: resolveDeviceId(dataRoot) || null,
        ownedApps: license?.ownedApps || [],
        allowUse: license?.allowUse,
        message: result.message
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/marketplace/auth/register') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const result = await marketRegister(dataRoot, {
        username: String(body.username || ''),
        email: String(body.email || ''),
        password: String(body.password || ''),
        displayName: typeof body.displayName === 'string' ? body.displayName : undefined
      })
      let license: Awaited<ReturnType<typeof runLicenseRecheck>> = null
      if (result.ok) {
        try {
          license = await runLicenseRecheck()
        } catch (e) {
          console.warn('[marketplace] 注册后授权复查失败', e)
        }
      }
      sendJson(res, result.ok ? 200 : 400, {
        ok: result.ok,
        user: result.user || null,
        loggedIn: Boolean(result.ok && result.user),
        deviceId: resolveDeviceId(dataRoot) || null,
        ownedApps: license?.ownedApps || [],
        allowUse: license?.allowUse,
        message: result.message
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/marketplace/auth/logout') {
    await marketLogout(dataRoot)
    try {
      await runLicenseRecheck()
    } catch (e) {
      console.warn('[marketplace] 退出后授权复查失败', e)
    }
    sendJson(res, 200, {
      ok: true,
      loggedIn: false,
      user: null,
      deviceId: resolveDeviceId(dataRoot) || null
    })
    return true
  }

  if (method === 'GET' && (path === '/api/v1/marketplace' || path === '/api/v1/marketplace/')) {
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const force = u.searchParams.get('force') === '1'
    const me = await fetchMarketMe(dataRoot)
    if (!me.loggedIn) {
      sendJson(res, 200, {
        ok: true,
        reachable: me.ok,
        message: me.message || '请先注册或登录应用集市账号',
        authRequired: true,
        loggedIn: false,
        user: null,
        marketBase,
        siteKeyConfigured: Boolean(resolveSiteKey(dataRoot)),
        deviceIdConfigured: Boolean(resolveDeviceId(dataRoot)),
        deviceId: resolveDeviceId(dataRoot) || null,
        docsUrl: `${marketBase}/docs`,
        consoleUrl: `${marketBase}/console`,
        registerUrl: `${marketBase}/register`,
        loginUrl: `${marketBase}/login`,
        packages: []
      })
      return true
    }

    const loaded = await loadMarketCatalog(force)
    const plugins = new Map<string, string>()
    const themes = new Map<string, string>()
    if (pm) {
      for (const p of pm.list()) plugins.set(p.identifier, p.version)
    }
    if (tm) {
      for (const t of tm.list()) themes.set(t.identifier, t.version)
    }
    const licFile = loadMarketLicenses(dataRoot)
    const hints = new Map<string, string>()
    for (const [id, e] of Object.entries(licFile.apps)) hints.set(id, e.licenseKey)
    const primary = String(process.env.APP_IDENTIFIER || '').trim()
    const primaryKey = String(process.env.LICENSE_KEY || '').trim()
    if (primary && primaryKey) hints.set(primary, primaryKey)

    const packages = enrichPackages(loaded.catalog, { plugins, themes }, hints)
    sendJson(res, 200, {
      ok: loaded.ok,
      reachable: loaded.reachable,
      message: loaded.message,
      source: loaded.source,
      repo: loaded.catalog.repo || marketBase,
      name: loaded.catalog.name || '应用集市',
      updatedAt: loaded.catalog.updatedAt,
      marketBase,
      siteKeyConfigured: Boolean(resolveSiteKey(dataRoot)),
      software: getLicenseSoftware() || null,
      docsUrl: `${marketBase}/docs`,
      consoleUrl: `${marketBase}/console`,
      registerUrl: `${marketBase}/register`,
      loginUrl: `${marketBase}/login`,
      authRequired: false,
      loggedIn: true,
      user: me.user,
      packages
    })
    return true
  }

  if (method === 'GET' && path === '/api/v1/marketplace/refresh') {
    const me = await fetchMarketMe(dataRoot)
    if (!me.loggedIn) {
      sendJson(res, 401, {
        ok: false,
        authRequired: true,
        message: '请先登录应用集市账号'
      })
      return true
    }
    const loaded = await loadMarketCatalog(true)
    sendJson(res, 200, {
      ok: loaded.ok,
      reachable: loaded.reachable,
      message: loaded.message,
      count: loaded.catalog.packages.length,
      repo: marketBase
    })
    return true
  }

  if (method === 'GET' && path === '/api/v1/marketplace/license') {
    const file = loadMarketLicenses(dataRoot)
    const siteKey = resolveSiteKey(dataRoot)
    const deviceId = resolveDeviceId(dataRoot)
    sendJson(res, 200, {
      ok: true,
      marketBase,
      deviceId: deviceId || null,
      deviceIdConfigured: Boolean(deviceId),
      siteKey: siteKey || null,
      siteKeyConfigured: Boolean(siteKey),
      software: getLicenseSoftware() || null,
      licenseRequired: process.env.LICENSE_REQUIRED === '1',
      licenseEnforce: true,
      apps: Object.fromEntries(
        Object.entries(file.apps).map(([id, e]) => [
          id,
          {
            kind: e.kind || 'plugin',
            updatedAt: e.updatedAt || null,
            licenseKeyHint: e.licenseKey ? `${e.licenseKey.slice(0, 6)}…` : null
          }
        ])
      ),
      docsUrl: `${marketBase}/docs`,
      consoleUrl: `${marketBase}/console`
    })
    return true
  }

  if (method === 'PUT' && path === '/api/v1/marketplace/license') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      if (typeof body.deviceId === 'string') {
        setDeviceId(dataRoot, body.deviceId)
      }
      if (typeof body.siteKey === 'string') {
        setSiteKey(dataRoot, body.siteKey)
      }
      if (typeof body.appIdentifier === 'string' && typeof body.licenseKey === 'string') {
        const kind = body.kind === 'theme' ? 'theme' : 'plugin'
        setAppLicense(dataRoot, body.appIdentifier.trim(), body.licenseKey.trim(), kind)
      }
      if (body.apps && typeof body.apps === 'object') {
        for (const [id, v] of Object.entries(body.apps as Record<string, unknown>)) {
          if (!v || typeof v !== 'object') continue
          const row = v as { licenseKey?: string; kind?: string }
          if (typeof row.licenseKey !== 'string') continue
          setAppLicense(
            dataRoot,
            id,
            row.licenseKey,
            row.kind === 'theme' ? 'theme' : 'plugin'
          )
        }
      }
      sendJson(res, 200, {
        ok: true,
        message: '授权配置已保存',
        siteKeyConfigured: Boolean(resolveSiteKey(dataRoot)),
        deviceIdConfigured: Boolean(resolveDeviceId(dataRoot)),
        deviceId: resolveDeviceId(dataRoot) || null,
        apps: loadMarketLicenses(dataRoot).apps
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/marketplace/license/heartbeat') {
    try {
      const deviceId = resolveDeviceId(dataRoot)
      if (!deviceId) {
        sendJson(res, 400, {
          ok: false,
          allowUse: false,
          code: 'MISSING_DEVICE',
          message: '缺少 MARKET_DEVICE_ID'
        })
        return true
      }
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const appIdentifier =
        typeof body.appIdentifier === 'string' ? body.appIdentifier.trim() : undefined
      const result = await marketHeartbeat({ marketBase, deviceId, appIdentifier })
      sendJson(res, result.allowUse ? 200 : 403, {
        ok: result.ok && result.allowUse,
        allowUse: result.allowUse,
        genuine: result.allowUse,
        code: result.code,
        message: result.message,
        user: result.user,
        ownedApps: result.ownedApps,
        nextHeartbeatSec: result.nextHeartbeatSec
      })
    } catch (e) {
      sendJson(res, 502, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/marketplace/license/verify') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const appIdentifier = String(body.appIdentifier || '').trim()
      const deviceId = String(body.deviceId || resolveDeviceId(dataRoot) || '').trim()
      if (!appIdentifier || !deviceId) {
        sendJson(res, 400, {
          ok: false,
          message: '需要 appIdentifier / deviceId'
        })
        return true
      }
      const result = await verifyAgainstMarket({
        marketBase,
        appIdentifier,
        deviceId
      })
      if (result.allowUse && body.persist !== false) {
        setDeviceId(dataRoot, deviceId)
      }
      sendJson(res, result.allowUse ? 200 : 403, {
        ok: result.ok && result.allowUse,
        genuine: result.allowUse,
        allowUse: result.allowUse,
        code: result.code,
        message: result.message,
        user: result.user,
        ownedApps: result.ownedApps,
        raw: result.raw
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/marketplace/license/check-installed') {
    try {
      const result = await runLicenseRecheck()
      sendJson(res, 200, { ok: true, data: result })
    } catch (e) {
      sendJson(res, 502, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  const resolveMarketPkg = async (body: Record<string, unknown>) => {
    const kind = (body.kind === 'theme' ? 'theme' : body.kind === 'plugin' ? 'plugin' : null) as
      | MarketPackageKind
      | null
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : ''
    if (!kind || !identifier) {
      return { error: { status: 400, body: { ok: false, message: '缺少 kind / identifier' } } }
    }
    const loaded = await loadMarketCatalog(false)
    if (!loaded.reachable) {
      return {
        error: {
          status: 502,
          body: { ok: false, reachable: false, message: loaded.message }
        }
      }
    }
    const pkg = loaded.catalog.packages.find((p) => p.kind === kind && p.identifier === identifier)
    if (!pkg) {
      return {
        error: {
          status: 404,
          body: { ok: false, message: `市场中未找到 ${kind}:${identifier}` }
        }
      }
    }
    const appId = String(pkg.appId || '').trim()
    if (!appId) {
      return {
        error: {
          status: 502,
          body: { ok: false, message: '目录缺少 appId，无法向集市领取安装授权' }
        }
      }
    }
    return { kind, identifier, pkg, appId }
  }

  /** 创建收费订单并返回付款二维码（监控台弹窗用） */
  if (method === 'POST' && path === '/api/v1/marketplace/pay/create') {
    try {
      const me = await fetchMarketMe(dataRoot)
      if (!me.loggedIn) {
        sendJson(res, 401, {
          ok: false,
          authRequired: true,
          message: '请先注册或登录应用集市账号后再购买'
        })
        return true
      }
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const resolved = await resolveMarketPkg(body)
      if ('error' in resolved && resolved.error) {
        sendJson(res, resolved.error.status, resolved.error.body)
        return true
      }
      const { appId, kind, identifier, pkg } = resolved as {
        appId: string
        kind: MarketPackageKind
        identifier: string
        pkg: { name?: string; price?: number; pricingType?: string }
      }

      const preview = await marketPreviewInstall(dataRoot, { appId })
      if (!preview.ok) {
        sendJson(res, preview.code === 'AUTH_REQUIRED' ? 401 : 403, {
          ok: false,
          code: preview.code,
          message: preview.message
        })
        return true
      }
      if (preview.alreadyOwned || !preview.needPay) {
        sendJson(res, 200, {
          ok: true,
          needPay: false,
          alreadyOwned: Boolean(preview.alreadyOwned),
          kind,
          identifier,
          name: pkg.name,
          amount: preview.amount ?? 0,
          message: preview.message
        })
        return true
      }

      const channelRaw = String(body.payChannel || 'DEMO').toUpperCase()
      const payChannel = (
        ['WECHAT', 'ALIPAY', 'THIRD_PARTY', 'DEMO'].includes(channelRaw) ? channelRaw : 'DEMO'
      ) as 'DEMO' | 'WECHAT' | 'ALIPAY' | 'THIRD_PARTY'
      const pay = await marketCreatePay(dataRoot, { appId, payChannel })
      if (!pay.ok) {
        sendJson(res, 400, { ok: false, code: pay.code, message: pay.message })
        return true
      }
      sendJson(res, 200, {
        ok: true,
        needPay: true,
        kind,
        identifier,
        name: pkg.name,
        amount: pay.amount ?? pkg.price,
        pricingType: pkg.pricingType,
        orderId: pay.orderId,
        qrDataUrl: pay.qrDataUrl,
        tip: pay.tip,
        mode: pay.mode,
        payChannel: pay.payChannel,
        channels: pay.channels,
        message: pay.message
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/marketplace/install') {
    try {
      const me = await fetchMarketMe(dataRoot)
      if (!me.loggedIn) {
        sendJson(res, 401, {
          ok: false,
          authRequired: true,
          message: '请先注册或登录应用集市账号后再安装'
        })
        return true
      }
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const resolved = await resolveMarketPkg(body)
      if ('error' in resolved && resolved.error) {
        sendJson(res, resolved.error.status, resolved.error.body)
        return true
      }
      const { kind, identifier, pkg, appId } = resolved as {
        kind: MarketPackageKind
        identifier: string
        pkg: { path?: string; sha256?: string; name?: string }
        appId: string
      }
      if (kind === 'plugin' && !pm) {
        sendJson(res, 503, { ok: false, message: '插件系统未启动' })
        return true
      }
      if (kind === 'theme' && !tm) {
        sendJson(res, 503, { ok: false, message: '主题系统未启动' })
        return true
      }

      const orderId =
        typeof body.orderId === 'string' && body.orderId.trim() ? body.orderId.trim() : undefined
      const payConfirmed = body.payConfirmed === true || Boolean(orderId)
      const channelRaw = String(body.payChannel || 'DEMO').toUpperCase()
      const payChannel = (
        ['WECHAT', 'ALIPAY', 'THIRD_PARTY', 'DEMO'].includes(channelRaw) ? channelRaw : 'DEMO'
      ) as 'DEMO' | 'WECHAT' | 'ALIPAY' | 'THIRD_PARTY'

      // 首次安装/购买：收费须先扫码确认（带 orderId）；免费直接签发
      const claim = await marketClaimInstall(dataRoot, {
        appId,
        payChannel,
        orderId,
        autoConfirmDemoPay: false
      })
      if (!claim.ok) {
        sendJson(res, claim.needPay ? 402 : 403, {
          ok: false,
          needPay: Boolean(claim.needPay),
          amount: claim.amount,
          code: claim.code,
          payConfirmed,
          message: claim.message,
          consoleUrl: `${marketBase}/console`
        })
        return true
      }
      if (claim.licenseKey) {
        setAppLicense(dataRoot, identifier, claim.licenseKey, kind)
      }

      const claimedPath = String(claim.packagePath || '').trim()
      const pkgPath = String(pkg.path || '').trim()
      const baseUrls = [
        ...packageDownloadUrls(claimedPath),
        ...(pkgPath ? packageDownloadUrls(pkgPath) : [])
      ]
      const idUrls = [
        `${marketBase}/api/apps/${encodeURIComponent(identifier)}/download`
      ]
      const urls =
        typeof body.url === 'string' && body.url.trim()
          ? [body.url.trim(), ...baseUrls, ...idUrls]
          : [...baseUrls, ...idUrls]
      const sessionCookie = getMarketSessionToken(dataRoot)
      const dl = await fetchBinary(urls, 60_000, { sessionCookie })
      if (!dl.ok) {
        sendJson(res, 502, {
          ok: false,
          reachable: false,
          claimed: true,
          message:
            dl.message +
            '。授权已领取，但下载安装包失败；请确认市场已上传 ZIP 或 packagePath 可访问。'
        })
        return true
      }
      verifySha256(dl.buf, pkg.sha256)

      const claimNote = claim.alreadyOwned
        ? '（已有授权）'
        : claim.free
          ? '（已免费领取授权）'
          : claim.paid
            ? '（已购买并签发授权）'
            : '（已登记授权）'

      if (kind === 'plugin') {
        const st = await pm!.installFromZip(dl.buf)
        sendJson(res, 200, {
          ok: true,
          kind,
          plugin: st,
          downloadedFrom: dl.url,
          claimed: true,
          message: `已安装插件 ${st.name || st.identifier} v${st.version}${claimNote}`
        })
      } else {
        const st = await tm!.installFromZip(dl.buf)
        sendJson(res, 200, {
          ok: true,
          kind,
          theme: st,
          downloadedFrom: dl.url,
          claimed: true,
          message: `已安装主题 ${st.name || st.identifier} v${st.version}${claimNote}`
        })
      }
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  return false
}
