/**
 * [INPUT]: 依赖 ink，依赖 components/StableTextInput，依赖 types/store 的 AppStore 操作
 * [OUTPUT]: 对外提供 ProviderForm 组件（添加 + 编辑两用）
 * [POS]: screens/ 的供应商表单屏幕，配置供应商的名称/模型/URL/Key，并在保存前校验长密钥完整性
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { AppStore, Installation, ProviderConfig } from '../types.js'
import { TOOLS, instKey } from '../types.js'
import { StableTextInput } from '../components/StableTextInput.js'
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

type SecretFieldKey = 'apiKey' | 'atoApiKey'

interface SecretConfirmState {
  apiKey: boolean
  atoApiKey: boolean
}

const SECRET_FIELD_LABELS: Record<SecretFieldKey, string> = {
  apiKey: 'fieldApiKey',
  atoApiKey: 'fieldAtoKey',
}

function isSecretFieldKey(key: FieldDef['key']): key is SecretFieldKey {
  return key === 'apiKey' || key === 'atoApiKey'
}

function hasWhitespace(value: string): boolean {
  return /\s/.test(value)
}

function summarizeSecret(value: string): string {
  if (!value) return ''

  if (value.length <= 8) {
    return `***${value.slice(-2)} · len ${value.length}`
  }

  const head = value.slice(0, Math.min(10, value.length))
  const tail = value.slice(-Math.min(8, Math.max(4, value.length - head.length)))

  return `${head}...${tail} · len ${value.length}`
}

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
  const [feedback, setFeedback] = useState('')
  const [feedbackTone, setFeedbackTone] = useState<'info' | 'error'>('info')
  const [pendingSecretConfirm, setPendingSecretConfirm] = useState<SecretConfirmState>({
    apiKey: false,
    atoApiKey: false,
  })

  // 字段列表：基础 + ATO开关 + (ATO字段 或 直接字段)
  const allFields: (FieldDef | 'toggle')[] = [
    ...BASE_FIELDS,
    'toggle',  // ATO 开关
    ...(useAto ? ATO_FIELDS : DIRECT_FIELDS),
  ]

  const totalItems = allFields.length + 2  // 字段 + 保存 + 取消
  const [focusIdx, setFocusIdx] = useState(0)

  function activeSecretKeys(): SecretFieldKey[] {
    return useAto ? ['atoApiKey'] : ['apiKey']
  }

  function activeSecretSummary(): string {
    return activeSecretKeys()
      .map(key => {
        const value = String(fields[key] ?? '').trim()
        if (!value) return ''
        return `${t(SECRET_FIELD_LABELS[key])}: ${summarizeSecret(value)}`
      })
      .filter(Boolean)
      .join(' | ')
  }

  function validateSecrets(): string | null {
    for (const key of activeSecretKeys()) {
      const value = String(fields[key] ?? '')
      if (!value) continue
      if (hasWhitespace(value)) {
        return t('secretWhitespaceError', { field: t(SECRET_FIELD_LABELS[key]) })
      }
    }

    return null
  }

  function onFieldChange(key: FieldDef['key'], value: string) {
    setFields(prev => ({ ...prev, [key]: value }))
    setFeedback('')

    if (isSecretFieldKey(key)) {
      setPendingSecretConfirm(prev => ({ ...prev, [key]: true }))
    }
  }

  function hasPendingActiveSecretConfirm(): boolean {
    return activeSecretKeys().some(key => pendingSecretConfirm[key])
  }

  function clearPendingActiveSecretConfirm() {
    setPendingSecretConfirm(prev => {
      const next = { ...prev }
      for (const key of activeSecretKeys()) {
        next[key] = false
      }
      return next
    })
  }

  function submit() {
    if (!fields.name.trim() || !fields.model.trim()) return

    const secretError = validateSecrets()
    if (secretError) {
      setFeedbackTone('error')
      setFeedback(secretError)
      return
    }

    if (hasPendingActiveSecretConfirm()) {
      setFeedbackTone('info')
      setFeedback(t('secretConfirmBeforeSave', { summary: activeSecretSummary() || '-' }))
      clearPendingActiveSecretConfirm()
      return
    }

    const entry: ProviderConfig = {
      id: editing?.id ?? newId(),
      name: fields.name.trim(),
      model: fields.model.trim(),
      baseUrl: useAto ? '' : fields.baseUrl.trim(),
      apiKey: useAto ? '' : fields.apiKey.trim(),
      useAto,
      atoUpstreamUrl: useAto ? String(fields.atoUpstreamUrl ?? '').trim() : undefined,
      atoApiKey: useAto ? String(fields.atoApiKey ?? '').trim() : undefined,
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
          const value = String(fields[f.key] ?? '')
          const trimmedValue = value.trim()
          const secretSummary = isSecret ? summarizeSecret(trimmedValue) : ''
          const secretWhitespace = isSecret ? hasWhitespace(value) : false

          return (
            <Box key={f.key} flexDirection="column">
              <Text color={focused ? meta.color : 'gray'} bold={focused}>
                {focused ? '❯ ' : '  '}{t(f.labelKey)}
              </Text>
              <Box paddingLeft={4} flexDirection="column">
                {focused ? (
                  <StableTextInput
                    value={value}
                    placeholder={t(f.placeholderKey)}
                    mask={isSecret ? '*' : undefined}
                    onChange={val => onFieldChange(f.key, val)}
                    onSubmit={() => onFieldSubmit(i)}
                  />
                ) : (
                  <Text dimColor>
                    {isSecret && value
                      ? secretSummary
                      : value || t(f.placeholderKey)}
                  </Text>
                )}
                {isSecret && value && focused && (
                  <Text dimColor>{t('secretPreview', { summary: secretSummary })}</Text>
                )}
                {isSecret && secretWhitespace && (
                  <Text color="yellow">{t('secretWhitespaceHint')}</Text>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>

      {feedback && (
        <Box marginTop={1} paddingLeft={2}>
          <Text color={feedbackTone === 'error' ? 'red' : 'yellow'} bold>{feedback}</Text>
        </Box>
      )}

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
