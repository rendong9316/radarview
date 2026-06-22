/**
 * src/cesium/flagRenderer.ts — 旗标 Billboard 渲染
 *
 * 管理 Cesium Entity API 中的旗标（Billboard + Label）。
 * 包含 Canvas 图标生成和 Entity 生命周期管理。
 *
 * 使用方式：在 onMounted 中调用 init(ctx)，之后即可使用所有函数。
 */

import * as Cesium from 'cesium'
import type { Flag } from '../composables/useFlags'
import type { CesiumContext } from './types'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

let ctx: CesiumContext | null = null

/** flagId → Entity 映射 */
const flagEntityMap = new Map<string, Cesium.Entity>()

/** Canvas 生成的旗标图标 Data URLs，按 style 名索引 */
let flagIconDataUrls: Map<string, string>

// ═══════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════

export function init(context: CesiumContext) {
  ctx = context
  flagIconDataUrls = createFlagIcons()
}

export function reset() {
  flagEntityMap.clear()
  ctx = null
}

// ═══════════════════════════════════════════
// 公开访问器
// ═══════════════════════════════════════════

export function getFlagEntityMap(): ReadonlyMap<string, Cesium.Entity> {
  return flagEntityMap
}

// ═══════════════════════════════════════════
// Canvas 图标生成（纯函数，不依赖 Cesium）
// ═══════════════════════════════════════════

export function createFlagIcons(): Map<string, string> {
  const map = new Map<string, string>()
  const size = 32

  function makeIcon(style: string, draw: (ctx: CanvasRenderingContext2D) => void): string {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const c2d = canvas.getContext('2d')!
    draw(c2d)
    const url = canvas.toDataURL()
    map.set(style, url)
    return url
  }

  // ── flag-standard: Lucide-style rectangular flag with notch ──
  makeIcon('flag-standard', (c2d) => {
    c2d.fillStyle = '#555555'
    c2d.fillRect(8, 4, 2, 22)
    c2d.beginPath()
    c2d.moveTo(10, 5)
    c2d.lineTo(26, 7)
    c2d.lineTo(26, 15)
    c2d.lineTo(18, 11)
    c2d.lineTo(10, 13)
    c2d.closePath()
    c2d.fillStyle = '#ff4444'
    c2d.fill()
    c2d.strokeStyle = '#ffffff'
    c2d.lineWidth = 1.5
    c2d.stroke()
  })

  // ── flag-triangle-right: triangular pennant ──
  makeIcon('flag-triangle-right', (c2d) => {
    c2d.fillStyle = '#555555'
    c2d.fillRect(8, 4, 2, 22)
    c2d.beginPath()
    c2d.moveTo(10, 6)
    c2d.lineTo(26, 12)
    c2d.lineTo(10, 18)
    c2d.closePath()
    c2d.fillStyle = '#ff4444'
    c2d.fill()
    c2d.strokeStyle = '#ffffff'
    c2d.lineWidth = 1.5
    c2d.stroke()
  })

  // ── flag-pin: classic pin ──
  makeIcon('flag-pin', (c2d) => {
    c2d.beginPath()
    c2d.arc(size / 2, size / 2 - 4, 10, 0, Math.PI * 2)
    c2d.fillStyle = '#ff4444'
    c2d.fill()
    c2d.strokeStyle = '#ffffff'
    c2d.lineWidth = 2
    c2d.stroke()
    c2d.beginPath()
    c2d.moveTo(size / 2 - 5, size / 2 + 2)
    c2d.lineTo(size / 2, size - 4)
    c2d.lineTo(size / 2 + 5, size / 2 + 2)
    c2d.fillStyle = '#ff4444'
    c2d.fill()
    c2d.strokeStyle = '#ffffff'
    c2d.lineWidth = 1.5
    c2d.stroke()
    c2d.beginPath()
    c2d.arc(size / 2, size / 2 - 4, 4, 0, Math.PI * 2)
    c2d.fillStyle = '#ffffff'
    c2d.fill()
  })

  // ── diamond: diamond marker ──
  makeIcon('diamond', (c2d) => {
    c2d.beginPath()
    c2d.moveTo(16, 4)
    c2d.lineTo(27, 15)
    c2d.lineTo(16, 26)
    c2d.lineTo(5, 15)
    c2d.closePath()
    c2d.fillStyle = '#ff4444'
    c2d.fill()
    c2d.strokeStyle = '#ffffff'
    c2d.lineWidth = 1.5
    c2d.stroke()
    c2d.beginPath()
    c2d.arc(16, 15, 4, 0, Math.PI * 2)
    c2d.fillStyle = '#ffffff'
    c2d.fill()
  })

  // ── circle: filled circle marker ──
  makeIcon('circle', (c2d) => {
    c2d.beginPath()
    c2d.arc(16, 16, 10, 0, Math.PI * 2)
    c2d.fillStyle = '#ff4444'
    c2d.fill()
    c2d.strokeStyle = '#ffffff'
    c2d.lineWidth = 2
    c2d.stroke()
    c2d.beginPath()
    c2d.arc(16, 16, 5, 0, Math.PI * 2)
    c2d.fillStyle = '#ffffff'
    c2d.fill()
  })

  // ── square-flag: simple rectangular flag without notch ──
  makeIcon('square-flag', (c2d) => {
    c2d.fillStyle = '#555555'
    c2d.fillRect(8, 4, 2, 22)
    c2d.beginPath()
    c2d.rect(10, 5, 16, 11)
    c2d.fillStyle = '#ff4444'
    c2d.fill()
    c2d.strokeStyle = '#ffffff'
    c2d.lineWidth = 1.5
    c2d.stroke()
  })

  return map
}

// ═══════════════════════════════════════════
// 图标查询
// ═══════════════════════════════════════════

export function getFlagIconUrl(style?: string): string {
  if (style && flagIconDataUrls.has(style)) return flagIconDataUrls.get(style)!
  return flagIconDataUrls.get('flag-pin')!
}

// ═══════════════════════════════════════════
// Entity 生命周期
// ═══════════════════════════════════════════

export function createFlagEntity(flag: Flag, scale: number) {
  if (!ctx?.viewer) return
  const entity = ctx.viewer.entities.add({
    id: `flag-${flag.id}`,
    position: Cesium.Cartesian3.fromDegrees(flag.longitude, flag.latitude),
    billboard: {
      image: getFlagIconUrl(flag.style),
      scale: 0.8 * scale,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    },
    label: {
      text: flag.label,
      font: `${Math.round(12 * scale)}px sans-serif`,
      fillColor: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.TOP,
      pixelOffset: new Cesium.Cartesian2(0, Math.round(8 * scale)),
    },
  })
  flagEntityMap.set(flag.id, entity)
}

export function removeFlagEntity(id: string) {
  const entity = flagEntityMap.get(id)
  if (entity && ctx?.viewer) {
    ctx.viewer.entities.remove(entity)
    flagEntityMap.delete(id)
  }
}

export function clearAllFlagEntities() {
  if (!ctx?.viewer) return
  for (const entity of flagEntityMap.values()) {
    ctx.viewer.entities.remove(entity)
  }
  flagEntityMap.clear()
}

/** Full reconciliation of flag Entities against reactive flags state */
export function syncFlagEntities(flags: Flag[], scale: number) {
  if (!ctx?.viewer) return
  const newIds = new Set(flags.map((f) => f.id))
  const oldIds = new Set(flagEntityMap.keys())

  ctx.viewer.entities.suspendEvents()

  for (const id of oldIds) {
    if (!newIds.has(id)) removeFlagEntity(id)
  }

  for (const flag of flags) {
    if (!flagEntityMap.has(flag.id)) {
      createFlagEntity(flag, scale)
    } else {
      const entity = flagEntityMap.get(flag.id)!
      if (entity.label) {
        entity.label.text = new Cesium.ConstantProperty(flag.label)
        entity.label.font = new Cesium.ConstantProperty(`${Math.round(12 * scale)}px sans-serif`)
        entity.label.pixelOffset = new Cesium.ConstantProperty(new Cesium.Cartesian2(0, Math.round(8 * scale)))
      }
      if (entity.billboard) {
        entity.billboard.image = new Cesium.ConstantProperty(getFlagIconUrl(flag.style))
        entity.billboard.scale = new Cesium.ConstantProperty(0.8 * scale)
      }
    }
  }

  ctx.viewer.entities.resumeEvents()
  ctx.viewer.scene.requestRender()
}
