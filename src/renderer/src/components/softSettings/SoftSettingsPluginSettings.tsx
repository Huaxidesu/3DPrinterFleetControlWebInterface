import { useEffect, useMemo, useRef, useState } from 'react'
import { Empty, Tabs, Typography } from 'antd'
import { isAdminUi } from '../../utils/appMode'
import { PluginSlot } from '../../plugins/PluginSlot'
import { getHanyePlugin, type PluginSettingsTab } from '../../plugins/runtime'

function PluginSettingsTabPane({ tab }: { tab: PluginSettingsTab }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    let cleanup: (() => void) | void
    try {
      cleanup = tab.render(el)
    } catch (e) {
      console.error('[settings tab]', tab.key, e)
      el.textContent = '插件设置页渲染失败'
    }
    return () => {
      if (typeof cleanup === 'function') {
        try {
          cleanup()
        } catch {
          /* ignore */
        }
      }
      el.innerHTML = ''
    }
  }, [tab])
  return (
    <>
      <PluginSlot name={`settings.tab.${tab.key}.before`} />
      <PluginSlot name={`settings.tab.${tab.key}`} replace>
        <div ref={ref} className="settings-tab-panel plugin-settings-tab" />
      </PluginSlot>
      <PluginSlot name={`settings.tab.${tab.key}.after`} />
    </>
  )
}

type Props = {
  tabs: PluginSettingsTab[]
  activeSubKey?: string
  onSubKeyChange?: (key: string) => void
}

export function SoftSettingsPluginSettings({ tabs, activeSubKey, onSubKeyChange }: Props) {
  const sorted = useMemo(() => {
    const runtime = getHanyePlugin()
    return tabs
      .filter((pt) => !(pt.adminOnly && !isAdminUi()))
      .slice()
      .sort(
        (a, b) =>
          runtime.resolveSettingsTabOrder(a) - runtime.resolveSettingsTabOrder(b) ||
          a.key.localeCompare(b.key)
      )
  }, [tabs])

  const firstKey = sorted[0]?.key
  const [innerKey, setInnerKey] = useState(activeSubKey || firstKey || '')

  useEffect(() => {
    if (activeSubKey && sorted.some((t) => t.key === activeSubKey)) {
      setInnerKey(activeSubKey)
      return
    }
    if (!sorted.some((t) => t.key === innerKey)) {
      setInnerKey(firstKey || '')
    }
  }, [activeSubKey, sorted, firstKey, innerKey])

  if (!sorted.length) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已启用的插件设置" />
    )
  }

  const activeKey = sorted.some((t) => t.key === innerKey) ? innerKey : firstKey!

  return (
    <div className="soft-plugin-settings">
      <Typography.Paragraph type="secondary" className="soft-plugin-settings-desc">
        以下为已开启插件注册的设置项，不再占用软件设置顶栏。
      </Typography.Paragraph>
      <Tabs
        className="soft-plugin-settings-tabs"
        size="small"
        activeKey={activeKey}
        onChange={(k) => {
          setInnerKey(k)
          onSubKeyChange?.(k)
        }}
        destroyInactiveTabPane
        items={sorted.map((pt) => ({
          key: pt.key,
          label: <span>{pt.label}</span>,
          children: <PluginSettingsTabPane tab={pt} />
        }))}
      />
    </div>
  )
}

/** Visible plugin settings tabs for current UI role */
export function filterVisiblePluginSettingsTabs(tabs: PluginSettingsTab[]): PluginSettingsTab[] {
  return tabs.filter((pt) => !(pt.adminOnly && !isAdminUi()))
}
