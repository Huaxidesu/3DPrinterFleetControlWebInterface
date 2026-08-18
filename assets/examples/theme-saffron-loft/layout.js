/**
 * saffron_loft — 藏红工坊
 * 底栏胶囊导航 · 票券机位 · 标题跟随当前导航
 */
;(function () {
  var T = window.HanyeTheme
  if (!T) return

  var tickerLines = [
    '工坊机位就绪 · 票券式监控',
    '底栏导航 · 非经典侧栏',
    '藏红强调 · 薄荷辅色 · 入场动效',
    '点击票券打开控制面板'
  ]
  var tickerIdx = 0
  var lastTitle = ''

  var SECTION_META = {
    fdm: { en: 'FDM FLEET', zh: 'FDM', devices: true },
    resin: { en: 'RESIN LAB', zh: '光固化', devices: true },
    filament: { en: 'FILAMENT', zh: '耗材管理', devices: false },
    tools: { en: 'TOOLS', zh: '常用工具', devices: false },
    quoteHistory: { en: 'QUOTE LOG', zh: '报价记录', devices: false },
    monitorWall: { en: 'MONITOR', zh: '内部监控', devices: false },
    monitorZones: { en: 'ZONES', zh: '区域监控', devices: false },
    models: { en: 'MODELS', zh: '模型网站', devices: false },
    aiModels: { en: 'AI MODELS', zh: 'AI 建模网', devices: false },
    users: { en: 'USERS', zh: '用户权限', devices: false },
    printApprove: { en: 'APPROVAL', zh: '打印审核/队列', devices: false },
    settings: { en: 'SETTINGS', zh: '软件设置', devices: false }
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n
  }

  function clock() {
    var d = new Date()
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  }

  function textOf(el) {
    if (!el) return ''
    return String(el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function findSelectedNav() {
    var dock = document.querySelector('.sl-dock') || document
    var sel =
      dock.querySelector('.ant-menu-item-selected') ||
      dock.querySelector('.ant-menu-submenu-selected > .ant-menu-submenu-title')
    if (!sel) return { key: '', label: '' }
    var key = ''
    try {
      key = String(sel.getAttribute('data-menu-id') || sel.getAttribute('data-menu-key') || '')
      // ant design 5: data-menu-id like "rc-menu-uuid-settings"
      if (key) {
        var parts = key.split('-')
        key = parts[parts.length - 1] || key
      }
    } catch (_) {}
    var labelEl = sel.querySelector('.ant-menu-title-content') || sel
    var label = textOf(labelEl)
    return { key: key, label: label }
  }

  function guessKeyFromLabel(label) {
    var map = [
      ['软件设置', 'settings'],
      ['FDM', 'fdm'],
      ['光固化', 'resin'],
      ['耗材', 'filament'],
      ['常用工具', 'tools'],
      ['报价', 'quoteHistory'],
      ['内部监控', 'monitorWall'],
      ['区域监控', 'monitorZones'],
      ['模型网站', 'models'],
      ['AI', 'aiModels'],
      ['用户', 'users'],
      ['打印审核', 'printApprove'],
      ['设置', 'settings']
    ]
    for (var i = 0; i < map.length; i++) {
      if (label.indexOf(map[i][0]) >= 0) return map[i][1]
    }
    return ''
  }

  function syncNavTitle() {
    var nav = findSelectedNav()
    var label = nav.label
    var key = nav.key
    if (!key || !SECTION_META[key]) key = guessKeyFromLabel(label)
    var meta = SECTION_META[key] || null

    var title = label || (meta && meta.zh) || '当前位置'
    if (!title) title = '当前位置'
    // strip icon-only leftovers
    if (title.length > 24) title = title.slice(0, 24)

    var kicker = (meta && meta.en) || 'NOW HERE'
    if (key && String(key).indexOf('plugin:') === 0) {
      kicker = 'PLUGIN'
    } else if (key && String(key).indexOf('page:') === 0) {
      kicker = 'PAGE'
    }

    var titleEls = document.querySelectorAll('[data-sl-title]')
    for (var i = 0; i < titleEls.length; i++) titleEls[i].textContent = title
    var kickEls = document.querySelectorAll('[data-sl-kicker]')
    for (var j = 0; j < kickEls.length; j++) kickEls[j].textContent = kicker

    var showDevices = meta ? meta.devices : /FDM|光固化/.test(title)
    var metaEls = document.querySelectorAll('[data-sl-meta]')
    for (var m = 0; m < metaEls.length; m++) {
      metaEls[m].style.display = showDevices ? '' : 'none'
    }

    if (title !== lastTitle) {
      lastTitle = title
      var tickers = document.querySelectorAll('[data-sl-ticker]')
      for (var t = 0; t < tickers.length; t++) {
        tickers[t].textContent = '当前：' + title
      }
    }
  }

  function tagCards() {
    var cards = document.querySelectorAll('.sl-main .device-card, .device-grid .device-card')
    for (var i = 0; i < cards.length; i++) {
      cards[i].style.setProperty('--sl-i', String(Math.min(i, 24)))
      cards[i].classList.add('sl-ticket')
    }
    var countEls = document.querySelectorAll('[data-sl-count]')
    for (var j = 0; j < countEls.length; j++) {
      countEls[j].textContent = String(cards.length)
    }
  }

  function tickClock() {
    var els = document.querySelectorAll('[data-sl-clock]')
    var t = clock()
    for (var i = 0; i < els.length; i++) els[i].textContent = t
  }

  function rotateTicker() {
    if (lastTitle) return
    tickerIdx = (tickerIdx + 1) % tickerLines.length
    var els = document.querySelectorAll('[data-sl-ticker]')
    for (var i = 0; i < els.length; i++) els[i].textContent = tickerLines[tickerIdx]
  }

  function flattenDockMenus() {
    var dock = document.querySelector('.sl-dock')
    if (!dock) return
    var titles = dock.querySelectorAll('.ant-menu-submenu-title')
    for (var i = 0; i < titles.length; i++) {
      titles[i].style.borderRadius = '999px'
    }
  }

  T.registerSlot('device.card.after', function (el, ctx) {
    var name =
      (ctx && ctx.context && (ctx.context.deviceName || ctx.context.deviceId)) || 'UNIT'
    el.innerHTML =
      '<div class="sl-card-stub">LOFT · ' + String(name).slice(0, 16) + '</div>'
  })

  T.registerSlot('device.detail.before', function (el) {
    el.innerHTML =
      '<div class="sl-ticker" style="margin-bottom:12px">' +
      '<span class="sl-ticker-live">OPS</span>' +
      '<span class="sl-ticker-text">票券详情 · 藏红工坊</span></div>'
  })

  T.on('ready', function (p) {
    console.log('[saffron_loft] ready', p && p.packId, p && p.siteMode)
    document.documentElement.classList.add('sl-ready')
    tickClock()
    tagCards()
    flattenDockMenus()
    syncNavTitle()

    document.addEventListener(
      'click',
      function () {
        setTimeout(syncNavTitle, 40)
        setTimeout(syncNavTitle, 200)
      },
      true
    )

    if (!window.__slLoftTimer) {
      window.__slLoftTimer = setInterval(function () {
        tickClock()
        tagCards()
        flattenDockMenus()
        syncNavTitle()
      }, 800)
    }
    if (!window.__slTickerTimer) {
      window.__slTickerTimer = setInterval(rotateTicker, 4200)
    }
  })
})()
