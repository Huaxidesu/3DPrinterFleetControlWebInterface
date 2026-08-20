/**
 * farm_dispatch — 宿主内：设置页初始化用户组（无新窗口、无悬浮条，避免卡死）
 */
;(function () {
  var P = window.HanyePlugin
  if (!P) return

  var TOKEN_KEY = 'hanye_client_jwt'
  var PLUGIN = 'farm_dispatch'

  function authHeaders(json) {
    var token = localStorage.getItem(TOKEN_KEY) || ''
    var h = { Accept: 'application/json' }
    if (json) h['Content-Type'] = 'application/json'
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function unwrap(j) {
    if (j && j.data && typeof j.data === 'object') return j.data
    return j
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: authHeaders(body != null),
      body: body != null ? JSON.stringify(body) : undefined
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return unwrap(j)
        })
      })
      .catch(function () {
        return { ok: false, message: '网络错误' }
      })
  }

  P.registerSettingsTab &&
    P.registerSettingsTab({
      key: 'farm_dispatch',
      label: '巡查派单',
      after: 'plugins',
      order: 28,
      adminOnly: true,
      plugin: PLUGIN,
      render: function (el) {
        el.innerHTML =
          '<div class="settings-tab-panel">' +
          '<h3>巡查派单</h3>' +
          '<p>四个入口在<strong>侧栏</strong>：巡查看板、派单审核、提交打印、派单日志（与其它插件页相同，勿开独立窗口）。</p>' +
          '<p>首次使用请初始化用户组，再到「用户」里把账号加入：巡查 / 审核 / 派单申请。</p>' +
          '<button type="button" class="ant-btn ant-btn-primary" data-act="groups">初始化用户组</button>' +
          '<div data-msg style="margin-top:10px;opacity:.75"></div></div>'
        if (el._fdBound) return
        el._fdBound = true
        el.addEventListener('click', function (ev) {
          var t = ev.target
          if (!t || t.getAttribute('data-act') !== 'groups') return
          var msg = el.querySelector('[data-msg]')
          t.disabled = true
          if (msg) msg.textContent = '处理中…'
          api('POST', '/api/v1/farm-dispatch/ensure-groups', {}).then(function (j) {
            t.disabled = false
            if (msg) {
              msg.textContent =
                j && j.ok
                  ? '用户组已就绪（新增 ' + (j.added || 0) + ' 个）'
                  : (j && j.message) || '失败（需管理员）'
            }
          })
        })
      }
    })
})()
