import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  message
} from 'antd'
import {
  AppstoreOutlined,
  CloudDownloadOutlined,
  KeyOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  UserOutlined
} from '@ant-design/icons'
import { serverGet, serverSend } from '../../api/serverClient'
import { PluginSlot } from '../../plugins/PluginSlot'
import { openExternal } from '../../utils/openExternal'

type MarketRow = {
  kind: 'plugin' | 'theme'
  identifier: string
  name: string
  version: string
  description?: string
  icon?: string
  intro?: string
  installed: boolean
  installedVersion: string | null
  updateAvailable: boolean
  iconUrls?: string[]
  pricingType?: string
  price?: number
  licensed?: boolean
  licenseKeyHint?: string
  developerName?: string
  developerTags?: string[]
}

type MarketPayload = {
  ok?: boolean
  reachable?: boolean
  message?: string
  repo?: string
  name?: string
  updatedAt?: string
  marketBase?: string
  marketBases?: string[]
  siteKeyConfigured?: boolean
  docsUrl?: string
  consoleUrl?: string
  registerUrl?: string
  loginUrl?: string
  authRequired?: boolean
  loggedIn?: boolean
  user?: MarketUser | null
  packages?: MarketRow[]
}

type MarketUser = {
  id: string
  email: string
  username: string
  role: string
  displayName?: string
}

type LicensePayload = {
  ok?: boolean
  siteKey?: string | null
  siteKeyConfigured?: boolean
  deviceId?: string | null
  deviceIdConfigured?: boolean
  marketBase?: string
  docsUrl?: string
  consoleUrl?: string
  licenseRequired?: boolean
  licenseEnforce?: boolean
}

const REPO_FALLBACK = 'http://sc1.dpfrp.top:3000'
/** 源码内置备用线路（与服务端 catalog 一致；勿写入对外文档） */
const REPO_FALLBACKS = ['http://sc1.dpfrp.top:3000', 'http://124.221.92.32:3001'] as const

function isPaidRow(row: Pick<MarketRow, 'pricingType' | 'price'>): boolean {
  if (String(row.pricingType || '').toUpperCase() === 'PAID') return true
  const price = typeof row.price === 'number' ? row.price : Number(row.price)
  return Number.isFinite(price) && price > 0
}

function introLines(text?: string): string {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith('版本：') && !s.startsWith('标识：'))
    .slice(0, 3)
    .join('\n')
}

function MarketCover({ row }: { row: MarketRow }) {
  const urls = row.iconUrls || []
  const [idx, setIdx] = useState(0)
  const src = urls[idx]
  if (!src) {
    return (
      <div
        className="market-card-cover market-card-cover--empty"
        style={{ background: row.kind === 'theme' ? '#5b21b6' : '#1d4ed8' }}
      >
        <AppstoreOutlined style={{ fontSize: 36, color: '#fff', opacity: 0.9 }} />
      </div>
    )
  }
  return (
    <div className="market-card-cover">
      <img
        src={src}
        alt={row.name}
        onError={() => {
          if (idx + 1 < urls.length) setIdx(idx + 1)
        }}
      />
    </div>
  )
}

function actionLabel(row: MarketRow): { text: string; kind: 'install' | 'update' | 'latest' } {
  if (!row.installed) return { text: '安装', kind: 'install' }
  if (row.updateAvailable) return { text: '更新', kind: 'update' }
  return { text: '已是最新', kind: 'latest' }
}

function MarketAppCard({
  row,
  installing,
  onInstall
}: {
  row: MarketRow
  installing: string | null
  onInstall: (row: MarketRow) => void
}) {
  const key = `${row.kind}:${row.identifier}`
  const action = actionLabel(row)
  const desc = introLines(row.description)
  const paid = isPaidRow(row)

  return (
    <Card className="market-app-card" hoverable cover={<MarketCover row={row} />}>
      <div className="market-app-card-body">
        <div className="market-app-card-title-row">
          <Typography.Text strong ellipsis={{ tooltip: row.name }} className="market-app-card-title">
            {row.name}
          </Typography.Text>
          {row.kind === 'theme' ? (
            <Tag color="purple" style={{ margin: 0 }}>
              主题
            </Tag>
          ) : (
            <Tag color="blue" style={{ margin: 0 }}>
              插件
            </Tag>
          )}
        </div>

        <div className="market-app-card-ver">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            市场 <Typography.Text style={{ fontSize: 12 }}>v{row.version}</Typography.Text>
          </Typography.Text>
          {row.installed ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              本地{' '}
              <Typography.Text
                style={{ fontSize: 12 }}
                type={row.updateAvailable ? 'warning' : undefined}
              >
                v{row.installedVersion}
              </Typography.Text>
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              未安装
            </Typography.Text>
          )}
        </div>

        {row.developerName || (row.developerTags && row.developerTags.length) ? (
          <div className="market-app-card-dev">
            {row.developerName ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                开发者 {row.developerName}
              </Typography.Text>
            ) : null}
            {row.developerTags && row.developerTags.length ? (
              <Space size={4} wrap style={{ marginTop: row.developerName ? 4 : 0 }}>
                {row.developerTags.map((tag) => (
                  <Tag key={tag} color="geekblue" style={{ margin: 0 }}>
                    {tag}
                  </Tag>
                ))}
              </Space>
            ) : null}
          </div>
        ) : null}

        <Space size={4} wrap style={{ margin: '4px 0 8px' }}>
          {!row.installed ? <Tag>未安装</Tag> : row.updateAvailable ? <Tag color="orange">有更新</Tag> : <Tag color="green">已最新</Tag>}
          {paid ? <Tag color="gold">¥{row.price ?? '?'}</Tag> : <Tag>免费</Tag>}
          {row.licensed ? <Tag color="cyan">已登记授权</Tag> : null}
        </Space>

        <Typography.Paragraph
          type="secondary"
          ellipsis={{ rows: 2, tooltip: desc }}
          className="market-app-card-desc"
        >
          {desc || '暂无介绍'}
        </Typography.Paragraph>

        <div className="market-app-card-footer">
          <Button
            type={action.kind === 'latest' ? 'default' : 'primary'}
            size="small"
            danger={action.kind === 'update'}
            icon={<CloudDownloadOutlined />}
            loading={installing === key}
            disabled={(Boolean(installing) && installing !== key) || action.kind === 'latest'}
            onClick={() => onInstall(row)}
            className="market-app-card-btn"
          >
            {action.text}
          </Button>
          {action.kind === 'latest' ? (
            <Button
              size="small"
              type="link"
              disabled={Boolean(installing) && installing !== key}
              loading={installing === key}
              onClick={() => onInstall(row)}
              style={{ paddingInline: 4 }}
            >
              重装
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

export function SoftSettingsMarketplace() {
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [payload, setPayload] = useState<MarketPayload | null>(null)
  const [licenseInfo, setLicenseInfo] = useState<LicensePayload | null>(null)
  const [q, setQ] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'plugin' | 'theme'>('all')
  const [siteKeyDraft, setSiteKeyDraft] = useState('')
  const [deviceIdDraft, setDeviceIdDraft] = useState('')
  const [savingSite, setSavingSite] = useState(false)
  const [installTarget, setInstallTarget] = useState<MarketRow | null>(null)
  const [payLoading, setPayLoading] = useState(false)
  const [paySession, setPaySession] = useState<{
    needPay: boolean
    amount?: number
    orderId?: string
    qrDataUrl?: string
    tip?: string
    mode?: string
    message?: string
  } | null>(null)
  const [ownedApps, setOwnedApps] = useState<
    Array<{ appIdentifier: string; name?: string; appType?: string }>
  >([])
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authLoading, setAuthLoading] = useState(false)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [deviceModalOpen, setDeviceModalOpen] = useState(false)
  const [loginForm] = Form.useForm()
  const [registerForm] = Form.useForm()

  const loggedIn = Boolean(payload?.loggedIn && payload?.user)
  const marketUser = payload?.user || null

  const loadLicense = useCallback(async () => {
    try {
      const r = (await serverGet('/api/v1/marketplace/license')) as LicensePayload
      setLicenseInfo(r)
      if (r.siteKey) setSiteKeyDraft(r.siteKey)
      if (r.deviceId) setDeviceIdDraft(r.deviceId)
    } catch {
      /* ignore */
    }
  }, [])

  const refreshHeartbeat = useCallback(async () => {
    try {
      const r = (await serverSend('/api/v1/marketplace/license/heartbeat', 'POST', {})) as {
        ok?: boolean
        allowUse?: boolean
        ownedApps?: Array<{ appIdentifier: string; name?: string; appType?: string }>
        user?: { username?: string }
        message?: string
      }
      setOwnedApps(Array.isArray(r.ownedApps) ? r.ownedApps : [])
      return r
    } catch {
      setOwnedApps([])
      return null
    }
  }, [])

  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    try {
      if (force) {
        await serverGet(`/api/v1/marketplace/refresh`).catch(() => null)
      }
      const r = (await serverGet(
        force ? '/api/v1/marketplace?force=1' : '/api/v1/marketplace'
      )) as MarketPayload
      setPayload(r)
      if (r.loggedIn && (r.ok === false || r.reachable === false)) {
        message.warning(r.message || '无法读取应用集市，请确认服务器能访问 MARKET_BASE_URL')
      }
      return r
    } catch (e) {
      setPayload({
        ok: false,
        reachable: false,
        loggedIn: false,
        authRequired: true,
        message: e instanceof Error ? e.message : '加载失败',
        packages: []
      })
      message.error(e instanceof Error ? e.message : '加载应用集市失败')
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(false)
    void loadLicense()
  }, [refresh, loadLicense])

  useEffect(() => {
    if (loggedIn) void refreshHeartbeat()
    else setOwnedApps([])
  }, [loggedIn, refreshHeartbeat])

  const onLogin = async (values: { account: string; password: string }) => {
    setAuthLoading(true)
    try {
      const r = (await serverSend('/api/v1/marketplace/auth/login', 'POST', values)) as {
        ok?: boolean
        message?: string
        ownedApps?: Array<{ appIdentifier: string; name?: string; appType?: string }>
        allowUse?: boolean
      }
      if (!r.ok) throw new Error(r.message || '登录失败')
      const ownedN = Array.isArray(r.ownedApps) ? r.ownedApps.length : 0
      message.success(
        r.allowUse === false
          ? '登录成功，但授权心跳未通过，请检查本机设备 ID'
          : `登录成功，已同步授权（可使用 ${ownedN} 个应用）`
      )
      loginForm.resetFields()
      await refresh(true)
      await loadLicense()
      await refreshHeartbeat()
      await onRecheckLicenses({ quiet: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败')
    } finally {
      setAuthLoading(false)
    }
  }

  const onRegister = async (values: {
    username: string
    email: string
    password: string
    displayName?: string
  }) => {
    setAuthLoading(true)
    try {
      const r = (await serverSend('/api/v1/marketplace/auth/register', 'POST', values)) as {
        ok?: boolean
        message?: string
        ownedApps?: Array<{ appIdentifier: string; name?: string; appType?: string }>
      }
      if (!r.ok) throw new Error(r.message || '注册失败')
      message.success(
        `注册并登录成功${Array.isArray(r.ownedApps) ? `（已购 ${r.ownedApps.length}）` : ''}`
      )
      registerForm.resetFields()
      await refresh(true)
      await loadLicense()
      await refreshHeartbeat()
      await onRecheckLicenses({ quiet: true })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '注册失败')
    } finally {
      setAuthLoading(false)
    }
  }

  const onLogout = async () => {
    setLogoutLoading(true)
    try {
      await serverSend('/api/v1/marketplace/auth/logout', 'POST', {})
      message.success('已退出集市账号（已装集市应用将按未登录关闭）')
      setOwnedApps([])
      setCheckResult(null)
      await refresh(false)
      await loadLicense()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '退出失败')
    } finally {
      setLogoutLoading(false)
    }
  }

  const rows = useMemo(() => {
    const list = Array.isArray(payload?.packages) ? payload!.packages! : []
    const kw = q.trim().toLowerCase()
    return list.filter((p) => {
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false
      if (!kw) return true
      return (
        p.name.toLowerCase().includes(kw) ||
        p.identifier.toLowerCase().includes(kw) ||
        String(p.description || '')
          .toLowerCase()
          .includes(kw)
      )
    })
  }, [payload, q, kindFilter])

  const updateCount = useMemo(
    () => (payload?.packages || []).filter((p) => p.updateAvailable).length,
    [payload]
  )

  const onCheckUpdates = async () => {
    setChecking(true)
    try {
      const r = await refresh(true)
      if (!r?.reachable) return
      const n = (r.packages || []).filter((p) => p.updateAvailable).length
      if (n > 0) message.info(`发现 ${n} 个可更新的插件/主题`)
      else message.success('全部已是最新版本')
    } finally {
      setChecking(false)
    }
  }

  const [checkResult, setCheckResult] = useState<{
    allGenuine?: boolean
    genuineCount?: number
    pirateCount?: number
    total?: number
    skippedBuiltin?: string[]
    skippedNotInMarket?: string[]
    items?: Array<{
      appIdentifier: string
      name?: string
      genuine: boolean
      code?: string
      message?: string
    }>
  } | null>(null)

  const onRecheckLicenses = async (opts?: { quiet?: boolean }) => {
    setChecking(true)
    try {
      const r = (await serverSend('/api/v1/marketplace/license/check-installed', 'POST', {})) as {
        ok?: boolean
        data?: {
          allGenuine?: boolean
          genuineCount?: number
          pirateCount?: number
          total?: number
          skippedBuiltin?: string[]
          skippedNotInMarket?: string[]
          items?: Array<{
            appIdentifier: string
            name?: string
            genuine: boolean
            code?: string
            message?: string
          }>
        }
        message?: string
      }
      if (!r.ok) throw new Error(r.message || '批量校验失败')
      const d = r.data || {}
      setCheckResult(d)
      await refreshHeartbeat()
      if (opts?.quiet) return
      const skipLocal = d.skippedNotInMarket?.length || 0
      const skipBuiltin = d.skippedBuiltin?.length || 0
      const skipN = skipBuiltin + skipLocal
      if (!d.total) {
        message.info(
          `已检查全部已装项：无集市上架包需验权（本地/未上架 ${skipLocal}，内置 ${skipBuiltin}）`
        )
      } else if (d.allGenuine) {
        message.success(
          `已装集市应用均已授权 ${d.genuineCount}/${d.total}（另跳过本地/内置 ${skipN}）`
        )
      } else {
        message.warning(
          `发现 ${d.pirateCount || 0} 项未授权（共验 ${d.total}），已关闭对应插件/切回默认主题`
        )
      }
    } catch (e) {
      if (!opts?.quiet) message.error(e instanceof Error ? e.message : '批量校验失败')
    } finally {
      setChecking(false)
    }
  }

  const saveDeviceId = async () => {
    setSavingSite(true)
    try {
      const r = (await serverSend('/api/v1/marketplace/license', 'PUT', {
        deviceId: deviceIdDraft.trim(),
        ...(siteKeyDraft.trim() ? { siteKey: siteKeyDraft.trim() } : {})
      })) as { ok?: boolean; message?: string }
      if (!r.ok) throw new Error(r.message || '保存失败')
      message.success('本机设备 ID 已保存')
      await loadLicense()
      await refreshHeartbeat()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingSite(false)
    }
  }

  const doInstall = async (row: MarketRow, orderId?: string) => {
    const key = `${row.kind}:${row.identifier}`
    setInstalling(key)
    try {
      const r = (await serverSend('/api/v1/marketplace/install', 'POST', {
        kind: row.kind,
        identifier: row.identifier,
        ...(orderId ? { orderId, payConfirmed: true } : {})
      })) as {
        ok?: boolean
        message?: string
        needPay?: boolean
      }
      if (!r.ok) throw new Error(r.message || '安装失败')
      message.success(r.message || (row.updateAvailable ? '已更新' : '安装成功'))
      setInstallTarget(null)
      setPaySession(null)
      await refresh(true)
      await loadLicense()
      await refreshHeartbeat()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '安装失败'
      // 未先创建付款会话时：拉起扫码，而不是只弹一句「请扫码」
      if (/收费应用|扫码|支付后安装|NEED_PAY/i.test(msg) && !orderId) {
        message.warning('该应用需先付款，正在生成收款码…')
        await prepareInstall(row)
        return
      }
      message.error(msg)
    } finally {
      setInstalling(null)
    }
  }

  const prepareInstall = async (row: MarketRow) => {
    // 一律问集市：是否需付费，避免本地 pricingType 缺失时跳过二维码
    setPaySession(null)
    setPayLoading(true)
    try {
      const r = (await serverSend('/api/v1/marketplace/pay/create', 'POST', {
        kind: row.kind,
        identifier: row.identifier
      })) as {
        ok?: boolean
        message?: string
        needPay?: boolean
        alreadyOwned?: boolean
        amount?: number
        orderId?: string
        qrDataUrl?: string
        tip?: string
        mode?: string
      }
      if (!r.ok) throw new Error(r.message || '创建付款失败')
      if (!r.needPay) {
        setPaySession({ needPay: false, message: r.message })
        return
      }
      if (!r.qrDataUrl) {
        throw new Error('集市未返回付款二维码，请确认市场端已启用演示/正式收款')
      }
      setPaySession({
        needPay: true,
        amount: r.amount ?? row.price,
        orderId: r.orderId,
        qrDataUrl: r.qrDataUrl,
        tip: r.tip,
        mode: r.mode,
        message: r.message
      })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '创建付款失败')
      setInstallTarget(null)
      setPaySession(null)
    } finally {
      setPayLoading(false)
    }
  }

  const onInstall = (row: MarketRow) => {
    setInstallTarget(row)
    void prepareInstall(row)
  }

  const confirmInstall = () => {
    if (!installTarget || !paySession || payLoading) return
    if (paySession.needPay) {
      if (!paySession.orderId) {
        message.error('尚未生成付款订单，请关闭后重试')
        return
      }
      void doInstall(installTarget, paySession.orderId)
      return
    }
    void doInstall(installTarget)
  }

  const repo =
    payload?.repo ||
    payload?.marketBase ||
    (Array.isArray(payload?.marketBases) && payload.marketBases[0]) ||
    REPO_FALLBACKS[0] ||
    REPO_FALLBACK
  const consoleUrl = payload?.consoleUrl || `${repo}/console`
  const registerUrl = payload?.registerUrl || `${repo}/register`
  const loginUrl = payload?.loginUrl || `${repo}/login`

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PluginSlot name="settings.marketplace.content.before" />

      {!loggedIn ? (
        <Card
          className="settings-card"
          title={
            <span>
              <UserOutlined /> 应用集市账号
            </span>
          }
          extra={
            <Space wrap>
              <Button onClick={() => openExternal(loginUrl)}>打开集市登录页</Button>
              <Button type="primary" ghost onClick={() => openExternal(registerUrl)}>
                打开注册页
              </Button>
            </Space>
          }
        >
          <Spin spinning={loading && !payload}>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="第一次使用应用集市，请先注册并登录"
              description="登录后可浏览插件/主题目录。首次安装会自动领取并登记到已购列表；之后启用/心跳按已购列表校验，未授权会自动关闭。"
            />
            <Tabs
              activeKey={authMode}
              onChange={(k) => setAuthMode(k === 'register' ? 'register' : 'login')}
              items={[
                {
                  key: 'login',
                  label: '登录',
                  children: (
                    <Form
                      form={loginForm}
                      layout="vertical"
                      onFinish={(v) => void onLogin(v)}
                      style={{ maxWidth: 420 }}
                    >
                      <Form.Item
                        name="account"
                        label="账号"
                        rules={[{ required: true, message: '请输入用户名或邮箱' }]}
                      >
                        <Input placeholder="用户名或邮箱" autoComplete="username" />
                      </Form.Item>
                      <Form.Item
                        name="password"
                        label="密码"
                        rules={[{ required: true, message: '请输入密码' }]}
                      >
                        <Input.Password placeholder="密码" autoComplete="current-password" />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" loading={authLoading} block>
                        登录应用集市
                      </Button>
                    </Form>
                  )
                },
                {
                  key: 'register',
                  label: '注册',
                  children: (
                    <Form
                      form={registerForm}
                      layout="vertical"
                      onFinish={(v) => void onRegister(v)}
                      style={{ maxWidth: 420 }}
                    >
                      <Form.Item
                        name="username"
                        label="用户名"
                        rules={[
                          { required: true, message: '请输入用户名' },
                          { min: 3, message: '至少 3 位' }
                        ]}
                      >
                        <Input placeholder="至少 3 位" autoComplete="username" />
                      </Form.Item>
                      <Form.Item
                        name="email"
                        label="邮箱"
                        rules={[
                          { required: true, message: '请输入邮箱' },
                          { type: 'email', message: '邮箱格式不正确' }
                        ]}
                      >
                        <Input placeholder="you@example.com" autoComplete="email" />
                      </Form.Item>
                      <Form.Item name="displayName" label="显示名（可选）">
                        <Input placeholder="默认与用户名相同" />
                      </Form.Item>
                      <Form.Item
                        name="password"
                        label="密码"
                        rules={[
                          { required: true, message: '请输入密码' },
                          { min: 6, message: '至少 6 位' }
                        ]}
                      >
                        <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" loading={authLoading} block>
                        注册并登录
                      </Button>
                    </Form>
                  )
                }
              ]}
            />
          </Spin>
        </Card>
      ) : null}

      {!loggedIn ? (
        <Alert
          type="warning"
          showIcon
          message="登录后继续"
          description="完成上方注册/登录后，即可浏览安装集市应用，并在需要时查看本机设备与授权信息。"
        />
      ) : (
        <>
          <Card
            className="settings-card"
            title={
              <span>
                <ShopOutlined /> 应用集市
                {updateCount > 0 ? (
                  <Tag color="orange" style={{ marginLeft: 8 }}>
                    {updateCount} 个可更新
                  </Tag>
                ) : null}
              </span>
            }
            extra={
              <Space wrap size={8}>
                <Typography.Link onClick={() => openExternal(repo)} style={{ whiteSpace: 'nowrap' }}>
                  {marketUser?.username || '用户'}已登陆
                </Typography.Link>
                <Button icon={<KeyOutlined />} onClick={() => setDeviceModalOpen(true)}>
                  本机 deviceId
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  loading={checking || loading}
                  onClick={() => void onCheckUpdates()}
                >
                  检查更新
                </Button>
                <Button loading={loading && !checking} onClick={() => void refresh(true)}>
                  刷新列表
                </Button>
                <Button
                  icon={<LogoutOutlined />}
                  loading={logoutLoading}
                  onClick={() => void onLogout()}
                >
                  退出登陆
                </Button>
              </Space>
            }
          >
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              目录来自应用集市。免费应用直接领取授权；收费应用会弹出付款二维码，确认后再安装。开发者可以到
              <Typography.Link onClick={() => openExternal(`${repo.replace(/\/+$/, '')}/docs`)}>
                应用市场
              </Typography.Link>
              获取开发文档与示例，用于开发插件/主题。
            </Typography.Paragraph>

            {payload && payload.reachable === false ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="读取不到应用集市"
                description={
                  payload.message ||
                  '请确认运行监控台的服务器能访问应用集市（多线路自动切换）。'
                }
              />
            ) : null}

            <Space wrap style={{ marginBottom: 16 }}>
              <Input.Search
                allowClear
                placeholder="搜索名称 / 标识"
                style={{ width: 240 }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Button
                type={kindFilter === 'all' ? 'primary' : 'default'}
                onClick={() => setKindFilter('all')}
              >
                全部
              </Button>
              <Button
                type={kindFilter === 'plugin' ? 'primary' : 'default'}
                onClick={() => setKindFilter('plugin')}
              >
                插件
              </Button>
              <Button
                type={kindFilter === 'theme' ? 'primary' : 'default'}
                onClick={() => setKindFilter('theme')}
              >
                主题
              </Button>
            </Space>

            <Spin spinning={loading}>
              {rows.length === 0 ? (
                <Empty description={loading ? '加载中…' : '暂无应用'} />
              ) : (
                <Row gutter={[12, 12]}>
                  {rows.map((row) => (
                    <Col key={`${row.kind}:${row.identifier}`} xs={24} sm={12} md={8} lg={6} xl={6}>
                      <MarketAppCard row={row} installing={installing} onInstall={onInstall} />
                    </Col>
                  ))}
                </Row>
              )}
            </Spin>
          </Card>

          <Modal
            title={
              <span>
                <KeyOutlined /> 本机设备与授权心跳
              </span>
            }
            open={deviceModalOpen}
            onCancel={() => setDeviceModalOpen(false)}
            footer={null}
            width={720}
            destroyOnClose
          >
            <Space wrap style={{ marginBottom: 12 }}>
              <Button onClick={() => openExternal(`${repo.replace(/\/+$/, '')}/docs`)}>
                插件主题开发文档
              </Button>
              <Button type="primary" ghost onClick={() => openExternal(consoleUrl)}>
                用户中心
              </Button>
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              本机 <code>deviceId</code> 在首次登录时自动生成并固定；切换账号会复用同一设备 ID
              并立即同步已购列表。请勿随便改成浏览器用户中心的另一个 ID，否则会出现「已登录但心跳
              USER_OFFLINE」。
            </Typography.Paragraph>
            {!licenseInfo?.deviceIdConfigured && !deviceIdDraft ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="尚未配置本机设备 ID"
                description="登录集市后会自动写入本机固定设备 ID。"
              />
            ) : (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 12 }}
                message="已配置本机设备 ID"
                description={
                  ownedApps.length
                    ? `当前账号可使用 ${ownedApps.length} 个已购应用：${ownedApps
                        .map((a) => a.name || a.appIdentifier)
                        .slice(0, 6)
                        .join('、')}${ownedApps.length > 6 ? '…' : ''}`
                    : '可点击「检查授权」拉取已购列表'
                }
              />
            )}
            <Space wrap style={{ width: '100%' }}>
              <Input
                placeholder="本机设备 ID（UUID）"
                value={deviceIdDraft}
                onChange={(e) => setDeviceIdDraft(e.target.value)}
                style={{ minWidth: 280, maxWidth: 480 }}
              />
              <Button type="primary" loading={savingSite} onClick={() => void saveDeviceId()}>
                保存设备 ID
              </Button>
              <Button
                icon={<SafetyCertificateOutlined />}
                loading={checking}
                onClick={() => void onRecheckLicenses()}
              >
                检查授权并关闭未购应用
              </Button>
            </Space>
            {checkResult ? (
              <Alert
                style={{ marginTop: 12 }}
                type={
                  !checkResult.total ? 'info' : checkResult.allGenuine ? 'success' : 'warning'
                }
                showIcon
                message={
                  !checkResult.total
                    ? '当前没有需要校验的已装集市包'
                    : checkResult.allGenuine
                      ? `已授权 ${checkResult.genuineCount}/${checkResult.total}`
                      : `未授权 ${checkResult.pirateCount}/${checkResult.total}（已关闭对应插件）`
                }
                description={
                  <div style={{ fontSize: 12 }}>
                    <div>
                      内置跳过：{(checkResult.skippedBuiltin || []).join('、') || '无'}；非集市包跳过：
                      {(checkResult.skippedNotInMarket || []).slice(0, 12).join('、') || '无'}
                      {(checkResult.skippedNotInMarket || []).length > 12 ? '…' : ''}
                    </div>
                    {(checkResult.items || []).length ? (
                      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                        {(checkResult.items || []).map((it) => (
                          <li key={it.appIdentifier}>
                            {it.genuine ? '✓' : '✗'} {it.name || it.appIdentifier}
                            {!it.genuine ? ` — ${it.message || it.code || '未授权'}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                }
              />
            ) : null}
          </Modal>

          <Modal
            title={
              installTarget
                ? paySession?.needPay
                  ? `扫码付款 · ${installTarget.name}`
                  : `安装 ${installTarget.name}`
                : '安装'
            }
            open={Boolean(installTarget)}
            onCancel={() => {
              setInstallTarget(null)
              setPaySession(null)
            }}
            onOk={() => confirmInstall()}
            okText={
              paySession?.needPay
                ? paySession.mode === 'live'
                  ? '我已完成付款并安装'
                  : '我已完成付款（演示）并安装'
                : '领取授权并安装'
            }
            confirmLoading={Boolean(
              installTarget && installing === `${installTarget.kind}:${installTarget.identifier}`
            )}
            okButtonProps={{
              disabled:
                payLoading ||
                !paySession ||
                (paySession.needPay && (!paySession.orderId || !paySession.qrDataUrl))
            }}
            destroyOnClose
            width={paySession?.needPay ? 480 : 520}
          >
            <Spin spinning={payLoading || !paySession}>
              {paySession?.needPay ? (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <div style={{ textAlign: 'center' }}>
                    <Typography.Text type="secondary">应付金额</Typography.Text>
                    <div style={{ fontSize: 28, fontWeight: 600, color: '#d48806', lineHeight: 1.3 }}>
                      ¥{paySession.amount ?? installTarget?.price ?? '?'}
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {paySession.mode === 'live' ? '正式收款' : '演示支付'}
                      {paySession.orderId
                        ? ` · 订单 ${paySession.orderId.slice(0, 10)}…`
                        : ''}
                    </Typography.Text>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 10,
                      padding: 16,
                      border: '1px solid rgba(0,0,0,.08)',
                      borderRadius: 12,
                      background: 'rgba(0,0,0,.02)'
                    }}
                  >
                    {paySession.qrDataUrl ? (
                      <img
                        src={paySession.qrDataUrl}
                        alt="付款二维码"
                        style={{
                          width: 220,
                          height: 220,
                          objectFit: 'contain',
                          background: '#fff',
                          padding: 8,
                          borderRadius: 8
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 220,
                          height: 220,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px dashed rgba(0,0,0,.15)',
                          borderRadius: 8,
                          color: 'rgba(0,0,0,.45)'
                        }}
                      >
                        暂无二维码
                      </div>
                    )}
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: 0, textAlign: 'center', fontSize: 12 }}
                    >
                      {paySession.tip || '请使用手机扫码支付'}
                    </Typography.Paragraph>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    标识：<code>{installTarget?.identifier}</code>
                  </Typography.Text>
                </Space>
              ) : (
                <Typography.Paragraph type="secondary">
                  标识：<code>{installTarget?.identifier}</code>
                  <br />
                  首次安装会向集市领取授权并写入已购列表。安装完成后启用与心跳按已购列表校验；内置包不受影响。
                  {paySession?.message ? (
                    <>
                      <br />
                      {paySession.message}
                    </>
                  ) : null}
                </Typography.Paragraph>
              )}
            </Spin>
          </Modal>
        </>
      )}

      <PluginSlot name="settings.marketplace.content.after" />
      <style>{`
        .market-app-card {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .market-app-card .ant-card-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 10px 12px 12px;
        }
        .market-app-card-body {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
        }
        .market-card-cover {
          height: 120px;
          background: rgba(0,0,0,.04);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .market-card-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .market-card-cover--empty {
          background: linear-gradient(145deg, #1d4ed8, #0ea5e9);
        }
        .market-app-card-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-width: 0;
        }
        .market-app-card-title {
          font-size: 14px;
          min-width: 0;
        }
        .market-app-card-ver {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 12px;
          margin-top: 4px;
        }
        .market-app-card-dev {
          margin-top: 6px;
          min-width: 0;
        }
        .market-app-card-desc {
          margin-bottom: 10px !important;
          flex: 1;
          min-height: 40px;
          white-space: pre-wrap;
          font-size: 12px;
        }
        .market-app-card-footer {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-top: auto;
        }
        .market-app-card-btn {
          max-width: 100%;
        }
        @media (max-width: 576px) {
          .market-card-cover { height: 100px; }
          .market-app-card-btn { flex: 1; }
        }
      `}</style>
    </Space>
  )
}
