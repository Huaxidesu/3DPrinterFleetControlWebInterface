module.exports = async function install(api) {
  api.writeJson('cache.json', { images: {}, at: new Date().toISOString() })
  api.log('card_model_portrait installed')
}
