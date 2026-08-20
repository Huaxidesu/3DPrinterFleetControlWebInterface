/**
 * Bambu Studio「耗材管理」云端库存（与 Studio 同源 REST）。
 * GET/POST/PUT /v1/design-user-service/my/filament/v2
 */
import axios from 'axios'
import { materialToCatalogId, rollsFromTotalGrams, vendorToBrandId } from '../../shared/spoolCatalog'
import { bambuApiBase, type BambuRegion } from './cloud'

export type CloudSpoolHit = Record<string, unknown>

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'bambu_network_agent/01.09.05.01',
    'X-BBL-Client-Name': 'OrcaSlicer',
    'X-BBL-Client-Type': 'slicer',
    'X-BBL-Client-Version': '01.09.05.51'
  }
}

function axiosErr(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as
      | { message?: string; error?: string; msg?: string; code?: number | string; errorMessage?: string }
      | string
      | undefined
    if (typeof d === 'string' && d.trim()) return d.trim()
    if (d && typeof d === 'object') {
      const msg =
        d.message || d.error || d.msg || d.errorMessage || (d.code != null ? `错误码 ${d.code}` : '')
      if (msg) return String(msg)
      try {
        const raw = JSON.stringify(d)
        if (raw && raw !== '{}') return raw.slice(0, 240)
      } catch {
        /* ignore */
      }
    }
    const status = err.response?.status
    if (status) return `拓竹云拒绝请求 (${status})`
    return err.message || '网络错误'
  }
  return err instanceof Error ? err.message : String(err)
}

export async function cloudListFilaments(
  region: BambuRegion,
  token: string
): Promise<{ ok: true; hits: CloudSpoolHit[] } | { ok: false; message: string }> {
  try {
    const all: CloudSpoolHit[] = []
    let offset = 0
    const limit = 100
    for (let i = 0; i < 40; i++) {
      const { data } = await axios.get(`${bambuApiBase(region)}/v1/design-user-service/my/filament/v2`, {
        params: { offset, limit },
        headers: headers(token),
        timeout: 25000
      })
      const hits = extractHits(data)
      all.push(...hits)
      if (hits.length < limit) break
      offset += hits.length
    }
    return { ok: true, hits: all }
  } catch (e) {
    return { ok: false, message: axiosErr(e) }
  }
}

export async function cloudCreateFilament(
  region: BambuRegion,
  token: string,
  body: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await axios.post(`${bambuApiBase(region)}/v1/design-user-service/my/filament/v2`, body, {
      headers: headers(token),
      timeout: 25000
    })
    return { ok: true }
  } catch (e) {
    console.warn('[bambu filament] create failed', body, axios.isAxiosError(e) ? e.response?.data : e)
    return { ok: false, message: axiosErr(e) }
  }
}

export async function cloudUpdateFilament(
  region: BambuRegion,
  token: string,
  body: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await axios.put(`${bambuApiBase(region)}/v1/design-user-service/my/filament/v2`, body, {
      headers: headers(token),
      timeout: 25000
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, message: axiosErr(e) }
  }
}

export async function cloudDeleteFilaments(
  region: BambuRegion,
  token: string,
  ids: Array<string | number>,
  rfids: string[] = []
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await axios.delete(`${bambuApiBase(region)}/v1/design-user-service/my/filament/v2/batch`, {
      data: { ids: ids.map((x) => (typeof x === 'number' ? x : Number(x) || x)), RFIDs: rfids },
      headers: headers(token),
      timeout: 25000
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, message: axiosErr(e) }
  }
}

export async function cloudAmsSync(
  region: BambuRegion,
  token: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  try {
    const { data } = await axios.post(
      `${bambuApiBase(region)}/v1/design-user-service/my/filament/v2/ams/sync`,
      body,
      { headers: headers(token), timeout: 30000 }
    )
    return { ok: true, data }
  } catch (e) {
    return { ok: false, message: axiosErr(e) }
  }
}

function extractHits(data: unknown): CloudSpoolHit[] {
  if (!data || typeof data !== 'object') return []
  const o = data as Record<string, unknown>
  const raw = o.hits || o.filaments || o.list || (o.data as Record<string, unknown> | undefined)?.hits
  if (Array.isArray(raw)) return raw.filter((x) => x && typeof x === 'object') as CloudSpoolHit[]
  return []
}

function pickStr(hit: CloudSpoolHit, ...keys: string[]): string {
  for (const k of keys) {
    const v = hit[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function pickNum(hit: CloudSpoolHit, ...keys: string[]): number {
  for (const k of keys) {
    if (hit[k] == null || hit[k] === '') continue
    const n = Number(hit[k])
    if (Number.isFinite(n)) return n
  }
  return 0
}

function pickNumOpt(hit: CloudSpoolHit, ...keys: string[]): number | undefined {
  for (const k of keys) {
    if (hit[k] == null || hit[k] === '') continue
    const n = Number(hit[k])
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function pickColor(hit: CloudSpoolHit): string {
  const colors = hit.colors
  if (Array.isArray(colors) && colors[0]) {
    const c = String(colors[0])
    if (c.startsWith('#')) return c.slice(0, 7)
    if (/^[0-9A-Fa-f]{6,8}$/.test(c)) return '#' + c.slice(0, 6)
  }
  const raw = pickStr(hit, 'color', 'tray_color', 'filamentColor')
  if (!raw) return '#888888'
  const h = raw.replace(/^#/, '')
  return '#' + h.slice(0, 6)
}

/** Studio 云端料卷 → 本地 SpoolRecord */
export function cloudHitToSpool(hit: CloudSpoolHit): {
  id: string
  brandId: string
  material: string
  color: string
  colorHex: string
  totalGrams: number
  remainGrams: number
  rolls: number
  notes?: string
  tech: 'fdm'
  createdAt: string
  updatedAt?: string
  bambuCloud: true
  bambuRfid?: string
  bambuFilamentId?: string
} {
  const id = pickStr(hit, 'id', 'spoolId', 'spool_id') || String(hit.id ?? '')
  const vendorRaw = pickStr(hit, 'vendor', 'brand', 'filamentVendor') || 'Generic'
  const vendor = vendorRaw
  const name = pickStr(hit, 'filamentName', 'name', 'tray_id_name')
  const typeRaw = pickStr(hit, 'type', 'filamentType', 'filament_type', 'material')
  const type = typeRaw
  const colorHex = pickColor(hit)
  const total = pickNumOpt(hit, 'totalNetWeight', 'total_g', 'totalGrams', 'tray_weight') || 1000
  let remain = pickNumOpt(hit, 'netWeight', 'remaining_g', 'remainGrams', 'remain')
  if (remain == null) remain = total
  const pct = pickNum(hit, 'remaining_pct')
  if ((remain === total || remain == null) && pct > 0 && pct <= 100) remain = Math.round((total * pct) / 100)
  const updated = pickStr(hit, 'updatedAt', 'updated_at', 'updateTime', 'update_time')
  const created = pickStr(hit, 'createdAt', 'created_at', 'createTime') || updated || new Date().toISOString()
  const rfid = pickStr(hit, 'RFID', 'rfid', 'tag_uid')
  const totalGrams = total > 0 ? total : 1000
  return {
    id,
    brandId: vendorToBrandId(vendor),
    material: materialToCatalogId(type || name || 'PLA', 'fdm'),
    color: name && type && name !== type ? name : colorNameFromHex(colorHex),
    colorHex,
    totalGrams,
    remainGrams: Math.max(0, remain),
    rolls: rollsFromTotalGrams(totalGrams),
    notes: pickStr(hit, 'note', 'notes', 'remark') || undefined,
    tech: 'fdm',
    createdAt: created,
    updatedAt: updated || undefined,
    bambuCloud: true,
    bambuRfid: rfid || undefined,
    bambuFilamentId: pickStr(hit, 'filamentId', 'filament_id') || undefined
  }
}

/** Studio 系统预设 setting_id（filamentId），缺省时云端常返回 400 */
const BAMBU_FILAMENT_IDS: Record<string, string> = {
  pla: 'GFA00',
  'pla basic': 'GFA00',
  'pla matte': 'GFA01',
  'pla silk': 'GFA02',
  'pla metal': 'GFA03',
  'pla-cf': 'GFA07',
  'pla aero': 'GFA12',
  petg: 'GFB00',
  'petg-cf': 'GFB01',
  abs: 'GFC00',
  asa: 'GFB02',
  tpu: 'GFU00',
  pa: 'GFN00',
  'pa-cf': 'GFN01',
  pc: 'GFC01',
  pva: 'GFS00',
  'support for pla': 'GFS01',
  'support for pa/pet': 'GFS02'
}

function resolveFilamentId(vendor: string, material: string): string {
  const v = vendor.toLowerCase()
  const m = material.toLowerCase().trim()
  if (v.includes('bambu')) {
    if (BAMBU_FILAMENT_IDS[m]) return BAMBU_FILAMENT_IDS[m]!
    const key = Object.keys(BAMBU_FILAMENT_IDS).find((k) => m.includes(k) || k.includes(m))
    if (key) return BAMBU_FILAMENT_IDS[key]!
    return 'GFA00'
  }
  // Generic / 第三方：Studio 常用空或 Generic 占位
  return ''
}

export function spoolToCreateBody(input: {
  brandId?: string
  vendor?: string
  material?: string
  color?: string
  colorHex?: string
  totalGrams?: number
  remainGrams?: number
  notes?: string
  bambuFilamentId?: string
}): Record<string, unknown> {
  const vendor = String(input.vendor || input.brandId || 'Generic').trim() || 'Generic'
  const material = String(input.material || 'PLA').trim() || 'PLA'
  const hex = String(input.colorHex || '#000000')
    .replace(/^#/, '')
    .slice(0, 6)
    .toUpperCase()
  const colorCode = (hex.length === 6 ? hex : '000000') + 'FF'
  const colorName = String(input.color || '').trim()
  const total = Math.max(1, Math.round(Number(input.totalGrams) || 1000))
  const remain = Math.max(0, Math.round(Number(input.remainGrams) || total))
  const filamentId =
    String(input.bambuFilamentId || '').trim() || resolveFilamentId(vendor, material)
  // Studio: filamentName 多为系列名；无系列时用材质类型
  const filamentName = colorName ? `${material}` : material
  const body: Record<string, unknown> = {
    createType: 'manual',
    filamentVendor: vendor,
    filamentName,
    filamentType: material,
    type: material,
    isSupport: false,
    color: colorCode,
    colorType: 2,
    colors: [colorCode],
    netWeight: remain,
    totalNetWeight: total,
    diameter: 1.75,
    note: String(input.notes || '').slice(0, 50)
  }
  if (filamentId) body.filamentId = filamentId
  return body
}

export function spoolToUpdateBody(
  id: string | number,
  input: {
    brandId?: string
    vendor?: string
    material?: string
    color?: string
    colorHex?: string
    totalGrams?: number
    remainGrams?: number
    notes?: string
    bambuFilamentId?: string
  }
): Record<string, unknown> {
  const numId = Number(id)
  const base = spoolToCreateBody(input)
  return {
    ...base,
    id: Number.isFinite(numId) ? numId : id,
    filamentName: base.filamentName
  }
}

function colorNameFromHex(hex: string): string {
  const h = hex.toLowerCase()
  if (h === '#000000' || h === '#1a1a1a') return '黑色'
  if (h === '#ffffff' || h === '#f5f5f5') return '白色'
  return hex
}
