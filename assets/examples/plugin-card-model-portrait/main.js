/**
 * card_model_portrait — 本地机型肖像（离线）+ 用户可在设置页补充/修改 PNG
 */

const MATCH_VERSION = 6
const STATIC_BASE = '/api/v1/plugins/card_model_portrait/static/'
const FILE_BASE = '/api/v1/card-model-portrait/file?name='

function cacheKey(brand, model) {
  const b = String(brand || '')
    .trim()
    .toLowerCase()
  const m = String(model || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (!m) return 'default'
  return `${b}|${m}`
}

function compactAlnum(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function modelAliases(model) {
  const m = String(model || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  const aliases = [m]
  const map = {
    x1c: ['x1 carbon', 'x1-carbon', 'x1c'],
    'x1 carbon': ['x1c', 'x1-carbon'],
    'x1-carbon': ['x1c', 'x1 carbon'],
    p1s: ['p1s', 'p1-s'],
    p1p: ['p1p', 'p1-p'],
    a1: ['a1'],
    'a1 mini': ['a1mini', 'a1-mini'],
    a1mini: ['a1 mini', 'a1-mini'],
    p2s: ['p2s'],
    x1e: ['x1e'],
    k1: ['k1'],
    'k1 max': ['k1max', 'k1-max'],
    k1max: ['k1 max', 'k1-max'],
    k1c: ['k1c'],
    k2: ['k2'],
    'ender 3 v3': ['ender-3-v3', 'ender3v3'],
    'ender-3 v3': ['ender 3 v3', 'ender3v3'],
    'neptune 4': ['neptune-4', 'neptune4'],
    'mars 5': ['mars-5', 'mars5'],
    'kobra 2': ['kobra-2', 'kobra2'],
    'kobra 3': ['kobra-3', 'kobra3'],
    artisan: ['artisan'],
    j1: ['j1'],
    'adventurer 5m': ['adventurer-5m', 'adventurer5m'],
    plus4: ['plus 4', 'qidi plus4'],
    'voron 2.4': ['voron2.4', 'voron-2-4', '2.4']
  }
  const hit = map[m]
  if (hit) for (const a of hit) if (!aliases.includes(a)) aliases.push(a)
  const compact = compactAlnum(m)
  if (compact && !aliases.includes(compact)) aliases.push(compact)
  return aliases
}

function normalizeBrandKey(brand, model) {
  const b = String(brand || '')
    .trim()
    .toLowerCase()
  if (b === 'bambu' || b === 'bambulab' || b === 'bambu lab' || b === '拓竹') return 'bambu'
  if (b === 'creality' || b === '创想' || b === '创想三维') return 'creality'
  if (b === 'elegoo' || b === '爱乐库') return 'elegoo'
  if (b === 'anycubic' || b === '纵维' || b === '纵维立方') return 'anycubic'
  if (b === 'snapmaker') return 'snapmaker'
  if (b === 'flashforge' || b === '闪铸') return 'flashforge'
  if (b === 'qidi' || b === '启迪') return 'qidi'
  if (b === 'voron' || b === 'klipper') return 'voron'
  if (b) return b.replace(/\s+/g, '')

  const m = compactAlnum(model)
  if (/^(x1c|x1carbon|p1s|p1p|a1|a1mini|p2s|x1e|h2d)/.test(m)) return 'bambu'
  if (/^(k1|k1max|k1c|k2|ender)/.test(m)) return 'creality'
  if (/^(neptune|mars|saturn)/.test(m)) return 'elegoo'
  if (/^(kobra|photon)/.test(m)) return 'anycubic'
  if (/^(artisan|j1)/.test(m)) return 'snapmaker'
  if (/^(adventurer)/.test(m)) return 'flashforge'
  if (/^(plus4)/.test(m)) return 'qidi'
  if (/voron|trident|v0/.test(m)) return 'voron'
  return 'custom'
}

function brandNice(brand) {
  const map = {
    bambu: 'Bambu Lab',
    creality: '创想三维',
    elegoo: '爱乐库',
    anycubic: '纵维立方',
    snapmaker: 'Snapmaker',
    flashforge: '闪铸',
    qidi: '启迪',
    voron: 'Voron',
    custom: '自定义'
  }
  return map[brand] || brand || '自定义'
}

function loadCatalog(api) {
  try {
    const fs = require('fs')
    const path = require('path')
    const candidates = [
      path.join(__dirname, 'static', 'models', 'catalog.json'),
      typeof api.pluginDir === 'function'
        ? path.join(api.pluginDir(), 'static', 'models', 'catalog.json')
        : ''
    ].filter(Boolean)
    for (const p of candidates) {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
    }
  } catch {
    /* ignore */
  }
  return api.readJson('catalog.json', null)
}

function loadOverrides(api) {
  const o = api.readJson('overrides.json', null)
  if (o && o.items && typeof o.items === 'object') return o
  return { version: 1, items: {} }
}

function saveOverrides(api, data) {
  api.writeJson('overrides.json', data)
}

function lookupOverride(api, brand, model) {
  const ov = loadOverrides(api)
  const brandKey = normalizeBrandKey(brand, model)
  const aliases = modelAliases(model)
  const keys = []
  for (const a of aliases) {
    keys.push(`${brandKey}|${a}`)
    keys.push(`${brandKey}|${compactAlnum(a)}`)
    keys.push(cacheKey(brandKey, a))
  }
  for (const k of keys) {
    const hit = ov.items[k]
    if (hit && hit.file) return { key: k, ...hit }
  }
  return null
}

function lookupLocalFile(catalog, brand, model) {
  if (!catalog || !catalog.byModel) return ''
  const brandKey = normalizeBrandKey(brand, model)
  const aliases = modelAliases(model)
  const keys = []
  for (const a of aliases) {
    if (brandKey) {
      keys.push(`${brandKey}|${a}`)
      keys.push(`${brandKey}|${compactAlnum(a)}`)
    }
    keys.push(a)
    keys.push(compactAlnum(a))
  }
  for (const k of keys) {
    const hit = catalog.byModel[k] || catalog.byModel[String(k).toLowerCase()]
    if (hit) return String(hit)
  }
  const images = Array.isArray(catalog.images) ? catalog.images : []
  const want = new Set(aliases.map((a) => compactAlnum(a)).filter(Boolean))
  for (const img of images) {
    if (brandKey && img.brand && img.brand !== brandKey && brandKey !== 'custom') continue
    const models = Array.isArray(img.models) ? img.models : []
    for (const m of models) {
      if (want.has(compactAlnum(m))) return String(img.file || '')
    }
  }
  return ''
}

function safeFileName(brandKey, model, ext) {
  const b = compactAlnum(brandKey) || 'custom'
  const m = compactAlnum(model) || 'model'
  const e = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : ext === 'webp' ? 'webp' : 'png'
  return `${b}__${m}.${e}`
}

function resolveImage(api, brand, model) {
  const key = cacheKey(brand, model)
  if (key === 'default' || !String(model || '').trim()) {
    return {
      ok: true,
      key: 'default',
      url: '',
      default: true,
      source: 'builtin',
      custom: false,
      matchVersion: MATCH_VERSION,
      offline: true,
      at: new Date().toISOString()
    }
  }

  const ov = lookupOverride(api, brand, model)
  if (ov && ov.file) {
    const name = String(ov.file).split('/').pop()
    const t = encodeURIComponent(String(ov.updatedAt || Date.now()))
    return {
      ok: true,
      key,
      url: `${FILE_BASE}${encodeURIComponent(name)}&t=${t}`,
      default: false,
      source: 'custom',
      custom: true,
      file: ov.file,
      matchVersion: MATCH_VERSION,
      offline: true,
      model: String(model || '').trim(),
      brand: String(brand || ov.brand || '').trim(),
      brandKey: normalizeBrandKey(brand, model),
      at: ov.updatedAt || new Date().toISOString()
    }
  }

  const catalog = loadCatalog(api)
  const rel = lookupLocalFile(catalog, brand, model)
  if (rel) {
    return {
      ok: true,
      key,
      url: STATIC_BASE + rel.replace(/^\/+/, ''),
      default: false,
      source: 'local',
      custom: false,
      file: rel,
      matchVersion: MATCH_VERSION,
      offline: true,
      model: String(model || '').trim(),
      brand: String(brand || '').trim(),
      brandKey: normalizeBrandKey(brand, model),
      at: new Date().toISOString()
    }
  }

  return {
    ok: true,
    key,
    url: '',
    default: true,
    source: 'builtin',
    custom: false,
    matchVersion: MATCH_VERSION,
    offline: true,
    model: String(model || '').trim(),
    brand: String(brand || '').trim(),
    brandKey: normalizeBrandKey(brand, model),
    at: new Date().toISOString()
  }
}

function listLibrary(api) {
  const catalog = loadCatalog(api) || { images: [] }
  const ov = loadOverrides(api)
  const builtin = (catalog.images || []).map((img) => ({
    id: img.id,
    brand: img.brand,
    brandLabel: brandNice(img.brand),
    models: img.models || [],
    model: (img.models && img.models[0]) || img.id,
    url: STATIC_BASE + String(img.file || '').replace(/^\/+/, ''),
    source: 'local',
    custom: false,
    bytes: img.bytes || 0
  }))

  const customs = []
  const seenFiles = new Set()
  for (const k of Object.keys(ov.items || {})) {
    const it = ov.items[k]
    if (!it || !it.file) continue
    const fileKey = String(it.file)
    if (seenFiles.has(fileKey)) continue
    seenFiles.add(fileKey)
    const name = fileKey.split('/').pop()
    const t = encodeURIComponent(String(it.updatedAt || ''))
    const thumb = readOverrideDataUrl(api, fileKey)
    customs.push({
      id: k,
      brand: it.brand,
      brandLabel: brandNice(it.brand),
      models: [it.model],
      model: it.model,
      url: `${FILE_BASE}${encodeURIComponent(name)}&t=${t}`,
      thumb: thumb || `${FILE_BASE}${encodeURIComponent(name)}&t=${t}`,
      source: 'custom',
      custom: true,
      updatedAt: it.updatedAt,
      bytes: it.bytes || 0,
      missing: !thumb
    })
  }

  return {
    ok: true,
    brands: [
      { id: 'bambu', name: 'Bambu Lab' },
      { id: 'creality', name: '创想三维' },
      { id: 'elegoo', name: '爱乐库' },
      { id: 'anycubic', name: '纵维立方' },
      { id: 'snapmaker', name: 'Snapmaker' },
      { id: 'flashforge', name: '闪铸' },
      { id: 'qidi', name: '启迪' },
      { id: 'voron', name: 'Voron' },
      { id: 'custom', name: '其他/自定义' }
    ],
    builtin,
    custom: customs,
    items: customs.concat(builtin)
  }
}

function saveOverride(api, body) {
  const brandIn = body && body.brand != null ? String(body.brand).trim() : ''
  const model = body && body.model != null ? String(body.model).trim() : ''
  if (!model) return { ok: false, message: '请填写机型' }
  const brandKey = normalizeBrandKey(brandIn, model)
  const brand = brandKey
  let raw = body && body.pngBase64 != null ? String(body.pngBase64) : ''
  let ext = 'png'
  let mime = 'image/png'
  const m = raw.match(/^data:image\/([\w+.-]+);base64,/i)
  if (m) {
    const t = String(m[1] || '').toLowerCase()
    if (t === 'jpeg' || t === 'jpg') {
      ext = 'jpg'
      mime = 'image/jpeg'
    } else if (t === 'webp') {
      ext = 'webp'
      mime = 'image/webp'
    } else if (t === 'png') {
      ext = 'png'
      mime = 'image/png'
    }
  }
  let b64 = raw.replace(/^data:image\/[\w+.-]+;base64,/i, '').trim()
  if (!b64) return { ok: false, message: '请上传 PNG 图片' }
  let buf
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    return { ok: false, message: '图片数据无效' }
  }
  if (buf.length < 64) return { ok: false, message: '图片过小' }
  if (buf.length > 5 * 1024 * 1024) return { ok: false, message: '图片不能超过 5MB' }

  const fileName = safeFileName(brandKey, model, ext)
  const rel = `overrides/${fileName}`
  if (typeof api.writeMedia !== 'function') {
    return { ok: false, message: '当前环境不支持写入媒体文件' }
  }
  const wr = api.writeMedia(rel, b64, { encoding: 'base64' })
  if (!wr || wr.ok === false) {
    return { ok: false, message: (wr && wr.message) || '写入失败' }
  }
  // verify file landed
  try {
    const fs = require('fs')
    const path = require('path')
    const full = path.join(api.dataDir, 'media', 'overrides', fileName)
    if (!fs.existsSync(full) || fs.statSync(full).size < 32) {
      return { ok: false, message: '图片写入后未找到，请重试' }
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '写入校验失败' }
  }

  const ov = loadOverrides(api)
  const key = cacheKey(brandKey, model)
  ov.items[key] = {
    brand,
    model,
    file: rel,
    mime,
    bytes: buf.length,
    updatedAt: new Date().toISOString()
  }
  // also index compact alias
  ov.items[`${brandKey}|${compactAlnum(model)}`] = ov.items[key]
  saveOverrides(api, ov)

  const t = encodeURIComponent(ov.items[key].updatedAt)
  return {
    ok: true,
    key,
    brand,
    model,
    url: `${FILE_BASE}${encodeURIComponent(fileName)}&t=${t}`,
    custom: true,
    message: '已保存，该机型将使用此图片'
  }
}

function deleteOverride(api, body) {
  const brandIn = body && body.brand != null ? String(body.brand).trim() : ''
  const model = body && body.model != null ? String(body.model).trim() : ''
  const keyIn = body && body.key != null ? String(body.key).trim() : ''
  const brandKey = normalizeBrandKey(brandIn, model)
  const ov = loadOverrides(api)
  const keys = []
  if (keyIn) keys.push(keyIn)
  if (model) {
    keys.push(cacheKey(brandKey, model))
    keys.push(`${brandKey}|${compactAlnum(model)}`)
  }
  let removed = 0
  for (const k of keys) {
    if (ov.items[k]) {
      delete ov.items[k]
      removed++
    }
  }
  // also remove duplicates pointing same model
  for (const k of Object.keys(ov.items)) {
    const it = ov.items[k]
    if (model && it && String(it.model).toLowerCase() === model.toLowerCase()) {
      if (!brandIn || normalizeBrandKey(it.brand, it.model) === brandKey) {
        delete ov.items[k]
        removed++
      }
    }
  }
  saveOverrides(api, ov)
  return { ok: true, removed, message: removed ? '已删除自定义图，恢复内置/默认' : '未找到自定义图' }
}

function serveOverrideFile(api, query) {
  const fs = require('fs')
  const path = require('path')
  const name = String((query && query.name) || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
  if (!name || name.includes('..') || !/^[\w.-]+\.(png|jpe?g|webp)$/i.test(name)) {
    return {
      __pluginHttp: {
        status: 400,
        json: { ok: false, message: '非法文件名' }
      }
    }
  }
  const full = path.join(api.dataDir, 'media', 'overrides', name)
  if (!fs.existsSync(full)) {
    return {
      __pluginHttp: {
        status: 404,
        json: { ok: false, message: '文件不存在' }
      }
    }
  }
  const buf = fs.readFileSync(full)
  const ext = path.extname(name).toLowerCase()
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg'
  return {
    __pluginHttp: {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buf.length),
        'Cache-Control': 'private, max-age=60'
      },
      body: buf
    }
  }
}

function readOverrideDataUrl(api, fileRel) {
  try {
    const fs = require('fs')
    const path = require('path')
    const name = String(fileRel || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
    if (!name) return ''
    const full = path.join(api.dataDir, 'media', 'overrides', name)
    if (!fs.existsSync(full)) return ''
    const buf = fs.readFileSync(full)
    const ext = path.extname(name).toLowerCase()
    const mime =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return ''
  }
}

module.exports = {
  async register(api) {
    const cat = loadCatalog(api)
    if (cat && !api.readJson('catalog.json', null)) {
      try {
        api.writeJson('catalog.json', cat)
      } catch {
        /* ignore */
      }
    }
    if (!api.readJson('overrides.json', null)) {
      api.writeJson('overrides.json', { version: 1, items: {} })
    }

    api.registerRoute('GET', '/api/v1/card-model-portrait/models', async () => {
      const devices = api.getDevices()
      const rows = (Array.isArray(devices) ? devices : []).map((d) => ({
        id: String((d && d.id) || ''),
        name: String((d && d.name) || ''),
        brand: d && d.brand,
        model: d && d.model != null ? String(d.model).trim() : ''
      }))
      return { ok: true, rows, offline: true, at: new Date().toISOString() }
    })

    api.registerRoute('GET', '/api/v1/card-model-portrait/resolve', async (req) => {
      const q = (req && req.query) || {}
      return resolveImage(api, q.brand != null ? String(q.brand) : '', q.model != null ? String(q.model) : '')
    })

    api.registerRoute('POST', '/api/v1/card-model-portrait/resolve-batch', async (req) => {
      const body = (req && req.body) || {}
      const items = Array.isArray(body.items) ? body.items : []
      const out = []
      for (const it of items.slice(0, 80)) {
        const brand = it && it.brand != null ? String(it.brand) : ''
        const model = it && it.model != null ? String(it.model) : ''
        const id = it && it.id != null ? String(it.id) : ''
        out.push({ id, brand, model, ...resolveImage(api, brand, model) })
      }
      return { ok: true, offline: true, items: out }
    })

    api.registerRoute('GET', '/api/v1/card-model-portrait/library', async () => listLibrary(api))

    api.registerRoute('POST', '/api/v1/card-model-portrait/override', async (req) => {
      return saveOverride(api, (req && req.body) || {})
    })

    api.registerRoute('POST', '/api/v1/card-model-portrait/override-delete', async (req) => {
      return deleteOverride(api, (req && req.body) || {})
    })

    api.registerRoute('GET', '/api/v1/card-model-portrait/file', async (req) => {
      return serveOverrideFile(api, (req && req.query) || {})
    }, { public: true })

    api.registerRoute('GET', '/api/v1/card-model-portrait/catalog', async () => {
      const catalog = loadCatalog(api) || { images: [] }
      return {
        ok: true,
        offline: true,
        matchVersion: MATCH_VERSION,
        count: Array.isArray(catalog.images) ? catalog.images.length : 0,
        images: catalog.images || []
      }
    })

    api.registerRoute('POST', '/api/v1/card-model-portrait/cache-clear', async () => {
      return { ok: true, cleared: true, offline: true }
    })
  }
}
