#!/usr/bin/env node
/**
 * Download official product portraits into plugin static/models (offline pack).
 * Usage: node ops/scripts/download-model-portraits.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '../..')
const plugin = join(root, 'assets/examples/plugin-card-model-portrait')
const outDir = join(plugin, 'static/models')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Direct known-good official CDN urls (preferred) + page scrape fallbacks */
const JOBS = [
  {
    id: 'bambu-p1s',
    brand: 'bambu',
    models: ['P1S', 'p1s', 'P1-S'],
    direct: [
      'https://store.bblcdn.com/s7/default/baec8bdd954d46d198b8d265c5c94f9e/P1S-compressed.jpg'
    ],
    pages: ['https://store.bambulab.com/products/p1s'],
    needles: ['p1s']
  },
  {
    id: 'bambu-p1p',
    brand: 'bambu',
    models: ['P1P', 'p1p', 'P1-P'],
    pages: [
      'https://store.bambulab.com/products/p1p',
      'https://store.bambulab.com/search?q=P1P'
    ],
    needles: ['p1p']
  },
  {
    id: 'bambu-a1',
    brand: 'bambu',
    models: ['A1', 'a1'],
    direct: [
      'https://store.bblcdn.com/s7/default/e424062172bd47fb8795a50fcdc941f0/A1-compressed.jpg'
    ],
    pages: ['https://store.bambulab.com/products/a1'],
    needles: ['a1'],
    exclude: ['a1mini', 'a1_mini']
  },
  {
    id: 'bambu-a1-mini',
    brand: 'bambu',
    models: ['A1 mini', 'A1 Mini', 'a1mini', 'A1-mini'],
    direct: [
      'https://store.bblcdn.com/s7/default/2769f2a05d45476583769f8df9d4c858/A1_mini-compressed.jpg'
    ],
    pages: ['https://store.bambulab.com/products/a1-mini'],
    needles: ['a1mini', 'a1_mini']
  },
  {
    id: 'bambu-x1c',
    brand: 'bambu',
    models: ['X1C', 'X1 Carbon', 'x1-carbon', 'X1-Carbon'],
    pages: [
      'https://store.bambulab.com/products/x1-carbon',
      'https://store.bambulab.com/search?q=X1%20Carbon'
    ],
    needles: ['x1c', 'x1carbon', 'x1_carbon']
  },
  {
    id: 'bambu-x1e',
    brand: 'bambu',
    models: ['X1E', 'x1e'],
    pages: ['https://store.bambulab.com/search?q=X1E'],
    needles: ['x1e']
  },
  {
    id: 'bambu-p2s',
    brand: 'bambu',
    models: ['P2S', 'p2s'],
    pages: ['https://store.bambulab.com/search?q=P2S', 'https://store.bambulab.com/products/p2s'],
    needles: ['p2s']
  },
  {
    id: 'creality-k1',
    brand: 'creality',
    models: ['K1', 'k1'],
    pages: [
      'https://www.creality.cn/products/k1',
      'https://www.creality.cn/search?keyword=K1'
    ],
    needles: ['k1'],
    exclude: ['k1max', 'k1c'],
    hosts: ['creality']
  },
  {
    id: 'creality-k1-max',
    brand: 'creality',
    models: ['K1 Max', 'K1Max', 'k1-max'],
    pages: [
      'https://www.creality.cn/products/k1-max',
      'https://www.creality.cn/search?keyword=K1%20Max'
    ],
    needles: ['k1max'],
    hosts: ['creality']
  },
  {
    id: 'creality-k1c',
    brand: 'creality',
    models: ['K1C', 'k1c'],
    pages: [
      'https://www.creality.cn/products/k1c',
      'https://www.creality.cn/search?keyword=K1C'
    ],
    needles: ['k1c'],
    hosts: ['creality']
  },
  {
    id: 'creality-ender-3-v3',
    brand: 'creality',
    models: ['Ender-3 V3', 'Ender 3 V3', 'ender3v3'],
    pages: [
      'https://www.creality.cn/products/ender-3-v3',
      'https://www.creality.cn/search?keyword=Ender-3%20V3'
    ],
    needles: ['ender3v3', 'ender-3-v3'],
    hosts: ['creality']
  },
  {
    id: 'creality-k2',
    brand: 'creality',
    models: ['K2', 'k2'],
    pages: [
      'https://www.creality.cn/products/k2-series',
      'https://www.creality.cn/search?keyword=K2'
    ],
    needles: ['k2'],
    hosts: ['creality']
  },
  {
    id: 'elegoo-neptune-4',
    brand: 'elegoo',
    models: ['Neptune 4', 'Neptune4', 'neptune-4'],
    pages: [
      'https://www.elegoo.com/search?q=Neptune%204',
      'https://www.elegoo.com.cn/'
    ],
    needles: ['neptune4', 'neptune'],
    hosts: ['elegoo', 'shopify']
  },
  {
    id: 'elegoo-mars-5',
    brand: 'elegoo',
    models: ['Mars 5', 'Mars5'],
    direct: [
      'https://cdn.shopify.com/s/files/1/0296/9026/5648/files/Mars_5.jpg?v=1743670551'
    ],
    pages: ['https://www.elegoo.com/search?q=Mars%205'],
    needles: ['mars5', 'mars'],
    hosts: ['elegoo', 'shopify']
  },
  {
    id: 'anycubic-kobra-2',
    brand: 'anycubic',
    models: ['Kobra 2', 'Kobra2', 'kobra-2'],
    pages: ['https://cn.anycubic.com/products/kobra-2', 'https://www.anycubic.com/products/kobra-2'],
    needles: ['kobra2'],
    hosts: ['anycubic', 'shopify']
  },
  {
    id: 'anycubic-kobra-3',
    brand: 'anycubic',
    models: ['Kobra 3', 'Kobra3'],
    pages: ['https://www.anycubic.com/search?q=Kobra%203', 'https://cn.anycubic.com/search?q=Kobra%203'],
    needles: ['kobra3'],
    hosts: ['anycubic', 'shopify']
  },
  {
    id: 'snapmaker-artisan',
    brand: 'snapmaker',
    models: ['Artisan', 'artisan'],
    pages: ['https://snapmaker.com/snapmaker-artisan'],
    needles: ['artisan'],
    hosts: ['snapmaker', 'cloudfront', 'shopify']
  },
  {
    id: 'snapmaker-j1',
    brand: 'snapmaker',
    models: ['J1', 'j1'],
    pages: ['https://snapmaker.com/?s=J1', 'https://snapmaker.com/'],
    needles: ['j1'],
    hosts: ['snapmaker', 'cloudfront', 'shopify']
  },
  {
    id: 'flashforge-adventurer-5m',
    brand: 'flashforge',
    models: ['Adventurer 5M', 'Adventurer5M', 'adventurer-5m'],
    pages: [
      'https://www.flashforge.com/product-detail/flashforge-adventurer-5m-3d-printer'
    ],
    needles: ['adventurer', '5m'],
    hosts: ['flashforge', 'shopify']
  },
  {
    id: 'qidi-plus4',
    brand: 'qidi',
    models: ['Plus4', 'Plus 4', 'Qidi Plus4'],
    pages: ['https://www.qidi3d.com/search?q=Plus4', 'https://qidi3d.com/'],
    needles: ['plus4'],
    hosts: ['qidi', 'shopify']
  },
  {
    id: 'voron-2-4',
    brand: 'voron',
    models: ['Voron 2.4', 'Voron2.4', '2.4'],
    pages: ['https://www.vorondesign.com/', 'https://www.vorondesign.com/voron2.4'],
    needles: ['voron', '2.4'],
    hosts: ['vorondesign', 'github']
  }
]

function compact(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

async function fetchBuf(url, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    return buf
  } finally {
    clearTimeout(t)
  }
}

async function fetchText(url) {
  const buf = await fetchBuf(url)
  return buf.toString('utf8')
}

function pickFromHtml(html, job) {
  const urls = html.match(/https?:\/\/[^"'\\\s<>]+\.(?:png|jpe?g|webp)(?:\?[^"'\\\s<>]*)?/gi) || []
  const excl = (job.exclude || []).map(compact)
  const hosts = job.hosts || []
  for (const u of urls) {
    const low = u.toLowerCase()
    if (/favicon|logo\.png|sprite|1x1|\/icon/i.test(low)) continue
    const c = compact(u)
    if (excl.some((x) => x && c.includes(x))) continue
    if (hosts.length) {
      const ok =
        hosts.some((h) => low.includes(h)) ||
        /bblcdn|shopify|cloudfront/i.test(low)
      if (!ok) continue
    } else if (!/bblcdn|bambulab|shopify|cloudfront|creality|elegoo|anycubic|snapmaker|flashforge|qidi|voron/i.test(low)) {
      continue
    }
    for (const n of job.needles) {
      const nc = compact(n)
      if (nc && c.includes(nc)) return u
    }
  }
  // softer product-looking
  for (const u of urls) {
    const low = u.toLowerCase()
    if (/favicon|logo|icon/i.test(low)) continue
    if (hosts.length && !(hosts.some((h) => low.includes(h)) || /bblcdn|shopify|cloudfront/i.test(low))) {
      continue
    }
    if (/product|compressed|1920|official|cdn\.shopify/i.test(low)) return u
  }
  return null
}

function extOf(url) {
  const low = String(url).toLowerCase()
  if (low.includes('.png')) return '.png'
  if (low.includes('.webp')) return '.webp'
  return '.jpg'
}

async function runJob(job) {
  let imgUrl = null
  for (const d of job.direct || []) {
    try {
      const buf = await fetchBuf(d)
      if (buf.length >= 2000) {
        imgUrl = d
        return { imgUrl, buf }
      }
    } catch (e) {
      console.log(`  direct fail ${d}: ${e.message}`)
    }
  }
  for (const page of job.pages || []) {
    try {
      const html = await fetchText(page)
      const found = pickFromHtml(html, job)
      if (found) {
        const buf = await fetchBuf(found.split('{width}').join('1200'))
        if (buf.length >= 2000) return { imgUrl: found, buf }
      }
    } catch (e) {
      console.log(`  page fail ${page}: ${e.message}`)
    }
  }
  return null
}

mkdirSync(outDir, { recursive: true })
const catalog = { version: 1, offline: true, images: [], byModel: {} }

for (const job of JOBS) {
  process.stdout.write(`== ${job.id}\n`)
  const got = await runJob(job)
  if (!got) {
    console.log(`FAIL ${job.id}`)
    continue
  }
  const brandDir = join(outDir, job.brand)
  mkdirSync(brandDir, { recursive: true })
  const filename = `${job.id}${extOf(got.imgUrl)}`
  const abs = join(brandDir, filename)
  writeFileSync(abs, got.buf)
  const rel = `models/${job.brand}/${filename}`
  console.log(`OK ${job.id} ${got.buf.length}B -> ${rel}`)
  const row = {
    id: job.id,
    brand: job.brand,
    models: job.models,
    file: rel,
    sourceUrl: got.imgUrl,
    bytes: got.buf.length
  }
  catalog.images.push(row)
  for (const m of job.models) {
    catalog.byModel[m.toLowerCase()] = rel
    catalog.byModel[compact(m)] = rel
    catalog.byModel[`${job.brand}|${m.toLowerCase()}`] = rel
    catalog.byModel[`${job.brand}|${compact(m)}`] = rel
  }
}

const catalogPath = join(outDir, 'catalog.json')
writeFileSync(catalogPath, JSON.stringify(catalog, null, 2))
console.log(`catalog ${catalogPath} count=${catalog.images.length}`)
