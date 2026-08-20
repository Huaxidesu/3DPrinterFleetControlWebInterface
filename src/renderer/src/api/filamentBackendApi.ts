import { serverGet, serverSend, serverSendAllowFail } from './serverClient'

export type FilamentBackendKind = 'local' | 'bambu_studio'

export type FilamentBackendState = {
  ok?: boolean
  backend: FilamentBackendKind
  region: 'china' | 'global'
  account: string
  loggedIn: boolean
  mutualSync: boolean
  message?: string
}

export type MutualSyncResult = FilamentBackendState & {
  pushed?: number
  pulled?: number
  updated?: number
  skipped?: number
}

export async function fetchFilamentBackend() {
  return serverGet<FilamentBackendState>('/api/v1/filament/backend')
}

export async function setFilamentBackendMode(backend: FilamentBackendKind) {
  return serverSend<FilamentBackendState>('/api/v1/filament/backend', 'POST', { backend })
}

export async function setFilamentMutualSync(mutualSync: boolean) {
  return serverSend<FilamentBackendState>('/api/v1/filament/backend', 'POST', { mutualSync })
}

/** 开启/关闭互相同步；开启时立即按 品牌+材质+色值 双向对齐本地与拓竹库 */
export async function runFilamentMutualSync(enable?: boolean) {
  return serverSendAllowFail<MutualSyncResult>('/api/v1/filament/bambu/mutual-sync', 'POST', {
    ...(typeof enable === 'boolean' ? { enable } : {})
  })
}

export async function filamentBambuSendCode(region: 'china' | 'global', account: string) {
  return serverSend<{ ok: boolean; message?: string; via?: string }>(
    '/api/v1/filament/bambu/send-code',
    'POST',
    { region, account }
  )
}

export async function filamentBambuLogin(opts: {
  region: 'china' | 'global'
  account: string
  password?: string
  code?: string
}) {
  return serverSendAllowFail<FilamentBackendState & { needCode?: boolean; via?: string }>(
    '/api/v1/filament/bambu/login',
    'POST',
    opts
  )
}

export async function filamentBambuLogout() {
  return serverSend<FilamentBackendState>('/api/v1/filament/bambu/logout', 'POST', {})
}

export async function filamentBambuAmsSync() {
  return serverSend<{ ok: boolean; message?: string }>('/api/v1/filament/bambu/ams-sync', 'POST', {})
}
