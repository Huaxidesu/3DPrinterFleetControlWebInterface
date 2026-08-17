/**
 * card_model_portrait — 免费图源解析机型图（Openverse / Wikimedia，无需 API Key）
 * 严格按「设置的机型」匹配：标题/文件名必须含机型关键词，否则回退默认图。
 * 无设置页；结果缓存到插件私有 JSON。
 */

/** 缓存协议版本：提高后自动忽略旧的松散匹配结果 */
const MATCH_VERSION = 3

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

function brandNiceName(b) {
  const x = String(b || '')
    .trim()
    .toLowerCase()
  if (x === 'bambu' || x === 'bambulab') return 'Bambu Lab'
  if (x === 'creality') return 'Creality'
  if (x === 'elegoo') return 'Elegoo'
  if (x === 'anycubic') return 'Anycubic'
  if (x === 'prusa') return 'Prusa'
  if (x === 'flashforge') return 'Flashforge'
  if (x === 'anker' || x === 'ankermake') return 'AnkerMake'
  if (x === 'voron') return 'Voron'
  return String(b || '').trim()
}

/** 机型别名，提高命中率（仍要求与设置机型对应） */
function modelAliases(model) {
  const m = String(model || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  const aliases = [m]
  const map = {
    x1c: ['x1 carbon', 'x1-carbon', 'x1c'],
    'x1 carbon': ['x1c', 'x1-carbon'],
    p1s: ['p1s', 'p1-s'],
    p1p: ['p1p', 'p1-p'],
    a1: ['a1', 'bambu a1'],
    'a1 mini': ['a1mini', 'a1-mini'],
    a1mini: ['a1 mini', 'a1-mini'],
    k1: ['k1', 'creality k1'],
    'k1 max': ['k1max', 'k1-max'],
    k1c: ['k1c'],
    'k1c': ['k1 c'],
    ender3: ['ender-3', 'ender 3'],
    'ender 3': ['ender-3', 'ender3'],
    ender3v3: ['ender-3 v3', 'ender 3 v3'],
    mk4: ['mk4', 'prusa mk4'],
    mini: ['prusa mini']
  }
  const hit = map[m]
  if (hit) {
    for (const a of hit) if (!aliases.includes(a)) aliases.push(a)
  }
  // 去空格紧凑式
  const compact = m.replace(/[^a-z0-9]+/g, '')
  if (compact && !aliases.includes(compact)) aliases.push(compact)
  return aliases
}

function modelTokens(model) {
  const m = String(model || '')
    .trim()
    .toLowerCase()
  const parts = m.split(/[^a-z0-9]+/).filter((p) => p && p.length >= 1)
  // 过滤过泛词
  const stop = new Set(['3d', 'printer', 'lab', 'the', 'and', 'pro', 'plus'])
  return parts.filter((p) => !stop.has(p) || parts.length === 1)
}

function buildQueries(brand, model) {
  const m = String(model || '').trim()
  if (!m) return []
  const bn = brandNiceName(brand)
  const aliases = modelAliases(m)
  const q = []
  // 精确优先：引号机型 + 品牌
  for (const a of aliases.slice(0, 3)) {
    if (bn) q.push(`"${a}" ${bn} 3D printer`)
    q.push(`"${a}" 3D printer`)
    if (bn) q.push(`${bn} ${a}`)
    q.push(a)
  }
  return q
}

async function fetchJson(api, url, timeoutMs = 9000) {
  const fetchFn = typeof api.fetch === 'function' ? api.fetch.bind(api) : fetch
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'hanye-card-model-portrait/1.1' }
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function textBlob(c) {
  return `${c.title || ''} ${c.filename || ''} ${c.url || ''}`.toLowerCase()
}

function compactAlnum(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * 打分：必须能证明与机型相关，否则返回 -1（丢弃）
 */
function scoreCandidate(c, brand, model) {
  if (!c || !c.url) return -1
  const text = textBlob(c)
  const compactText = compactAlnum(text)
  const aliases = modelAliases(model)
  const tokens = modelTokens(model)
  const bn = brandNiceName(brand).toLowerCase()
  const brandBits = bn
    .split(/\s+/)
    .map((x) => x.toLowerCase())
    .filter((x) => x.length >= 3)

  let score = 0
  let modelHit = false

  for (const a of aliases) {
    if (!a) continue
    if (text.includes(a)) {
      modelHit = true
      score += a.length >= 4 ? 40 : 28
      break
    }
    const ca = compactAlnum(a)
    if (ca.length >= 2 && compactText.includes(ca)) {
      modelHit = true
      score += ca.length >= 4 ? 36 : 24
      break
    }
  }

  if (!modelHit && tokens.length) {
    const need = tokens.filter((t) => t.length >= 2)
    if (need.length && need.every((t) => text.includes(t) || compactText.includes(t))) {
      modelHit = true
      score += 22
    }
  }

  if (!modelHit) return -1

  // 品牌加分（非必须）
  for (const b of brandBits) {
    if (text.includes(b)) score += 8
  }
  if (/\b3d\b|printer|filament|fdm|resin|sla/i.test(text)) score += 6

  const mime = String(c.mime || '').toLowerCase()
  const url = String(c.url || '')
  if (mime.includes('png') || /\.png(\?|$)/i.test(url)) score += 12
  else if (mime.includes('webp') || /\.webp(\?|$)/i.test(url)) score += 4
  else if (mime.includes('jpeg') || mime.includes('jpg') || /\.jpe?g(\?|$)/i.test(url)) score += 1

  // 排除明显无关
  if (/logo only|icon pack|favicon|sprite|banner ad/i.test(text)) score -= 20
  if (/screenshot of website|youtube thumbnail/i.test(text)) score -= 15

  return score
}

function pickBest(candidates, brand, model) {
  let best = null
  let bestScore = 0
  for (const c of candidates) {
    const s = scoreCandidate(c, brand, model)
    if (s < 20) continue // 门槛：必须明显相关
    if (s > bestScore) {
      bestScore = s
      best = c
    }
  }
  if (!best) return null
  return {
    url: String(best.url),
    source: best.source || 'web',
    score: bestScore,
    title: best.title || ''
  }
}

async function searchOpenverse(api, query) {
  const u =
    'https://api.openverse.org/v1/images/?q=' +
    encodeURIComponent(query) +
    '&page_size=12&license_type=commercial,modification'
  const data = await fetchJson(api, u)
  const results = (data && data.results) || []
  return results.map((r) => ({
    url: r.url || r.thumbnail || '',
    mime: (r && r.filetype) || 'image/png',
    title: r.title || r.name || '',
    filename: r.url || '',
    source: 'openverse'
  }))
}

async function searchWikimedia(api, query) {
  const u =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search' +
    '&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=480' +
    '&gsrsearch=' +
    encodeURIComponent(`filetype:bitmap ${query}`)
  const data = await fetchJson(api, u)
  const pages = (data && data.query && data.query.pages) || {}
  const out = []
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    const info = p && p.imageinfo && p.imageinfo[0]
    if (!info) continue
    out.push({
      url: info.thumburl || info.url || '',
      mime: info.mime || '',
      title: p.title || '',
      filename: p.title || info.url || '',
      source: 'wikimedia'
    })
  }
  return out
}

async function resolveImage(api, brand, model) {
  const key = cacheKey(brand, model)
  const cache = api.readJson('cache.json', { images: {} }) || { images: {} }
  if (!cache.images) cache.images = {}
  const hit = cache.images[key]
  if (
    hit &&
    hit.matchVersion === MATCH_VERSION &&
    hit.url &&
    Date.now() - new Date(hit.at || 0).getTime() < 7 * 24 * 3600 * 1000
  ) {
    return { ok: true, key, ...hit, cached: true }
  }

  if (key === 'default' || !String(model || '').trim()) {
    const row = {
      url: '',
      default: true,
      source: 'builtin',
      matchVersion: MATCH_VERSION,
      at: new Date().toISOString()
    }
    cache.images.default = row
    api.writeJson('cache.json', cache)
    return { ok: true, key: 'default', ...row, cached: false }
  }

  const queries = buildQueries(brand, model)
  let picked = null
  const pool = []
  for (const q of queries) {
    const a = await searchOpenverse(api, q)
    pool.push(...a)
    picked = pickBest(pool, brand, model)
    if (picked && picked.score >= 28) break
    const b = await searchWikimedia(api, q)
    pool.push(...b)
    picked = pickBest(pool, brand, model)
    if (picked && picked.score >= 28) break
  }
  if (!picked) picked = pickBest(pool, brand, model)

  const row = picked
    ? {
        url: picked.url,
        source: picked.source,
        score: picked.score,
        title: picked.title,
        default: false,
        matchVersion: MATCH_VERSION,
        model: String(model || '').trim(),
        brand: String(brand || '').trim(),
        at: new Date().toISOString()
      }
    : {
        url: '',
        default: true,
        source: 'builtin',
        matchVersion: MATCH_VERSION,
        model: String(model || '').trim(),
        brand: String(brand || '').trim(),
        at: new Date().toISOString()
      }

  cache.images[key] = row
  api.writeJson('cache.json', { images: cache.images, matchVersion: MATCH_VERSION, at: new Date().toISOString() })
  return { ok: true, key, ...row, cached: false }
}

module.exports = {
  async register(api) {
    api.registerRoute('GET', '/api/v1/card-model-portrait/models', async () => {
      const devices = api.getDevices()
      const rows = (Array.isArray(devices) ? devices : []).map((d) => ({
        id: String((d && d.id) || ''),
        name: String((d && d.name) || ''),
        brand: d && d.brand,
        model: d && d.model != null ? String(d.model).trim() : ''
      }))
      return { ok: true, rows, at: new Date().toISOString() }
    })

    api.registerRoute('GET', '/api/v1/card-model-portrait/resolve', async (req) => {
      const q = (req && req.query) || {}
      const brand = q.brand != null ? String(q.brand) : ''
      const model = q.model != null ? String(q.model) : ''
      return resolveImage(api, brand, model)
    })

    api.registerRoute('POST', '/api/v1/card-model-portrait/resolve-batch', async (req) => {
      const body = (req && req.body) || {}
      const items = Array.isArray(body.items) ? body.items : []
      const out = []
      for (const it of items.slice(0, 40)) {
        const brand = it && it.brand != null ? String(it.brand) : ''
        const model = it && it.model != null ? String(it.model) : ''
        const id = it && it.id != null ? String(it.id) : ''
        const r = await resolveImage(api, brand, model)
        out.push({ id, brand, model, ...r })
      }
      return { ok: true, items: out }
    })

    /** 清缓存后按新规则重匹配（无设置页，可供调试/重装后调用） */
    api.registerRoute('POST', '/api/v1/card-model-portrait/cache-clear', async () => {
      api.writeJson('cache.json', { images: {}, matchVersion: MATCH_VERSION, at: new Date().toISOString() })
      return { ok: true, cleared: true }
    })
  }
}
