import type { DeviceConfig, PrinterBrand } from '../types/printer'

/** Normalize model for same-fleet batch print matching. */
export function normalizeDeviceModel(model?: string | null): string {
  return String(model || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** Brand + model key; empty model → "" (legacy devices of same brand can still match each other). */
export function deviceBatchPrintKey(device: DeviceConfig): string {
  return `${device.brand}::${normalizeDeviceModel(device.model)}`
}

export function deviceModelLabel(device: DeviceConfig): string {
  const m = String(device.model || '').trim()
  return m || '未设置机型'
}

export type BatchPrintGroupCheck =
  | { ok: true; brand: PrinterBrand; modelLabel: string }
  | { ok: false; message: string }

/** Batch import print requires identical brand (models may differ). */
export function assertSameBrandBatch(devices: DeviceConfig[]): BatchPrintGroupCheck {
  if (!devices.length) return { ok: false, message: '没有可批量打印的设备' }
  const brands = new Set(devices.map((d) => d.brand))
  if (brands.size !== 1) {
    return {
      ok: false,
      message: `批量导入打印仅允许相同品牌：当前选中 ${brands.size} 种品牌，请只勾选同品牌设备`
    }
  }
  const brand = devices[0]!.brand
  const models = [...new Set(devices.map((d) => deviceModelLabel(d)))]
  const modelLabel =
    models.length === 1 ? models[0]! : `${models.slice(0, 3).join(' / ')}${models.length > 3 ? '…' : ''}`
  return { ok: true, brand: brand as PrinterBrand, modelLabel }
}
