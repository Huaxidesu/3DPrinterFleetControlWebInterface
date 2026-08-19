export type FilamentKind = 'fdm' | 'resin' | 'both'

export type FilamentBrand = {
  id: string
  name: string
  nameEn?: string
  kind: FilamentKind
  popular?: boolean
}

export type MaterialCategory = 'fdm' | 'resin'

export type MaterialType = {
  id: string
  label: string
  category: MaterialCategory
}

/** Bind local spool to a printer for auto-deduct on print finish */
export type SpoolAmsBinding = {
  deviceId: string
  /**
   * 0 = 外挂 / 单色料架 / 换头机 T0
   * ≥1 = AMS 槽位或换头机 T1、T2…（与详情控制台料位编号一致）
   */
  slotId: number
}

export type SpoolRecord = {
  id: string
  brandId: string
  material: string
  color: string
  colorHex: string
  /** 单卷净重/总重 (g)；库存总容量 = totalGrams × rolls */
  totalGrams: number
  remainGrams: number
  /** 同规格料卷数量；可绑定设备/槽位数上限 = rolls（默认 1）；余量上限 = totalGrams × rolls */
  rolls?: number
  location?: string
  price?: number
  openedAt?: string
  notes?: string
  tech: 'fdm' | 'resin'
  archived?: boolean
  /** @deprecated use amsBindings */
  amsBinding?: SpoolAmsBinding | null
  /** 绑定列表，长度不超过 rolls */
  amsBindings?: SpoolAmsBinding[]
  createdAt: string
  updatedAt?: string
  /** Free-form plugin payload */
  pluginData?: Record<string, unknown>
  [key: string]: unknown
}
