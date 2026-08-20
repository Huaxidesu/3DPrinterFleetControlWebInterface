/**
 * device_priority — 前端按报错/完成发生时间重排设备卡片（含分页第一页）
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var ranks = Object.create(null)
  var baseIds = []
  var timer = null
  var unsub = null
  var lastKey = ''
  var applying = false
  var enabled = true
  var pinError = true
  var pinFinished = true

  function authHeaders() {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json' }
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function loadVars() {
    return fetch('/api/v1/plugins', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var list = (data && data.data && data.data.plugins) || data.plugins || data.data || []
        if (!Array.isArray(list)) list = []
        var hit = list.find(function (p) {
          return p && (p.identifier === 'device_priority' || p.id === 'device_priority')
        })
        var v = (hit && (hit.vars || hit.configVars)) || {}
        enabled = v.enabled !== '0' && v.enabled !== false
        pinError = v.pin_error !== '0' && v.pin_error !== false
        pinFinished = v.pin_finished !== '0' && v.pin_finished !== false
      })
      .catch(function () {})
  }

  function saveVars(vars) {
    return fetch('/api/v1/plugins/device_priority/vars', {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authHeaders().Authorization || ''
      },
      body: JSON.stringify({ vars: vars })
    }).then(function (r) {
      return r.json()
    })
  }

  function normState(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
  }

  function isError(st) {
    if (!st) return false
    if (String(st.health || '') === 'error') return true
    var s = normState(st.state)
    if (!s) return false
    return (
      s === 'failed' ||
      s === 'error' ||
      s === 'fatal' ||
      s.indexOf('failed') >= 0 ||
      s.indexOf('error') >= 0 ||
      s.indexOf('klippy_') === 0
    )
  }

  function isFinished(st) {
    var s = normState(st && st.state)
    return s === 'finish' || s === 'finished' || s === 'complete' || s === 'completed' || s === 'done'
  }

  function kindOf(st) {
    if (isError(st)) return 'error'
    if (isFinished(st)) return 'finished'
    return 'other'
  }

  function kindFromCard(card) {
    var foot = card.querySelector('.device-card-footer')
    var cls = (foot && foot.className) || card.className || ''
    if (/\bstate-error\b/.test(cls) || /\bhealth-error\b/.test(cls)) return 'error'
    if (/\bstate-finished\b/.test(cls)) return 'finished'
    return 'other'
  }

  function rememberBase(ids) {
    if (!ids || !ids.length) return
    if (!baseIds.length) {
      baseIds = ids.slice()
      return
    }
    var set = Object.create(null)
    baseIds.forEach(function (id) {
      set[id] = true
    })
    ids.forEach(function (id) {
      if (!set[id]) baseIds.push(id)
    })
    baseIds = baseIds.filter(function (id) {
      return ids.indexOf(id) >= 0
    })
  }

  function touch(id, kind) {
    var rec = ranks[id] || { kind: 'other', errorAt: 0, finishAt: 0 }
    var now = Date.now()
    if (kind === 'error' && rec.kind !== 'error') rec.errorAt = now
    if (kind === 'finished' && rec.kind !== 'finished') rec.finishAt = now
    rec.kind = kind
    ranks[id] = rec
  }

  function sortedIds(ids, statusOf) {
    var rows = ids.map(function (id, i) {
      var st = statusOf(id)
      var kind = kindOf(st)
      if (kind === 'other') {
        var card = document.querySelector('.device-card[data-device-id="' + id + '"]')
        if (card) kind = kindFromCard(card)
      }
      touch(id, kind)
      var rec = ranks[id] || {}
      var bucket = 2
      var ts = 0
      if (pinError && kind === 'error') {
        bucket = 0
        ts = rec.errorAt || 0
      } else if (pinFinished && kind === 'finished') {
        bucket = 1
        ts = rec.finishAt || 0
      }
      return { id: id, i: i, bucket: bucket, ts: ts }
    })
    rows.sort(function (a, b) {
      if (a.bucket !== b.bucket) return a.bucket - b.bucket
      if (a.bucket < 2 && a.ts !== b.ts) return b.ts - a.ts
      return a.i - b.i
    })
    return rows.map(function (r) {
      return r.id
    })
  }

  function applyDomOrder(ids) {
    var grid = document.querySelector('.device-grid')
    if (!grid) return
    var cards = grid.querySelectorAll('.device-card[data-device-id]')
    if (!cards.length) return
    var rank = Object.create(null)
    ids.forEach(function (id, i) {
      rank[id] = i
    })
    cards.forEach(function (el) {
      var id = el.getAttribute('data-device-id')
      var n = rank[id]
      el.style.order = n == null ? '9000' : String(n)
    })
  }

  function tick() {
    if (!enabled || applying) return
    var ids = typeof P.getDeviceIds === 'function' ? P.getDeviceIds() : []
    if (!ids.length) {
      ids = Array.prototype.map.call(
        document.querySelectorAll('.device-card[data-device-id]'),
        function (el) {
          return el.getAttribute('data-device-id')
        }
      )
    }
    if (!ids.length) return
    rememberBase(ids)
    var statuses = typeof P.getDeviceStatuses === 'function' ? P.getDeviceStatuses() || {} : {}
    var next = sortedIds(baseIds.length ? baseIds : ids, function (id) {
      return statuses[id] || null
    })
    var key = next.join(',')
    if (key === lastKey) {
      applyDomOrder(next)
      return
    }
    lastKey = key
    applying = true
    try {
      if (typeof P.setDeviceOrder === 'function') P.setDeviceOrder(next)
      applyDomOrder(next)
    } finally {
      applying = false
    }
  }

  function boot() {
    loadVars().then(function () {
      tick()
      if (typeof P.subscribeDeviceState === 'function') {
        unsub = P.subscribeDeviceState(function () {
          tick()
        })
      }
      timer = setInterval(tick, 800)
    })
  }

  P.registerSettingsTab({
    key: 'device_priority',
    label: '设备置顶',
    after: 'plugins',
    order: 16,
    adminOnly: true,
    plugin: 'device_priority',
    render: function (el) {
      el.innerHTML = '<div class="settings-tab-panel dp-settings"><p>加载中…</p></div>'
      loadVars().then(function () {
        el.innerHTML =
          '<div class="settings-tab-panel dp-settings">' +
          '<h3>设备状态置顶</h3>' +
          '<p class="dp-hint">报错设备排到最前：后报错的更靠前（B 刚报错则 B 第一、A 第二）。打印完成同样按完成时间排，在报错后面。</p>' +
          '<div class="dp-field"><label>启用自动重排</label>' +
          '<select class="dp-input" name="enabled">' +
          '<option value="1"' +
          (enabled ? ' selected' : '') +
          '>开启</option>' +
          '<option value="0"' +
          (!enabled ? ' selected' : '') +
          '>关闭</option></select></div>' +
          '<div class="dp-field"><label>报错置顶</label>' +
          '<select class="dp-input" name="pin_error">' +
          '<option value="1"' +
          (pinError ? ' selected' : '') +
          '>开启</option>' +
          '<option value="0"' +
          (!pinError ? ' selected' : '') +
          '>关闭</option></select></div>' +
          '<div class="dp-field"><label>打印完成排列</label>' +
          '<select class="dp-input" name="pin_finished">' +
          '<option value="1"' +
          (pinFinished ? ' selected' : '') +
          '>开启</option>' +
          '<option value="0"' +
          (!pinFinished ? ' selected' : '') +
          '>关闭</option></select></div>' +
          '<div class="dp-actions"><button type="button" class="dp-btn" data-save>保存</button>' +
          '<span data-msg class="dp-msg"></span></div></div>'
        el.querySelector('[data-save]').addEventListener('click', function () {
          var msg = el.querySelector('[data-msg]')
          var next = {
            enabled: el.querySelector('[name=enabled]').value,
            pin_error: el.querySelector('[name=pin_error]').value,
            pin_finished: el.querySelector('[name=pin_finished]').value
          }
          msg.textContent = '保存中…'
          saveVars(next)
            .then(function () {
              enabled = next.enabled !== '0'
              pinError = next.pin_error !== '0'
              pinFinished = next.pin_finished !== '0'
              lastKey = ''
              tick()
              msg.textContent = '已保存'
            })
            .catch(function (e) {
              msg.textContent = (e && e.message) || '失败'
            })
        })
      })
    }
  })

  if (P.on) P.on('ready', boot)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
