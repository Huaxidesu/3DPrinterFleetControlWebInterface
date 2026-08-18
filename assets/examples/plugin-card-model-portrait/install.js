module.exports = async function install(api) {
  // Mirror catalog into private JSON (backup). Images live under static/models/.
  try {
    const fs = require('fs')
    const path = require('path')
    const p = path.join(__dirname, 'static', 'models', 'catalog.json')
    if (fs.existsSync(p)) {
      const catalog = JSON.parse(fs.readFileSync(p, 'utf8'))
      api.writeJson('catalog.json', catalog)
    } else {
      api.writeJson('catalog.json', { version: 1, offline: true, images: [], byModel: {} })
    }
  } catch (e) {
    api.writeJson('catalog.json', { version: 1, offline: true, images: [], byModel: {} })
    api.log('card_model_portrait install catalog warn: ' + (e && e.message ? e.message : e))
  }
  api.log('card_model_portrait installed (offline local portraits v1.3)')
}
