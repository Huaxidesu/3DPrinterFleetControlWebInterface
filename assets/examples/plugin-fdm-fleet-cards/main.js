/**
 * fdm_fleet_cards — FDM 机群快照 API
 */
function deviceTech(d) {
  const t = d && d.tech
  return t === 'resin' ? 'resin' : 'fdm'
}

function normState(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
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

function isPrinting(st) {
  if (!st || isFinished(st) || isError(st)) return false
  const s = normState(st.state)
  if (!s) return Number(st.progress) > 0 && Number(st.progress) < 100
  if (s === 'idle' || s === 'standby' || s === 'ready' || s === 'cancelled' || s === 'canceled') {
    return false
  }
  if (s === 'offline' || s === 'connecting' || s === 'reconnecting') return false
  return true
}

module.exports = {
  async register(api) {
    api.registerRoute('GET', '/api/v1/fdm-fleet/snapshot', async () => {
      const devices = api.getDevices() || []
      const statuses = api.getStatuses() || {}
      const rows = []
      for (const d of Array.isArray(devices) ? devices : []) {
        if (deviceTech(d) !== 'fdm') continue
        const id = String((d && d.id) || '')
        if (!id) continue
        const st = statuses[id] || {}
        const progress = Math.min(100, Math.max(0, Math.round(Number(st.progress) || 0)))
        const finished = isFinished(st)
        const error = isError(st)
        rows.push({
          id,
          name: String((d && d.name) || id),
          brand: d && d.brand,
          health: String(st.health || 'offline'),
          state: st.state != null ? String(st.state) : '',
          progress,
          remainingSeconds:
            st.remainingSeconds == null || st.remainingSeconds === ''
              ? null
              : Number(st.remainingSeconds),
          extruderActual:
            st.extruder && st.extruder.actual != null ? Number(st.extruder.actual) : null,
          bedActual: st.bed && st.bed.actual != null ? Number(st.bed.actual) : null,
          finished,
          error,
          printing: isPrinting(st),
          filename: st.filename != null ? String(st.filename) : '',
          message: st.message != null ? String(st.message) : ''
        })
      }
      return {
        ok: true,
        voiceAnnounce: api.getVar('voice_announce', '1') === '1',
        defaultCompact: api.getVar('default_compact', '0') === '1',
        count: rows.length,
        rows,
        at: new Date().toISOString()
      }
    })

    api.registerRoute('GET', '/api/v1/fdm-fleet/config', async () => ({
      ok: true,
      voiceAnnounce: api.getVar('voice_announce', '1') === '1',
      defaultCompact: api.getVar('default_compact', '0') === '1'
    }))
  }
}
