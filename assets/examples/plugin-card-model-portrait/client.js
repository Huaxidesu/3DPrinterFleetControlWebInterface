/**
 * card_model_portrait — 设备卡片机型肖像
 *
 * - 槽位只用 device.card.before
 * - 本地 static/models 离线图；软件设置「机型肖像」可补充/修改 PNG
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
    if (b === 'bambu' || b === 'bambulab') return 'Bambu'
    if (b === 'creality') return '创想'
    if (b === 'elegoo') return '爱乐库'
    if (b === 'anycubic') return '纵维'
    if (b === 'snapmaker') return 'Snapmaker'
    if (b === 'flashforge') return '闪铸'
    if (b === 'qidi') return '启迪'
    if (b === 'voron' || b === 'klipper') return 'Voron'
    if (b === 'prusa') return 'Prusa'
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

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (j) {
        var payload = j && j.data && typeof j.data === 'object' ? j.data : j
        if (!r.ok || (payload && payload.ok === false)) {
          throw new Error((payload && (payload.error || payload.message)) || '请求失败')
        }
        return payload
      })
    })
  }

  function renderSettings(el, lib) {
    var brands = (lib && lib.brands) || []
    var customs = (lib && lib.custom) || []
    var builtin = (lib && lib.builtin) || []
    var brandOpts = brands
      .map(function (b) {
        return (
          '<option value="' +
          escapeHtml(b.id) +
          '">' +
          escapeHtml(b.name) +
          '</option>'
        )
      })
      .join('')

    function rowHtml(it, canEdit) {
      var src = it.thumb || it.url || DEFAULT_SRC
      return (
        '<div class="cmp-lib-row" data-brand="' +
        escapeHtml(it.brand || '') +
        '" data-model="' +
        escapeHtml(it.model || '') +
        '" data-key="' +
        escapeHtml(it.id || '') +
        '">' +
        '<img class="cmp-lib-thumb" src="' +
        escapeHtml(src) +
        '" alt="" loading="lazy" />' +
        '<div class="cmp-lib-meta">' +
        '<div><strong>' +
        escapeHtml(it.brandLabel || it.brand || '') +
        '</strong> · ' +
        escapeHtml(it.model || '') +
        '</div>' +
        '<div class="cmp-lib-sub">' +
        (it.custom ? '自定义上传' : '内置图库') +
        (it.bytes ? ' · ' + Math.round(it.bytes / 1024) + ' KB' : '') +
        (it.missing ? ' · 文件缺失，请重新上传' : '') +
        '</div></div>' +
        '<div class="cmp-lib-actions">' +
        (canEdit
          ? '<button type="button" class="cmp-btn" data-act="replace">更换</button>' +
            (it.custom
              ? '<button type="button" class="cmp-btn cmp-btn-danger" data-act="del">删除</button>'
              : '')
          : '<button type="button" class="cmp-btn" data-act="replace">覆盖</button>') +
        '</div></div>'
      )
    }

    el.innerHTML =
      '<div class="settings-tab-panel cmp-settings">' +
      '<h3>机型肖像</h3>' +
      '<p class="cmp-hint">不显示图片时，可在此补充品牌与机型的 PNG；保存后该机型将固定使用此图，也可更换已有图片。</p>' +
      '<div class="cmp-form">' +
      '<label>品牌<select data-k="brand">' +
      brandOpts +
      '</select></label>' +
      '<label>机型<input data-k="model" placeholder="如 P1S / K1 Max / Neptune 4" /></label>' +
      '<label>PNG 图片<input data-k="file" type="file" accept="image/png,image/jpeg,image/webp" /></label>' +
      '<div class="cmp-form-actions">' +
      '<button type="button" class="cmp-btn cmp-btn-primary" data-act="save">保存 / 更新</button>' +
      '<button type="button" class="cmp-btn" data-act="reload">刷新列表</button>' +
      '<span class="cmp-msg" data-msg></span>' +
      '</div>' +
      '<div class="cmp-preview-wrap"><img class="cmp-preview" data-preview alt="" /></div>' +
      '</div>' +
      '<h4>自定义图片（' +
      customs.length +
      '）</h4>' +
      '<div class="cmp-lib">' +
      (customs.length
        ? customs.map(function (it) {
            return rowHtml(it, true)
          }).join('')
        : '<p class="cmp-hint">暂无自定义，可在上方添加。</p>') +
      '</div>' +
      '<h4>内置图库（' +
      builtin.length +
      '）</h4>' +
      '<div class="cmp-lib">' +
      builtin
        .map(function (it) {
          return rowHtml(it, false)
        })
        .join('') +
      '</div></div>'
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader()
      fr.onload = function () {
        resolve(String(fr.result || ''))
      }
      fr.onerror = function () {
        reject(new Error('读取文件失败'))
      }
      fr.readAsDataURL(file)
    })
  }

  function bindSettings(el) {
    if (el._cmpBound) return
    el._cmpBound = true
    var pendingFile = null
    var autoSaveOnPick = false

    function doSave(btn) {
      var msg = el.querySelector('[data-msg]')
      var brand = (el.querySelector('[data-k="brand"]') || {}).value || 'custom'
      var model = String((el.querySelector('[data-k="model"]') || {}).value || '').trim()
      var fileInp2 = el.querySelector('[data-k="file"]')
      var file = pendingFile || (fileInp2 && fileInp2.files && fileInp2.files[0])
      if (!model) {
        if (msg) msg.textContent = '请填写机型'
        return
      }
      if (!file) {
        if (msg) msg.textContent = '请选择 PNG 图片'
        return
      }
      if (btn) btn.disabled = true
      if (msg) msg.textContent = '保存中…'
      readFileAsBase64(file)
        .then(function (dataUrl) {
          return fetchJson('/api/v1/card-model-portrait/override', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              brand: brand,
              model: model,
              pngBase64: dataUrl
            })
          })
        })
        .then(function () {
          if (msg) msg.textContent = '已保存，卡片将使用此图'
          pendingFile = null
          autoSaveOnPick = false
          imgByKey = Object.create(null)
          return loadSettings(el)
        })
        .then(function () {
          return loadModels().then(refresh)
        })
        .catch(function (e) {
          if (msg) msg.textContent = e.message || '保存失败'
        })
        .then(function () {
          if (btn) btn.disabled = false
        })
    }

    el.addEventListener('change', function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      if (t.getAttribute('data-k') === 'file' && t.files && t.files[0]) {
        pendingFile = t.files[0]
        var prev = el.querySelector('[data-preview]')
        if (prev) {
          prev.src = URL.createObjectURL(pendingFile)
          prev.style.display = 'block'
        }
        var msg = el.querySelector('[data-msg]')
        if (autoSaveOnPick) {
          doSave(el.querySelector('[data-act="save"]'))
        } else if (msg) {
          msg.textContent = '已选择图片，点「保存 / 更新」生效'
        }
      }
    })

    el.addEventListener('click', function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      var act = t.getAttribute('data-act')
      var msg = el.querySelector('[data-msg]')
      if (!act) return

      if (act === 'reload') {
        loadSettings(el)
        return
      }

      if (act === 'replace') {
        var row = t.closest('.cmp-lib-row')
        if (!row) return
        var brandSel = el.querySelector('[data-k="brand"]')
        var modelInp = el.querySelector('[data-k="model"]')
        if (brandSel) brandSel.value = row.getAttribute('data-brand') || 'custom'
        if (modelInp) modelInp.value = row.getAttribute('data-model') || ''
        autoSaveOnPick = true
        var fileInp = el.querySelector('[data-k="file"]')
        if (fileInp) fileInp.click()
        if (msg) msg.textContent = '请选择图片，选完后自动保存'
        return
      }

      if (act === 'del') {
        var rowDel = t.closest('.cmp-lib-row')
        if (!rowDel) return
        if (!confirm('删除该自定义图片？将恢复内置图（如有）。')) return
        t.disabled = true
        fetchJson('/api/v1/card-model-portrait/override-delete', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            key: rowDel.getAttribute('data-key') || '',
            brand: rowDel.getAttribute('data-brand') || '',
            model: rowDel.getAttribute('data-model') || ''
          })
        })
          .then(function () {
            if (msg) msg.textContent = '已删除'
            imgByKey = Object.create(null)
            return loadSettings(el)
          })
          .then(function () {
            return loadModels().then(refresh)
          })
          .catch(function (e) {
            if (msg) msg.textContent = e.message || '删除失败'
          })
          .then(function () {
            t.disabled = false
          })
        return
      }

      if (act === 'save') {
        doSave(t)
      }
    })
  }

  function loadSettings(el) {
    el.innerHTML = '<div class="settings-tab-panel"><p>加载中…</p></div>'
    return fetchJson('/api/v1/card-model-portrait/library', { headers: authHeaders() })
      .then(function (lib) {
        renderSettings(el, lib || {})
        bindSettings(el)
      })
      .catch(function (e) {
        el.innerHTML =
          '<div class="settings-tab-panel"><p class="cmp-err">' +
          escapeHtml(e.message || '加载失败') +
          '</p></div>'
      })
  }

  P.registerSettingsTab({
    key: 'card_model_portrait',
    label: '机型肖像',
    after: 'plugins',
    order: 14,
    adminOnly: true,
    plugin: 'card_model_portrait',
    render: function (el) {
      loadSettings(el)
    }
  })

  P.emit('card_model_portrait:ready', { ok: true })
})()
