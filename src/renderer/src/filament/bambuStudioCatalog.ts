/** Bambu Studio 耗材管理常用品牌 / 类型 / 预设色（与 Studio 添加弹窗对齐） */

export const BAMBU_VENDORS = [
  'Bambu Lab',
  'Generic',
  'eSUN',
  'Polymaker',
  'SUNLU',
  'Creality',
  'Anycubic',
  'ELEGOO',
  'Overture',
  'Hatchbox',
  'Prusament',
  'Flashforge'
] as const

const COMMON_TYPES = [
  'PLA',
  'PLA-CF',
  'PLA Aero',
  'PETG',
  'PETG-CF',
  'ABS',
  'ASA',
  'TPU',
  'PA',
  'PA-CF',
  'PC',
  'PVA',
  'HIPS',
  'PPS',
  'PPS-CF'
]

const BAMBU_TYPES = [
  'PLA',
  'PLA Basic',
  'PLA Matte',
  'PLA Silk',
  'PLA Metal',
  'PLA-CF',
  'PLA Aero',
  'PETG',
  'PETG-CF',
  'ABS',
  'ASA',
  'TPU',
  'PA',
  'PA-CF',
  'PC',
  'PVA',
  'Support for PLA',
  'Support for PA/PET'
]

export function typesForVendor(vendor: string): string[] {
  const v = String(vendor || '').toLowerCase()
  if (!v) return []
  if (v.includes('bambu')) return [...BAMBU_TYPES]
  return [...COMMON_TYPES]
}

export const DEFAULT_COLOR_PRESETS: { label: string; hex: string }[] = [
  { label: '黑色', hex: '#000000' },
  { label: '白色', hex: '#FFFFFF' },
  { label: '灰色', hex: '#8C8C8C' },
  { label: '红色', hex: '#CF1322' },
  { label: '橙色', hex: '#D46B08' },
  { label: '黄色', hex: '#D4B106' },
  { label: '绿色', hex: '#389E0D' },
  { label: '蓝色', hex: '#0958D9' },
  { label: '青色', hex: '#08979C' },
  { label: '紫色', hex: '#531DAB' },
  { label: '粉色', hex: '#C41D7F' },
  { label: '棕色', hex: '#874D00' }
]

/** Studio：部分品牌有预设色；Generic 等可能无预设 */
export function presetColorsFor(vendor: string, _type?: string): { label: string; hex: string }[] {
  const v = String(vendor || '').toLowerCase()
  if (!v) return []
  if (v.includes('generic') || v === 'other') return []
  return DEFAULT_COLOR_PRESETS
}

export function brandLabelOfVendor(brandId: string): string {
  const id = String(brandId || '').trim()
  if (!id) return ''
  if (id.startsWith('custom:')) return id.slice('custom:'.length)
  const hit = BAMBU_VENDORS.find(
    (v) => v.toLowerCase() === id.toLowerCase() || v.toLowerCase().replace(/\s+/g, '_') === id.toLowerCase()
  )
  if (hit) return hit
  if (id === 'bambu' || id === 'bambu_lab') return 'Bambu Lab'
  if (id === 'esun') return 'eSUN'
  if (id === 'sunlu') return 'SUNLU'
  if (id === 'creality') return 'Creality'
  if (id === 'elegoo') return 'ELEGOO'
  if (id === 'polymaker') return 'Polymaker'
  return id
}
