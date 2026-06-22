/**
 * src/cesium/boundaryRenderer.ts — 行政边界层 GeoJSON → Cesium Primitive 渲染
 *
 * 负责：
 * 1. GeoJSON 几何提取与简化（Douglas-Peucker）
 * 2. 环合并（减少 Polyline 对象数）
 * 3. Cesium Primitive 构建与场景管理
 *
 * 使用方式：在 onMounted 中调用 init(ctx)，之后即可使用所有函数。
 */

import * as Cesium from 'cesium'
import type { BoundaryLayerKey } from '../composables/useBoundaryLayers'
import {
  BOUNDARY_ALTITUDE,
  SIMPLIFY_TOLERANCE,
  BOUNDARY_LAYERS,
  type CesiumContext,
} from './types'

// ═══════════════════════════════════════════
// 模块级状态
// ═══════════════════════════════════════════

let ctx: CesiumContext | null = null

/** Per-layer Primitive references */
const boundaryPrimitives = new Map<BoundaryLayerKey, Cesium.Primitive>()

/** Per-layer merged ring coordinates [lon, lat][][] — cached for rebuild on color/width change */
const boundaryRingCache = new Map<BoundaryLayerKey, number[][][]>()

// ═══════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════

export function init(context: CesiumContext) {
  ctx = context
}

export function reset() {
  clearAllBoundaryLayers()
  boundaryRingCache.clear()
  ctx = null
}

// ═══════════════════════════════════════════
// 几何处理（纯函数）
// ═══════════════════════════════════════════

/** Extract all line coordinate rings from a GeoJSON geometry object */
export function extractPolygonRings(geometry: any): number[][][] {
  const type = geometry?.type
  const coords = geometry?.coordinates
  if (!type || !coords) return []

  switch (type) {
    case 'LineString':
      return [coords]
    case 'MultiLineString':
      return coords
    case 'Polygon':
      return [coords[0]] // 只取外环，忽略岛洞
    case 'MultiPolygon':
      return coords.map((p: any) => p[0])
    default:
      return []
  }
}

/** Douglas-Peucker 折线简化算法（基于索引，零临时数组分配） */
export function simplifyRing(ring: number[][], tolerance: number): number[][] {
  if (ring.length <= 2) return ring
  const result: number[][] = []
  result.push(ring[0])
  simplifyDp(ring, 0, ring.length - 1, tolerance, result)
  result.push(ring[ring.length - 1])
  return result
}

function simplifyDp(
  ring: number[][], lo: number, hi: number, tolerance: number, out: number[][],
) {
  if (hi - lo <= 1) return

  const first = ring[lo]
  const last = ring[hi]
  const dx = last[0] - first[0]
  const dy = last[1] - first[1]
  const lenSq = dx * dx + dy * dy

  let maxDist = 0
  let maxIdx = lo + 1

  for (let i = lo + 1; i < hi; i++) {
    let dist: number
    if (lenSq === 0) {
      const ddx = ring[i][0] - first[0]
      const ddy = ring[i][1] - first[1]
      dist = Math.sqrt(ddx * ddx + ddy * ddy)
    } else {
      const cross = Math.abs((ring[i][0] - first[0]) * dy - (ring[i][1] - first[1]) * dx)
      dist = cross / Math.sqrt(lenSq)
    }
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }

  if (maxDist <= tolerance) return // 中间所有点都可丢弃

  simplifyDp(ring, lo, maxIdx, tolerance, out)
  out.push(ring[maxIdx])
  simplifyDp(ring, maxIdx, hi, tolerance, out)
}

/** 合并端点相接的环，大幅减少 Polyline 对象数量 */
export function mergeConnectedRings(rings: number[][][]): number[][][] {
  if (rings.length <= 1) return rings

  const key = (pt: number[]) => `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`
  const startMap = new Map<string, number[]>()
  const endMap = new Map<string, number[]>()
  const used = new Set<number>()
  const closed: number[][][] = [] // 闭合环（首尾相接），单独保留

  for (let i = 0; i < rings.length; i++) {
    if (rings[i].length < 2) { used.add(i); continue }
    const sk = key(rings[i][0])
    const ek = key(rings[i][rings[i].length - 1])
    if (!startMap.has(sk)) startMap.set(sk, [])
    startMap.get(sk)!.push(i)
    if (!endMap.has(ek)) endMap.set(ek, [])
    endMap.get(ek)!.push(i)
    // 闭合环单独保留
    if (sk === ek) { used.add(i); closed.push(rings[i].slice()) }
  }

  const merged: number[][][] = [...closed]

  for (let i = 0; i < rings.length; i++) {
    if (used.has(i)) continue

    let chain = rings[i].slice()
    used.add(i)

    // 向前扩展
    let growing = true
    while (growing) {
      growing = false
      const headKey = key(chain[0])
      for (const ci of endMap.get(headKey) || []) {
        if (!used.has(ci)) { chain = [...rings[ci].slice(0, -1), ...chain]; used.add(ci); growing = true; break }
      }
      if (growing) continue
      for (const ci of startMap.get(headKey) || []) {
        if (!used.has(ci)) { chain = [...rings[ci].slice().reverse().slice(0, -1), ...chain]; used.add(ci); growing = true; break }
      }
    }

    // 向后扩展
    growing = true
    while (growing) {
      growing = false
      const tailKey = key(chain[chain.length - 1])
      for (const ci of startMap.get(tailKey) || []) {
        if (!used.has(ci)) { chain = [...chain, ...rings[ci].slice(1)]; used.add(ci); growing = true; break }
      }
      if (growing) continue
      for (const ci of endMap.get(tailKey) || []) {
        if (!used.has(ci)) { chain = [...chain, ...rings[ci].slice().reverse().slice(1)]; used.add(ci); growing = true; break }
      }
    }

    merged.push(chain)
  }

  return merged
}

// ═══════════════════════════════════════════
// Primitive 构建
// ═══════════════════════════════════════════

/** Build a Cesium Primitive from cached rings for one boundary layer */
export function buildBoundaryPrimitive(
  layerKey: BoundaryLayerKey,
  boundaryColors: Record<BoundaryLayerKey, string>,
  boundaryWidths: Record<BoundaryLayerKey, number>,
): Cesium.Primitive | null {
  const rings = boundaryRingCache.get(layerKey)
  if (!rings || rings.length === 0) return null

  const layerConfig = BOUNDARY_LAYERS.find(l => l.key === layerKey)
  const alpha = layerConfig?.alpha ?? 0.55
  const color = Cesium.Color.fromCssColorString(boundaryColors[layerKey]).withAlpha(alpha)
  const width = boundaryWidths[layerKey]

  const instances: Cesium.GeometryInstance[] = []
  for (let i = 0; i < rings.length; i++) {
    const positions = rings[i].map(pt =>
      Cesium.Cartesian3.fromDegrees(pt[0], pt[1], BOUNDARY_ALTITUDE),
    )
    instances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions,
        width,
        vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
      }),
    }))
  }

  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PolylineMaterialAppearance({
      material: Cesium.Material.fromType('Color', { color }),
    }),
    asynchronous: false,
  })
}

// ═══════════════════════════════════════════
// 加载 / 卸载
// ═══════════════════════════════════════════

export function clearAllBoundaryLayers() {
  for (const [key] of boundaryPrimitives) {
    clearSingleBoundaryLayer(key)
  }
}

/** Toggle boundary layers — load on first show, unload on hide */
export function applyBoundaryVisibility(
  boundaryVisible: Record<BoundaryLayerKey, boolean>,
  boundaryColors: Record<BoundaryLayerKey, string>,
  boundaryWidths: Record<BoundaryLayerKey, number>,
) {
  for (const layer of BOUNDARY_LAYERS) {
    if (boundaryVisible[layer.key]) {
      if (boundaryPrimitives.has(layer.key)) continue
      loadSingleBoundaryLayer(layer.key, boundaryVisible, boundaryColors, boundaryWidths)
    } else {
      clearSingleBoundaryLayer(layer.key)
    }
  }
}

export async function loadSingleBoundaryLayer(
  layerKey: BoundaryLayerKey,
  boundaryVisible: Record<BoundaryLayerKey, boolean>,
  boundaryColors: Record<BoundaryLayerKey, string>,
  boundaryWidths: Record<BoundaryLayerKey, number>,
) {
  if (!ctx?.viewer) return
  if (boundaryPrimitives.has(layerKey)) return

  const layer = BOUNDARY_LAYERS.find(l => l.key === layerKey)
  if (!layer) return

  try {
    const response = await fetch(layer.url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const geojson = await response.json()
    const features = Array.isArray(geojson.features) ? geojson.features : []

    // 1. 收集 + 简化 + 合并
    const allRings: number[][][] = []
    for (const feature of features) {
      const rings = extractPolygonRings(feature.geometry)
      for (const ring of rings) {
        if (Array.isArray(ring) && ring.length >= 2) allRings.push(ring as number[][])
      }
    }
    const simplified = allRings.map(r => simplifyRing(r, SIMPLIFY_TOLERANCE))
    const merged = mergeConnectedRings(simplified)

    const totalRawVerts = allRings.reduce((s, r) => s + r.length, 0)
    const totalSimpleVerts = simplified.reduce((s, r) => s + r.length, 0)

    // 2. 缓存合并后的环（用于后续颜色/线宽变更重建）
    boundaryRingCache.set(layerKey, merged)

    // 3. 构建 Primitive 并加入场景
    const primitive = buildBoundaryPrimitive(layerKey, boundaryColors, boundaryWidths)
    if (!primitive) return

    // fetch 期间用户可能关掉了可见性
    if (!boundaryVisible[layerKey]) return

    ctx.viewer.scene.primitives.add(primitive)
    boundaryPrimitives.set(layerKey, primitive)

    const ratio = totalRawVerts > 0 ? ((1 - totalSimpleVerts / totalRawVerts) * 100).toFixed(0) : '0'
    console.log(`[boundary] ${layerKey}: ${allRings.length}→${merged.length} rings, ${totalRawVerts}→${totalSimpleVerts} verts (-${ratio}%)`)
    ctx.viewer.scene.requestRender()
  } catch (e) {
    console.warn(`[boundary] failed to load ${layerKey}:`, e)
  }
}

export function clearSingleBoundaryLayer(layerKey: BoundaryLayerKey) {
  const primitive = boundaryPrimitives.get(layerKey)
  if (primitive && ctx?.viewer) {
    ctx.viewer.scene.primitives.remove(primitive)
    if (!primitive.isDestroyed()) primitive.destroy()
  }
  boundaryPrimitives.delete(layerKey)
  boundaryRingCache.delete(layerKey)
  ctx?.viewer?.scene.requestRender()
}

// ═══════════════════════════════════════════
// 线宽 / 颜色变更
// ═══════════════════════════════════════════

/** Rebuild a boundary primitive with new width/color */
export function rebuildBoundaryPrimitive(
  layerKey: BoundaryLayerKey,
  boundaryColors: Record<BoundaryLayerKey, string>,
  boundaryWidths: Record<BoundaryLayerKey, number>,
) {
  if (!boundaryPrimitives.has(layerKey)) return // 未加载，无需重建
  // 销毁旧 Primitive
  const old = boundaryPrimitives.get(layerKey)!
  if (ctx?.viewer) {
    ctx.viewer.scene.primitives.remove(old)
    if (!old.isDestroyed()) old.destroy()
  }
  boundaryPrimitives.delete(layerKey)
  // 重建
  const primitive = buildBoundaryPrimitive(layerKey, boundaryColors, boundaryWidths)
  if (primitive && ctx?.viewer) {
    ctx.viewer.scene.primitives.add(primitive)
    boundaryPrimitives.set(layerKey, primitive)
    ctx.viewer.scene.requestRender()
  }
}

export function applyBoundaryWidth(
  layerKey: BoundaryLayerKey,
  boundaryColors: Record<BoundaryLayerKey, string>,
  boundaryWidths: Record<BoundaryLayerKey, number>,
) {
  rebuildBoundaryPrimitive(layerKey, boundaryColors, boundaryWidths)
}

export function applyAllBoundaryWidths(
  boundaryColors: Record<BoundaryLayerKey, string>,
  boundaryWidths: Record<BoundaryLayerKey, number>,
) {
  for (const layer of BOUNDARY_LAYERS) {
    applyBoundaryWidth(layer.key, boundaryColors, boundaryWidths)
  }
}

export function applyBoundaryColor(
  layerKey: BoundaryLayerKey,
  boundaryColors: Record<BoundaryLayerKey, string>,
  boundaryWidths: Record<BoundaryLayerKey, number>,
) {
  rebuildBoundaryPrimitive(layerKey, boundaryColors, boundaryWidths)
}

export function applyAllBoundaryColors(
  boundaryColors: Record<BoundaryLayerKey, string>,
  boundaryWidths: Record<BoundaryLayerKey, number>,
) {
  for (const layer of BOUNDARY_LAYERS) {
    applyBoundaryColor(layer.key, boundaryColors, boundaryWidths)
  }
}

// ═══════════════════════════════════════════
// 公开访问器（供外部模块使用）
// ═══════════════════════════════════════════

export function getBoundaryPrimitives(): ReadonlyMap<BoundaryLayerKey, Cesium.Primitive> {
  return boundaryPrimitives
}
