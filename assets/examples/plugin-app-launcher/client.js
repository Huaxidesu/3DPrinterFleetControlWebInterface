/**
 * app_launcher — 悬浮快捷启动 UI + 软件设置
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var POS_KEY = 'hanye_app_launcher_pos'
  var OPEN_KEY = 'hanye_app_launcher_panel'

  var state = {
    config: null,
    me: null,
    panelOpen: false,
    dragging: false
  }

  function authHeaders() {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function unwrap(data) {
    if (data && data.data && typeof data.data === 'object' && data.ok !== false) {
      if (data.data.ok != null || data.data.config || data.data.me) return data.data
    }
    return data
  }

  function api(path, method, body) {
    var opts = { method: method || 'GET', headers: authHeaders() }
    if (body != null) opts.body = JSON.stringify(body)
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (data) {
        var payload = unwrap(data)
        if (!r.ok || (payload && payload.ok === false)) {
          throw new Error((payload && payload.message) || (data && data.message) || '请求失败')
        }
        return payload
      })
    })
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function detectClientPlatform() {
    var ua = navigator.userAgent || ''
    var plat = navigator.platform || ''
    if (/Mac|iPhone|iPad|iPod/i.test(plat) || /Mac OS X/i.test(ua)) return 'mac'
    if (/Win/i.test(plat) || /Windows/i.test(ua)) return 'win'
    if (/Linux/i.test(plat)) return 'linux'
    return 'both'
  }

  function pathToFileUrl(p) {
    var s = String(p || '').trim()
    if (!s) return ''
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s
    if (/^[A-Za-z]:[\\/]/.test(s)) {
      var win = s.replace(/\\/g, '/')
      return 'file:///' + encodeURI(win).replace(/#/g, '%23')
    }
    if (s.charAt(0) === '/') {
      return 'file://' + encodeURI(s).replace(/#/g, '%23')
    }
    return s
  }

  function agentPort() {
    return (state.config && state.config.agentPort) || 18791
  }

  function agentOrigin() {
    return 'http://127.0.0.1:' + agentPort()
  }

  function agentFetch(path, method, body) {
    var opts = {
      method: method || 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
    }
    if (body != null) opts.body = JSON.stringify(body)
    return fetch(agentOrigin() + path, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || (data && data.ok === false)) {
          throw new Error((data && data.message) || '本机助手失败')
        }
        return data
      })
    })
  }

  function pingAgent() {
    return fetch(agentOrigin() + '/status', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
      .then(function (r) {
        return r.json()
      })
      .catch(function () {
        return null
      })
  }

  function pairAgent(creds) {
    return agentFetch('/pair', 'POST', {
      userId: creds.userId,
      username: creds.displayName || creds.username,
      pairToken: creds.pairToken,
      serverOrigin: window.location.origin
    })
  }

  function openViaAgent(item, creds) {
    return agentFetch('/open', 'POST', {
      userId: creds.userId,
      pairToken: creds.pairToken,
      path: item.path,
      openMode: item.openMode,
      title: item.title
    }).then(function () {
      return { ok: true, via: 'agent' }
    })
  }

  function cornerOf() {
    var me = state.me || {}
    var cfg = state.config || {}
    return me.effectiveCorner || me.corner || cfg.fabCornerDefault || 'br'
  }

  function visibleShortcuts() {
    var me = state.me || {}
    var list = (me.shortcuts || []).filter(function (s) {
      return s && s.enabled !== false && s.path
    })
    var client = detectClientPlatform()
    list = list.filter(function (s) {
      var p = String(s.platform || 'both').toLowerCase()
      return p === 'both' || p === 'all' || p === client
    })
    list.sort(function (a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
    })
    var limit = Number(me.effectiveShowLimit)
    if (!Number.isFinite(limit) || limit <= 0) {
      var cfg = state.config || {}
      limit = Number(cfg.showLimitDefault) || 0
    }
    if (limit > 0) list = list.slice(0, limit)
    return list
  }

  function openViaElectron(item) {
    var api = window.electronAPI
    if (!api) return Promise.resolve(false)
    var shell = api.shell
    // 优先 openPath（真正打开本机路径）；openExternal 对 file:// 经常无效
    if (item.openMode !== 'url' && shell && typeof shell.openPath === 'function') {
      return Promise.resolve(shell.openPath(String(item.path)))
        .then(function (errMsg) {
          if (errMsg) throw new Error(String(errMsg))
          return true
        })
        .catch(function () {
          return false
        })
    }
    if (!shell || typeof shell.openExternal !== 'function') return Promise.resolve(false)
    var target = item.openMode === 'url' ? String(item.path) : pathToFileUrl(item.path)
    return Promise.resolve(shell.openExternal(target))
      .then(function () {
        return item.openMode === 'url'
      })
      .catch(function () {
        return false
      })
  }

  function openShortcut(item) {
    return openViaElectron(item).then(function (ok) {
      if (ok) return { ok: true, via: 'electron' }
      return api('/api/v1/app-launcher/agent/credentials').then(function (creds) {
        return pingAgent().then(function (st) {
          if (st && st.ok) {
            var needPair = !st.paired || String(st.userId) !== String(creds.userId)
            var p = needPair ? pairAgent(creds) : Promise.resolve(st)
            return p.then(function () {
              return openViaAgent(item, creds)
            })
          }
          return api('/api/v1/app-launcher/open', 'POST', {
            id: item.id,
            clientPlatform: detectClientPlatform(),
            preferAgent: true
          }).then(function () {
            throw new Error(
              '未检测到本机助手。请到「软件设置 → 快捷启动」下载安装（Win 或 Mac），装好后点「绑定当前账号」，再打开软件。'
            )
          })
        })
      })
    })
  }

  function ensureRoot() {
    var root = document.getElementById('al-root')
    if (root) return root
    root = document.createElement('div')
    root.id = 'al-root'
    root.className = 'al-root'
    document.body.appendChild(root)
    return root
  }

  function loadPos() {
    try {
      var raw = localStorage.getItem(POS_KEY)
      if (!raw) return null
      var o = JSON.parse(raw)
      if (o && typeof o.x === 'number' && typeof o.y === 'number') return o
    } catch (_) {}
    return null
  }

  function savePos(x, y) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ x: x, y: y }))
    } catch (_) {}
  }

  function applyCornerDefaults(fab) {
    var c = cornerOf()
    var size = (state.config && state.config.fabSize) || 56
    fab.style.width = size + 'px'
    fab.style.height = size + 'px'
    fab.style.left = 'auto'
    fab.style.right = 'auto'
    fab.style.top = 'auto'
    fab.style.bottom = 'auto'
    if (c === 'bl') {
      fab.style.left = '24px'
      fab.style.bottom = '24px'
    } else if (c === 'tr') {
      fab.style.right = '24px'
      fab.style.top = '24px'
    } else if (c === 'tl') {
      fab.style.left = '24px'
      fab.style.top = '24px'
    } else {
      fab.style.right = '24px'
      fab.style.bottom = '24px'
    }
  }

  function applyPos(fab) {
    var size = (state.config && state.config.fabSize) || 56
    fab.style.width = size + 'px'
    fab.style.height = size + 'px'
    var pos = loadPos()
    if (pos) {
      fab.style.left = Math.max(8, pos.x) + 'px'
      fab.style.top = Math.max(8, pos.y) + 'px'
      fab.style.right = 'auto'
      fab.style.bottom = 'auto'
    } else {
      applyCornerDefaults(fab)
    }
    syncPanelPos(fab)
  }

  function syncPanelPos(fab) {
    var panel = document.getElementById('al-panel')
    if (!panel || !fab) return
    var rect = fab.getBoundingClientRect()
    var size = rect.height || 56
    var spaceBelow = window.innerHeight - rect.bottom
    var spaceAbove = rect.top
    panel.style.left = 'auto'
    panel.style.right = 'auto'
    panel.style.top = 'auto'
    panel.style.bottom = 'auto'
    if (rect.left + 160 > window.innerWidth / 2) {
      panel.style.right = Math.max(8, window.innerWidth - rect.right) + 'px'
    } else {
      panel.style.left = Math.max(8, rect.left) + 'px'
    }
    if (spaceBelow < 240 && spaceAbove > spaceBelow) {
      panel.style.bottom = Math.max(8, window.innerHeight - rect.top + 12) + 'px'
    } else {
      panel.style.top = Math.max(8, rect.bottom + 12) + 'px'
    }
  }

  function bindDrag(fab) {
    var startX = 0
    var startY = 0
    var startLeft = 0
    var startTop = 0
    var moved = false

    function onMove(e) {
      if (!state.dragging) return
      var dx = e.clientX - startX
      var dy = e.clientY - startY
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
      var left = Math.max(8, Math.min(window.innerWidth - 48, startLeft + dx))
      var top = Math.max(8, Math.min(window.innerHeight - 48, startTop + dy))
      fab.style.left = left + 'px'
      fab.style.top = top + 'px'
      fab.style.right = 'auto'
      fab.style.bottom = 'auto'
      syncPanelPos(fab)
      e.preventDefault()
    }

    function onUp() {
      if (!state.dragging) return
      state.dragging = false
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      var left = parseFloat(fab.style.left) || 24
      var top = parseFloat(fab.style.top) || 24
      savePos(left, top)
      syncPanelPos(fab)
      fab.dataset.moved = moved ? '1' : '0'
    }

    fab.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return
      state.dragging = true
      moved = false
      startX = e.clientX
      startY = e.clientY
      var rect = fab.getBoundingClientRect()
      startLeft = rect.left
      startTop = rect.top
      fab.style.left = startLeft + 'px'
      fab.style.top = startTop + 'px'
      fab.style.right = 'auto'
      fab.style.bottom = 'auto'
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    })
  }

  function renderPanel(panel) {
    var list = visibleShortcuts()
    if (!list.length) {
      panel.innerHTML =
        '<div class="al-empty">还没有快捷方式。<br/>打开「软件设置 → 快捷启动」添加。' +
        '<div class="al-empty-actions"><button type="button" data-al-goto-settings>去设置</button></div></div>'
      return
    }
    var html = '<div class="al-list">'
    list.forEach(function (s) {
      html +=
        '<button type="button" class="al-item" data-al-open="' +
        escapeHtml(s.id) +
        '" title="' +
        escapeHtml(s.path) +
        '">' +
        (s.iconDataUrl
          ? '<img class="al-item-icon" alt="" src="' + String(s.iconDataUrl).replace(/"/g, '') + '" />'
          : '<span class="al-item-icon al-item-icon-fallback">◆</span>') +
        '<span class="al-item-text"><span class="al-item-title">' +
        escapeHtml(s.title) +
        '</span><span class="al-item-meta">' +
        escapeHtml(s.platform) +
        ' · ' +
        escapeHtml(s.openMode) +
        '</span></span></button>'
    })
    html += '</div>'
    html +=
      '<div class="al-panel-foot"><button type="button" data-al-goto-settings>管理快捷方式</button></div>'
    panel.innerHTML = html
  }

  function setPanelOpen(open) {
    state.panelOpen = Boolean(open)
    try {
      localStorage.setItem(OPEN_KEY, state.panelOpen ? '1' : '0')
    } catch (_) {}
    var panel = document.getElementById('al-panel')
    var fab = document.getElementById('al-fab')
    if (panel) {
      panel.classList.toggle('is-open', state.panelOpen)
      if (state.panelOpen) {
        renderPanel(panel)
        syncPanelPos(fab)
      }
    }
    if (fab) fab.setAttribute('aria-expanded', state.panelOpen ? 'true' : 'false')
  }

  function mountFab() {
    var cfg = state.config
    if (!cfg || !cfg.enabled) {
      var old = document.getElementById('al-root')
      if (old) old.remove()
      return
    }
    var root = ensureRoot()
    var icon = cfg.fabIconDataUrl || ''
    root.innerHTML =
      '<div id="al-panel" class="al-panel" role="dialog" aria-label="快捷启动"></div>' +
      '<button type="button" id="al-fab" class="al-fab" aria-label="快捷启动" aria-expanded="false">' +
      (icon
        ? '<img class="al-fab-img" alt="" draggable="false" src="' + icon.replace(/"/g, '') + '" />'
        : '<span class="al-fab-fallback">App</span>') +
      '</button>' +
      '<div id="al-toast" class="al-toast" hidden></div>'

    var fab = document.getElementById('al-fab')
    var panel = document.getElementById('al-panel')
    applyPos(fab)
    bindDrag(fab)

    fab.addEventListener('click', function () {
      if (fab.dataset.moved === '1') {
        fab.dataset.moved = '0'
        return
      }
      setPanelOpen(!state.panelOpen)
    })

    root.addEventListener('click', function (e) {
      var t = e.target
      if (!t || !t.closest) return
      var openBtn = t.closest('[data-al-open]')
      if (openBtn) {
        var id = openBtn.getAttribute('data-al-open')
        var item = ((state.me && state.me.shortcuts) || []).find(function (s) {
          return String(s.id) === String(id)
        })
        if (!item) return
        openBtn.disabled = true
        openShortcut(item)
          .then(function () {
            toast('已打开：' + (item.title || ''))
            setPanelOpen(false)
          })
          .catch(function (err) {
            toast(err.message || '打开失败', true)
          })
          .then(function () {
            openBtn.disabled = false
          })
        return
      }
      if (t.closest('[data-al-goto-settings]')) {
        setPanelOpen(false)
        toast('请到「软件设置 → 快捷启动」管理')
      }
    })

    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape' && state.panelOpen) setPanelOpen(false)
    })

    try {
      if (localStorage.getItem(OPEN_KEY) === '1') setPanelOpen(true)
      else renderPanel(panel)
    } catch (_) {
      renderPanel(panel)
    }
  }

  function toast(msg, isErr) {
    var el = document.getElementById('al-toast')
    if (!el) return
    el.hidden = false
    el.className = 'al-toast' + (isErr ? ' is-err' : '')
    el.textContent = String(msg || '')
    clearTimeout(toast._t)
    toast._t = setTimeout(function () {
      el.hidden = true
    }, 2600)
  }

  function refresh() {
    return api('/api/v1/app-launcher/me')
      .then(function (res) {
        state.config = res.config || null
        state.me = res.me || null
        mountFab()
      })
      .catch(function () {})
  }

  function loadPluginVars() {
    return fetch('/api/v1/plugins', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (data) {
        var list = (data && data.data && data.data.plugins) || data.plugins || data.data || []
        if (!Array.isArray(list)) list = []
        var hit = list.find(function (p) {
          return p && (p.identifier === 'app_launcher' || p.id === 'app_launcher')
        })
        return (hit && (hit.vars || hit.configVars)) || {}
      })
  }

  function savePluginVars(vars) {
    return fetch('/api/v1/plugins/app_launcher/vars', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ vars: vars })
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || (data && data.ok === false)) {
          throw new Error((data && data.message) || '保存失败（需管理员）')
        }
        return data
      })
    })
  }

  function platformLabel(p) {
    if (p === 'mac') return 'macOS'
    if (p === 'win') return 'Windows'
    if (p === 'linux') return 'Linux'
    return 'Win+Mac'
  }

  function cornerLabel(c) {
    if (c === 'bl') return '左下'
    if (c === 'tr') return '右上'
    if (c === 'tl') return '左上'
    return '右下'
  }

  function readFileAsDataUrl(file, maxBytes) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('未选择文件'))
      if (maxBytes && file.size > maxBytes) return reject(new Error('图片过大'))
      var reader = new FileReader()
      reader.onload = function () {
        resolve(String(reader.result || ''))
      }
      reader.onerror = function () {
        reject(new Error('读取失败'))
      }
      reader.readAsDataURL(file)
    })
  }

  function renderShortcutEditor(box, shortcuts) {
    var rows = shortcuts && shortcuts.length ? shortcuts : []
    var html =
      '<table class="al-table"><thead><tr>' +
      '<th>图标</th><th>名称</th><th>路径 / URL</th><th>打开方式</th><th>系统</th><th></th>' +
      '</tr></thead><tbody>'
    if (!rows.length) {
      html += '<tr><td colspan="6" class="al-muted">暂无快捷方式，点击下方添加</td></tr>'
    }
    rows.forEach(function (s, i) {
      html +=
        '<tr data-idx="' +
        i +
        '" data-id="' +
        escapeHtml(s.id || '') +
        '" data-icon="' +
        escapeHtml(s.iconDataUrl || '') +
        '">' +
        '<td class="al-icon-cell">' +
        (s.iconDataUrl
          ? '<img class="al-sc-icon" alt="" src="' + String(s.iconDataUrl).replace(/"/g, '') + '" />'
          : '<span class="al-sc-icon al-sc-icon-empty">无</span>') +
        '<input type="file" accept="image/*" data-icon-file hidden />' +
        '<button type="button" class="al-btn-ghost al-btn-xs" data-pick-icon>图</button>' +
        '</td>' +
        '<td><input class="al-input" name="title" value="' +
        escapeHtml(s.title || '') +
        '" /></td>' +
        '<td><input class="al-input al-path" name="path" value="' +
        escapeHtml(s.path || '') +
        '" placeholder="C:\\…\\app.exe 或 /Applications/Foo.app" /></td>' +
        '<td><select class="al-input" name="openMode">' +
        '<option value="app"' +
        (s.openMode !== 'url' ? ' selected' : '') +
        '>应用路径</option>' +
        '<option value="url"' +
        (s.openMode === 'url' ? ' selected' : '') +
        '>URL/协议</option>' +
        '</select></td>' +
        '<td><select class="al-input" name="platform">' +
        '<option value="both"' +
        (!s.platform || s.platform === 'both' ? ' selected' : '') +
        '>Win+Mac</option>' +
        '<option value="win"' +
        (s.platform === 'win' ? ' selected' : '') +
        '>Windows</option>' +
        '<option value="mac"' +
        (s.platform === 'mac' ? ' selected' : '') +
        '>macOS</option>' +
        '</select></td>' +
        '<td><button type="button" class="al-btn-danger" data-del>删</button></td>' +
        '</tr>'
    })
    html += '</tbody></table>'
    box.innerHTML = html
  }

  function collectShortcuts(box) {
    var out = []
    box.querySelectorAll('tbody tr[data-idx]').forEach(function (tr, i) {
      var title = tr.querySelector('[name=title]')
      var pathEl = tr.querySelector('[name=path]')
      var openMode = tr.querySelector('[name=openMode]')
      var platform = tr.querySelector('[name=platform]')
      var p = pathEl && pathEl.value ? pathEl.value.trim() : ''
      if (!p) return
      var id = tr.getAttribute('data-id') || ''
      var icon = tr.getAttribute('data-icon') || ''
      out.push({
        id: id || undefined,
        title: (title && title.value) || '未命名',
        path: p,
        openMode: (openMode && openMode.value) || 'app',
        platform: (platform && platform.value) || 'both',
        sortOrder: i,
        enabled: true,
        iconDataUrl: icon || ''
      })
    })
    return out
  }

  function exportMyShortcuts(shortcuts, meta) {
    var payload = {
      v: 1,
      kind: 'app_launcher_shortcuts',
      exportedAt: new Date().toISOString(),
      platform: (meta && meta.platform) || detectClientPlatform(),
      showLimit: (meta && meta.showLimit) || 0,
      corner: (meta && meta.corner) || '',
      shortcuts: (shortcuts || []).map(function (s) {
        return {
          title: s.title,
          path: s.path,
          openMode: s.openMode,
          platform: s.platform,
          sortOrder: s.sortOrder,
          enabled: s.enabled !== false,
          iconDataUrl: s.iconDataUrl || ''
        }
      })
    }
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    var a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'app-launcher-shortcuts.json'
    a.click()
    setTimeout(function () {
      URL.revokeObjectURL(a.href)
    }, 1000)
  }

  function parseImportJson(text) {
    var o = JSON.parse(text)
    var list = Array.isArray(o) ? o : o.shortcuts
    if (!Array.isArray(list)) throw new Error('JSON 中没有 shortcuts 数组')
    return {
      shortcuts: list.map(function (s, i) {
        return {
          title: s.title || '未命名',
          path: s.path || s.target || '',
          openMode: s.openMode || s.open_mode || 'app',
          platform: s.platform || 'both',
          sortOrder: s.sortOrder != null ? s.sortOrder : i,
          enabled: s.enabled !== false,
          iconDataUrl: s.iconDataUrl || s.icon || ''
        }
      }),
      showLimit: o.showLimit,
      platform: o.platform,
      corner: o.corner
    }
  }

  function renderSettings(el, pack) {
    var cfg = pack.config || {}
    var me = pack.me || {}
    var vars = pack.vars || {}
    var isAdm = Boolean(pack.isAdmin)
    var client = detectClientPlatform()
    var allowUserFab = cfg.allowUserFab !== false

    var html =
      '<div class="settings-tab-panel al-settings">' +
      '<h3>悬浮快捷启动</h3>' +
      '<p class="al-hint">当前客户端：<strong>' +
      escapeHtml(platformLabel(client)) +
      '</strong>；服务端：<strong>' +
      escapeHtml(platformLabel(cfg.hostPlatform)) +
      '</strong>；存储：' +
      escapeHtml(me.storage || (cfg.db ? 'mysql' : 'json')) +
      '。全局设置仅管理员可改；快捷方式每人自己的。</p>'

    if (isAdm) {
      html +=
        '<div class="al-card"><h4>全局设置（仅管理员）</h4>' +
        '<div class="al-fab-preview-wrap">' +
        '<img class="al-fab-preview" id="al-fab-preview" alt="" src="' +
        escapeHtml(cfg.globalFabIconDataUrl || cfg.fabIconDataUrl || '') +
        '" />' +
        '<div>' +
        '<input type="file" id="al-fab-file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" />' +
        '<div class="al-actions">' +
        '<button type="button" class="al-btn" data-fab-upload>上传全局图标</button> ' +
        '<button type="button" class="al-btn-ghost" data-fab-clear>恢复默认</button>' +
        '</div></div></div>' +
        '<div class="al-field"><label>启用悬浮球</label>' +
        '<select class="al-input" name="enabled">' +
        '<option value="1"' +
        (vars.enabled !== '0' ? ' selected' : '') +
        '>开启</option>' +
        '<option value="0"' +
        (vars.enabled === '0' ? ' selected' : '') +
        '>关闭</option></select></div>' +
        '<div class="al-field"><label>默认角落</label>' +
        '<select class="al-input" name="fab_corner">' +
        ['br', 'bl', 'tr', 'tl']
          .map(function (c) {
            var cur = vars.fab_corner || cfg.fabCornerDefault || 'br'
            return (
              '<option value="' +
              c +
              '"' +
              (cur === c ? ' selected' : '') +
              '>' +
              cornerLabel(c) +
              '</option>'
            )
          })
          .join('') +
        '</select></div>' +
        '<div class="al-field"><label>默认显示个数（0=全部）</label>' +
        '<input class="al-input" name="show_limit" type="number" min="0" max="40" value="' +
        escapeHtml(vars.show_limit != null ? vars.show_limit : cfg.showLimitDefault || 0) +
        '" /></div>' +
        '<div class="al-field"><label>按钮边长(px)</label>' +
        '<input class="al-input" name="fab_size" type="number" min="40" max="96" value="' +
        escapeHtml(vars.fab_size != null ? vars.fab_size : cfg.fabSize || 56) +
        '" /></div>' +
        '<div class="al-field"><label>允许服务端本机打开</label>' +
        '<select class="al-input" name="allow_server_open">' +
        '<option value="1"' +
        (vars.allow_server_open !== '0' ? ' selected' : '') +
        '>开启</option>' +
        '<option value="0"' +
        (vars.allow_server_open === '0' ? ' selected' : '') +
        '>关闭</option></select></div>' +
        '<div class="al-field"><label>允许每人自定义悬浮图标</label>' +
        '<select class="al-input" name="allow_user_fab">' +
        '<option value="1"' +
        (vars.allow_user_fab !== '0' ? ' selected' : '') +
        '>允许</option>' +
        '<option value="0"' +
        (vars.allow_user_fab === '0' ? ' selected' : '') +
        '>禁止（只用全局图）</option></select></div>' +
        '<div class="al-actions"><button type="button" class="al-btn" data-save-vars>保存全局设置</button>' +
        '<span data-vars-msg class="al-msg"></span></div>' +
        '<div class="al-card-sub"><h4>各用户统计</h4><div data-admin-users class="al-muted">加载中…</div></div>' +
        '</div>'
    }

    html +=
      '<div class="al-card"><h4>本机助手（打开软件用）</h4>' +
      '<p class="al-hint">在你这台电脑安装一次即可：后台隐藏、开机自启。网页点击只发给<strong>当前登录用户</strong>绑定的助手，不会让别人电脑一起打开。</p>' +
      '<p class="al-hint" data-agent-status>正在检测本机助手…</p>' +
      '<div class="al-actions">' +
      '<a class="al-btn" href="' +
      escapeHtml((cfg.agentDownloads && cfg.agentDownloads.win) || '/api/v1/plugins/app_launcher/static/agent/HanyeLauncher-windows.zip') +
      '" download>下载 Windows 助手</a> ' +
      '<a class="al-btn-ghost" href="' +
      escapeHtml((cfg.agentDownloads && cfg.agentDownloads.mac) || '/api/v1/plugins/app_launcher/static/agent/HanyeLauncher-mac.zip') +
      '" download>下载 Mac 助手</a> ' +
      '<button type="button" class="al-btn" data-agent-pair>绑定当前账号</button>' +
      '<span data-agent-msg class="al-msg"></span></div>' +
      '<p class="al-hint">Windows：解压后双击 <code>install.bat</code>。Mac：解压后运行 <code>install.sh</code>。</p>' +
      '</div>'

    html +=
      '<div class="al-card"><h4>我的快捷方式</h4>' +
      '<div class="al-field"><label>我显示几个（0=跟随全局）</label>' +
      '<input class="al-input" name="my_show_limit" type="number" min="0" max="40" value="' +
      escapeHtml(me.showLimit != null ? me.showLimit : 0) +
      '" /></div>' +
      '<div class="al-field"><label>我的默认角落（空=跟随全局；拖动后以拖动位置为准）</label>' +
      '<select class="al-input" name="my_corner">' +
      '<option value=""' +
      (!me.corner ? ' selected' : '') +
      '>跟随全局（' +
      escapeHtml(cornerLabel(cfg.fabCornerDefault || 'br')) +
      '）</option>' +
      ['br', 'bl', 'tr', 'tl']
        .map(function (c) {
          return (
            '<option value="' +
            c +
            '"' +
            (me.corner === c ? ' selected' : '') +
            '>' +
            cornerLabel(c) +
            '</option>'
          )
        })
        .join('') +
      '</select></div>' +
      '<div class="al-field"><label>记录的系统偏好</label>' +
      '<select class="al-input" name="my_platform">' +
      '<option value="both"' +
      (!me.platform || me.platform === 'both' ? ' selected' : '') +
      '>Win+Mac</option>' +
      '<option value="win"' +
      (me.platform === 'win' ? ' selected' : '') +
      '>Windows</option>' +
      '<option value="mac"' +
      (me.platform === 'mac' ? ' selected' : '') +
      '>macOS</option></select></div>'

    if (allowUserFab) {
      html +=
        '<div class="al-field"><label>我的悬浮图标（可选）</label>' +
        '<div class="al-fab-preview-wrap">' +
        '<img class="al-fab-preview" id="al-my-fab-preview" alt="" src="' +
        escapeHtml(me.fabIconDataUrl || cfg.fabIconDataUrl || '') +
        '" />' +
        '<div><input type="file" id="al-my-fab-file" accept="image/*" />' +
        '<div class="al-actions">' +
        '<button type="button" class="al-btn-ghost" data-my-fab-upload>上传我的图标</button> ' +
        '<button type="button" class="al-btn-ghost" data-my-fab-clear>清除（用全局）</button>' +
        '</div></div></div></div>'
    }

    html +=
      '<div data-sc-editor></div>' +
      '<div class="al-actions">' +
      '<button type="button" class="al-btn-ghost" data-add-sc>添加一条</button> ' +
      '<button type="button" class="al-btn" data-save-me>保存我的快捷方式</button> ' +
      '<button type="button" class="al-btn-ghost" data-export>导出 JSON</button> ' +
      '<button type="button" class="al-btn-ghost" data-import>导入 JSON</button>' +
      '<input type="file" id="al-import-file" accept="application/json,.json" hidden />' +
      '<span data-me-msg class="al-msg"></span></div>' +
      '<p class="al-hint">Windows：<code>D:\\Program Files (x86)\\Bambu Studio\\bambu-studio.exe</code>；macOS：<code>/Applications/Safari.app</code>；也可填 URL。<br/>点打开时由<strong>本机助手</strong>启动软件（先安装并绑定账号）。</p>' +
      '</div></div>'

    el.innerHTML = html

    var editor = el.querySelector('[data-sc-editor]')
    var draft = (me.shortcuts || []).slice()
    renderShortcutEditor(editor, draft)

    function refreshAgentStatus() {
      var box = el.querySelector('[data-agent-status]')
      if (!box) return
      pingAgent().then(function (st) {
        if (!st || !st.ok) {
          box.innerHTML = '本机助手：<strong>未运行</strong>。请下载安装后刷新本页。'
          return
        }
        if (st.paired) {
          box.innerHTML =
            '本机助手：<strong>运行中</strong>，已绑定账号 <code>' +
            escapeHtml(st.username || st.userId) +
            '</code>'
        } else {
          box.innerHTML = '本机助手：<strong>运行中</strong>，尚未绑定。请点「绑定当前账号」。'
        }
      })
    }
    refreshAgentStatus()
    var pairBtn = el.querySelector('[data-agent-pair]')
    if (pairBtn) {
      pairBtn.addEventListener('click', function () {
        var msg = el.querySelector('[data-agent-msg]')
        msg.textContent = '绑定中…'
        api('/api/v1/app-launcher/agent/credentials')
          .then(function (creds) {
            return pingAgent().then(function (st) {
              if (!st || !st.ok) throw new Error('没检测到助手，请先安装并确认已启动')
              return pairAgent(creds)
            })
          })
          .then(function () {
            msg.textContent = '已绑定当前账号'
            refreshAgentStatus()
          })
          .catch(function (err) {
            msg.textContent = err.message || '绑定失败'
          })
      })
    }

    function syncDraftFromDom() {
      draft = collectShortcuts(editor)
    }

    el.querySelector('[data-add-sc]').addEventListener('click', function () {
      syncDraftFromDom()
      draft.push({
        title: '',
        path: '',
        openMode: 'app',
        platform: client === 'linux' ? 'both' : client,
        sortOrder: draft.length,
        enabled: true,
        iconDataUrl: ''
      })
      renderShortcutEditor(editor, draft)
    })

    editor.addEventListener('click', function (e) {
      var t = e.target
      if (!t || !t.closest) return
      var del = t.closest('[data-del]')
      if (del) {
        var tr = del.closest('tr')
        syncDraftFromDom()
        var idx = tr ? Number(tr.getAttribute('data-idx')) : -1
        if (idx >= 0) draft.splice(idx, 1)
        renderShortcutEditor(editor, draft)
        return
      }
      var pick = t.closest('[data-pick-icon]')
      if (pick) {
        var row = pick.closest('tr')
        var input = row && row.querySelector('[data-icon-file]')
        if (input) input.click()
      }
    })

    editor.addEventListener('change', function (e) {
      var input = e.target
      if (!input || !input.matches || !input.matches('[data-icon-file]')) return
      var file = input.files && input.files[0]
      var row = input.closest('tr')
      if (!file || !row) return
      readFileAsDataUrl(file, 256 * 1024)
        .then(function (dataUrl) {
          row.setAttribute('data-icon', dataUrl)
          syncDraftFromDom()
          renderShortcutEditor(editor, draft)
        })
        .catch(function (err) {
          alert(err.message || '图标读取失败')
        })
    })

    function saveMe(extra) {
      var msg = el.querySelector('[data-me-msg]')
      var showLimit = Number(el.querySelector('[name=my_show_limit]').value) || 0
      var platform = el.querySelector('[name=my_platform]').value || detectClientPlatform()
      var corner = el.querySelector('[name=my_corner]').value
      var shortcuts = collectShortcuts(editor)
      var body = {
        shortcuts: shortcuts,
        showLimit: showLimit,
        platform: platform,
        corner: corner,
        keepFabIcon: true
      }
      if (extra) {
        Object.keys(extra).forEach(function (k) {
          body[k] = extra[k]
        })
      }
      msg.textContent = '保存中…'
      return api('/api/v1/app-launcher/me', 'PUT', body).then(function (res) {
        state.me = res.me
        if (res.config) state.config = res.config
        draft = (res.me && res.me.shortcuts) || shortcuts
        renderShortcutEditor(editor, draft)
        msg.textContent = '已保存（' + draft.length + ' 个）'
        refresh()
        return res
      })
    }

    el.querySelector('[data-save-me]').addEventListener('click', function () {
      saveMe().catch(function (err) {
        el.querySelector('[data-me-msg]').textContent = err.message || '保存失败'
      })
    })

    el.querySelector('[data-export]').addEventListener('click', function () {
      var shortcuts = collectShortcuts(editor)
      exportMyShortcuts(shortcuts, {
        platform: el.querySelector('[name=my_platform]').value,
        showLimit: Number(el.querySelector('[name=my_show_limit]').value) || 0,
        corner: el.querySelector('[name=my_corner]').value
      })
    })

    var importFile = el.querySelector('#al-import-file')
    el.querySelector('[data-import]').addEventListener('click', function () {
      importFile.click()
    })
    importFile.addEventListener('change', function () {
      var f = importFile.files && importFile.files[0]
      if (!f) return
      var reader = new FileReader()
      reader.onload = function () {
        try {
          var parsed = parseImportJson(String(reader.result || ''))
          draft = parsed.shortcuts
          if (parsed.showLimit != null) el.querySelector('[name=my_show_limit]').value = parsed.showLimit
          if (parsed.platform) el.querySelector('[name=my_platform]').value = parsed.platform
          if (parsed.corner != null) el.querySelector('[name=my_corner]').value = parsed.corner || ''
          renderShortcutEditor(editor, draft)
          el.querySelector('[data-me-msg]').textContent = '已导入 ' + draft.length + ' 条，请点保存'
        } catch (err) {
          alert(err.message || '导入失败')
        }
        importFile.value = ''
      }
      reader.readAsText(f)
    })

    if (allowUserFab) {
      var myFabBtn = el.querySelector('[data-my-fab-upload]')
      if (myFabBtn) {
        myFabBtn.addEventListener('click', function () {
          var f = el.querySelector('#al-my-fab-file')
          var file = f && f.files && f.files[0]
          if (!file) {
            alert('请先选择图片')
            return
          }
          readFileAsDataUrl(file, 2 * 1024 * 1024)
            .then(function (dataUrl) {
              return saveMe({ fabIconDataUrl: dataUrl, keepFabIcon: false })
            })
            .then(function (res) {
              var img = el.querySelector('#al-my-fab-preview')
              if (img && res.config) img.src = res.config.fabIconDataUrl || ''
            })
            .catch(function (err) {
              alert(err.message || '上传失败')
            })
        })
      }
      var clearBtn = el.querySelector('[data-my-fab-clear]')
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          saveMe({ clearFabIcon: true, keepFabIcon: false })
            .then(function (res) {
              var img = el.querySelector('#al-my-fab-preview')
              if (img && res.config) img.src = res.config.fabIconDataUrl || ''
            })
            .catch(function (err) {
              alert(err.message || '失败')
            })
        })
      }
    }

    if (isAdm) {
      var fileInput = el.querySelector('#al-fab-file')
      el.querySelector('[data-fab-upload]').addEventListener('click', function () {
        var f = fileInput && fileInput.files && fileInput.files[0]
        if (!f) {
          alert('请先选择图片')
          return
        }
        readFileAsDataUrl(f, 2 * 1024 * 1024)
          .then(function (dataUrl) {
            return api('/api/v1/app-launcher/fab-icon', 'POST', { dataUrl: dataUrl })
          })
          .then(function (res) {
            state.config = res.config
            var img = el.querySelector('#al-fab-preview')
            if (img && res.config) img.src = res.config.globalFabIconDataUrl || res.config.fabIconDataUrl || ''
            refresh()
          })
          .catch(function (err) {
            alert(err.message || '上传失败')
          })
      })
      el.querySelector('[data-fab-clear]').addEventListener('click', function () {
        api('/api/v1/app-launcher/fab-icon', 'POST', { clear: true })
          .then(function (res) {
            state.config = res.config
            var img = el.querySelector('#al-fab-preview')
            if (img && res.config) img.src = res.config.globalFabIconDataUrl || res.config.fabIconDataUrl || ''
            refresh()
          })
          .catch(function (err) {
            alert(err.message || '失败')
          })
      })
      el.querySelector('[data-save-vars]').addEventListener('click', function () {
        var msg = el.querySelector('[data-vars-msg]')
        var next = {
          enabled: el.querySelector('[name=enabled]').value,
          show_limit: el.querySelector('[name=show_limit]').value,
          fab_size: el.querySelector('[name=fab_size]').value,
          fab_corner: el.querySelector('[name=fab_corner]').value,
          allow_server_open: el.querySelector('[name=allow_server_open]').value,
          allow_user_fab: el.querySelector('[name=allow_user_fab]').value
        }
        msg.textContent = '保存中…'
        savePluginVars(next)
          .then(function () {
            msg.textContent = '全局设置已保存'
            try {
              localStorage.removeItem(POS_KEY)
            } catch (_) {}
            return refresh()
          })
          .catch(function (err) {
            msg.textContent = err.message || '失败'
          })
      })
      var usersEl = el.querySelector('[data-admin-users]')
      api('/api/v1/app-launcher/admin/users')
        .then(function (res) {
          var users = res.users || []
          if (!users.length) {
            usersEl.textContent = '暂无用户数据'
            return
          }
          usersEl.innerHTML =
            '<ul class="al-user-list">' +
            users
              .map(function (u) {
                return (
                  '<li><strong>' +
                  escapeHtml(u.displayName || u.username || u.userId) +
                  '</strong> · ' +
                  Number(u.shortcutCount || 0) +
                  ' 个 · ' +
                  escapeHtml(platformLabel(u.platform)) +
                  '</li>'
                )
              })
              .join('') +
            '</ul>'
        })
        .catch(function () {
          usersEl.textContent = '无法加载统计'
        })
    }
  }

  function loadSettings(el) {
    el.innerHTML = '<div class="settings-tab-panel"><p>加载中…</p></div>'
    Promise.all([
      api('/api/v1/app-launcher/me'),
      loadPluginVars().catch(function () {
        return {}
      })
    ])
      .then(function (pair) {
        var meRes = pair[0]
        var vars = pair[1]
        state.config = meRes.config
        state.me = meRes.me
        var isAdmin = Boolean(meRes.me && meRes.me.isAdmin)
        if (isAdmin) {
          renderSettings(el, { config: meRes.config, me: meRes.me, vars: vars, isAdmin: true })
          return
        }
        renderSettings(el, { config: meRes.config, me: meRes.me, vars: vars, isAdmin: false })
      })
      .catch(function (e) {
        el.innerHTML =
          '<div class="settings-tab-panel"><p class="al-err">' +
          escapeHtml(e.message || '加载失败') +
          '</p></div>'
      })
  }

  P.registerSettingsTab({
    key: 'app_launcher',
    label: '快捷启动',
    after: 'plugins',
    order: 12,
    adminOnly: false,
    plugin: 'app_launcher',
    render: function (el) {
      loadSettings(el)
    }
  })

  function boot() {
    refresh()
  }

  if (P.on) P.on('ready', boot)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
