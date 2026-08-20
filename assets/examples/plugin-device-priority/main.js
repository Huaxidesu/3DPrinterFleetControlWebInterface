/**
 * device_priority — 报错 / 打印完成按发生时间重排设备列表
 * 后进入该状态的更靠前：B 刚报错则 B 第一、A 第二。
 */
const RANK_FILE = 'ranks.json'

function boolVar(api, key, def) {
  const v = api.getVar(key, def ? '1' : '0')
  return v === '1' || v === true || v === 'true'
}

function normState(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
}

function isError(st) {
  if (!st) return false
  if (String(st.health || '') === 'error') return true
  const s = normState(st.state)
  if (!s) return false
  return (
    s === 'failed' ||
    s === 'error' ||
    s === 'fatal' ||
    s.includes('failed') ||
    s.includes('error') ||
    s.startsWith('klippy_')
  )
}

function isFinished(st) {
  const s = normState(st && st.state)
  return (
    s === 'finish' ||
    s === 'finished' ||
    s === 'complete' ||
    s === 'completed' ||
    s === 'done'
  )
}

function loadRanks(api) {
  const raw = api.readJson(RANK_FILE, null)
  const byId = raw && raw.byId && typeof raw.byId === 'object' ? raw.byId : {}
  return { byId: byId }
}

function saveRanks(api, ranks) {
  api.writeJson(RANK_FILE, { byId: ranks.byId || {}, updatedAt: new Date().toISOString() })
}

function kindOf(st) {
  if (isError(st)) return 'error'
  if (isFinished(st)) return 'finished'
  return 'other'
}

function touchRanks(api, statuses) {
  const ranks = loadRanks(api)
  const now = Date.now()
  let changed = false
  const map = statuses && typeof statuses === 'object' ? statuses : {}
  for (const id of Object.keys(map)) {
    const st = map[id]
    const kind = kindOf(st)
    const prev = ranks.byId[id] && typeof ranks.byId[id] === 'object' ? ranks.byId[id] : {}
    const prevKind = prev.kind || 'other'
    const next = {
      kind: kind,
      errorAt: Number(prev.errorAt) || 0,
      finishAt: Number(prev.finishAt) || 0
    }
    if (kind === 'error' && prevKind !== 'error') {
      next.errorAt = now
      changed = true
    }
    if (kind === 'finished' && prevKind !== 'finished') {
      next.finishAt = now
      changed = true
    }
    if (kind !== prevKind) changed = true
    ranks.byId[id] = next
  }
  if (changed) saveRanks(api, ranks)
  return ranks
}

function sortDevices(devices, ranks, statuses, opts) {
  if (!Array.isArray(devices)) return devices
  const pinError = opts.pinError !== false
  const pinFinished = opts.pinFinished !== false
  const byId = (ranks && ranks.byId) || {}
  const indexed = devices.map((d, i) => {
    const id = d && d.id != null ? String(d.id) : ''
    const st = (statuses && statuses[id]) || {}
    const rec = byId[id] || {}
    const kind = kindOf(st)
    let bucket = 2
    let ts = 0
    if (pinError && kind === 'error') {
      bucket = 0
      ts = Number(rec.errorAt) || 0
    } else if (pinFinished && kind === 'finished') {
      bucket = 1
      ts = Number(rec.finishAt) || 0
    }
    return { d, i, bucket, ts }
  })
  indexed.sort(function (a, b) {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket
    if (a.bucket < 2 && a.ts !== b.ts) return b.ts - a.ts
    return a.i - b.i
  })
  return indexed.map((x) => x.d)
}

module.exports = {
  async statuses_publish(api, statuses) {
    if (boolVar(api, 'enabled', true)) touchRanks(api, statuses)
    return statuses
  },

  async devices_list(api, devices) {
    if (!boolVar(api, 'enabled', true)) return devices
    const statuses = (api.getStatuses && api.getStatuses()) || {}
    const ranks = touchRanks(api, statuses)
    return sortDevices(devices, ranks, statuses, {
      pinError: boolVar(api, 'pin_error', true),
      pinFinished: boolVar(api, 'pin_finished', true)
    })
  }
}
