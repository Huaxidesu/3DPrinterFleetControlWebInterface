module.exports = async function install(api) {
  api.writeJson('shortcuts_by_user.json', {})
  api.writeJson('fab_icon.json', { dataUrl: '', updatedAt: null })
  api.log('[app_launcher] installed')
}
