import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Modal, Segmented, Space, Typography, message } from 'antd'
import { CloudDownloadOutlined, GithubOutlined, InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { openExternal } from '../../utils/openExternal'
import { PluginSlot } from '../../plugins/PluginSlot'
import { useAuthStore, apiFetch } from '../../stores/authStore'

const LS_LAST = 'hanye_update_last_check_at'
const LS_HINT = 'hanye_update_pending_hint'
const LS_MIRROR = 'hanye_update_mirror'
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_REPO_URL = 'https://gitee.com/hanye11/3DPrinterFleetControlWebInterface'
/** Build-time version from package.json — always available without API */
const BUILTIN_VERSION = String(
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.4.1'
).replace(/^v/i, '') || '1.4.1'

export type UpdateMirrorId = 'github' | 'gitee' | 'gitcode'

export type UpdateMirrorInfo = {
  id: UpdateMirrorId
  label: string
  hostHint: string
  webUrl: string
}

export type UpdateCheckPayload = {
  ok: boolean
  reachable: boolean
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string | null
  latestTag: string | null
  releaseUrl: string | null
  message: string
  checkedAt?: string
  cached?: boolean
  deployMode?: 'docker' | 'source'
  canApplyUpdate?: boolean
  canAutoRebuild?: boolean
  mirror?: UpdateMirrorId
  mirrorLabel?: string
  preferred?: UpdateMirrorId
  mirrors?: UpdateMirrorInfo[]
}

const FALLBACK_MIRRORS: UpdateMirrorInfo[] = [
  {
    id: 'github',
    label: 'GitHub',
    hostHint: 'github.com',
    webUrl: 'https://github.com/hanye1993/3DPrinterFleetControlWebInterface'
  },
  {
    id: 'gitee',
    label: 'Gitee',
    hostHint: 'gitee.com',
    webUrl: 'https://gitee.com/hanye11/3DPrinterFleetControlWebInterface'
  },
  {
    id: 'gitcode',
    label: 'GitCode',
    hostHint: 'gitcode.com',
    webUrl: 'https://gitcode.com/hanye6666/3DPrinterFleetControlWebInterface'
  }
]

function isMirrorId(v: unknown): v is UpdateMirrorId {
  return v === 'github' || v === 'gitee' || v === 'gitcode'
}

async function fetchLocalAppVersion(): Promise<string> {
  const { serverUrl } = useAuthStore.getState()
  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/health`)
    const j = (await res.json()) as { version?: string }
    const v = String(j.version || '').trim().replace(/^v/i, '')
    return v || BUILTIN_VERSION
  } catch {
    return BUILTIN_VERSION
  }
}

export async function fetchUpdateCheck(
  force = false,
  mirror?: UpdateMirrorId | null
): Promise<UpdateCheckPayload> {
  const { serverUrl, token } = useAuthStore.getState()
  const qs = new URLSearchParams()
  if (force) qs.set('force', '1')
  if (mirror) qs.set('mirror', mirror)
  const path = `/api/v1/update/check${qs.toString() ? `?${qs}` : ''}`
  const localVersion = await fetchLocalAppVersion()
  const res = await apiFetch(serverUrl, path, { token: token || undefined })
  let j: Partial<UpdateCheckPayload> & { message?: string } = {}
  try {
    j = (await res.json()) as Partial<UpdateCheckPayload> & { message?: string }
  } catch {
    j = {}
  }
  if (!res.ok || typeof j.reachable !== 'boolean') {
    return {
      ok: false,
      reachable: false,
      updateAvailable: false,
      currentVersion: localVersion,
      latestVersion: null,
      latestTag: null,
      releaseUrl: DEFAULT_REPO_URL,
      message:
        res.status === 401
          ? '未登录或登录已失效，请重新登录后再检查更新'
          : j.message ||
            '检查不到更新：服务器无法访问所选平台。浏览器能打开不等于服务器能连通。',
      mirrors: FALLBACK_MIRRORS,
      preferred: mirror || 'gitee'
    }
  }
  return {
    ok: Boolean(j.ok),
    reachable: j.reachable,
    updateAvailable: Boolean(j.updateAvailable),
    currentVersion: j.currentVersion || localVersion,
    latestVersion: j.latestVersion ?? null,
    latestTag: j.latestTag ?? null,
    releaseUrl: j.releaseUrl || DEFAULT_REPO_URL,
    message: j.message || '',
    checkedAt: j.checkedAt,
    cached: j.cached,
    deployMode: j.deployMode === 'docker' ? 'docker' : j.deployMode === 'source' ? 'source' : undefined,
    canApplyUpdate: j.canApplyUpdate,
    canAutoRebuild: Boolean(j.canAutoRebuild),
    mirror: isMirrorId(j.mirror) ? j.mirror : undefined,
    mirrorLabel: j.mirrorLabel,
    preferred: isMirrorId(j.preferred) ? j.preferred : undefined,
    mirrors: Array.isArray(j.mirrors) && j.mirrors.length ? j.mirrors : FALLBACK_MIRRORS
  }
}

async function saveUpdateMirror(mirror: UpdateMirrorId): Promise<void> {
  const { serverUrl, token } = useAuthStore.getState()
  await apiFetch(serverUrl, '/api/v1/update/mirror', {
    method: 'POST',
    token: token || undefined,
    body: JSON.stringify({ mirror })
  })
  localStorage.setItem(LS_MIRROR, mirror)
}

function sleep(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms))
}

function versionAtLeast(current: string, target: string): boolean {
  const pa = String(current || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10))
  const pb = String(target || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10))
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = Number.isFinite(pa[i]!) ? pa[i]! : 0
    const y = Number.isFinite(pb[i]!) ? pb[i]! : 0
    if (x > y) return true
    if (x < y) return false
  }
  return true
}

async function waitForRebuiltVersion(target: string | null): Promise<string | null> {
  const { serverUrl } = useAuthStore.getState()
  const health = `${serverUrl.replace(/\/$/, '')}/api/health`
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    await sleep(8000)
    try {
      const res = await fetch(health, { cache: 'no-store' })
      if (!res.ok) continue
      const j = (await res.json()) as { version?: string }
      const v = String(j.version || '').trim().replace(/^v/i, '')
      if (!v) continue
      if (!target || versionAtLeast(v, target)) return v
    } catch {
      /* 重建时短暂断开 */
    }
  }
  return null
}

export function usePeriodicUpdateCheck(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const run = async () => {
      try {
        const last = Number(localStorage.getItem(LS_LAST) || 0)
        if (Date.now() - last < DAY_MS) {
          const pending = localStorage.getItem(LS_HINT)
          if (pending === '1') {
            message.info({
              content: '检测到有新版本，可到「软件设置 → 关于」检查并更新',
              key: 'hanye-update-hint',
              duration: 6
            })
          }
          return
        }
        const r = await fetchUpdateCheck(false)
        if (cancelled) return
        localStorage.setItem(LS_LAST, String(Date.now()))
        if (!r.reachable) {
          localStorage.removeItem(LS_HINT)
          message.warning({
            content:
              r.message ||
              '检查不到更新：请确认运行监控台的服务器能访问所选更新平台（GitHub / Gitee / GitCode）',
            key: 'hanye-update-unreachable',
            duration: 8
          })
          return
        }
        if (r.updateAvailable) {
          localStorage.setItem(LS_HINT, '1')
          message.info({
            content: `${r.message || '发现新版本'}。请到「软件设置 → 关于」点击更新。`,
            key: 'hanye-update-available',
            duration: 8
          })
        } else {
          localStorage.removeItem(LS_HINT)
        }
      } catch {
        if (!cancelled) {
          localStorage.setItem(LS_LAST, String(Date.now()))
          message.warning({
            content: '检查不到更新：请确认运行监控台的服务器能访问所选更新平台',
            key: 'hanye-update-unreachable',
            duration: 8
          })
        }
      }
    }
    const t = window.setTimeout(() => void run(), 2500)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [enabled])
}

export function SoftSettingsAbout() {
  const token = useAuthStore((s) => s.token)
  const serverUrl = useAuthStore((s) => s.serverUrl)
  const user = useAuthStore((s) => s.user)
  const isAdmin = !user || user.level === 'admin'
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [status, setStatus] = useState<UpdateCheckPayload | null>(null)
  const [localVersion, setLocalVersion] = useState<string>(BUILTIN_VERSION)
  const [mirror, setMirror] = useState<UpdateMirrorId>(() => {
    const saved = localStorage.getItem(LS_MIRROR)
    return isMirrorId(saved) ? saved : 'gitee'
  })
  const [mirrors, setMirrors] = useState<UpdateMirrorInfo[]>(FALLBACK_MIRRORS)

  const doCheck = useCallback(
    async (force: boolean, nextMirror?: UpdateMirrorId) => {
      const useMirror = nextMirror || mirror
      setChecking(true)
      try {
        const r = await fetchUpdateCheck(force, useMirror)
        setStatus(r)
        if (r.mirrors?.length) setMirrors(r.mirrors)
        // 以本次检查实际使用的平台为准，避免被服务器 preferred 覆盖成别的镜像
        if (isMirrorId(useMirror)) setMirror(useMirror)
        else if (isMirrorId(r.mirror)) setMirror(r.mirror)
        else if (isMirrorId(r.preferred)) setMirror(r.preferred)
        localStorage.setItem(LS_LAST, String(Date.now()))
        if (!r.reachable) {
          localStorage.removeItem(LS_HINT)
          message.warning(r.message || '检查不到更新，请确认所选平台网络可达')
        } else if (r.updateAvailable) {
          localStorage.setItem(LS_HINT, '1')
          message.info(r.message)
        } else {
          localStorage.removeItem(LS_HINT)
          message.success(r.message || '已是最新版本')
        }
      } catch (e) {
        const localVersion = await fetchLocalAppVersion()
        const msg = e instanceof Error ? e.message : '检查失败'
        setStatus({
          ok: false,
          reachable: false,
          updateAvailable: false,
          currentVersion: localVersion,
          latestVersion: null,
          latestTag: null,
          releaseUrl: DEFAULT_REPO_URL,
          message:
            '检查不到更新：服务器无法访问所选更新平台。浏览器能打开不等于服务器能连通。',
          mirrors: FALLBACK_MIRRORS,
          preferred: useMirror
        })
        message.warning(
          msg.includes('Failed') || msg.includes('fetch')
            ? '检查不到更新：请确认运行监控台的那台机器能访问所选平台'
            : msg
        )
      } finally {
        setChecking(false)
      }
    },
    [mirror]
  )

  const onMirrorChange = async (v: string | number) => {
    if (!isMirrorId(v)) return
    setMirror(v)
    if (isAdmin) {
      try {
        await saveUpdateMirror(v)
      } catch {
        /* 本地仍可按所选平台检查 */
      }
    } else {
      localStorage.setItem(LS_MIRROR, v)
    }
    await doCheck(true, v)
  }

  useEffect(() => {
    let cancelled = false
    void fetchLocalAppVersion().then((v) => {
      if (!cancelled) setLocalVersion(v)
    })
    return () => {
      cancelled = true
    }
  }, [serverUrl])

  useEffect(() => {
    void doCheck(false)
  }, [doCheck, serverUrl, token])

  const activeMirror =
    mirrors.find((m) => m.id === mirror) || FALLBACK_MIRRORS.find((m) => m.id === mirror) || FALLBACK_MIRRORS[1]!
  const openUrl = status?.releaseUrl || activeMirror.webUrl

  const onUpdateClick = () => {
    const docker = status?.deployMode === 'docker'
    Modal.confirm({
      title: docker ? '确认更新（Docker）？' : '确认更新源码？',
      icon: <GithubOutlined />,
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            更新由<strong>服务器</strong>从 <strong>{activeMirror.label}</strong> 拉取：优先 git，否则下载源码包。需该机器能访问{' '}
            <Typography.Link href={activeMirror.webUrl} target="_blank" rel="noreferrer">
              {activeMirror.hostHint}
            </Typography.Link>
            。
          </p>
          {docker ? (
            <p style={{ marginBottom: 0, color: 'rgba(0,0,0,.45)' }}>
              {status?.canAutoRebuild
                ? '会下载新源码并自动重建容器。页面可能短暂断开，完成后刷新即可看到新版本。'
                : '会先把新源码写到宿主机。若未挂载 docker.sock，还需在 Docker 里「重新构建并启动」后新版本才会进容器。'}
            </p>
          ) : (
            <p style={{ marginBottom: 0, color: 'rgba(0,0,0,.45)' }}>
              完成后请自行 npm run build 并重启服务（飞牛可用 node.js20/update-hanye.sh）。
            </p>
          )}
        </div>
      ),
      okText: docker ? '开始更新' : '服务器可访问，开始更新',
      cancelText: '取消',
      onOk: async () => {
        setApplying(true)
        let waitInBackground = false
        try {
          const probe = await fetchUpdateCheck(true, mirror)
          if (!probe.reachable) {
            message.error(probe.message || `无法连接 ${activeMirror.label}，请检查网络后再试`)
            setStatus(probe)
            return
          }
          if (probe.canApplyUpdate === false) {
            message.error(
              probe.message ||
                '当前 Docker 未挂载宿主机源码目录，无法在设置里更新。请先按文档更新 compose 并重建。'
            )
            setStatus(probe)
            return
          }
          const res = await apiFetch(serverUrl, '/api/v1/update/apply', {
            method: 'POST',
            token: token || undefined,
            body: JSON.stringify({ mirror })
          })
          const j = (await res.json()) as {
            ok?: boolean
            reachable?: boolean
            message?: string
            needsRebuild?: boolean
            rebuilding?: boolean
            deployMode?: string
            latestVersion?: string | null
            currentVersion?: string
          }
          if (!j.reachable) {
            message.error(j.message || '无法连接 GitHub，请检查网络后再试')
            return
          }
          if (!j.ok) {
            message.error(j.message || '更新失败')
            return
          }
          localStorage.removeItem(LS_HINT)
          if (j.rebuilding) {
            waitInBackground = true
            const target = j.latestVersion || j.currentVersion || null
            void (async () => {
              try {
                message.loading({
                  content: j.message || '正在重建容器，请稍候…',
                  key: 'hanye-rebuild',
                  duration: 0
                })
                const next = await waitForRebuiltVersion(target)
                if (next) {
                  message.success({ content: `已更新到 v${next}`, key: 'hanye-rebuild' })
                  setLocalVersion(next)
                } else {
                  message.warning({
                    content: '容器仍在重建或启动中，请过一两分钟后手动刷新页面。',
                    key: 'hanye-rebuild'
                  })
                }
                await doCheck(true)
              } finally {
                setApplying(false)
              }
            })()
            return
          }
          message.success(j.message || '源码已更新')
          if (j.needsRebuild || j.deployMode === 'docker') {
            Modal.info({
              title: '还差一步：重建 Docker 镜像',
              content:
                '源码已写到宿主机，但当前容器还是旧镜像。请到 Docker → 本项目 →「重新构建并启动」（需使用已挂载 docker.sock 的新 compose）。完成后刷新网页查看新版本号。'
            })
          }
          await doCheck(true)
        } catch (e) {
          message.error(e instanceof Error ? e.message : '更新失败')
        } finally {
          if (!waitInBackground) setApplying(false)
        }
      }
    })
  }

  const ver = status?.currentVersion || localVersion

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PluginSlot name="settings.about.content.before" />
      <Card className="settings-card" title="关于">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div className="settings-row">
            <div className="settings-row-label">
              <Typography.Text strong>hanye-3D打印机监控台</Typography.Text>
              <Typography.Text type="secondary">版本 v{ver}</Typography.Text>
            </div>
            <InfoCircleOutlined style={{ fontSize: 18, opacity: 0.55 }} />
          </div>

          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              更新平台（按网络自选）
            </Typography.Text>
            <Segmented
              value={mirror}
              disabled={checking || applying}
              onChange={(v) => void onMirrorChange(v)}
              options={mirrors.map((m) => ({ label: m.label, value: m.id }))}
              style={{ marginBottom: 12 }}
            />
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              检查更新 · 当前 {activeMirror.label}（{activeMirror.hostHint}）
            </Typography.Text>
            {status && !status.reachable ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 10 }}
                message="检查不到更新"
                description={
                  status.message ||
                  `请确认运行监控台的服务器能否访问 ${activeMirror.hostHint}。浏览器能打开不等于服务器能连通。可切换 GitHub / Gitee / GitCode 后再试。`
                }
              />
            ) : null}
            {status?.reachable && status.updateAvailable ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 10 }}
                message={`发现新版本 v${status.latestVersion}`}
                description={status.message}
              />
            ) : null}
            {status?.reachable && !status.updateAvailable ? (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 10 }}
                message={status.message || '已是最新版本'}
              />
            ) : null}
            <Space wrap>
              <Button
                icon={<ReloadOutlined />}
                loading={checking}
                onClick={() => void doCheck(true)}
              >
                检查更新
              </Button>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                loading={applying}
                disabled={!isAdmin}
                onClick={onUpdateClick}
              >
                更新
              </Button>
              <Button
                icon={<GithubOutlined />}
                onClick={() => openExternal(openUrl)}
              >
                打开 {activeMirror.label}
              </Button>
            </Space>
            {!isAdmin ? (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                仅管理员可执行源码更新。
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                {status?.deployMode === 'docker'
                  ? status.canAutoRebuild
                    ? 'Docker 模式：更新会覆盖宿主机源码并自动重建容器。自动每 24 小时检查一次。'
                    : 'Docker 模式：更新会覆盖宿主机源码。当前未挂载 docker.sock，还需手动重新构建镜像。自动每 24 小时检查一次。'
                  : '自动每 24 小时检查一次。更新会从所选平台拉取源码（git 或 ZIP），完成后请重新构建并重启。'}
              </Typography.Text>
            )}
          </div>

          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              介绍
            </Typography.Text>
            <Typography.Text>
              纯网页版监控台：电脑与手机浏览器打开同一地址即可使用（手机自适应布局）。统一管理
              Klipper / 拓竹 / 创想等设备与耗材；可通过「主题」换排版与配色，通过「插件」扩展功能。
            </Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              开发者
            </Typography.Text>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              B站：
              <Typography.Link
                onClick={() =>
                  openExternal(
                    'https://search.bilibili.com/all?keyword=%E5%B0%8F%E6%B1%89%E6%95%85%E4%BA%8B'
                  )
                }
              >
                @小汉故事
              </Typography.Link>
              <br />
              QQ：
              <Typography.Text copyable={{ text: '2500689358' }}>2500689358</Typography.Text>
              <br />
              群号：
              <Typography.Text copyable={{ text: '1053838529' }}>1053838529</Typography.Text>
            </Typography.Paragraph>
            <PluginSlot name="settings.about.links.after" />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              感谢
            </Typography.Text>
            <Typography.Text>时空之树测试反馈</Typography.Text>
          </div>
          <PluginSlot name="settings.about.footer" />
        </Space>
      </Card>
      <PluginSlot name="settings.about.content.after" />
    </Space>
  )
}
