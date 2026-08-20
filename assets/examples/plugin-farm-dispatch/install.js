module.exports = async function install(api) {
  api.writeJson('duty.json', {})
  api.writeJson('jobs.json', [])
  api.writeJson('notifications.json', [])
  api.writeJson('audit_log.json', [])
  api.writeJson('allow_once.json', {})
  api.log('[farm_dispatch] installed — 请管理员打开设置页点「初始化用户组」或手动创建「巡查」「审核」「派单申请」用户组')
}
