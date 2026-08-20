/**
 * farm_dispatch — 巡查手机端 + 审核 PC + 提交申请 + 智能派单 + 开打拦截
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const PERM = {
  patrol: 'plugin.farm_dispatch.patrol',
  audit: 'plugin.farm_dispatch.audit',
  submit: 'plugin.farm_dispatch.submit',
  logs: 'plugin.farm_dispatch.logs'
}

const GROUP_DEFS = [
  {
    id: 'farm_patrol',
    name: '巡查',
    description: '巡查看板：报错/完成确认、空闲/维修、绑定耗材',
    permissions: [PERM.patrol, 'device.view', 'filament.view', 'filament.bind', 'filament.unbind'],
    moduleAccess: [{ pluginId: 'farm_dispatch', module: 'patrol' }]
  },
  {
    id: 'farm_audit',
    name: '审核',
    description: '派单审核',
    permissions: [PERM.audit, 'device.view'],
    moduleAccess: [{ pluginId: 'farm_dispatch', module: 'audit' }]
  },
  {
    id: 'farm_submit',
    name: '派单申请',
    description: '提交打印文件申请（机型/材料/颜色）',
    permissions: [PERM.submit],
    moduleAccess: [{ pluginId: 'farm_dispatch', module: 'submit' }]
  }
]

function boolVar(api, key, def) {
  const v = api.getVar(key, def ? '1' : '0')
  return v === '1' || v === true || v === 'true'
}

function numVar(api, key, def) {
  const n = Number(api.getVar(key, String(def)))
  return Number.isFinite(n) ? n : def
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return crypto.randomBytes(10).toString('hex')
}

function httpHtml(status, html) {
  return {
    __pluginHttp: {
      status: status || 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: String(html)
    }
  }
}

function httpJson(status, json) {
  return { __pluginHttp: { status: status || 200, json } }
}

function authUser(ctx) {
  const a = ctx && ctx.auth
  if (a && a.kind === 'user' && a.user && a.user.id) return a.user
  return null
}

function authHeader(ctx) {
  const h = (ctx && ctx.headers) || {}
  return h.authorization || h.Authorization || ''
}

function userPerms(user) {
  const set = new Set()
  if (!user) return set
  if (String(user.level || '') === 'admin') {
    set.add('*')
    return set
  }
  for (const p of user.permissions || []) set.add(String(p))
  for (const p of user.effectivePermissions || []) set.add(String(p))
  return set
}

function hasPerm(user, code) {
  if (!user) return false
  const set = userPerms(user)
  return set.has('*') || set.has(code)
}

function isAdmin(user) {
  return user && String(user.level || '') === 'admin'
}

function requireRole(user, roleKey) {
  if (!user) return { ok: false, status: 401, message: '请先登录' }
  const roles = roleFlags(user)
  if (roles.admin || roles[roleKey]) return { ok: true }
  return { ok: false, status: 403, message: '无权限：需要「' + roleKey + '」岗' }
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
}

function normColor(s) {
  const t = String(s || '').trim()
  if (!t) return ''
  if (t.charAt(0) === '#') return t.toLowerCase()
  return norm(t)
}

function colorMatch(a, b) {
  const x = normColor(a)
  const y = normColor(b)
  if (!x || !y) return false
  return x === y
}

function materialMatch(a, b) {
  return norm(a) && norm(a) === norm(b)
}

function modelMatch(a, b) {
  return norm(a) && norm(a) === norm(b)
}

function readArr(api, file, fallback) {
  const raw = api.readJson(file, fallback)
  return Array.isArray(raw) ? raw : fallback
}

function readObj(api, file) {
  const raw = api.readJson(file, {})
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function appendLog(api, entry) {
  const max = Math.max(200, Math.min(20000, numVar(api, 'log_max', 5000)))
  const list = readArr(api, 'audit_log.json', [])
  list.unshift({
    id: newId(),
    at: nowIso(),
    ...entry
  })
  api.writeJson('audit_log.json', list.slice(0, max))
}

function actorOf(user) {
  if (!user) return { actorId: '', actorName: '系统' }
  return {
    actorId: String(user.id || ''),
    actorName: String(user.displayName || user.username || user.id || '')
  }
}

function pageFile(api, name) {
  const p = path.join(api.pluginDir, 'pages', name)
  return fs.readFileSync(p, 'utf8')
}

function localBase(api) {
  const s = api.getSettings() || {}
  const port = Number(s.apiPort) || 17890
  return 'http://127.0.0.1:' + port
}

async function hostJson(api, ctx, method, urlPath, body, timeoutMs) {
  const url = localBase(api) + urlPath
  const headers = {
    Accept: 'application/json',
    Authorization: authHeader(ctx)
  }
  if (body != null) headers['Content-Type'] = 'application/json'
  const ms = Math.max(1000, Number(timeoutMs) || 8000)
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null
  try {
    const res = await api.fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    })
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { ok: false, message: text || '非 JSON 响应' }
    }
    return { status: res.status, json }
  } catch (e) {
    return {
      status: 504,
      json: { ok: false, message: e && e.name === 'AbortError' ? '内部请求超时' : String(e && e.message ? e.message : e) }
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function roleFlags(user) {
  const gids = Array.isArray(user && user.groupIds) ? user.groupIds.map(String) : []
  const admin = isAdmin(user)
  const groups = readUserGroupsFile()
  const extra = []
  for (const gid of gids) {
    const g = groups.find((x) => String(x.id) === gid)
    if (g && Array.isArray(g.permissions)) extra.push(...g.permissions)
  }
  const boxed = user
    ? { ...user, permissions: [...(user.permissions || []), ...extra] }
    : user
  return {
    patrol: admin || hasPerm(boxed, PERM.patrol) || gids.includes('farm_patrol'),
    audit: admin || hasPerm(boxed, PERM.audit) || gids.includes('farm_audit'),
    submit: admin || hasPerm(boxed, PERM.submit) || gids.includes('farm_submit'),
    logs:
      admin ||
      hasPerm(boxed, PERM.logs) ||
      gids.includes('farm_patrol') ||
      gids.includes('farm_audit'),
    admin
  }
}

function spoolBindings(s) {
  if (!s) return []
  if (Array.isArray(s.amsBindings)) {
    return s.amsBindings.filter((b) => b && b.deviceId && Number.isFinite(Number(b.slotId)))
  }
  if (s.amsBinding && s.amsBinding.deviceId) return [s.amsBinding]
  return []
}

function deviceSpools(spools, deviceId) {
  const out = []
  for (const s of spools || []) {
    if (!s || s.archived) continue
    for (const b of spoolBindings(s)) {
      if (String(b.deviceId) === String(deviceId)) {
        out.push({ spool: s, slotId: Number(b.slotId) })
      }
    }
  }
  return out
}

function hasAnyFilament(spools, deviceId) {
  return deviceSpools(spools, deviceId).length > 0
}

function spoolMatchesJob(spool, job) {
  if (!spool || !job) return false
  if (!materialMatch(spool.material, job.material)) return false
  const cOk =
    colorMatch(spool.color, job.color) ||
    colorMatch(spool.colorHex, job.color) ||
    colorMatch(spool.color, job.colorHex) ||
    colorMatch(spool.colorHex, job.colorHex)
  return cOk
}

function normState(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
}

function isErrorSt(st) {
  if (!st) return false
  if (String(st.health || '') === 'error') return true
  const s = normState(st.state)
  return (
    s === 'failed' ||
    s === 'error' ||
    s === 'fatal' ||
    s.includes('failed') ||
    s.includes('error') ||
    s.startsWith('klippy_')
  )
}

function isFinishedSt(st) {
  const s = normState(st && st.state)
  return (
    s === 'finish' ||
    s === 'finished' ||
    s === 'complete' ||
    s === 'completed' ||
    s === 'done'
  )
}

function isPrintingSt(st) {
  const s = normState(st && st.state)
  return /print|run|busy|pause/.test(s) && !isFinishedSt(st) && !isErrorSt(st)
}

function isOfflineSt(st) {
  if (!st) return true
  const h = String(st.health || '').toLowerCase()
  return h === 'offline' || h === 'disconnected' || h === ''
}

function getDuty(api, deviceId) {
  const all = readObj(api, 'duty.json')
  const row = all[String(deviceId)]
  return row && typeof row === 'object'
    ? row
    : { status: 'idle', clearedAt: null, note: '', updatedAt: null, updatedBy: '' }
}

function setDuty(api, deviceId, patch, user) {
  const all = readObj(api, 'duty.json')
  const prev = getDuty(api, deviceId)
  const next = {
    ...prev,
    ...patch,
    updatedAt: nowIso(),
    updatedBy: user ? String(user.displayName || user.username || user.id) : prev.updatedBy || ''
  }
  all[String(deviceId)] = next
  api.writeJson('duty.json', all)
  return next
}

function attentionKind(st) {
  if (isErrorSt(st)) return 'error'
  if (isFinishedSt(st)) return 'finished'
  return null
}

function episodeFp(st) {
  const kind = attentionKind(st)
  if (!kind) return ''
  return kind + ':' + String(st.state || '') + ':' + String(st.filename || st.gcodeFile || '')
}

/** 设备是否允许接收打印文件 */
function canAcceptPrint(api, deviceId, spools) {
  if (!boolVar(api, 'block_unavailable', true)) return { ok: true }
  const duty = getDuty(api, deviceId)
  if (duty.status === 'maintenance') {
    return { ok: false, message: '设备维修中，禁止发送打印文件' }
  }
  if (duty.status === 'attention') {
    return { ok: false, message: '设备待巡查处理，禁止发送打印文件' }
  }
  const st = (api.getStatuses() || {})[String(deviceId)] || {}
  if (isOfflineSt(st)) return { ok: false, message: '设备离线，禁止发送打印文件' }
  if (isPrintingSt(st)) return { ok: false, message: '设备正在打印，禁止发送打印文件' }
  const fp = episodeFp(st)
  if (isErrorSt(st) || isFinishedSt(st)) {
    if (!(duty.status === 'idle' && duty.clearedFp && duty.clearedFp === fp)) {
      return {
        ok: false,
        message: isErrorSt(st)
          ? '设备报错，需巡查确认空闲后才能开打'
          : '打印已完成，需巡查确认空闲（清床）后才能开打'
      }
    }
  }
  if (boolVar(api, 'require_filament', true) && Array.isArray(spools) && spools.length > 0 && !hasAnyFilament(spools, deviceId)) {
    return { ok: false, message: '设备未绑定耗材，禁止发送打印文件 / 无法智能派单' }
  }
  return { ok: true }
}

function takeAllowOnce(api, deviceId) {
  const map = readObj(api, 'allow_once.json')
  const key = String(deviceId)
  const row = map[key]
  if (!row) return false
  const t = Date.parse(row.until || 0)
  if (!Number.isFinite(t) || Date.now() > t) {
    delete map[key]
    api.writeJson('allow_once.json', map)
    return false
  }
  delete map[key]
  api.writeJson('allow_once.json', map)
  return true
}

function grantAllowOnce(api, deviceId, jobId) {
  const map = readObj(api, 'allow_once.json')
  map[String(deviceId)] = {
    jobId: String(jobId || ''),
    until: new Date(Date.now() + 120000).toISOString()
  }
  api.writeJson('allow_once.json', map)
}

function dataRoot() {
  return process.env.DATA_ROOT || path.join(process.cwd(), 'data')
}

function readUserGroupsFile() {
  const p = path.join(dataRoot(), 'user-groups.json')
  if (!fs.existsSync(p)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(raw.groups) ? raw.groups : []
  } catch {
    return []
  }
}

function saveUserGroupsFile(groups) {
  const p = path.join(dataRoot(), 'user-groups.json')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify({ groups }, null, 2), 'utf8')
}

function readFilamentSpools(api) {
  try {
    const p = path.join(dataRoot(), 'filament-spools.json')
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (Array.isArray(raw)) {
        module.exports._cacheSpools(api, raw)
        return raw
      }
    }
  } catch (e) {
    api.log('[farm_dispatch] readFilamentSpools ' + (e && e.message))
  }
  const cache = readObj(api, 'filament_cache.json')
  return Array.isArray(cache.spools) ? cache.spools : []
}

function writeFilamentSpools(api, spools) {
  const p = path.join(dataRoot(), 'filament-spools.json')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(spools, null, 2), 'utf8')
  module.exports._cacheSpools(api, spools)
}

function bindFilamentSpool(api, spoolId, deviceId, slotId, bind) {
  let spools = readFilamentSpools(api)
  const idx = spools.findIndex((s) => String(s.id) === String(spoolId))
  if (idx < 0) return { ok: false, message: 'Spool not found' }
  const rolls = Math.max(1, Math.min(99, Math.floor(Number(spools[idx].rolls) || 1)))
  for (const s of spools) {
    let list = []
    if (Array.isArray(s.amsBindings)) {
      list = [...s.amsBindings]
    } else if (s.amsBinding && s.amsBinding.deviceId) {
      list = [{ deviceId: s.amsBinding.deviceId, slotId: Number(s.amsBinding.slotId) }]
    }
    list = list.filter((b) => !(String(b.deviceId) === String(deviceId) && Number(b.slotId) === Number(slotId)))
    if (String(s.id) === String(spoolId) && bind) {
      if (!list.some((b) => String(b.deviceId) === String(deviceId) && Number(b.slotId) === Number(slotId))) {
        if (list.length >= rolls) {
          return { ok: false, message: 'Spool only has ' + rolls + ' roll(s); binding full' }
        }
        list.push({ deviceId: String(deviceId), slotId: Number(slotId) })
      }
    }
    s.amsBindings = list
    s.amsBinding = list[0] || null
    if (String(s.id) === String(spoolId)) s.rolls = rolls
    s.updatedAt = nowIso()
  }
  writeFilamentSpools(api, spools)
  const next = spools.find((s) => String(s.id) === String(spoolId))
  return { ok: true, spool: next }
}

function pushPatrolNotice(api, n) {
  const list = readArr(api, 'notifications.json', [])
  const row = {
    id: newId(),
    status: 'open',
    createdAt: nowIso(),
    ...n
  }
  list.unshift(row)
  api.writeJson('notifications.json', list.slice(0, 500))
  try {
    if (typeof api.notify === 'function') {
      api.notify({
        kind: 'farm_dispatch',
        title: row.title || '巡查通知',
        content: row.body || '',
        deviceId: row.deviceId,
        deviceName: row.deviceName
      })
    }
  } catch (_) {
    /* ignore */
  }
  return row
}

function findCandidates(api, job, spools) {
  const devices = api.getDevices() || []
  const statuses = api.getStatuses() || {}
  const hits = []
  for (const d of devices) {
    const id = String(d.id || '')
    if (!id) continue
    if (!modelMatch(d.model, job.model)) continue
    const bound = deviceSpools(spools, id)
    if (!bound.length) continue
    if (!bound.some((x) => spoolMatchesJob(x.spool, job))) continue
    const gate = canAcceptPrint(api, id, spools)
    if (!gate.ok) continue
    const st = statuses[id] || {}
    if (isPrintingSt(st) || isErrorSt(st) || isFinishedSt(st) || isOfflineSt(st)) continue
    const duty = getDuty(api, id)
    if (duty.status === 'maintenance' || duty.status === 'attention') continue
    hits.push({
      id,
      name: String(d.name || id),
      model: String(d.model || ''),
      brand: d.brand
    })
  }
  return hits
}

async function dispatchJob(api, ctx, job, user) {
  const spools = readFilamentSpools(api)
  if (boolVar(api, 'require_filament', true)) {
    /* always checked per device */
  }
  const candidates = findCandidates(api, job, spools)
  if (!candidates.length) {
    job.status = 'waiting_material'
    job.deviceId = ''
    job.deviceName = ''
    job.waitReason =
      '没有匹配机型「' +
      job.model +
      '」且材料「' +
      job.material +
      '」颜色「' +
      (job.color || job.colorHex) +
      '」且可开打的设备'
    job.updatedAt = nowIso()
    pushPatrolNotice(api, {
      type: 'need_filament',
      title: '需要换料 / 换机',
      body:
        '任务 #' +
        job.id.slice(0, 8) +
        ' 需要机型 ' +
        job.model +
        '、材料 ' +
        job.material +
        '、颜色 ' +
        (job.color || job.colorHex) +
        '。请到对应机位绑定耗材或确认空闲后点「换料完成」。',
      jobId: job.id,
      need: {
        model: job.model,
        material: job.material,
        color: job.color,
        colorHex: job.colorHex
      }
    })
    appendLog(api, {
      ...actorOf(user),
      action: 'dispatch_waiting',
      detail: { jobId: job.id, reason: job.waitReason }
    })
    return { ok: false, waiting: true, job }
  }

  const target = candidates[0]
  grantAllowOnce(api, target.id, job.id)
  let contentBase64 = job.contentBase64
  if (!contentBase64 && job.mediaRel) {
    try {
      const full = path.join(api.dataDir, 'media', job.mediaRel)
      contentBase64 = fs.readFileSync(full).toString('base64')
    } catch (e) {
      return { ok: false, message: '读取打印文件失败：' + (e.message || e) }
    }
  }
  if (!contentBase64) return { ok: false, message: '任务缺少打印文件内容' }

  const claimed = await api.claimDevice(target.id, {
    ttlSec: 300,
    ownerLabel: 'farm_dispatch:' + job.id
  })
  if (claimed && claimed.ok === false && !String(claimed.message || '').includes('已锁定')) {
    /* continue anyway if lock unavailable */
  }

  const r = await api.startPrint(target.id, {
    filename: job.filename,
    contentBase64
  })
  try {
    await api.releaseDevice(target.id, {})
  } catch (_) {
    /* ignore */
  }

  if (!r || !r.ok) {
    job.status = 'failed'
    job.failReason = (r && r.message) || '开打失败'
    job.updatedAt = nowIso()
    appendLog(api, {
      ...actorOf(user),
      action: 'dispatch_failed',
      detail: { jobId: job.id, deviceId: target.id, message: job.failReason }
    })
    return { ok: false, message: job.failReason, job }
  }

  job.status = 'printing'
  job.deviceId = target.id
  job.deviceName = target.name
  job.dispatchedAt = nowIso()
  job.updatedAt = nowIso()
  job.waitReason = ''
  appendLog(api, {
    ...actorOf(user),
    action: 'dispatch_ok',
    detail: { jobId: job.id, deviceId: target.id, deviceName: target.name }
  })
  return { ok: true, job, device: target }
}

function saveJobs(api, jobs) {
  api.writeJson('jobs.json', jobs)
}

function getJobs(api) {
  return readArr(api, 'jobs.json', [])
}

function updateJob(api, id, patch) {
  const jobs = getJobs(api)
  const i = jobs.findIndex((j) => String(j.id) === String(id))
  if (i < 0) return null
  jobs[i] = { ...jobs[i], ...patch, updatedAt: nowIso() }
  saveJobs(api, jobs)
  return jobs[i]
}

function enrichDevices(api, spools) {
  const devices = api.getDevices() || []
  const statuses = api.getStatuses() || {}
  return devices.map((d) => {
    const id = String(d.id || '')
    const st = statuses[id] || {}
    const duty = getDuty(api, id)
    const bound = deviceSpools(spools, id).map((x) => ({
      spoolId: x.spool.id,
      material: x.spool.material,
      color: x.spool.color,
      colorHex: x.spool.colorHex,
      slotId: x.slotId,
      remainGrams: x.spool.remainGrams
    }))
    const kind = attentionKind(st)
    const fp = episodeFp(st)
    const cleared =
      duty.status === 'idle' && duty.clearedFp && fp && duty.clearedFp === fp
    let board = 'other'
    if (duty.status === 'maintenance') board = 'maintenance'
    else if (kind === 'error' && !cleared) board = 'error'
    else if (kind === 'finished' && !cleared) board = 'finished'
    else if (duty.status === 'attention') board = 'attention'
    else if (isPrintingSt(st)) board = 'printing'
    else board = 'idle'
    return {
      id,
      name: String(d.name || id),
      model: String(d.model || ''),
      brand: d.brand,
      health: st.health,
      state: st.state,
      message: st.message,
      filename: st.filename || st.gcodeFile || '',
      duty,
      board,
      bound,
      gate: canAcceptPrint(api, id, spools)
    }
  })
}

module.exports = {
  async register(api) {
    const servePage = (name) => async () => {
      try {
        return httpHtml(200, pageFile(api, name))
      } catch (e) {
        return httpHtml(500, '<pre>页面缺失：' + String(e.message || e) + '</pre>')
      }
    }

    // 旧独立 URL：提示改走侧栏，避免 Electron 新窗口套壳卡死
    const tipPage = (title, section) =>
      httpHtml(
        200,
        '<!doctype html><meta charset="utf-8"/><title>' +
          title +
          '</title><body style="font-family:system-ui;padding:24px;background:#0f141c;color:#e8eaed">' +
          '<h1 style="font-size:18px">' +
          title +
          '</h1><p>请在监控台侧栏打开「' +
          section +
          '」，勿用独立窗口（易卡死）。</p>' +
          '<p style="opacity:.65;font-size:13px">入口：巡查看板 / 派单审核 / 提交打印 / 派单日志</p></body>'
      )
    api.registerRoute('GET', '/farm/patrol', async () => tipPage('巡查看板', '巡查看板'), {
      public: true
    })
    api.registerRoute('GET', '/farm/audit', async () => tipPage('派单审核', '派单审核'), {
      public: true
    })
    api.registerRoute('GET', '/farm/submit', async () => tipPage('提交打印', '提交打印'), {
      public: true
    })

    api.registerRoute(
      'GET',
      '/api/v1/farm-dispatch/meta',
      async () => {
        return {
          ok: true,
          pages: {
            patrol: 'plugin:farm_dispatch:patrol',
            audit: 'plugin:farm_dispatch:audit',
            submit: 'plugin:farm_dispatch:submit',
            logs: 'plugin:farm_dispatch:logs'
          },
          perms: PERM,
          groups: GROUP_DEFS.map((g) => ({ id: g.id, name: g.name, description: g.description }))
        }
      },
      { public: true }
    )

    api.registerRoute('GET', '/api/v1/farm-dispatch/me', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      // 禁止回调本机 /auth/me（同进程自请求会卡死）
      const roles = roleFlags(user)
      return {
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          level: user.level,
          groupIds: user.groupIds || []
        },
        roles
      }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/ensure-groups', async (req) => {
      const user = authUser(req)
      if (!isAdmin(user)) return httpJson(403, { ok: false, message: '需要管理员' })
      const list = readUserGroupsFile().slice()
      let added = 0
      for (const g of GROUP_DEFS) {
        if (list.some((x) => String(x.id) === g.id)) continue
        list.push(g)
        added++
      }
      saveUserGroupsFile(list)
      appendLog(api, {
        ...actorOf(user),
        action: 'ensure_groups',
        detail: { added }
      })
      return { ok: true, added, groups: list }
    })

    // —— 巡查 ——
    api.registerRoute('GET', '/api/v1/farm-dispatch/patrol/board', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol')
      if (!gate.ok) return httpJson(gate.status, gate)
      const spools = readFilamentSpools(api)
      const devices = enrichDevices(api, spools)
      const board = {
        error: devices.filter((d) => d.board === 'error'),
        finished: devices.filter((d) => d.board === 'finished'),
        maintenance: devices.filter((d) => d.board === 'maintenance'),
        attention: devices.filter((d) => d.board === 'attention'),
        printing: devices.filter((d) => d.board === 'printing'),
        idle: devices.filter((d) => d.board === 'idle')
      }
      const notices = readArr(api, 'notifications.json', []).filter((n) => n.status === 'open')
      return { ok: true, board, notices, devices, spools: spools.filter((s) => !s.archived) }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/patrol/duty', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol')
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const deviceId = String(body.deviceId || '').trim()
      const status = String(body.status || '').trim()
      const note = String(body.note || '').trim()
      if (!deviceId) return { ok: false, message: '缺少 deviceId' }
      if (status !== 'idle' && status !== 'maintenance') {
        return { ok: false, message: 'status 仅支持 idle / maintenance' }
      }
      const st = (api.getStatuses() || {})[deviceId] || {}
      const kind = attentionKind(st)
      const fp = kind
        ? kind + ':' + String(st.state || '') + ':' + String(st.filename || st.gcodeFile || '')
        : ''
      const patch = { status, note }
      if (status === 'idle') {
        patch.clearedAt = nowIso()
        patch.clearedFp = fp || getDuty(api, deviceId).attentionFp || ''
      }
      if (status === 'maintenance') {
        patch.clearedAt = null
        patch.clearedFp = ''
      }
      const duty = setDuty(api, deviceId, patch, user)
      appendLog(api, {
        ...actorOf(user),
        action: 'patrol_duty',
        detail: { deviceId, status, note }
      })
      return { ok: true, duty }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/patrol/bind', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol')
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const deviceId = String(body.deviceId || '').trim()
      const spoolId = String(body.spoolId || '').trim()
      const slotId = Math.floor(Number(body.slotId != null ? body.slotId : 0))
      if (!deviceId || !spoolId) return { ok: false, message: '需要 deviceId 与 spoolId' }
      const r = bindFilamentSpool(api, spoolId, deviceId, slotId, true)
      appendLog(api, {
        ...actorOf(user),
        action: 'patrol_bind',
        detail: { deviceId, spoolId, slotId, ok: r.ok, message: r.message }
      })
      if (!r.ok) return r
      return { ok: true, spool: r.spool }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/patrol/unbind', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol')
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const deviceId = String(body.deviceId || '').trim()
      const spoolId = String(body.spoolId || '').trim()
      const slotId = Math.floor(Number(body.slotId != null ? body.slotId : 0))
      if (!deviceId || !spoolId) return { ok: false, message: '需要 deviceId 与 spoolId' }
      const r = bindFilamentSpool(api, spoolId, deviceId, slotId, false)
      appendLog(api, {
        ...actorOf(user),
        action: 'patrol_unbind',
        detail: { deviceId, spoolId, slotId }
      })
      return { ok: r.ok !== false, spool: r.spool, message: r.message }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/patrol/notice-done', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'patrol')
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const noticeId = String(body.noticeId || '').trim()
      const jobId = String(body.jobId || '').trim()
      const list = readArr(api, 'notifications.json', [])
      let notice = null
      for (const n of list) {
        if (noticeId && String(n.id) === noticeId) {
          n.status = 'done'
          n.doneAt = nowIso()
          n.doneBy = actorOf(user).actorName
          notice = n
        }
      }
      api.writeJson('notifications.json', list)
      appendLog(api, {
        ...actorOf(user),
        action: 'patrol_notice_done',
        detail: { noticeId, jobId: jobId || (notice && notice.jobId) }
      })

      const jid = jobId || (notice && notice.jobId)
      if (jid) {
        const job = getJobs(api).find((j) => String(j.id) === String(jid))
        if (job && (job.status === 'waiting_material' || job.status === 'approved')) {
          const r = await dispatchJob(api, req, job, user)
          const jobs = getJobs(api)
          const i = jobs.findIndex((x) => String(x.id) === String(job.id))
          if (i >= 0) {
            jobs[i] = r.job || job
            saveJobs(api, jobs)
          }
          return { ok: true, notice, dispatch: r }
        }
      }
      return { ok: true, notice }
    })

    // —— 提交申请 ——
    api.registerRoute('POST', '/api/v1/farm-dispatch/jobs', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'submit')
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const model = String(body.model || '').trim()
      const material = String(body.material || '').trim()
      const color = String(body.color || '').trim()
      const colorHex = String(body.colorHex || '').trim()
      const filename = String(body.filename || '').trim() || 'job.gcode'
      const contentBase64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : ''
      const note = String(body.note || '').trim()
      if (!model || !material || !(color || colorHex)) {
        return { ok: false, message: '请填写机型、材料、颜色' }
      }
      if (!contentBase64) return { ok: false, message: '请上传打印文件' }
      const maxMb = Math.max(1, numVar(api, 'max_file_mb', 80))
      const bytes = Buffer.from(contentBase64, 'base64')
      if (bytes.length > maxMb * 1024 * 1024) {
        return { ok: false, message: '文件过大，上限 ' + maxMb + 'MB' }
      }
      const mediaRel = 'jobs/' + newId() + '_' + filename.replace(/[^\w.\-]+/g, '_')
      const up = api.writeMedia(mediaRel, contentBase64, { encoding: 'base64' })
      if (!up || !up.ok) {
        return { ok: false, message: (up && up.message) || '保存文件失败' }
      }
      const job = {
        id: newId(),
        status: 'pending_audit',
        model,
        material,
        color,
        colorHex,
        filename,
        mediaRel,
        note,
        applicantId: String(user.id),
        applicantName: String(user.displayName || user.username || user.id),
        reviewerId: '',
        reviewerName: '',
        rejectReason: '',
        deviceId: '',
        deviceName: '',
        waitReason: '',
        failReason: '',
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
      const jobs = getJobs(api)
      jobs.unshift(job)
      saveJobs(api, jobs)
      appendLog(api, {
        ...actorOf(user),
        action: 'job_submit',
        detail: { jobId: job.id, model, material, color, filename }
      })
      return { ok: true, job: { ...job, contentBase64: undefined } }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/jobs', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const q = (req && req.query) || {}
      let rows = getJobs(api).map((j) => {
        const { contentBase64, ...rest } = j
        return rest
      })
      const status = String(q.status || '').trim()
      const mine = q.mine === '1' || q.mine === 'true'
      if (status) rows = rows.filter((j) => String(j.status) === status)
      const roles = roleFlags(user)
      if (mine || !roles.audit) {
        rows = rows.filter((j) => String(j.applicantId) === String(user.id))
      }
      const limit = Math.max(1, Math.min(500, Number(q.limit) || 100))
      return { ok: true, total: rows.length, jobs: rows.slice(0, limit) }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/job', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const jobId = String((req.query && req.query.id) || '').trim()
      const job = getJobs(api).find((j) => String(j.id) === jobId)
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      const roles = roleFlags(user)
      if (String(job.applicantId) !== String(user.id) && !roles.audit) {
        return httpJson(403, { ok: false, message: '无权查看' })
      }
      const { contentBase64, ...rest } = job
      return { ok: true, job: rest }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/job/approve', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'audit')
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const jobId = String(body.id || body.jobId || '').trim()
      const job = getJobs(api).find((j) => String(j.id) === jobId)
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      if (job.status !== 'pending_audit') {
        return { ok: false, message: '当前状态不可审核：' + job.status }
      }
      job.status = 'approved'
      job.reviewerId = String(user.id)
      job.reviewerName = String(user.displayName || user.username || user.id)
      job.reviewedAt = nowIso()
      job.rejectReason = ''
      appendLog(api, {
        ...actorOf(user),
        action: 'job_approve',
        detail: { jobId: job.id }
      })
      const r = await dispatchJob(api, req, job, user)
      const jobs = getJobs(api)
      const i = jobs.findIndex((x) => String(x.id) === String(job.id))
      if (i >= 0) {
        jobs[i] = r.job || job
        saveJobs(api, jobs)
      }
      return { ok: true, dispatch: r, job: { ...(r.job || job), contentBase64: undefined } }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/job/reject', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'audit')
      if (!gate.ok) return httpJson(gate.status, gate)
      const body = (req && req.body) || {}
      const reason = String(body.reason || '').trim()
      if (!reason) return { ok: false, message: '驳回必须填写原因' }
      const jobId = String(body.id || body.jobId || '').trim()
      const job = updateJob(api, jobId, {
        status: 'rejected',
        rejectReason: reason,
        reviewerId: String(user.id),
        reviewerName: String(user.displayName || user.username || user.id),
        reviewedAt: nowIso()
      })
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      appendLog(api, {
        ...actorOf(user),
        action: 'job_reject',
        detail: { jobId, reason }
      })
      return { ok: true, job }
    })

    api.registerRoute('POST', '/api/v1/farm-dispatch/job/redispatch', async (req) => {
      const user = authUser(req)
      const roles = roleFlags(user)
      if (!roles.audit && !roles.patrol) {
        return httpJson(403, { ok: false, message: '无权限' })
      }
      const body = (req && req.body) || {}
      const jobId = String(body.id || body.jobId || '').trim()
      const job = getJobs(api).find((j) => String(j.id) === jobId)
      if (!job) return httpJson(404, { ok: false, message: '任务不存在' })
      if (!['waiting_material', 'approved', 'failed'].includes(job.status)) {
        return { ok: false, message: '当前状态不可重新派单：' + job.status }
      }
      const r = await dispatchJob(api, req, job, user)
      const jobs = getJobs(api)
      const i = jobs.findIndex((x) => String(x.id) === String(job.id))
      if (i >= 0) {
        jobs[i] = r.job || job
        saveJobs(api, jobs)
      }
      return { ok: true, dispatch: r, job: { ...(r.job || job), contentBase64: undefined } }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/logs', async (req) => {
      const user = authUser(req)
      const gate = requireRole(user, 'logs')
      if (!gate.ok) return httpJson(gate.status || 403, gate)
      const q = (req && req.query) || {}
      let rows = readArr(api, 'audit_log.json', [])
      const action = String(q.action || '').trim()
      if (action) rows = rows.filter((r) => String(r.action) === action)
      const limit = Math.max(1, Math.min(1000, Number(q.limit) || 200))
      return { ok: true, total: rows.length, logs: rows.slice(0, limit) }
    })

    api.registerRoute('GET', '/api/v1/farm-dispatch/models', async (req) => {
      const user = authUser(req)
      if (!user) return httpJson(401, { ok: false, message: '请先登录' })
      const set = new Set()
      for (const d of api.getDevices() || []) {
        const m = String(d.model || '').trim()
        if (m) set.add(m)
      }
      return { ok: true, models: Array.from(set).sort() }
    })

    api.log('[farm_dispatch] routes ready — /farm/patrol /farm/audit /farm/submit')
  },

  async ui_assets(api, assets) {
    return assets && typeof assets === 'object' ? assets : {}
  },

  async permissions_catalog(api, list) {
    const rows = Array.isArray(list) ? list.slice() : []
    const add = (code, label, description) => {
      if (!rows.some((r) => r && r.code === code)) {
        rows.push({ code, label, plugin: 'farm_dispatch', description })
      }
    }
    add(PERM.patrol, '巡查岗', '手机巡查页：空闲/维修/绑耗材')
    add(PERM.audit, '审核岗', 'PC 审核派单申请')
    add(PERM.submit, '派单申请', '提交打印文件申请')
    add(PERM.logs, '派单日志', '查看操作审计日志')
    return rows
  },

  async control_before(api, payload) {
    try {
      if (!payload || payload.proceed === false) return payload
      if (!boolVar(api, 'block_unavailable', true)) return payload
      const action = String((payload.payload && payload.payload.action) || '')
      if (action !== 'print_file') return payload
      const deviceId = String(payload.deviceId || '')
      if (takeAllowOnce(api, deviceId)) {
        return payload
      }
      const cache = readObj(api, 'filament_cache.json')
      const spools = Array.isArray(cache.spools) ? cache.spools : []
      const gate = canAcceptPrint(api, deviceId, spools)
      if (!gate.ok) {
        appendLog(api, {
          actorId: '',
          actorName: '拦截器',
          action: 'block_print',
          detail: { deviceId, message: gate.message }
        })
        return {
          proceed: false,
          status: 403,
          message: gate.message,
          body: { ok: false, message: gate.message }
        }
      }
    } catch (e) {
      api.log('[farm_dispatch] control_before ' + (e && e.message))
    }
    return payload
  },

  async print_batch_before(api, payload) {
    if (!payload || payload.proceed === false) return payload
    if (!boolVar(api, 'block_unavailable', true)) return payload
    const ids = Array.isArray(payload.deviceIds) ? payload.deviceIds : []
    const cache = readObj(api, 'filament_cache.json')
    const spools = Array.isArray(cache.spools) ? cache.spools : []
    for (const id of ids) {
      const gate = canAcceptPrint(api, String(id), spools)
      if (!gate.ok) {
        return {
          proceed: false,
          status: 403,
          body: { ok: false, message: gate.message + '（设备 ' + id + '）' }
        }
      }
    }
    return payload
  },

  async print_start(api, payload) {
    // queue start — also gated via onStartPrintJob control_before
    return payload
  },

  async print_request_create(api, payload) {
    if (!payload || payload.proceed === false) return payload
    if (!boolVar(api, 'block_unavailable', true)) return payload
    const body = payload.body && typeof payload.body === 'object' ? payload.body : {}
    const deviceId = String(body.deviceId || '')
    if (!deviceId) return payload
    const cache = readObj(api, 'filament_cache.json')
    const spools = Array.isArray(cache.spools) ? cache.spools : []
    const gate = canAcceptPrint(api, deviceId, spools)
    if (!gate.ok) {
      return {
        proceed: false,
        status: 403,
        message: gate.message,
        body: { ok: false, message: gate.message }
      }
    }
    return payload
  },

  async statuses_publish(api, statuses) {
    try {
      const map = statuses && typeof statuses === 'object' ? statuses : {}
      const duties = readObj(api, 'duty.json')
      let changed = false
      for (const id of Object.keys(map)) {
        const st = map[id]
        const kind = attentionKind(st)
        const prev = duties[id] && typeof duties[id] === 'object' ? duties[id] : {}
        if (prev.status === 'maintenance') continue
        if (!kind) continue
        const fp = kind + ':' + String(st.state || '') + ':' + String(st.filename || st.gcodeFile || '')
        // 巡查已针对本轮完成/报错点过空闲 → 不再刷回 attention
        if (prev.status === 'idle' && prev.clearedFp && prev.clearedFp === fp) continue
        if (prev.status === 'attention' && prev.attentionFp === fp) continue
        duties[id] = {
          ...prev,
          status: 'attention',
          attentionFp: fp,
          attentionKind: kind,
          clearedAt: null,
          note: kind === 'error' ? '报错待巡查' : '打印完成待确认',
          updatedAt: nowIso(),
          updatedBy: 'system'
        }
        changed = true
      }
      if (changed) api.writeJson('duty.json', duties)
    } catch (e) {
      api.log('[farm_dispatch] statuses_publish ' + (e && e.message))
    }
    return statuses
  }
}

/** 巡查板拉取时刷新耗材缓存，供开打拦截使用 */
module.exports._cacheSpools = function (api, spools) {
  api.writeJson('filament_cache.json', {
    at: nowIso(),
    spools: Array.isArray(spools) ? spools : []
  })
}
