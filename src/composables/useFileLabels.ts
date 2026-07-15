/**
 * src/composables/useFileLabels.ts — 文件序号标签
 *
 * 将原始文件名替换为按导入先后顺序的序号（文件1、文件2…），
 * 仅影响 UI 显示，不改变 trackKey 中的 fileName 标识。
 * 模块级单例，所有组件共享。
 */

import { ref, watch } from 'vue'
import type { DataSource } from '../types/track'

/** key = "source::fileName" → generated label like "文件1" */
const generatedFileLabelMap = ref<Record<string, string>>({})
/** key = "source::fileName" → user-defined display label */
const customFileLabelMap = ref<Record<string, string>>({})
const SETTINGS_KEY = 'display.file_labels'

watch(customFileLabelMap, () => {
  import('./useSettingsPersistence').then(({ scheduleSave }) => {
    scheduleSave(SETTINGS_KEY, JSON.stringify(customFileLabelMap.value))
  })
}, { deep: true, immediate: false })

/** DB source value → frontend DataSource key */
const DB_TO_SRC: Record<string, string> = {
  'ADS-B': 'adsb',
  'Radar': 'radar',
  'RadarRaw': 'radar_raw',
}

/** 从 batches 数组重建标签映射（按 batch.id 升序）。单文件时不分配序号。 */
export function setBatchOrder(
  batches: { id: number; file_name: string; source: string }[],
): void {
  const nextGenerated: Record<string, string> = {}

  // Group by frontend source key
  const bySrc = new Map<string, { id: number; name: string }[]>()
  for (const b of batches) {
    const src = DB_TO_SRC[b.source] || b.source
    if (!b.file_name) continue
    if (!bySrc.has(src)) bySrc.set(src, [])
    bySrc.get(src)!.push({ id: b.id, name: b.file_name })
  }

  for (const [src, files] of bySrc) {
    // Sort by batch ID ascending (import order)
    files.sort((a, b) => a.id - b.id)
    if (files.length <= 1) continue // no need for file numbers
    files.forEach((f, i) => {
      nextGenerated[`${src}::${f.name}`] = `文件${i + 1}`
    })
  }

  generatedFileLabelMap.value = nextGenerated
}

function fileKey(source: DataSource, fileName: string): string {
  return `${source}::${fileName}`
}

export function setFileLabel(source: DataSource, fileName: string, label: string | null): void {
  const key = fileKey(source, fileName)
  const next = { ...customFileLabelMap.value }
  const clean = (label ?? '').trim()
  if (clean) next[key] = clean
  else delete next[key]
  customFileLabelMap.value = next
}

export function loadFileLabels(raw: Record<string, string>): void {
  const rawVal = raw[SETTINGS_KEY]
  if (rawVal === undefined) return
  try {
    const parsed = JSON.parse(rawVal)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.trim()) clean[k] = v.trim()
      }
      customFileLabelMap.value = clean
    }
  } catch { /* keep default */ }
}

/** 获取文件显示标签。fileName 为空时返回默认标签。 */
export function getFileLabel(source: DataSource, fileName: string): string {
  if (!fileName) return '(旧数据)'
  const key = fileKey(source, fileName)
  return customFileLabelMap.value[key] || generatedFileLabelMap.value[key] || fileName
}
