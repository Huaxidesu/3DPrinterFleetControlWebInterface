/**
 * 拓竹 Studio 风格耗材面板（筛选 / 搜索 / 增删改 / AMS 读取，与 Studio 截图对齐）
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  ColorPicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from 'antd'
import type { Color } from 'antd/es/color-picker'
import type { ColumnsType } from 'antd/es/table'
import {
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { filamentBambuAmsSync } from '../api/filamentBackendApi'
import {
  isLowStock,
  spoolCapacityGrams,
  spoolRemainPct,
  useFilamentStore
} from '../stores/filamentStore'
import type { SpoolRecord } from '../types/filament'
import {
  BAMBU_VENDORS,
  brandLabelOfVendor,
  presetColorsFor,
  typesForVendor
} from '../filament/bambuStudioCatalog'
import { rollsFromTotalGrams } from '@shared/spoolCatalog'

type AddTab = 'manual' | 'ams'

type FormValues = {
  vendor: string
  type: string
  color: string
  colorHex: string
  remainGrams: number
  totalGrams: number
  notes?: string
  rolls: number
}

export function BambuFilamentPanel() {
  const spools = useFilamentStore((s) => s.spools)
  const loading = useFilamentStore((s) => s.loading)
  const search = useFilamentStore((s) => s.search)
  const setSearch = useFilamentStore((s) => s.setSearch)
  const brandFilter = useFilamentStore((s) => s.brandFilter)
  const setBrandFilter = useFilamentStore((s) => s.setBrandFilter)
  const materialFilter = useFilamentStore((s) => s.materialFilter)
  const setMaterialFilter = useFilamentStore((s) => s.setMaterialFilter)
  const lowStockThreshold = useFilamentStore((s) => s.lowStockThreshold)
  const addSpool = useFilamentStore((s) => s.addSpool)
  const updateSpool = useFilamentStore((s) => s.updateSpool)
  const removeSpool = useFilamentStore((s) => s.removeSpool)
  const activateBambu = useFilamentStore((s) => s.activateBambuFilament)
  const addModalOpen = useFilamentStore((s) => s.addModalOpen)
  const closeAddModal = useFilamentStore((s) => s.closeAddModal)

  const [scope, setScope] = useState<'all' | 'ams'>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [addTab, setAddTab] = useState<AddTab>('manual')
  const [editing, setEditing] = useState<SpoolRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<FormValues>()
  const vendorWatch = Form.useWatch('vendor', form)
  const typeWatch = Form.useWatch('type', form)
  const colorHexWatch = Form.useWatch('colorHex', form)
  const totalGramsWatch = Form.useWatch('totalGrams', form)

  const vendorsInList = useMemo(() => {
    const set = new Set<string>()
    for (const s of spools) {
      const v = String(s.vendor || s.brandName || brandLabelOfVendor(s.brandId) || '').trim()
      if (v) set.add(v)
    }
    for (const v of BAMBU_VENDORS) set.add(v)
    return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
  }, [spools])

  const typesInList = useMemo(() => {
    const set = new Set<string>()
    for (const s of spools) {
      if (s.material) set.add(String(s.material).toUpperCase())
    }
    for (const t of typesForVendor(brandFilter === 'all' ? 'Bambu Lab' : brandFilter)) set.add(t)
    return [...set].sort()
  }, [spools, brandFilter])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return spools.filter((s) => {
      if (s.archived) return false
      if (scope === 'ams') {
        const bindings = s.amsBindings || (s.amsBinding ? [s.amsBinding] : [])
        if (!bindings.length && !s.bambuRfid) return false
      }
      const vendor = String(s.vendor || s.brandName || brandLabelOfVendor(s.brandId) || '')
      if (
        brandFilter !== 'all' &&
        vendor.toLowerCase() !== brandFilter.toLowerCase() &&
        s.brandId !== brandFilter
      ) {
        return false
      }
      if (materialFilter !== 'all') {
        const mat = String(s.material || '').toUpperCase()
        if (mat !== materialFilter.toUpperCase() && !mat.includes(materialFilter.toUpperCase())) {
          return false
        }
      }
      if (!q) return true
      return (
        vendor.toLowerCase().includes(q) ||
        String(s.material || '').toLowerCase().includes(q) ||
        String(s.color || '').toLowerCase().includes(q) ||
        String(s.notes || '').toLowerCase().includes(q)
      )
    })
  }, [spools, search, brandFilter, materialFilter, scope])

  const typeOptions = useMemo(() => typesForVendor(vendorWatch || ''), [vendorWatch])
  const colorPresets = useMemo(
    () => presetColorsFor(vendorWatch || '', typeWatch || ''),
    [vendorWatch, typeWatch]
  )

  const openCreate = () => {
    setEditing(null)
    setAddTab('manual')
    form.resetFields()
    form.setFieldsValue({
      vendor: 'Bambu Lab',
      type: 'PLA',
      color: '黑色',
      colorHex: '#000000',
      remainGrams: 1000,
      totalGrams: 1000,
      notes: '',
      rolls: 1
    })
    setFormOpen(true)
  }

  const openEdit = (row: SpoolRecord) => {
    setEditing(row)
    setAddTab('manual')
    form.setFieldsValue({
      vendor: String(row.vendor || row.brandName || brandLabelOfVendor(row.brandId) || 'Generic'),
      type: String(row.material || 'PLA').toUpperCase(),
      color: row.color || '',
      colorHex: row.colorHex || '#888888',
      remainGrams: Math.round(row.remainGrams),
      totalGrams: Math.round(row.totalGrams || 1000),
      notes: (row.notes || '').slice(0, 50),
      rolls: 1
    })
    setFormOpen(true)
  }

  useEffect(() => {
    if (!addModalOpen) return
    openCreate()
    closeAddModal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addModalOpen])

  const submitManual = async () => {
    const values = await form.validateFields()
    const notes = String(values.notes || '').slice(0, 50)
    const rolls = Math.max(1, Math.min(99, Math.floor(Number(values.rolls) || 1)))
    setBusy(true)
    try {
      if (editing) {
        const totalGrams = Number(values.totalGrams) || 1000
        await updateSpool({
          ...editing,
          brandId: values.vendor,
          material: values.type,
          color: values.color,
          colorHex: values.colorHex,
          remainGrams: Number(values.remainGrams) || 0,
          totalGrams,
          rolls: rollsFromTotalGrams(totalGrams),
          notes,
          tech: 'fdm',
          vendor: values.vendor,
          brandName: values.vendor
        } as SpoolRecord)
        message.success('已更新云端耗材')
      } else {
        const totalGrams = Number(values.totalGrams) || 1000
        const rollCount = rollsFromTotalGrams(totalGrams)
        for (let i = 0; i < rolls; i++) {
          await addSpool({
            brandId: values.vendor,
            material: values.type,
            color: values.color,
            colorHex: values.colorHex,
            remainGrams: Number(values.remainGrams) || 0,
            totalGrams,
            rolls: rollCount,
            notes,
            tech: 'fdm',
            vendor: values.vendor,
            brandName: values.vendor
          } as Omit<SpoolRecord, 'id' | 'createdAt' | 'updatedAt'>)
        }
        message.success(
          rolls > 1
            ? `已添加 ${rolls} 条（每条按 ${rollCount} 卷计）到拓竹云`
            : `已添加到拓竹云（按 ${rollCount} 卷计，可绑定 ${rollCount} 个料位）`
        )
      }
      setFormOpen(false)
      await activateBambu()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const doAmsRead = async () => {
    setBusy(true)
    try {
      const r = await filamentBambuAmsSync()
      if (!r.ok) throw new Error(r.message || '同步失败')
      await activateBambu()
      message.success(r.message || '已从 AMS 读取')
      setFormOpen(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '同步失败')
    } finally {
      setBusy(false)
    }
  }

  const columns: ColumnsType<SpoolRecord> = [
    {
      title: '颜色',
      key: 'color',
      width: 120,
      render: (_, row) => (
        <Space size={8}>
          <span className="spool-swatch" style={{ background: row.colorHex }} title={row.colorHex} />
          <span>{row.color}</span>
        </Space>
      )
    },
    {
      title: '品牌',
      key: 'vendor',
      width: 140,
      render: (_, row) =>
        String(row.vendor || row.brandName || brandLabelOfVendor(row.brandId) || row.brandId)
    },
    {
      title: '类型',
      dataIndex: 'material',
      width: 110,
      render: (v: string) => String(v || '').toUpperCase()
    },
    {
      title: '卷数',
      key: 'rolls',
      width: 88,
      render: (_, row) => {
        const n = rollsFromTotalGrams(row.totalGrams || 1000)
        return `${n} 卷`
      }
    },
    {
      title: '余量',
      key: 'remain',
      width: 200,
      render: (_, row) => {
        const pct = spoolRemainPct(row)
        const low = isLowStock(row, lowStockThreshold)
        return (
          <div className="spool-remain">
            <div className="spool-remain-text">
              {Math.round(row.remainGrams)} / {Math.round(spoolCapacityGrams(row))} g
              {low ? <Tag color="warning">低</Tag> : null}
            </div>
            <Progress
              percent={Math.round(pct)}
              size="small"
              status={low ? 'exception' : 'active'}
              showInfo={false}
            />
          </div>
        )
      }
    },
    {
      title: '备注',
      dataIndex: 'notes',
      ellipsis: true,
      render: (v?: string) => v || '—'
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: '删除该耗材？',
                content: '将从拓竹云端删除，Studio / Handy 同步消失。',
                okText: '删除',
                okType: 'danger',
                cancelText: '取消',
                onOk: async () => {
                  await removeSpool(row.id)
                  message.success('已删除')
                }
              })
            }}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div className="bambu-filament-panel">
      <div className="bambu-filament-toolbar">
        <Space wrap size={8}>
          <Button type={scope === 'all' ? 'primary' : 'default'} size="small" onClick={() => setScope('all')}>
            全部
          </Button>
          <Button type={scope === 'ams' ? 'primary' : 'default'} size="small" onClick={() => setScope('ams')}>
            机内耗材
          </Button>
          <Select
            allowClear
            placeholder="品牌"
            style={{ width: 140 }}
            value={brandFilter === 'all' ? undefined : brandFilter}
            onChange={(v) => setBrandFilter(v || 'all')}
            options={vendorsInList.map((v) => ({ value: v, label: v }))}
          />
          <Select
            allowClear
            placeholder="耗材类型"
            style={{ width: 140 }}
            value={materialFilter === 'all' ? undefined : materialFilter}
            onChange={(v) => setMaterialFilter(v || 'all')}
            options={typesInList.map((t) => ({ value: t, label: t }))}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索耗材"
            style={{ width: 180 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void activateBambu()} />
        </Space>
      </div>

      {visible.length === 0 && !loading ? (
        <div className="filament-empty">
          <Empty description="暂无云端耗材，点击右上角「添加料卷」或弹窗内「从 AMS 上读取」" />
        </div>
      ) : (
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={visible}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          scroll={{ x: 900 }}
          className="filament-table"
        />
      )}

      <Modal
        title={editing ? '编辑耗材' : '添加耗材'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        footer={null}
        destroyOnClose
        width={520}
        className="bambu-add-filament-modal"
      >
        {!editing ? (
          <div className="bambu-add-tabs">
            <button
              type="button"
              className={`bambu-add-tab${addTab === 'manual' ? ' active' : ''}`}
              onClick={() => setAddTab('manual')}
            >
              手动添加
            </button>
            <button
              type="button"
              className={`bambu-add-tab${addTab === 'ams' ? ' active' : ''}`}
              onClick={() => setAddTab('ams')}
            >
              从 AMS 上读取
            </button>
          </div>
        ) : null}

        {addTab === 'ams' && !editing ? (
          <div style={{ padding: '16px 0' }}>
            <Typography.Paragraph type="secondary">
              从已绑定的拓竹打印机 AMS 读取料卷信息并同步到云端库存（与 Studio 相同）。
            </Typography.Paragraph>
            <Space>
              <Button onClick={() => setFormOpen(false)}>取消</Button>
              <Button type="primary" loading={busy} onClick={() => void doAmsRead()}>
                开始读取
              </Button>
            </Space>
          </div>
        ) : (
          <Form form={form} layout="vertical" requiredMark="optional" style={{ marginTop: 12 }}>
            <Typography.Text strong>耗材信息</Typography.Text>
            <div className="bambu-form-row-2" style={{ marginTop: 12 }}>
              <Form.Item name="vendor" label="品牌" rules={[{ required: true, message: '请选择品牌' }]}>
                <Select
                  showSearch
                  placeholder="选择品牌"
                  options={BAMBU_VENDORS.map((v) => ({ value: v, label: v }))}
                  onChange={() => form.setFieldValue('type', undefined)}
                />
              </Form.Item>
              <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
                <Select
                  showSearch
                  placeholder={vendorWatch ? '选择类型' : '请先选择品牌'}
                  disabled={!vendorWatch}
                  options={typeOptions.map((t) => ({ value: t, label: t }))}
                />
              </Form.Item>
            </div>
            <Form.Item label="颜色" required>
              <Space wrap size={[8, 8]} style={{ marginBottom: 8 }}>
                {colorPresets.length ? (
                  colorPresets.map((c) => (
                    <button
                      key={c.hex + c.label}
                      type="button"
                      className={`spool-color-preset${colorHexWatch === c.hex ? ' active' : ''}`}
                      style={{ background: c.hex }}
                      title={c.label}
                      onClick={() => form.setFieldsValue({ color: c.label, colorHex: c.hex })}
                    />
                  ))
                ) : (
                  <Typography.Text type="secondary">该耗材暂无预设颜色</Typography.Text>
                )}
              </Space>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item name="color" noStyle rules={[{ required: true, message: '请输入颜色名' }]}>
                  <Input placeholder="颜色名称" style={{ width: '55%' }} />
                </Form.Item>
                <Form.Item
                  name="colorHex"
                  noStyle
                  rules={[{ required: true, message: '请选择色值' }]}
                  getValueFromEvent={(c: Color) => c.toHexString()}
                >
                  <ColorPicker showText format="hex" />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
            <div className="bambu-form-row-2">
              <Form.Item
                name="remainGrams"
                label="当前净重"
                rules={[{ required: true, message: '请输入当前净重' }]}
              >
                <InputNumber min={0} max={99999} addonAfter="g" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="totalGrams" label="总净重" rules={[{ required: true, message: '请输入总净重' }]}>
                <InputNumber min={1} max={99999} addonAfter="g" style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <Typography.Paragraph type="secondary" style={{ marginTop: -8, fontSize: 12 }}>
              卷数规则：总净重每 1000g 计 1 卷，不足 1000g 也按 1 卷（用于设备料位绑定数量）。当前约{' '}
              {rollsFromTotalGrams(Number(totalGramsWatch) || 1000)} 卷。
            </Typography.Paragraph>
            <Form.Item name="notes" label="备注">
              <Input.TextArea rows={2} maxLength={50} showCount placeholder="输入备注" />
            </Form.Item>
            {!editing ? (
              <Form.Item name="rolls" label="数量" initialValue={1}>
                <InputNumber min={1} max={99} addonAfter="卷" style={{ width: 140 }} />
              </Form.Item>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button onClick={() => setFormOpen(false)}>取消</Button>
              <Button type="primary" loading={busy} onClick={() => void submitManual()}>
                {editing ? '保存' : '添加'}
              </Button>
            </div>
          </Form>
        )}
      </Modal>
    </div>
  )
}
