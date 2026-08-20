/**
 * app_launcher — 悬浮本机软件快捷启动
 * 每人 shortcuts 入库（MySQL 优先，否则 JSON）；悬浮图标走软件设置。
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const STORE_FILE = 'shortcuts_by_user.json'
const FAB_FILE = 'fab_icon.json'
const MAX_SHORTCUTS = 40
const MAX_ICON_BYTES = 2 * 1024 * 1024
const MAX_ITEM_ICON_BYTES = 256 * 1024

function boolVar(api, key, def) {
  const v = api.getVar(key, def ? '1' : '0')
  return v === '1' || v === true || v === 'true'
}

function numVar(api, key, def) {
  const n = Number(api.getVar(key, String(def)))
  return Number.isFinite(n) ? n : def
}

function httpJson(status, json) {
  return { __pluginHttp: { status: status || 200, json } }
}

function authUser(ctx) {
  const a = ctx && ctx.auth
  if (a && a.kind === 'user' && a.user && a.user.id) return a.user
  return null
}

function isAdmin(user) {
  return user && String(user.level || '') === 'admin'
}

function nowIso() {
  return new Date().toISOString()
}

/** MySQL DATETIME(3)：不能写 ISO（带 T/Z），否则 strict 模式会报 Incorrect datetime value */
function nowMysql() {
  const d = new Date()
  const pad = function (n, w) {
    return String(n).padStart(w || 2, '0')
  }
  return (
    d.getUTCFullYear() +
    '-' +
    pad(d.getUTCMonth() + 1) +
    '-' +
    pad(d.getUTCDate()) +
    ' ' +
    pad(d.getUTCHours()) +
    ':' +
    pad(d.getUTCMinutes()) +
    ':' +
    pad(d.getUTCSeconds()) +
    '.' +
    pad(d.getUTCMilliseconds(), 3)
  )
}

function newId() {
  return crypto.randomBytes(10).toString('hex')
}

function hostPlatform() {
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'win32') return 'win'
  return 'linux'
}

function normalizePlatform(p) {
  const s = String(p || '')
    .trim()
    .toLowerCase()
  if (s === 'mac' || s === 'darwin' || s === 'osx' || s === 'macos') return 'mac'
  if (s === 'win' || s === 'windows' || s === 'win32') return 'win'
  if (s === 'linux') return 'linux'
  if (s === 'both' || s === 'all') return 'both'
  return 'both'
}

function normalizeOpenMode(m) {
  const s = String(m || '')
    .trim()
    .toLowerCase()
  if (s === 'url' || s === 'http' || s === 'https' || s === 'protocol') return 'url'
  if (s === 'shell' || s === 'cmd' || s === 'command') return 'shell'
  return 'app'
}

function normalizeCorner(c) {
  const s = String(c || '')
    .trim()
    .toLowerCase()
  if (s === 'bl' || s === 'bottom-left' || s === 'left-bottom') return 'bl'
  if (s === 'tr' || s === 'top-right' || s === 'right-top') return 'tr'
  if (s === 'tl' || s === 'top-left' || s === 'left-top') return 'tl'
  return 'br'
}

function sanitizeTitle(t) {
  return String(t || '')
    .trim()
    .slice(0, 80)
}

function sanitizePath(p) {
  return String(p || '')
    .trim()
    .replace(/\0/g, '')
    .slice(0, 1024)
}

function parseDataUrl(dataUrl, maxBytes) {
  const s = String(dataUrl || '')
  const m = /^data:([^;]+);base64,(.+)$/i.exec(s)
  if (!m) return null
  const mime = m[1].toLowerCase()
  if (!/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/.test(mime)) return null
  const buf = Buffer.from(m[2], 'base64')
  const limit = maxBytes || MAX_ICON_BYTES
  if (!buf.length || buf.length > limit) return null
  return { mime, buf, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') }
}

function normalizeShortcut(raw, index) {
  const id = String((raw && raw.id) || newId())
  const title = sanitizeTitle(raw && raw.title) || '未命名'
  const target = sanitizePath(raw && (raw.path || raw.target))
  const openMode = normalizeOpenMode(raw && (raw.openMode || raw.open_mode))
  const platform = normalizePlatform(raw && raw.platform)
  const sortOrder = Number.isFinite(
    Number(raw && raw.sortOrder != null ? raw.sortOrder : raw && raw.sort_order)
  )
    ? Number(raw.sortOrder != null ? raw.sortOrder : raw.sort_order)
    : index
  const enabled = raw && raw.enabled === false ? false : true
  let iconDataUrl = ''
  const iconRaw = raw && (raw.iconDataUrl || raw.icon_data || raw.icon)
  if (iconRaw) {
    const parsed = parseDataUrl(iconRaw, MAX_ITEM_ICON_BYTES)
    if (parsed) iconDataUrl = parsed.dataUrl
  }
  return {
    id,
    title,
    path: target,
    openMode,
    platform,
    sortOrder,
    enabled,
    iconDataUrl
  }
}

function loadJsonStore(api) {
  const raw = api.readJson(STORE_FILE, null)
  return raw && typeof raw === 'object' ? raw : {}
}

function saveJsonStore(api, store) {
  api.writeJson(STORE_FILE, store)
}

function loadFab(api) {
  const raw = api.readJson(FAB_FILE, null)
  if (raw && typeof raw === 'object' && raw.dataUrl) {
    return { dataUrl: String(raw.dataUrl), updatedAt: raw.updatedAt || null }
  }
  return { dataUrl: '', updatedAt: null }
}

function saveFab(api, dataUrl) {
  api.writeJson(FAB_FILE, { dataUrl: String(dataUrl || ''), updatedAt: nowIso() })
}

function defaultFabDataUrl(api) {
  try {
    const p = path.join(api.pluginDir || __dirname, 'fab-default.svg')
    if (fs.existsSync(p)) {
      const svg = fs.readFileSync(p, 'utf8')
      return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
    }
  } catch (_) {
    /* ignore */
  }
  return ''
}

async function ensureTables(api) {
  if (!api.db || !api.db.available) return false
  await api.db.ensureTable(
    'users',
    'user_id VARCHAR(64) PRIMARY KEY, username VARCHAR(128) NOT NULL DEFAULT "", display_name VARCHAR(128) NOT NULL DEFAULT "", shortcut_count INT NOT NULL DEFAULT 0, show_limit INT NOT NULL DEFAULT 0, platform VARCHAR(16) NOT NULL DEFAULT "both", corner VARCHAR(8) NOT NULL DEFAULT "", fab_icon MEDIUMTEXT NULL, updated_at DATETIME(3) NOT NULL, INDEX idx_al_users_updated (updated_at)'
  )
  await api.db.ensureTable(
    'shortcuts',
    'id VARCHAR(32) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, title VARCHAR(128) NOT NULL, path VARCHAR(1024) NOT NULL, open_mode VARCHAR(32) NOT NULL DEFAULT "app", platform VARCHAR(16) NOT NULL DEFAULT "both", sort_order INT NOT NULL DEFAULT 0, enabled TINYINT NOT NULL DEFAULT 1, icon_data MEDIUMTEXT NULL, updated_at DATETIME(3) NOT NULL, INDEX idx_al_sc_user (user_id, sort_order)'
  )
  return true
}

function rowToShortcut(row) {
  return {
    id: String(row.id),
    title: String(row.title || ''),
    path: String(row.path || ''),
    openMode: normalizeOpenMode(row.open_mode || row.openMode),
    platform: normalizePlatform(row.platform),
    sortOrder: Number(row.sort_order != null ? row.sort_order : row.sortOrder) || 0,
    enabled: !(row.enabled === 0 || row.enabled === false || row.enabled === '0'),
    iconDataUrl: String(row.icon_data || row.iconDataUrl || '')
  }
}

async function getUserBundle(api, userId) {
  const uid = String(userId)
  if (api.db && api.db.available) {
    await ensureTables(api)
    const meta = await api.db.getOne('users', { user_id: uid })
    const rows = await api.db.select('shortcuts', {
      where: { user_id: uid },
      orderBy: 'sort_order ASC'
    })
    const shortcuts = (rows || []).map(rowToShortcut)
    return {
      userId: uid,
      username: meta ? String(meta.username || '') : '',
      displayName: meta ? String(meta.display_name || '') : '',
      showLimit: meta ? Number(meta.show_limit) || 0 : 0,
      platform: meta ? normalizePlatform(meta.platform) : 'both',
      corner: meta && meta.corner ? normalizeCorner(meta.corner) : '',
      fabIconDataUrl: meta && meta.fab_icon ? String(meta.fab_icon) : '',
      shortcutCount: shortcuts.length,
      shortcuts,
      storage: 'mysql'
    }
  }
  const store = loadJsonStore(api)
  const row = store[uid]
  if (!row || typeof row !== 'object') {
    return {
      userId: uid,
      username: '',
      displayName: '',
      showLimit: 0,
      platform: 'both',
      corner: '',
      fabIconDataUrl: '',
      shortcutCount: 0,
      shortcuts: [],
      storage: 'json'
    }
  }
  const shortcuts = Array.isArray(row.shortcuts)
    ? row.shortcuts.map((s, i) => normalizeShortcut(s, i))
    : []
  return {
    userId: uid,
    username: String(row.username || ''),
    displayName: String(row.displayName || ''),
    showLimit: Number(row.showLimit) || 0,
    platform: normalizePlatform(row.platform),
    corner: row.corner ? normalizeCorner(row.corner) : '',
    fabIconDataUrl: String(row.fabIconDataUrl || ''),
    shortcutCount: shortcuts.length,
    shortcuts,
    storage: 'json'
  }
}

async function saveUserBundle(api, user, payload) {
  const uid = String(user.id)
  const username = String(user.username || '')
  const displayName = String(user.displayName || user.username || '')
  let list = Array.isArray(payload.shortcuts) ? payload.shortcuts : []
  if (list.length > MAX_SHORTCUTS) list = list.slice(0, MAX_SHORTCUTS)
  const shortcuts = list
    .map((s, i) => normalizeShortcut(s, i))
    .filter((s) => s.path)
  const showLimit = Math.max(0, Math.min(MAX_SHORTCUTS, Number(payload.showLimit) || 0))
  const platform = normalizePlatform(payload.platform || hostPlatform())
  const corner =
    payload.corner === '' || payload.corner == null
      ? ''
      : normalizeCorner(payload.corner)
  let fabIconDataUrl = ''
  if (payload.clearFabIcon) {
    fabIconDataUrl = ''
  } else if (payload.fabIconDataUrl) {
    const parsed = parseDataUrl(payload.fabIconDataUrl, MAX_ICON_BYTES)
    if (!parsed) throw new Error('个人悬浮图标无效（PNG/JPEG/GIF/WebP/SVG，≤2MB）')
    fabIconDataUrl = parsed.dataUrl
  } else if (payload.keepFabIcon !== false) {
    const prev = await getUserBundle(api, uid)
    fabIconDataUrl = prev.fabIconDataUrl || ''
  }
  const updatedAtIso = nowIso()
  const updatedAtSql = nowMysql()

  if (api.db && api.db.available) {
    await ensureTables(api)
    await api.db.remove('shortcuts', { user_id: uid })
    for (let i = 0; i < shortcuts.length; i++) {
      const s = shortcuts[i]
      await api.db.insert('shortcuts', {
        id: s.id,
        user_id: uid,
        title: s.title,
        path: s.path,
        open_mode: s.openMode,
        platform: s.platform,
        sort_order: s.sortOrder != null ? s.sortOrder : i,
        enabled: s.enabled ? 1 : 0,
        icon_data: s.iconDataUrl || null,
        updated_at: updatedAtSql
      })
    }
    await api.db.upsert(
      'users',
      {
        user_id: uid,
        username,
        display_name: displayName,
        shortcut_count: shortcuts.length,
        show_limit: showLimit,
        platform,
        corner,
        fab_icon: fabIconDataUrl || null,
        updated_at: updatedAtSql
      },
      ['user_id']
    )
    return {
      userId: uid,
      username,
      displayName,
      showLimit,
      platform,
      corner,
      fabIconDataUrl,
      shortcutCount: shortcuts.length,
      shortcuts,
      storage: 'mysql'
    }
  }

  const store = loadJsonStore(api)
  store[uid] = {
    userId: uid,
    username,
    displayName,
    showLimit,
    platform,
    corner,
    fabIconDataUrl,
    shortcutCount: shortcuts.length,
    shortcuts,
    updatedAt: updatedAtIso
  }
  saveJsonStore(api, store)
  return {
    userId: uid,
    username,
    displayName,
    showLimit,
    platform,
    corner,
    fabIconDataUrl,
    shortcutCount: shortcuts.length,
    shortcuts,
    storage: 'json'
  }
}

async function listAllUsers(api) {
  if (api.db && api.db.available) {
    await ensureTables(api)
    const rows = await api.db.select('users', { orderBy: 'updated_at DESC', limit: 500 })
    return (rows || []).map((r) => ({
      userId: String(r.user_id),
      username: String(r.username || ''),
      displayName: String(r.display_name || ''),
      shortcutCount: Number(r.shortcut_count) || 0,
      showLimit: Number(r.show_limit) || 0,
      platform: normalizePlatform(r.platform),
      corner: r.corner ? normalizeCorner(r.corner) : '',
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null
    }))
  }
  const store = loadJsonStore(api)
  return Object.keys(store)
    .map((uid) => {
      const r = store[uid] || {}
      return {
        userId: uid,
        username: String(r.username || ''),
        displayName: String(r.displayName || ''),
        shortcutCount: Array.isArray(r.shortcuts) ? r.shortcuts.length : Number(r.shortcutCount) || 0,
        showLimit: Number(r.showLimit) || 0,
        platform: normalizePlatform(r.platform),
        corner: r.corner ? normalizeCorner(r.corner) : '',
        updatedAt: r.updatedAt || null
      }
    })
    .sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    })
}

function resolveFabIcon(api, bundle) {
  const cfgAllow = boolVar(api, 'allow_user_fab', true)
  if (cfgAllow && bundle && bundle.fabIconDataUrl) return bundle.fabIconDataUrl
  const fab = loadFab(api)
  return fab.dataUrl || defaultFabDataUrl(api)
}

function publicConfig(api, bundle) {
  const fab = loadFab(api)
  return {
    enabled: boolVar(api, 'enabled', true),
    showLimitDefault: Math.max(0, Math.min(MAX_SHORTCUTS, numVar(api, 'show_limit', 0))),
    fabSize: Math.max(40, Math.min(96, numVar(api, 'fab_size', 56))),
    fabCornerDefault: normalizeCorner(api.getVar('fab_corner', 'br')),
    allowServerOpen: boolVar(api, 'allow_server_open', true),
    allowUserFab: boolVar(api, 'allow_user_fab', true),
    globalFabIconDataUrl: fab.dataUrl || defaultFabDataUrl(api),
    fabIconDataUrl: resolveFabIcon(api, bundle),
    hostPlatform: hostPlatform(),
    db: Boolean(api.db && api.db.available),
    agentPort: 18791,
    agentDownloads: {
      win: '/api/v1/plugins/app_launcher/static/agent/HanyeLauncher-windows.zip',
      mac: '/api/v1/plugins/app_launcher/static/agent/HanyeLauncher-mac.zip'
    }
  }
}

function pathLooksWindows(p) {
  const t = String(p || '')
  return /^[A-Za-z]:[\\/]/.test(t) || /\\/.test(t)
}

function pathLooksMacApp(p) {
  const t = String(p || '')
  return t.indexOf('/Applications/') === 0 || /\.app\/?$/i.test(t)
}

function launchOnHost(target, openMode) {
  const mode = normalizeOpenMode(openMode)
  const t = sanitizePath(target)
  if (!t) throw new Error('缺少路径')

  if (mode === 'url') {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) throw new Error('URL / 协议不合法')
  } else if (mode === 'shell') {
    throw new Error('出于安全，已禁用任意 shell 命令；请用「应用路径」或「URL/协议」')
  } else if (/[\r\n"]/.test(t)) {
    throw new Error('路径非法')
  }

  // Web 服务在服务器本机启动；远程 Docker / 跨系统必然失败，直接说清
  if (mode === 'app') {
    if (pathLooksWindows(t) && process.platform !== 'win32') {
      throw new Error(
        '监控台服务跑在 ' +
          hostPlatform() +
          '，无法打开 Windows 路径。请把监控台装在这台 Windows 电脑上运行（不要用远程 NAS/Docker 浏览器访问），路径：' +
          t
      )
    }
    if (pathLooksMacApp(t) && process.platform !== 'darwin') {
      throw new Error(
        '监控台服务跑在 ' + hostPlatform() + '，无法打开 macOS 应用路径：' + t
      )
    }
    if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        if (!fs.existsSync(t)) {
          throw new Error('找不到文件（请确认路径，含空格也要完整）：' + t)
        }
      } catch (e) {
        if (e && e.message && String(e.message).indexOf('找不到') === 0) throw e
        /* existsSync 在个别环境可能抛错，忽略继续尝试启动 */
      }
    }
  }

  return new Promise(function (resolve, reject) {
    let child
    try {
      if (process.platform === 'darwin') {
        child = spawn('open', mode === 'url' ? [t] : [t], {
          detached: true,
          stdio: 'ignore'
        })
      } else if (process.platform === 'win32') {
        if (mode === 'url') {
          // start 的第一个引号参数是窗口标题，必须留空标题再跟目标
          child = spawn('cmd.exe', ['/c', 'start', '', t], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })
        } else {
          // 直接 spawn exe：可正确处理 Program Files 空格；勿走 start 拆词
          child = spawn(t, [], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          })
        }
      } else {
        child = spawn(mode === 'url' ? 'xdg-open' : t, mode === 'url' ? [t] : [], {
          detached: true,
          stdio: 'ignore'
        })
      }
      child.on('error', function (err) {
        reject(err || new Error('启动失败'))
      })
      // 给进程一点时间把 ENOENT 等错误抛出来
      setTimeout(function () {
        try {
          child.unref()
        } catch (_) {}
        resolve({ ok: true, hostPlatform: hostPlatform() })
      }, 80)
    } catch (e) {
      reject(e)
    }
  })
}

function shortcutMatchesClient(sc, clientPlatform) {
  const p = normalizePlatform(sc.platform)
  if (p === 'both') return true
  const c = normalizePlatform(clientPlatform)
  return p === c
}

const AGENT_PORT = 18791
const pendingJobs = []

function loadPairs(api) {
  const raw = api.readJson('agent_pairs.json', null)
  return raw && typeof raw === 'object' ? raw : {}
}

function savePairs(api, store) {
  api.writeJson('agent_pairs.json', store)
}

function pairRecordFor(api, user) {
  const store = loadPairs(api)
  const uid = String(user.id)
  if (store[uid] && store[uid].token) {
    store[uid].username = String(user.username || store[uid].username || '')
    savePairs(api, store)
    return store[uid]
  }
  const rec = {
    token: crypto.randomBytes(24).toString('hex'),
    username: String(user.username || ''),
    createdAt: nowIso()
  }
  store[uid] = rec
  savePairs(api, store)
  return rec
}

function findUserIdByToken(api, token) {
  const t = String(token || '').trim()
  if (!t) return null
  const store = loadPairs(api)
  for (const uid of Object.keys(store)) {
    if (store[uid] && store[uid].token === t) return uid
  }
  return null
}

function pruneJobs() {
  const now = Date.now()
  for (let i = pendingJobs.length - 1; i >= 0; i--) {
    if (!pendingJobs[i] || pendingJobs[i].expiresAt < now) pendingJobs.splice(i, 1)
  }
}

function enqueueJob(userId, token, sc) {
  pruneJobs()
  const job = {
    id: newId(),
    userId: String(userId),
    pairToken: String(token),
    path: sc.path,
    openMode: sc.openMode,
    title: sc.title,
    expiresAt: Date.now() + 60 * 1000
  }
  pendingJobs.push(job)
  return job
}

function takeJobsForUser(userId) {
  pruneJobs()
  const uid = String(userId)
  const out = []
  for (let i = pendingJobs.length - 1; i >= 0; i--) {
    if (String(pendingJobs[i].userId) === uid) {
      out.push(pendingJobs[i])
      pendingJobs.splice(i, 1)
    }
  }
  return out.reverse()
}

async function resolveOwnedShortcut(api, user, body) {
  const bundle = await getUserBundle(api, user.id)
  let sc = null
  if (body && body.id) {
    sc = (bundle.shortcuts || []).find((s) => String(s.id) === String(body.id))
  }
  return sc
}

async function register(api) {
  try {
    await ensureTables(api)
  } catch (e) {
    api.log('[app_launcher] ensureTables ' + (e && e.message ? e.message : e))
  }

  api.registerRoute('GET', '/api/v1/app-launcher/config', async (req) => {
    const user = authUser(req)
    if (!user) return httpJson(401, { ok: false, message: '请先登录' })
    const bundle = await getUserBundle(api, user.id)
    return { ok: true, config: publicConfig(api, bundle) }
  })

  api.registerRoute('POST', '/api/v1/app-launcher/fab-icon', async (req) => {
    const user = authUser(req)
    if (!user || !isAdmin(user)) return httpJson(403, { ok: false, message: '需要管理员' })
    const body = (req && req.body) || {}
    if (body.clear) {
      saveFab(api, '')
      const bundle = await getUserBundle(api, user.id)
      return { ok: true, config: publicConfig(api, bundle) }
    }
    const parsed = parseDataUrl(body.dataUrl || body.icon, MAX_ICON_BYTES)
    if (!parsed) return httpJson(400, { ok: false, message: '请上传 PNG/JPEG/GIF/WebP/SVG（≤2MB）' })
    saveFab(api, parsed.dataUrl)
    const bundle = await getUserBundle(api, user.id)
    return { ok: true, config: publicConfig(api, bundle) }
  })

  api.registerRoute('GET', '/api/v1/app-launcher/me', async (req) => {
    const user = authUser(req)
    if (!user) return httpJson(401, { ok: false, message: '请先登录' })
    const bundle = await getUserBundle(api, user.id)
    const cfg = publicConfig(api, bundle)
    const effectiveLimit = bundle.showLimit > 0 ? bundle.showLimit : cfg.showLimitDefault
    const effectiveCorner = bundle.corner || cfg.fabCornerDefault
    return {
      ok: true,
      config: cfg,
      me: Object.assign({}, bundle, {
        username: bundle.username || user.username || '',
        displayName: bundle.displayName || user.displayName || user.username || '',
        level: user.level || '',
        isAdmin: isAdmin(user),
        effectiveShowLimit: effectiveLimit,
        effectiveCorner: effectiveCorner
      })
    }
  })

  api.registerRoute('PUT', '/api/v1/app-launcher/me', async (req) => {
    const user = authUser(req)
    if (!user) return httpJson(401, { ok: false, message: '请先登录' })
    const body = (req && req.body) || {}
    if (body.fabIconDataUrl && !boolVar(api, 'allow_user_fab', true) && !isAdmin(user)) {
      return httpJson(403, { ok: false, message: '管理员已禁止自定义悬浮图标' })
    }
    try {
      const saved = await saveUserBundle(api, user, body)
      return { ok: true, me: saved, config: publicConfig(api, saved) }
    } catch (e) {
      return httpJson(400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
  })

  api.registerRoute('POST', '/api/v1/app-launcher/open', async (req) => {
    const user = authUser(req)
    if (!user) return httpJson(401, { ok: false, message: '请先登录' })
    const body = (req && req.body) || {}
    const sc = await resolveOwnedShortcut(api, user, body)
    if (!sc) {
      return httpJson(404, { ok: false, message: '快捷方式不存在或不属于当前用户' })
    }
    if (!sc.enabled) return httpJson(400, { ok: false, message: '该快捷方式已禁用' })
    const rec = pairRecordFor(api, user)
    const job = enqueueJob(user.id, rec.token, sc)
    // 优先交给已绑定该用户的本机助手；同机部署时才尝试服务端打开
    if (body.preferAgent !== false) {
      return {
        ok: true,
        queued: true,
        via: 'agent',
        jobId: job.id,
        hint: '已发给本机助手。若未安装，请到设置页下载。'
      }
    }
    if (!boolVar(api, 'allow_server_open', true)) {
      return { ok: true, queued: true, via: 'agent', jobId: job.id }
    }
    try {
      const result = await launchOnHost(sc.path, sc.openMode)
      return { ok: true, opened: sc, host: result, via: 'server' }
    } catch (e) {
      return {
        ok: true,
        queued: true,
        via: 'agent',
        jobId: job.id,
        message: e instanceof Error ? e.message : String(e)
      }
    }
  })

  api.registerRoute('GET', '/api/v1/app-launcher/agent/credentials', async (req) => {
    const user = authUser(req)
    if (!user) return httpJson(401, { ok: false, message: '请先登录' })
    const rec = pairRecordFor(api, user)
    return {
      ok: true,
      userId: String(user.id),
      username: String(user.username || ''),
      displayName: String(user.displayName || user.username || ''),
      pairToken: rec.token,
      agentPort: AGENT_PORT
    }
  })

  api.registerRoute(
    'GET',
    '/api/v1/app-launcher/agent/pull',
    async (req) => {
      const token = String((req.query && req.query.token) || '').trim()
      const uid = findUserIdByToken(api, token)
      if (!uid) return httpJson(403, { ok: false, message: '无效助手令牌' })
      const jobs = takeJobsForUser(uid)
      return { ok: true, jobs: jobs }
    },
    { public: true }
  )

  api.registerRoute('GET', '/api/v1/app-launcher/admin/users', async (req) => {
    const user = authUser(req)
    if (!user || !isAdmin(user)) return httpJson(403, { ok: false, message: '需要管理员' })
    const users = await listAllUsers(api)
    return { ok: true, users, storage: api.db && api.db.available ? 'mysql' : 'json' }
  })

  api.log('[app_launcher] routes ready (' + hostPlatform() + ')')
}

module.exports = { register }
