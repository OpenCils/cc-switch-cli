/**
 * [INPUT]: 依赖 ink/ink-text-input，依赖 types/store 的 AppStore 操作
 * [OUTPUT]: 对外提供 ProviderForm 组件（添加 + 编辑两用）
 * [POS]: screens/ 的供应商表单屏幕，配置供应商的名称/模型/URL/Key
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { AppStore, Installation, ProviderConfig } from '../types.js'
import { TOOLS, instKey } from '../types.js'
import { addProvider, updateProvider, saveStore, newId } from '../store/local.js'
import { t } from '../i18n/index.js'

// ---------------------- 表单字段定义 ----------------------
interface FieldDef {
  key: keyof Omit<ProviderConfig, 'id' | 'useAto'>
  labelKey: string
  placeholderKey: string
  secret?: boolean
}

const BASE_FIELDS: FieldDef[] = [
  { key: 'name',    labelKey: 'fieldName',    placeholderKey: 'placeholderName' },
  { key: 'model',   labelKey: 'fieldModel',   placeholderKey: 'placeholderModel' },
]

const DIRECT_FIELDS: FieldDef[] = [
  { key: 'baseUrl', labelKey: 'fieldBaseUrl', placeholderKey: 'placeholderBaseUrl' },
  { key: 'apiKey',  labelKey: 'fieldApiKey',  placeholderKey: 'placeholderApiKey', secret: true },
]

const ATO_FIELDS: FieldDef[] = [
  { key: 'atoUpstreamUrl', labelKey: 'fieldAtoUrl', placeholderKey: 'placeholderAtoUrl' },
  { key: 'atoApiKey',      labelKey: 'fieldAtoKey', placeholderKey: 'placeholderAtoKey', secret: true },
]

interface Props {
  installation: Installation
  store: AppStore
  editing: ProviderConfig | null
  onStoreChange: (s: AppStore) => void
  onBack: () => void
}

export function ProviderForm({ installation, store, editing, onStoreChange, onBack }: Props) {
  const meta = TOOLS.find(t => t.id === installation.tool)!
  const isEdit = editing !== null

  const [fields, setFields] = useState<Omit<ProviderConfig, 'id'>>({
    name:    editing?.name    ?? '',
    model:   editing?.model   ?? '',
    baseUrl: editing?.baseUrl ?? '',
    apiKey:  editing?.apiKey  ?? '',
    useAto:  editing?.useAto  ?? false,
    atoUpstreamUrl: editing?.atoUpstreamUrl ?? '',
    atoApiKey:      editing?.atoApiKey      ?? '',
    atoPort:        editing?.atoPort        ?? 18653,
  })
  const [useAto, setUseAto] = useState(editing?.useAto ?? false)

  // 字段列表：基础 + ATO开关 + (ATO字段 或 直接字段)
  const allFields: (FieldDef | 'toggle')[] = [
    ...BASE_FIELDS,
    'toggle',  // ATO 开关
    ...(useAto ? ATO_FIELDS : DIRECT_FIELDS),
  ]

  const totalItems = allFields.length + 2  // 字段 + 保存 + 取消
  const [focusIdx, setFocusIdx] = useState(0)

  function submit() {
    if (!fields.name.trim() || !fields.model.trim()) return

    const entry: ProviderConfig = {
      id: editing?.id ?? newId(),
      name: fields.name,
      model: fields.model,
      baseUrl: useAto ? '' : fields.baseUrl,
      apiKey: useAto ? '' : fields.apiKey,
      useAto,
      atoUpstreamUrl: useAto ? fields.atoUpstreamUrl : undefined,
      atoApiKey: useAto ? fields.atoApiKey : undefined,
      atoPort: useAto ? fields.atoPort : undefined,
    }

    const key = instKey(installation)
    const next = isEdit
      ? updateProvider(store, key, entry)
      : addProvider(store, key, entry)

    saveStore(next)
    onStoreChange(next)
    onBack()
  }

  // 全局键盘处理
  useInput((ch, k) => {
    if (k.escape) return onBack()
    if (k.upArrow)    return setFocusIdx(i => (i - 1 + totalItems) % totalItems)
    if (k.downArrow)  return setFocusIdx(i => (i + 1) % totalItems)
    if (k.return) {
      const fieldCount = allFields.length
      if (focusIdx === fieldCount)     return submit()       // 保存
      if (focusIdx === fieldCount + 1) return onBack()       // 取消
      if (focusIdx < fieldCount && allFields[focusIdx] === 'toggle') {
        // 切换 ATO 开关
        setUseAto(v => !v)
        return
      }
    }
  })

  // 字段内 Enter 跳转
  function onFieldSubmit(idx: number) {
    if (idx < allFields.length - 1) {
      setFocusIdx(idx + 1)
    } else {
      setFocusIdx(allFields.length)  // 跳到保存按钮
    }
  }

  const canSave = fields.name.trim() && fields.model.trim()
  const fieldCount = allFields.length

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* ---- 顶栏 ---- */}
      <Box marginBottom={1} gap={1}>
        <Text dimColor>CC Switch › {meta.label} › {installation.env.label} ›</Text>
        <Text bold color={meta.color}>{isEdit ? t('editProvider') : t('addProviderTitle')}</Text>
      </Box>

      {/* ---- 表单字段 ---- */}
      <Box flexDirection="column" gap={1}>
        {allFields.map((f, i) => {
          const focused = i === focusIdx

          // ATO 开关
          if (f === 'toggle') {
            return (
              <Box key="toggle" flexDirection="column">
                <Text color={focused ? meta.color : 'gray'} bold={focused}>
                  {focused ? '❯ ' : '  '}{t('viaAtoProxy')}
                </Text>
                <Box paddingLeft={4}>
                  <Text color={useAto ? 'green' : 'gray'}>
                    {useAto ? t('atoOn') : t('atoOff')}  {t('atoToggleHint')}
                  </Text>
                </Box>
              </Box>
            )
          }

          const isSecret = f.secret
          const value = fields[f.key] ?? ''

          return (
            <Box key={f.key} flexDirection="column">
              <Text color={focused ? meta.color : 'gray'} bold={focused}>
                {focused ? '❯ ' : '  '}{t(f.labelKey)}
              </Text>
              <Box paddingLeft={4}>
                {focused ? (
                  <TextInput
                    value={String(value)}
                    placeholder={t(f.placeholderKey)}
                    mask={isSecret ? '*' : undefined}
                    onChange={val => setFields(prev => ({ ...prev, [f.key]: val }))}
                    onSubmit={() => onFieldSubmit(i)}
                  />
                ) : (
                  <Text dimColor>
                    {isSecret && value
                      ? '●'.repeat(Math.min(String(value).length, 12))
                      : value || t(f.placeholderKey)}
                  </Text>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>

      {/* ---- 操作按钮 ---- */}
      <Box marginTop={1} gap={3} paddingLeft={2}>
        <Text
          color={focusIdx === fieldCount ? (canSave ? 'green' : 'gray') : undefined}
          bold={focusIdx === fieldCount}
        >
          {focusIdx === fieldCount ? '❯ ' : '  '}
          [{canSave ? t('save') : t('saveMissing')}]
        </Text>
        <Text
          color={focusIdx === fieldCount + 1 ? 'red' : undefined}
          bold={focusIdx === fieldCount + 1}
        >
          {focusIdx === fieldCount + 1 ? '❯ ' : '  '}
          [{t('cancel')}]
        </Text>
      </Box>

      {/* ---- 底部提示 ---- */}
      <Box marginTop={1}>
        <Text dimColor>{t('hintForm')}</Text>
      </Box>
    </Box>
  )
}
