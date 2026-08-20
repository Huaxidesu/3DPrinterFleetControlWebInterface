/**
 * 软件更新镜像：GitHub / Gitee / GitCode（用户自选）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export type UpdateMirrorId = 'github' | 'gitee' | 'gitcode'

export type UpdateMirror = {
  id: UpdateMirrorId
  label: string
  /** 提示文案里用的主机名 */
  hostHint: string
  webUrl: string
  gitUrl: string
  releasesUrl: string
  apiReleasesLatest: string | null
  apiTags: string
  atomUrl: string | null
  zipUrls: (tagName: string) => string[]
}

const REPO = '3DPrinterFleetControlWebInterface'

export const UPDATE_MIRRORS: Record<UpdateMirrorId, UpdateMirror> = {
  github: {
    id: 'github',
    label: 'GitHub',
    hostHint: 'github.com',
    webUrl: `https://github.com/hanye1993/${REPO}`,
    gitUrl: `https://github.com/hanye1993/${REPO}.git`,
    releasesUrl: `https://github.com/hanye1993/${REPO}/releases`,
    apiReleasesLatest: `https://api.github.com/repos/hanye1993/${REPO}/releases/latest`,
    apiTags: `https://api.github.com/repos/hanye1993/${REPO}/tags?per_page=30`,
    atomUrl: `https://github.com/hanye1993/${REPO}/releases.atom`,
    zipUrls: (tag) => [
      `https://codeload.github.com/hanye1993/${REPO}/zip/refs/tags/${tag}`,
      `https://github.com/hanye1993/${REPO}/archive/refs/tags/${tag}.zip`
    ]
  },
  gitee: {
    id: 'gitee',
    label: 'Gitee',
    hostHint: 'gitee.com',
    webUrl: `https://gitee.com/hanye11/${REPO}`,
    gitUrl: `https://gitee.com/hanye11/${REPO}.git`,
    releasesUrl: `https://gitee.com/hanye11/${REPO}/releases`,
    apiReleasesLatest: `https://gitee.com/api/v5/repos/hanye11/${REPO}/releases/latest`,
    apiTags: `https://gitee.com/api/v5/repos/hanye11/${REPO}/tags?sort=updated&direction=desc&per_page=30`,
    atomUrl: null,
    zipUrls: (tag) => [`https://gitee.com/hanye11/${REPO}/repository/archive/${tag}.zip`]
  },
  gitcode: {
    id: 'gitcode',
    label: 'GitCode',
    hostHint: 'gitcode.com',
    webUrl: `https://gitcode.com/hanye6666/${REPO}`,
    gitUrl: `https://gitcode.com/hanye6666/${REPO}.git`,
    releasesUrl: `https://gitcode.com/hanye6666/${REPO}/releases`,
    apiReleasesLatest: `https://gitcode.com/api/v5/repos/hanye6666/${REPO}/releases/latest`,
    apiTags: `https://gitcode.com/api/v5/repos/hanye6666/${REPO}/tags?sort=updated&direction=desc&per_page=30`,
    atomUrl: null,
    zipUrls: (tag) => [
      // GitCode 网页 archive 常返回反爬 HTML；保留作尝试，失败后走 git clone
      `https://gitcode.com/hanye6666/${REPO}/repository/archive/${tag}.zip`,
      `https://gitcode.com/hanye6666/${REPO}/archive/refs/tags/${tag}.zip`,
      `https://gitcode.com/hanye6666/${REPO}/-/archive/${tag}/${REPO}-${tag}.zip`
    ]
  }
}

export const UPDATE_MIRROR_IDS: UpdateMirrorId[] = ['github', 'gitee', 'gitcode']

export function isUpdateMirrorId(v: unknown): v is UpdateMirrorId {
  return v === 'github' || v === 'gitee' || v === 'gitcode'
}

export function getMirror(id: UpdateMirrorId): UpdateMirror {
  return UPDATE_MIRRORS[id]
}

export function listUpdateMirrors(): Array<{
  id: UpdateMirrorId
  label: string
  hostHint: string
  webUrl: string
}> {
  return UPDATE_MIRROR_IDS.map((id) => {
    const m = UPDATE_MIRRORS[id]
    return { id: m.id, label: m.label, hostHint: m.hostHint, webUrl: m.webUrl }
  })
}

/** 兼容旧常量 */
export const GITHUB_OWNER = 'hanye1993'
export const GITHUB_REPO = REPO
export const GITHUB_REPO_URL = UPDATE_MIRRORS.github.webUrl
export const GITHUB_RELEASES_URL = UPDATE_MIRRORS.github.releasesUrl

function prefsPathFromDataRoot(dataRoot: string): string {
  return join(dataRoot, 'update-mirror.json')
}

export function resolveUpdatePrefsPath(dataRoot?: string | null): string {
  if (dataRoot && String(dataRoot).trim()) {
    return prefsPathFromDataRoot(String(dataRoot).trim())
  }
  return prefsPathFromDataRoot(join(process.cwd(), 'data'))
}

export function readPreferredMirror(dataRoot?: string | null): UpdateMirrorId {
  try {
    const p = resolveUpdatePrefsPath(dataRoot)
    if (!existsSync(p)) return 'gitee'
    const j = JSON.parse(readFileSync(p, 'utf8')) as { mirror?: string }
    return isUpdateMirrorId(j.mirror) ? j.mirror : 'gitee'
  } catch {
    return 'gitee'
  }
}

export function writePreferredMirror(
  mirror: UpdateMirrorId,
  dataRoot?: string | null
): UpdateMirrorId {
  const id = isUpdateMirrorId(mirror) ? mirror : 'gitee'
  const p = resolveUpdatePrefsPath(dataRoot)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ mirror: id, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
  return id
}
