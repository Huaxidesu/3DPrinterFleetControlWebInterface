/** 拓竹耗材：1000g = 1 卷；不足 1000g 也按 1 卷（用于 AMS 绑定槽位数） */
export function rollsFromTotalGrams(totalGrams: number): number {
  const g = Math.max(0, Number(totalGrams) || 0)
  if (g <= 0) return 1
  return Math.max(1, Math.min(99, Math.ceil(g / 1000)))
}

/** 本地 ↔ 拓竹互相同步：匹配键（品牌 + 材质 + 色值） */
export function filamentSyncMatchKey(input: {
  brandId?: string
  vendor?: string
  brandName?: string
  material?: string
  colorHex?: string
  tech?: string
}): string | null {
  const tech = String(input.tech || 'fdm')
  if (tech === 'resin') return null
  const brandRaw = String(input.vendor || input.brandName || input.brandId || '').trim()
  const materialRaw = String(input.material || '').trim()
  const hex = String(input.colorHex || '')
    .replace(/^#/, '')
    .slice(0, 6)
    .toUpperCase()
  if (!brandRaw || !materialRaw || hex.length < 6) return null
  const brand = vendorToBrandId(brandRaw)
  const material = materialToCatalogId(materialRaw, 'fdm')
  return `${brand}|${material}|${hex}`
}

const BRAND_ALIASES: Record<string, string> = {
  bambu: 'bambu',
  bambu_lab: 'bambu',
  bambulab: 'bambu',
  'bambu lab': 'bambu',
  esun: 'esun',
  polymaker: 'polymaker',
  sunlu: 'sunlu',
  creality: 'creality',
  anycubic: 'anycubic',
  elegoo: 'elegoo',
  prusa: 'prusa',
  prusament: 'prusa',
  hatchbox: 'hatchbox',
  overture: 'overture',
  kingroon: 'kingroon',
  jayo: 'jayo',
  flashforge: 'flashforge',
  resione: 'resione',
  siraya: 'siraya',
  siraya_tech: 'siraya',
  phrozen: 'phrozen',
  generic: 'other',
  other: 'other'
}

const MATERIAL_ALIASES: Record<string, string> = {
  pla: 'pla',
  'pla+': 'pla-plus',
  'pla plus': 'pla-plus',
  petg: 'petg',
  abs: 'abs',
  asa: 'asa',
  tpu: 'tpu',
  pa: 'pa',
  'pa-cf': 'pa-cf',
  'pa cf': 'pa-cf',
  'nylon': 'pa',
  pc: 'pc',
  pva: 'pva',
  hips: 'hips',
  'resin-std': 'resin-std',
  'standard resin': 'resin-std',
  'resin-abs': 'resin-abs',
  'resin-cast': 'resin-cast',
  'resin-water': 'resin-water',
  'resin-flex': 'resin-flex'
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9+]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function vendorToBrandId(vendor: string): string {
  const raw = String(vendor || '').trim()
  if (!raw) return 'other'
  const lower = raw.toLowerCase()
  const s = slug(raw)
  if (BRAND_ALIASES[s]) return BRAND_ALIASES[s]
  if (BRAND_ALIASES[lower]) return BRAND_ALIASES[lower]
  if (s.includes('bambu') || lower.includes('bambu')) return 'bambu'
  if (s.includes('esun') || raw.includes('易生')) return 'esun'
  if (s.includes('creality') || raw.includes('创想')) return 'creality'
  if (s.includes('anycubic') || raw.includes('纵维')) return 'anycubic'
  if (s.includes('elegoo') || raw.includes('爱乐酷')) return 'elegoo'
  if (s.includes('polymaker')) return 'polymaker'
  if (s.includes('sunlu') || raw.includes('三绿')) return 'sunlu'
  if (s.startsWith('custom:')) return raw
  return `custom:${raw}`
}

export function materialToCatalogId(raw: string, tech: 'fdm' | 'resin' = 'fdm'): string {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return tech === 'resin' ? 'resin-std' : 'pla'
  if (MATERIAL_ALIASES[s]) return MATERIAL_ALIASES[s]
  const sl = slug(s)
  if (MATERIAL_ALIASES[sl]) return MATERIAL_ALIASES[sl]
  if (s.includes('pla+') || s.includes('pla plus')) return 'pla-plus'
  if (/\bpla\b/.test(s) || s.startsWith('pla')) return 'pla'
  if (s.includes('petg')) return 'petg'
  if (s.includes('abs') && !s.includes('like')) return 'abs'
  if (s.includes('asa')) return 'asa'
  if (s.includes('tpu')) return 'tpu'
  if (s.includes('pa-cf') || s.includes('cf') || s.includes('carbon')) return 'pa-cf'
  if (s.includes('nylon') || s.includes('pa')) return 'pa'
  if (s.includes('cast')) return tech === 'resin' ? 'resin-cast' : 'other-fdm'
  if (s.includes('resin')) return tech === 'resin' ? 'resin-std' : 'other-fdm'
  return tech === 'resin' ? 'other-resin' : 'other-fdm'
}

/** Normalize spool.brandId from cloud or legacy records for quote / Select binding */
export function brandIdForQuote(brandId: string, brandName?: string | null): string {
  const id = String(brandId || '').trim()
  if (id && !id.startsWith('custom:') && BRAND_ALIASES[id] !== undefined) return BRAND_ALIASES[id]!
  if (id && !id.startsWith('custom:') && Object.values(BRAND_ALIASES).includes(id)) return id
  if (id.startsWith('custom:')) return id
  if (id && BRAND_ALIASES[slug(id)]) return BRAND_ALIASES[slug(id)]!
  const fromName = brandName ? vendorToBrandId(brandName) : ''
  if (fromName) return fromName
  if (id) return vendorToBrandId(id.replace(/_/g, ' '))
  return 'other'
}
