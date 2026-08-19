/**
 * fdm_fleet_cards — FDM 机群紧凑卡片
 *
 * - 默认保留原设备卡片与全部功能
 * - 工具栏切换图标 → 超紧凑机群视图（一屏数百台）
 * - 显示：名称、挤出/热床温度、进度条、剩余时间
 * - 打印完成：透明「完成」盖章；报错：「报错」盖章
 * - 完成瞬间语音播报：「{名字}打印完成」；报错瞬间：「{名字}报错」
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var LS_COMPACT = 'hanye_fdm_fleet_compact'
  var LS_VOICE = 'hanye_fdm_fleet_voice'

  var compact = localStorage.getItem(LS_COMPACT) === '1'
  var voiceOn = localStorage.getItem(LS_VOICE) !== '0'
  var serverVoice = true
  var defaultCompact = false

  var toolbarEl = null
  var fleetHost = null
  var timer = null
  var sectionTimer = null
  var rowsCache = []
  var prevFinished = Object.create(null)
  var prevError = Object.create(null)
  var primed = false
  var brandFilter = 'all'
  var statusKinds = []
  var speakQueue = []
  var speakTimer = null
  var lastUtterance = null
  var speechUnlocked = false

  function authHeaders() {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json' }
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function isFdmSection() {
    return !!document.querySelector('.brand-filter-bar.tech-fdm')
  }

  function formatRemain(sec) {
    if (sec == null || !Number.isFinite(Number(sec)) || Number(sec) <= 0) return '--'
    var s = Math.round(Number(sec))
    var h = Math.floor(s / 3600)
    var m = Math.floor((s % 3600) / 60)
    if (h > 0) return h + 'h' + (m > 0 ? m + 'm' : '')
    if (m > 0) return m + 'm'
    return s + 's'
  }

  function fmtTemp(n) {
    if (n == null || !Number.isFinite(Number(n))) return '--'
    return Math.round(Number(n)) + '°'
  }

  function isErrorRow(row) {
    if (row && row.error) return true
    var h = String((row && row.health) || '')
    if (h === 'error') return true
    var s = String((row && row.state) || '').toLowerCase()
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

  function kindOf(row) {
    var h = String((row && row.health) || 'offline')
    if (h === 'offline' || h === 'connecting') return 'offline'
    if (isErrorRow(row)) return 'error'
    if (row && row.finished) return 'finished'
    if (row && row.printing) return 'printing'
    var s = String((row && row.state) || '').toLowerCase()
    if (s.indexOf('pause') >= 0) return 'printing'
    if (s === 'idle' || s === 'standby' || s === 'ready') return 'idle'
    if (Number(row && row.progress) > 0 && Number(row.progress) < 100) return 'printing'
    return 'idle'
  }

  function readBrandFilter() {
    var active = document.querySelector('.brand-filter-bar.tech-fdm .brand-filter-tag.active')
    if (!active) return 'all'
    var t = String(active.textContent || '').replace(/\d+/g, '').trim()
    var map = {
      全部: 'all',
      Klipper: 'klipper',
      创想三维: 'creality',
      爱乐库: 'elegoo',
      纵维立方: 'anycubic',
      Snapmaker: 'snapmaker',
      闪铸: 'flashforge',
      启迪: 'qidi',
      'Bambu Lab': 'bambu'
    }
    return map[t] || 'all'
  }

  function readStatusFilters() {
    var out = []
    var wraps = document.querySelectorAll('.device-status-filters .ant-checkbox-wrapper')
    for (var i = 0; i < wraps.length; i++) {
      var w = wraps[i]
      if (!w.classList.contains('ant-checkbox-wrapper-checked')) continue
      var label = String(w.textContent || '').trim()
      if (label.indexOf('空闲') >= 0) out.push('idle')
      else if (label.indexOf('打印完成') >= 0) out.push('finished')
      else if (label.indexOf('报错') >= 0) out.push('error')
      else if (label.indexOf('正在打印') >= 0) out.push('printing')
      else if (label.indexOf('离线') >= 0) out.push('offline')
    }
    return out
  }

  function filteredRows() {
    brandFilter = readBrandFilter()
    statusKinds = readStatusFilters()
    return rowsCache.filter(function (r) {
      if (brandFilter !== 'all' && String(r.brand) !== brandFilter) return false
      if (statusKinds.length && statusKinds.indexOf(kindOf(r)) < 0) return false
      return true
    })
  }

  function pickZhVoice() {
    try {
      var voices = window.speechSynthesis.getVoices() || []
      for (var i = 0; i < voices.length; i++) {
        var v = voices[i]
        var key = String((v && v.lang) || '') + ' ' + String((v && v.name) || '')
        if (/zh-CN|zh_CN|Chinese|中文|普通话|Ting-Ting|Mei-Jia/i.test(key)) return v
      }
      for (var j = 0; j < voices.length; j++) {
        if (/^zh/i.test(String(voices[j].lang || ''))) return voices[j]
      }
    } catch (_) {
      /* ignore */
    }
    return null
  }

  function unlockSpeech() {
    speechUnlocked = true
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return
    try {
      window.speechSynthesis.resume()
    } catch (_) {
      /* ignore */
    }
  }

  function speakNow(text) {
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return
    try {
      window.speechSynthesis.resume()
      var u = new window.SpeechSynthesisUtterance(String(text || ''))
      u.lang = 'zh-CN'
      u.rate = 1
      u.volume = 1
      var voice = pickZhVoice()
      if (voice) u.voice = voice
      lastUtterance = u
      window.speechSynthesis.speak(u)
    } catch (_) {
      /* ignore */
    }
  }

  function drainSpeak() {
    if (speakTimer) return
    speakTimer = setTimeout(function () {
      speakTimer = null
      if (!voiceOn || !serverVoice) {
        speakQueue = []
        return
      }
      if (!speakQueue.length) return
      if (window.speechSynthesis && window.speechSynthesis.speaking) {
        drainSpeak()
        return
      }
      speakNow(speakQueue.shift())
      if (speakQueue.length) drainSpeak()
    }, 120)
  }

  function speak(text) {
    if (!voiceOn || !serverVoice) return
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return
    speakQueue.push(String(text || ''))
    drainSpeak()
  }

  function speakDone(name) {
    speak(String(name || '打印机') + '打印完成')
  }

  function speakError(name) {
    speak(String(name || '打印机') + '报错')
  }

  function detectStatusTransitions(rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]
      var id = r.id
      var nowDone = !!r.finished && !isErrorRow(r)
      var nowErr = isErrorRow(r)
      var prevDone = prevFinished[id]
      var prevErr = prevError[id]
      if (primed && prevDone === false && nowDone === true) {
        speakDone(r.name)
      }
      if (primed && prevErr === false && nowErr === true) {
        speakError(r.name)
      }
      prevFinished[id] = nowDone
      prevError[id] = nowErr
    }
    primed = true
  }

  function tileHtml(r) {
    var pct = Math.min(100, Math.max(0, Number(r.progress) || 0))
    var finished = !!r.finished
    var k = kindOf(r)
    var err = k === 'error'
    var stamp =
      err || finished
        ? '<span class="ffc-stamp' +
          (err ? ' ffc-stamp-error' : '') +
          '" aria-hidden="true"><span class="ffc-stamp-text">' +
          (err ? '报错' : '完成') +
          '</span></span>'
        : ''
    var tip = r.name + (r.filename ? ' · ' + r.filename : '') + (r.message ? ' · ' + r.message : '')
    return (
      '<button type="button" class="ffc-tile ffc-k-' +
      k +
      (finished && !err ? ' is-done' : '') +
      (err ? ' is-error' : '') +
      '" data-id="' +
      escapeHtml(r.id) +
      '" title="' +
      escapeHtml(tip) +
      '">' +
      stamp +
      '<div class="ffc-name">' +
      escapeHtml(r.name) +
      '</div>' +
      '<div class="ffc-temps">' +
      '<span>喷 ' +
      fmtTemp(r.extruderActual) +
      '</span>' +
      '<span>床 ' +
      fmtTemp(r.bedActual) +
      '</span>' +
      '</div>' +
      '<div class="ffc-bar"><i style="width:' +
      pct +
      '%"></i></div>' +
      '<div class="ffc-meta">' +
      '<span class="ffc-pct">' +
      pct +
      '%</span>' +
      '<span class="ffc-eta">' +
      (err ? '报错' : finished ? '完成' : formatRemain(r.remainingSeconds)) +
      '</span>' +
      '</div>' +
      '</button>'
    )
  }

  function renderFleet() {
    if (!fleetHost) return
    if (!compact || !isFdmSection()) {
      fleetHost.innerHTML = ''
      return
    }
    var rows = filteredRows()
    fleetHost.innerHTML =
      '<div class="ffc-fleet">' +
      '<div class="ffc-fleet-head">' +
      '<strong>机群紧凑视图</strong>' +
      '<span class="ffc-fleet-count">' +
      rows.length +
      ' 台</span>' +
      '<span class="ffc-fleet-hint">点击卡片可打开原控制面板</span>' +
      '</div>' +
      '<div class="ffc-fleet-grid">' +
      (rows.length
        ? rows.map(tileHtml).join('')
        : '<div class="ffc-empty">没有匹配的 FDM 设备</div>') +
      '</div></div>'
  }

  function applyBodyClass() {
    var on = compact && isFdmSection()
    document.body.classList.toggle('ffc-compact', on)
    document.documentElement.classList.toggle('ffc-compact', on)
  }

  function setCompact(on) {
    compact = !!on
    localStorage.setItem(LS_COMPACT, compact ? '1' : '0')
    applyBodyClass()
    renderToolbar()
    renderFleet()
    if (compact) startPoll(true)
    else stopPoll()
  }

  function setVoice(on) {
    unlockSpeech()
    voiceOn = !!on
    localStorage.setItem(LS_VOICE, voiceOn ? '1' : '0')
    renderToolbar()
    if (voiceOn && serverVoice) speakNow('语音播报已打开')
  }

  function renderToolbar() {
    if (!toolbarEl) return
    if (!isFdmSection()) {
      toolbarEl.innerHTML = ''
      return
    }
    toolbarEl.innerHTML =
      '<div class="ffc-toolbar" role="group" aria-label="FDM 机群视图">' +
      '<button type="button" class="ffc-toggle' +
      (compact ? ' is-on' : '') +
      '" data-act="toggle" title="' +
      (compact ? '切换回原卡片' : '切换为紧凑机群视图') +
      '">' +
      '<span class="ffc-ico" aria-hidden="true">' +
      (compact
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="18" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>') +
      '</span>' +
      '<span>' +
      (compact ? '原卡片' : '机群紧凑') +
      '</span></button>' +
      '<button type="button" class="ffc-toggle' +
      (voiceOn && serverVoice ? ' is-on' : '') +
      '" data-act="voice" title="完成/报错语音播报">' +
      '<span class="ffc-ico" aria-hidden="true">' +
      (voiceOn && serverVoice
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16 8.5a5 5 0 010 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M18 9l-4 6M14 9l4 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>') +
      '</span></button></div>'
  }

  function ensurePageSizeAll(done) {
    var label = document.querySelector('.device-page-bar .ant-select-selection-item')
    if (label && /全部/.test(label.textContent || '')) {
      if (done) done()
      return
    }
    var trigger = document.querySelector('.device-page-bar .ant-select-selector')
    if (!trigger) {
      if (done) done()
      return
    }
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    trigger.click()
    setTimeout(function () {
      var opts = document.querySelectorAll('.ant-select-item-option')
      for (var i = 0; i < opts.length; i++) {
        if (/全部/.test(opts[i].textContent || '')) {
          opts[i].click()
          break
        }
      }
      setTimeout(function () {
        if (done) done()
      }, 80)
    }, 120)
  }

  function huntAndClick(id, done) {
    var tries = 0
    var sp = document.querySelector('.app-main') || document.scrollingElement
    var safeId = String(id || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    var timerHunt = setInterval(function () {
      tries++
      var card = document.querySelector('.device-card[data-device-id="' + safeId + '"]')
      if (card) {
        clearInterval(timerHunt)
        try {
          card.scrollIntoView({ block: 'center', inline: 'nearest' })
        } catch (_) {}
        card.click()
        if (done) done(true)
        return
      }
      if (sp) sp.scrollTop += 480
      if (tries > 50) {
        clearInterval(timerHunt)
        if (done) done(false)
      }
    }, 60)
  }

  function openDevice(id) {
    if (!id) return
    // Preferred: host API (printer-monitor with HanyePlugin.selectDevice)
    if (typeof P.selectDevice === 'function') {
      try {
        P.selectDevice(id)
        return
      } catch (_) {
        /* fall through */
      }
    }
    // Fallback for older host: temporarily show native grid and click the card
    var reopen = compact
    setCompact(false)
    ensurePageSizeAll(function () {
      huntAndClick(id, function () {
        if (reopen) {
          setTimeout(function () {
            setCompact(true)
          }, 200)
        }
      })
    })
  }

  function loadSnapshot() {
    return fetch('/api/v1/fdm-fleet/snapshot', { headers: authHeaders() })
      .then(function (r) {
        return r.json()
      })
      .then(function (j) {
        var p = j && j.data && typeof j.data === 'object' ? j.data : j
        if (!p || p.ok === false) return
        if (typeof p.voiceAnnounce === 'boolean') serverVoice = p.voiceAnnounce
        if (typeof p.defaultCompact === 'boolean') defaultCompact = p.defaultCompact
        rowsCache = Array.isArray(p.rows) ? p.rows : []
        detectStatusTransitions(rowsCache)
        renderFleet()
        renderToolbar()
      })
      .catch(function () {})
  }

  function startPoll(immediate) {
    stopPoll()
    if (immediate) loadSnapshot()
    timer = setInterval(loadSnapshot, 2500)
  }

  function stopPoll() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function bindToolbar(el) {
    if (el._ffcBound) return
    el._ffcBound = true
    el.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null
      if (!t) return
      var act = t.getAttribute('data-act')
      if (act === 'toggle') {
        unlockSpeech()
        setCompact(!compact)
      }
      if (act === 'voice') setVoice(!voiceOn)
    })
  }

  function bindFleet(el) {
    if (el._ffcBound) return
    el._ffcBound = true
    el.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('.ffc-tile') : null
      if (!t) return
      openDevice(t.getAttribute('data-id') || '')
    })
  }

  P.registerSlot(
    'device.grid.toolbar.after',
    function (el) {
      toolbarEl = el
      bindToolbar(el)
      renderToolbar()
      applyBodyClass()
      if (compact && isFdmSection()) startPoll(true)
    },
    { order: 5, plugin: 'fdm_fleet_cards' }
  )

  P.registerSlot(
    'device.grid.after',
    function (el) {
      fleetHost = el
      bindFleet(el)
      renderFleet()
    },
    { order: 5, plugin: 'fdm_fleet_cards' }
  )

  // brand / status filter clicks → refresh fleet filter
  document.addEventListener(
    'click',
    function () {
      if (!compact) return
      setTimeout(renderFleet, 30)
    },
    true
  )

  sectionTimer = setInterval(function () {
    var fdm = isFdmSection()
    applyBodyClass()
    renderToolbar()
    if (!fdm) {
      if (compact) {
        // leave compact flag but hide UI off FDM section
        renderFleet()
        stopPoll()
      }
      return
    }
    if (compact && !timer) startPoll(true)
  }, 1500)

  // first config
  fetch('/api/v1/fdm-fleet/config', { headers: authHeaders() })
    .then(function (r) {
      return r.json()
    })
    .then(function (j) {
      var p = j && j.data && typeof j.data === 'object' ? j.data : j
      if (!p || p.ok === false) return
      if (typeof p.voiceAnnounce === 'boolean') serverVoice = p.voiceAnnounce
      if (typeof p.defaultCompact === 'boolean') defaultCompact = p.defaultCompact
      if (localStorage.getItem(LS_COMPACT) == null && defaultCompact) {
        setCompact(true)
      }
      renderToolbar()
    })
    .catch(function () {})

  P.emit('fdm_fleet_cards:ready', { ok: true })

  try {
    if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
      window.speechSynthesis.addEventListener('voiceschanged', function () {
        pickZhVoice()
      })
      window.speechSynthesis.getVoices()
    }
  } catch (_) {
    /* ignore */
  }
})()
