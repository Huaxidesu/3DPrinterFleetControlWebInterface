module.exports = async function uninstall(api) {
  try {
    if (api.db && api.db.available) {
      await api.db.dropTable('shortcuts')
      await api.db.dropTable('users')
    }
  } catch (e) {
    api.log('[app_launcher] dropTable: ' + (e && e.message ? e.message : e))
  }
  api.log('[app_launcher] uninstalled')
}
