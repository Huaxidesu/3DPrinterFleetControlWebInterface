import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type { BambuRegion } from '../bambu/cloud'
import { bambuLogin, bambuLoginWithCode, bambuSendVerifyCode } from '../bambu/cloud'
import {
  cloudAmsSync,
  cloudCreateFilament,
  cloudDeleteFilaments,
  cloudHitToSpool,
  cloudListFilaments,
  cloudUpdateFilament,
  spoolToCreateBody,
  spoolToUpdateBody
} from '../bambu/filamentCloud'
import { filamentSyncMatchKey, rollsFromTotalGrams } from '../../shared/spoolCatalog'

export type FilamentBackendKind = 'local' | 'bambu_studio'

export type FilamentBackendState = {
  backend: FilamentBackendKind
  region: BambuRegion
  account: string
  loggedIn: boolean
  mutualSync: boolean
}

type Overlay = {
  bindings: Record<string, Array<{ deviceId: string; slotId: number }>>
  /** local spool id → cloud spool id */
  syncPairs?: Record<string, string>
}

type Cfg = {
  backend: FilamentBackendKind
  region: BambuRegion
  account: string
  mutualSync: boolean
}

const TOKEN_KEY = 'bambu:filament:cloud'

type Deps = {
  filamentPath: string
  getSecret: (key: string) => string | null
  setSecret: (key: string, value: string) => void
  deleteSecret: (key: string) => void
}

type SpoolLike = Record<string, unknown>

function cfgPath(filamentPath: string) {
  return join(dirname(filamentPath), 'filament-backend.json')
}

function overlayPath(filamentPath: string) {
  return join(dirname(filamentPath), 'filament-bambu-overlay.json')
}

function readCfg(p: string): Cfg {
  try {
    if (!existsSync(p)) return { backend: 'local', region: 'china', account: '', mutualSync: false }
    const j = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    return {
      backend: j.backend === 'bambu_studio' ? 'bambu_studio' : 'local',
      region: j.region === 'global' ? 'global' : 'china',
      account: String(j.account || ''),
      mutualSync: j.mutualSync === true
    }
  } catch {
    return { backend: 'local', region: 'china', account: '', mutualSync: false }
  }
}

function writeCfg(p: string, cfg: Cfg) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8')
}

function readOverlay(p: string): Overlay {
  try {
    if (!existsSync(p)) return { bindings: {}, syncPairs: {} }
    const j = JSON.parse(readFileSync(p, 'utf8')) as Overlay
    return {
      bindings: j.bindings && typeof j.bindings === 'object' ? j.bindings : {},
      syncPairs: j.syncPairs && typeof j.syncPairs === 'object' ? j.syncPairs : {}
    }
  } catch {
    return { bindings: {}, syncPairs: {} }
  }
}

function writeOverlay(p: string, o: Overlay) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(o, null, 2), 'utf8')
}

function readLocalSpools(filamentPath: string): SpoolLike[] {
  try {
    if (!existsSync(filamentPath)) return []
    const raw = JSON.parse(readFileSync(filamentPath, 'utf8')) as unknown
    return Array.isArray(raw) ? (raw as SpoolLike[]) : []
  } catch {
    return []
  }
}

function writeLocalSpools(filamentPath: string, spools: SpoolLike[]) {
  mkdirSync(dirname(filamentPath), { recursive: true })
  writeFileSync(filamentPath, JSON.stringify(spools, null, 2), 'utf8')
}

export function getFilamentBackendState(deps: Deps): FilamentBackendState {
  const cfg = readCfg(cfgPath(deps.filamentPath))
  const token = deps.getSecret(TOKEN_KEY)
  return {
    backend: cfg.backend,
    region: cfg.region,
    account: cfg.account,
    loggedIn: Boolean(token),
    mutualSync: cfg.mutualSync
  }
}

export function setFilamentBackend(deps: Deps, backend: FilamentBackendKind): FilamentBackendState {
  const cfg = readCfg(cfgPath(deps.filamentPath))
  cfg.backend = backend
  writeCfg(cfgPath(deps.filamentPath), cfg)
  return getFilamentBackendState(deps)
}

export function setMutualSync(deps: Deps, mutualSync: boolean): FilamentBackendState {
  const cfg = readCfg(cfgPath(deps.filamentPath))
  cfg.mutualSync = Boolean(mutualSync)
  writeCfg(cfgPath(deps.filamentPath), cfg)
  return getFilamentBackendState(deps)
}

export function isMutualSyncEnabled(deps: Deps): boolean {
  return readCfg(cfgPath(deps.filamentPath)).mutualSync === true
}

export async function loginFilamentBambu(
  deps: Deps,
  opts: { region: BambuRegion; account: string; password?: string; code?: string }
): Promise<{ ok: boolean; message?: string; needCode?: boolean; via?: string }> {
  const region = opts.region === 'global' ? 'global' : 'china'
  const prev = readCfg(cfgPath(deps.filamentPath))
  if (opts.code && opts.code.trim()) {
    const r = await bambuLoginWithCode(region, opts.account, opts.code)
    if (!r.ok) return { ok: false, message: r.message }
    deps.setSecret(TOKEN_KEY, r.accessToken)
    writeCfg(cfgPath(deps.filamentPath), {
      backend: 'bambu_studio',
      region,
      account: opts.account.trim(),
      mutualSync: prev.mutualSync
    })
    return { ok: true }
  }
  if (!opts.password) return { ok: false, message: '请填写密码或验证码' }
  const r = await bambuLogin(region, opts.account, opts.password)
  if (!r.ok) {
    return {
      ok: false,
      message: r.message,
      needCode: r.needCode,
      via: 'via' in r ? r.via : undefined
    }
  }
  deps.setSecret(TOKEN_KEY, r.accessToken)
  writeCfg(cfgPath(deps.filamentPath), {
    backend: 'bambu_studio',
    region,
    account: opts.account.trim(),
    mutualSync: prev.mutualSync
  })
  return { ok: true }
}

export async function sendFilamentBambuCode(opts: { region: BambuRegion; account: string }) {
  return bambuSendVerifyCode(opts.region === 'global' ? 'global' : 'china', opts.account)
}

export function logoutFilamentBambu(deps: Deps): FilamentBackendState {
  deps.deleteSecret(TOKEN_KEY)
  return getFilamentBackendState(deps)
}

function creds(deps: Deps): { region: BambuRegion; token: string } | { error: string } {
  const cfg = readCfg(cfgPath(deps.filamentPath))
  const token = deps.getSecret(TOKEN_KEY)
  if (!token) return { error: '未登录 Bambu Studio 云端，请先登录拓竹账号' }
  return { region: cfg.region, token }
}

export function isCloudSpoolId(id: string): boolean {
  return /^\d+$/.test(String(id || '').trim())
}

function asMatchInput(s: SpoolLike) {
  return {
    brandId: s.brandId != null ? String(s.brandId) : undefined,
    vendor: s.vendor != null ? String(s.vendor) : undefined,
    brandName: s.brandName != null ? String(s.brandName) : undefined,
    material: s.material != null ? String(s.material) : undefined,
    colorHex: s.colorHex != null ? String(s.colorHex) : undefined,
    tech: s.tech != null ? String(s.tech) : 'fdm'
  }
}

function isSyncableLocal(s: SpoolLike): boolean {
  if (s.archived) return false
  if (String(s.tech || 'fdm') === 'resin') return false
  return Boolean(filamentSyncMatchKey(asMatchInput(s)))
}

export async function listCloudSpools(deps: Deps): Promise<
  { ok: true; spools: Record<string, unknown>[] } | { ok: false; message: string }
> {
  const c = creds(deps)
  if ('error' in c) return { ok: false, message: c.error }
  const listed = await cloudListFilaments(c.region, c.token)
  if (!listed.ok) return listed
  const overlay = readOverlay(overlayPath(deps.filamentPath))
  const spools = listed.hits
    .map((hit) => {
      const s = cloudHitToSpool(hit)
      const bindings = overlay.bindings[s.id] || []
      return {
        ...s,
        amsBindings: bindings,
        amsBinding: bindings[0] || null
      }
    })
    .filter((s) => String(s.id || '').trim())
  return { ok: true, spools }
}

export async function createCloudSpool(
  deps: Deps,
  body: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = creds(deps)
  if ('error' in c) return { ok: false, message: c.error }
  return cloudCreateFilament(c.region, c.token, spoolToCreateBody(body))
}

export async function updateCloudSpool(
  deps: Deps,
  id: string,
  body: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = creds(deps)
  if ('error' in c) return { ok: false, message: c.error }
  return cloudUpdateFilament(c.region, c.token, spoolToUpdateBody(id, body))
}

export async function deleteCloudSpool(
  deps: Deps,
  id: string,
  rfid?: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const c = creds(deps)
  if ('error' in c) return { ok: false, message: c.error }
  const r = await cloudDeleteFilaments(c.region, c.token, [id], rfid ? [rfid] : [])
  if (r.ok) {
    const p = overlayPath(deps.filamentPath)
    const o = readOverlay(p)
    delete o.bindings[id]
    if (o.syncPairs) {
      for (const [lid, cid] of Object.entries(o.syncPairs)) {
        if (cid === id) delete o.syncPairs[lid]
      }
    }
    writeOverlay(p, o)
  }
  return r
}

export function overlayBind(
  deps: Deps,
  spoolId: string,
  deviceId: string,
  slotId: number,
  bind: boolean
) {
  const p = overlayPath(deps.filamentPath)
  const o = readOverlay(p)
  let list = [...(o.bindings[spoolId] || [])]
  list = list.filter((b) => !(b.deviceId === deviceId && Number(b.slotId) === Number(slotId)))
  if (bind) list.push({ deviceId, slotId: Number(slotId) })
  if (list.length) o.bindings[spoolId] = list
  else delete o.bindings[spoolId]
  writeOverlay(p, o)
}

export async function amsSyncFromPrinters(
  deps: Deps,
  deviceSerials: string[]
): Promise<{ ok: boolean; message: string }> {
  const c = creds(deps)
  if ('error' in c) return { ok: false, message: c.error }
  if (!deviceSerials.length) return { ok: false, message: '没有拓竹设备序列号，请先添加 Bambu 打印机' }
  const msgs: string[] = []
  for (const serial of deviceSerials) {
    const r = await cloudAmsSync(c.region, c.token, { devId: serial, items: [] })
    msgs.push(serial + ': ' + (r.ok ? '已请求同步' : r.message))
  }
  return { ok: true, message: msgs.join('；') }
}

export type MutualSyncResult = {
  ok: boolean
  message: string
  pushed: number
  pulled: number
  updated: number
  skipped: number
}

/**
 * 互相同步：仅 FDM；按 品牌+材质+色值 匹配。
 * - 本地有、云端无 → 推到云端
 * - 云端有、本地无 → 拉到本地
 * - 两边都有 → 以较新 updatedAt 为准同步余量/总重
 * 树脂 / 归档 / 缺关键字段 → 跳过
 */
export async function runMutualSync(deps: Deps): Promise<MutualSyncResult> {
  const empty: MutualSyncResult = {
    ok: false,
    message: '',
    pushed: 0,
    pulled: 0,
    updated: 0,
    skipped: 0
  }
  if (!isMutualSyncEnabled(deps)) {
    return { ...empty, message: '未开启互相同步' }
  }
  const c = creds(deps)
  if ('error' in c) return { ...empty, message: c.error }

  const cloudListed = await listCloudSpools(deps)
  if (!cloudListed.ok) return { ...empty, message: cloudListed.message }

  const localAll = readLocalSpools(deps.filamentPath)
  const localFdm = localAll.filter(isSyncableLocal)
  const cloudFdm = cloudListed.spools.filter((s) => isSyncableLocal(s as SpoolLike))

  const overlayP = overlayPath(deps.filamentPath)
  const overlay = readOverlay(overlayP)
  const pairs = { ...(overlay.syncPairs || {}) }
  const usedCloud = new Set<string>()

  let pushed = 0
  let pulled = 0
  let updated = 0
  let skipped = 0

  const cloudByKey = new Map<string, SpoolLike[]>()
  for (const cs of cloudFdm) {
    const key = filamentSyncMatchKey(asMatchInput(cs as SpoolLike))
    if (!key) {
      skipped++
      continue
    }
    const arr = cloudByKey.get(key) || []
    arr.push(cs as SpoolLike)
    cloudByKey.set(key, arr)
  }

  const now = new Date().toISOString()
  let localMut = [...localAll]

  const findCloudForLocal = (local: SpoolLike): SpoolLike | null => {
    const lid = String(local.id || '')
    const paired = pairs[lid]
    if (paired) {
      const hit = cloudFdm.find((x) => String(x.id) === paired)
      if (hit && !usedCloud.has(String(hit.id))) return hit as SpoolLike
    }
    const key = filamentSyncMatchKey(asMatchInput(local))
    if (!key) return null
    const cands = (cloudByKey.get(key) || []).filter((x) => !usedCloud.has(String(x.id)))
    if (!cands.length) return null
    const localRemain = Number(local.remainGrams) || 0
    cands.sort(
      (a, b) =>
        Math.abs(Number(a.remainGrams) - localRemain) - Math.abs(Number(b.remainGrams) - localRemain)
    )
    return cands[0] || null
  }

  for (const local of localFdm) {
    const lid = String(local.id || '')
    const cloud = findCloudForLocal(local)
    if (!cloud) {
      const body = {
        brandId: local.brandId,
        vendor: local.vendor || local.brandName || local.brandId,
        material: local.material,
        color: local.color,
        colorHex: local.colorHex,
        totalGrams: local.totalGrams,
        remainGrams: local.remainGrams,
        notes: local.notes,
        tech: 'fdm'
      }
      const r = await cloudCreateFilament(
        c.region,
        c.token,
        spoolToCreateBody(body as Record<string, unknown>)
      )
      if (r.ok) {
        pushed++
        const again = await listCloudSpools(deps)
        if (again.ok) {
          const key = filamentSyncMatchKey(asMatchInput(local))
          const fresh = again.spools.find((cs) => {
            if (usedCloud.has(String(cs.id))) return false
            return filamentSyncMatchKey(asMatchInput(cs as SpoolLike)) === key
          })
          if (fresh?.id != null) {
            pairs[lid] = String(fresh.id)
            usedCloud.add(String(fresh.id))
          }
        }
      } else {
        skipped++
      }
      continue
    }

    const cid = String(cloud.id)
    usedCloud.add(cid)
    pairs[lid] = cid

    const localTs = Date.parse(String(local.updatedAt || local.createdAt || 0)) || 0
    const cloudTs = Date.parse(String(cloud.updatedAt || cloud.createdAt || 0)) || 0
    const localRemain = Number(local.remainGrams)
    const cloudRemain = Number(cloud.remainGrams)
    const localTotal = Number(local.totalGrams) || 1000
    const cloudTotal = Number(cloud.totalGrams) || 1000

    if (
      Number.isFinite(localRemain) &&
      Number.isFinite(cloudRemain) &&
      Math.round(localRemain) === Math.round(cloudRemain) &&
      Math.round(localTotal) === Math.round(cloudTotal)
    ) {
      continue
    }

    if (cloudTs >= localTs) {
      localMut = localMut.map((s) =>
        String(s.id) === lid
          ? {
              ...s,
              remainGrams: Math.max(0, cloudRemain),
              totalGrams: Math.max(1, cloudTotal),
              rolls: rollsFromTotalGrams(cloudTotal),
              updatedAt: now,
              x_bambu_cloud_id: cid
            }
          : s
      )
      updated++
    } else {
      const r = await cloudUpdateFilament(
        c.region,
        c.token,
        spoolToUpdateBody(cid, {
          brandId: String(local.brandId || ''),
          vendor: String(local.vendor || local.brandName || local.brandId || ''),
          material: String(local.material || ''),
          color: String(local.color || ''),
          colorHex: String(local.colorHex || ''),
          totalGrams: localTotal,
          remainGrams: localRemain,
          notes: local.notes != null ? String(local.notes) : undefined
        })
      )
      if (r.ok) updated++
      else skipped++
    }
  }

  for (const cloud of cloudFdm) {
    const cid = String(cloud.id || '')
    if (!cid || usedCloud.has(cid)) continue
    const key = filamentSyncMatchKey(asMatchInput(cloud as SpoolLike))
    if (!key) {
      skipped++
      continue
    }
    const totalGrams = Math.max(1, Number(cloud.totalGrams) || 1000)
    const remainGrams = Math.max(0, Number(cloud.remainGrams) || totalGrams)
    const created: SpoolLike = {
      id: randomUUID(),
      brandId: cloud.brandId || 'other',
      material: cloud.material || 'pla',
      color: cloud.color || '',
      colorHex: cloud.colorHex || '#888888',
      totalGrams,
      remainGrams,
      rolls: rollsFromTotalGrams(totalGrams),
      notes: cloud.notes,
      tech: 'fdm',
      archived: false,
      amsBindings: [],
      amsBinding: null,
      createdAt: now,
      updatedAt: now,
      vendor: cloud.vendor || cloud.brandName,
      brandName: cloud.brandName || cloud.vendor,
      x_bambu_cloud_id: cid
    }
    localMut.unshift(created)
    pairs[String(created.id)] = cid
    usedCloud.add(cid)
    pulled++
  }

  writeLocalSpools(deps.filamentPath, localMut)
  overlay.syncPairs = pairs
  writeOverlay(overlayP, overlay)

  return {
    ok: true,
    message: `互相同步完成：推送 ${pushed}，拉取 ${pulled}，更新 ${updated}，跳过 ${skipped}`,
    pushed,
    pulled,
    updated,
    skipped
  }
}

/** 本地新增后镜像到云端（互相同步开启时） */
export async function mirrorLocalCreateToCloud(deps: Deps, localSpool: SpoolLike): Promise<void> {
  if (!isMutualSyncEnabled(deps) || !isSyncableLocal(localSpool)) return
  const c = creds(deps)
  if ('error' in c) return
  const r = await cloudCreateFilament(
    c.region,
    c.token,
    spoolToCreateBody({
      brandId: String(localSpool.brandId || ''),
      vendor: String(localSpool.vendor || localSpool.brandName || localSpool.brandId || ''),
      material: String(localSpool.material || ''),
      color: String(localSpool.color || ''),
      colorHex: String(localSpool.colorHex || ''),
      totalGrams: Number(localSpool.totalGrams) || 1000,
      remainGrams: Number(localSpool.remainGrams) || 0,
      notes: localSpool.notes != null ? String(localSpool.notes) : undefined
    })
  )
  if (!r.ok) return
  const listed = await listCloudSpools(deps)
  if (!listed.ok) return
  const key = filamentSyncMatchKey(asMatchInput(localSpool))
  const hit = listed.spools.find((cs) => filamentSyncMatchKey(asMatchInput(cs as SpoolLike)) === key)
  if (!hit?.id) return
  const p = overlayPath(deps.filamentPath)
  const o = readOverlay(p)
  o.syncPairs = { ...(o.syncPairs || {}), [String(localSpool.id)]: String(hit.id) }
  writeOverlay(p, o)
}

/** 云端新增后镜像到本地 */
export function mirrorCloudCreateToLocal(deps: Deps, cloudSpool: SpoolLike): SpoolLike | null {
  if (!isMutualSyncEnabled(deps) || !isSyncableLocal(cloudSpool)) return null
  const locals = readLocalSpools(deps.filamentPath)
  const key = filamentSyncMatchKey(asMatchInput(cloudSpool))
  if (!key) return null
  const exists = locals.some((s) => filamentSyncMatchKey(asMatchInput(s)) === key && !s.archived)
  if (exists) return null
  const now = new Date().toISOString()
  const totalGrams = Math.max(1, Number(cloudSpool.totalGrams) || 1000)
  const created: SpoolLike = {
    id: randomUUID(),
    brandId: cloudSpool.brandId || 'other',
    material: cloudSpool.material || 'pla',
    color: cloudSpool.color || '',
    colorHex: cloudSpool.colorHex || '#888888',
    totalGrams,
    remainGrams: Math.max(0, Number(cloudSpool.remainGrams) || totalGrams),
    rolls: rollsFromTotalGrams(totalGrams),
    notes: cloudSpool.notes,
    tech: 'fdm',
    archived: false,
    amsBindings: [],
    amsBinding: null,
    createdAt: now,
    updatedAt: now,
    vendor: cloudSpool.vendor || cloudSpool.brandName,
    brandName: cloudSpool.brandName || cloudSpool.vendor,
    x_bambu_cloud_id: cloudSpool.id
  }
  locals.unshift(created)
  writeLocalSpools(deps.filamentPath, locals)
  const p = overlayPath(deps.filamentPath)
  const o = readOverlay(p)
  o.syncPairs = { ...(o.syncPairs || {}), [String(created.id)]: String(cloudSpool.id) }
  writeOverlay(p, o)
  return created
}
