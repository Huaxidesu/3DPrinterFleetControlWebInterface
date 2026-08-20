module.exports = async function install(api) {
  api.writeJson('ranks.json', { byId: {} })
  api.log('[device_priority] installed')
}
