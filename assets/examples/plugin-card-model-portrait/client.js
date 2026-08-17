/**
 * card_model_portrait — 设备卡片机型肖像
 *
 * - 槽位只用 device.card.before，不占 after-name / temps / extra / footer，兼容其它插件
 * - 无设置页；免费图源由服务端 Openverse / Wikimedia 解析
 * - 未设机型 → 内置透明默认图
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var DEFAULT_SRC = '/api/v1/plugins/card_model_portrait/static/default.svg'
  var byId = Object.create(null)
  var imgByKey = Object.create(null)
  var resolving = Object.create(null)
  var timer = null

  function authHeaders() {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function cacheKey(brand, model) {
    var b = String(brand || '')
      .trim()
      .toLowerCase()
    var m = String(model || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
    if (!m) return 'default'
    return b + '|' + m
  }

  function brandLabel(b) {
    b = String(b || '').toLowerCase()
    if (b === 'bambu') return 'Bambu'
    if (b === 'creality') return 'Creality'
    if (b === 'elegoo') return 'Elegoo'
    if (b === 'anycubic') return 'Anycubic'
    if (b === 'prusa') return 'Prusa'
    if (b === 'flashforge') return 'Flashforge'
    return b ? b.charAt(0).toUpperCase() + b.slice(1) : 'Printer'
  }

  function tagCard(el) {
    var card = el && el.closest && el.closest('.device-card')
    if (!card) return null
    card.classList.add('cmp-card')
    return card
  }

  function modelMeta(ctx) {
    var c = (ctx && ctx.context) || {}
    var id = c.deviceId != null ? String(c.deviceId) : ''
    var row = id && byId[id] ? byId[id] : null
    var brand = (row && row.brand) || c.brand || ''
    var model = row && row.model != null ? String(row.model).trim() : ''
    return { id: id, brand: brand, model: model, name: (row && row.name) || c.deviceName || '' }
  }

  function srcFor(meta) {
    var key = cacheKey(meta.brand, meta.model)
    var hit = imgByKey[key]
    if (hit && hit.url) return hit.url
    return DEFAULT_SRC
  }

  function captionFor(meta) {
    if (meta.model) return brandLabel(meta.brand) + ' · ' + meta.model
    return '未设置机型'
  }

  function heroHtml(meta) {
    var src = srcFor(meta)
    var cap = captionFor(meta)
    var unknown = !meta.model
    return (
      '<div class="cmp-hero' +
      (unknown ? ' is-default' : '') +
      '" data-device-id="' +
      escapeHtml(meta.id) +
      '">' +
      '<div class="cmp-hero-glow" aria-hidden="true"></div>' +
      '<div class="cmp-hero-frame">' +
      '<img class="cmp-hero-img" alt="" src="' +
      escapeHtml(src) +
      '" loading="lazy" referrerpolicy="no-referrer" />' +
      '</div>' +
      '<div class="cmp-hero-caption">' +
      '<span class="cmp-hero-caption-text">' +
      escapeHtml(cap) +
      '</span>' +
      '</div>' +
      '</div>'
    )
  }

  function ensureResolved(meta) {
    var key = cacheKey(meta.brand, meta.model)
    if (imgByKey[key] || resolving[key]) return
    resolving[key] = true
    var q =
      '/api/v1/card-model-portrait/resolve?brand=' +
      encodeURIComponent(meta.brand || '') +
      '&model=' +
      encodeURIComponent(meta.model || '')
    fetch(q, { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var p = data && data.data && typeof data.data === 'object' ? data.data : data
        if (!p || p.ok === false) {
          imgByKey[key] = { url: DEFAULT_SRC, default: true }
          return
        }
        imgByKey[key] = {
          url: p.url || DEFAULT_SRC,
          default: !!p.default || !p.url,
          source: p.source || ''
        }
      })
      .catch(function () {
        imgByKey[key] = { url: DEFAULT_SRC, default: true }
      })
      .finally(function () {
        delete resolving[key]
        P.emit('slot:change', { name: 'device.card.before' })
      })
  }

  function loadModels() {
    return fetch('/api/v1/card-model-portrait/models', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var payload = data && data.data && typeof data.data === 'object' ? data.data : data
        var rows = (payload && payload.rows) || []
        var next = Object.create(null)
        var batch = []
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i]
          if (!row || !row.id) continue
          next[String(row.id)] = {
            id: String(row.id),
            name: row.name || '',
            brand: row.brand || '',
            model: row.model != null ? String(row.model).trim() : ''
          }
          batch.push({
            id: String(row.id),
            brand: row.brand || '',
            model: row.model != null ? String(row.model).trim() : ''
          })
        }
        byId = next
        return warmBatch(batch)
      })
      .catch(function () {
        return fallbackDevices()
      })
  }

  function warmBatch(items) {
    if (!items || !items.length) return null
    return fetch('/api/v1/card-model-portrait/resolve-batch', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ items: items })
    })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var payload = data && data.data && typeof data.data === 'object' ? data.data : data
        var list = (payload && payload.items) || []
        for (var i = 0; i < list.length; i++) {
          var it = list[i]
          if (!it) continue
          var key = cacheKey(it.brand, it.model)
          imgByKey[key] = {
            url: it.url || DEFAULT_SRC,
            default: !!it.default || !it.url,
            source: it.source || ''
          }
        }
      })
      .catch(function () {})
  }

  function fallbackDevices() {
    return fetch('/api/v1/devices', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var list =
          (data && data.data && data.data.devices) ||
          (data && data.devices) ||
          (Array.isArray(data && data.data) ? data.data : null) ||
          (Array.isArray(data) ? data : null) ||
          []
        var next = Object.create(null)
        for (var i = 0; i < list.length; i++) {
          var d = list[i]
          if (!d || !d.id) continue
          next[String(d.id)] = {
            id: String(d.id),
            name: d.name || '',
            brand: d.brand || '',
            model: d.model != null ? String(d.model).trim() : ''
          }
        }
        byId = next
      })
      .catch(function () {})
  }

  P.registerSlot(
    'device.card.before',
    function (el, ctx) {
      tagCard(el)
      var meta = modelMeta(ctx)
      ensureResolved(meta)
      el.innerHTML = heroHtml(meta)
      var img = el.querySelector('.cmp-hero-img')
      if (img) {
        img.addEventListener('error', function () {
          if (img.getAttribute('src') !== DEFAULT_SRC) img.setAttribute('src', DEFAULT_SRC)
        })
      }
    },
    { order: 1, plugin: 'card_model_portrait' }
  )

  function refresh() {
    P.emit('slot:change', { name: 'device.card.before' })
  }

  loadModels().then(function () {
    refresh()
    if (timer) clearInterval(timer)
    timer = setInterval(function () {
      loadModels().then(refresh)
    }, 60000)
  })

  P.emit('card_model_portrait:ready', { ok: true })
})()
