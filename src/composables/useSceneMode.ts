/**
 * src/composables/useSceneMode.ts — 2D/3D 地图模式切换
 *
 * 模块级单例，管理 Cesium SceneMode 在 SCENE3D ↔ SCENE2D 之间的切换。
 * 不涉及 COLUMBUS_VIEW（用户只需 3D 地球 / 2D 平面地图两种）。
 * 选择通过 useSettingsPersistence 持久化到 SQLite（key: map.scene_mode）。
 */

import { ref, computed } from 'vue'
import * as Cesium from 'cesium'
import { scheduleSave, getRawSetting } from './useSettingsPersistence'

const SETTINGS_KEY = 'map.scene_mode'

// ── 模块级状态 ──
const sceneMode = ref<Cesium.SceneMode>(Cesium.SceneMode.SCENE3D)

let _viewer: Cesium.Viewer | null = null

// ── Composable ──

export function useSceneMode() {
  const is3D = computed(() => sceneMode.value === Cesium.SceneMode.SCENE3D)

  /** CesiumMap onMounted 调用，传入 viewer 并应用持久化的模式 */
  function init(viewer: Cesium.Viewer) {
    _viewer = viewer
    const raw = getRawSetting(SETTINGS_KEY)
    if (raw !== undefined) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed === '2d') {
          sceneMode.value = Cesium.SceneMode.SCENE2D
          viewer.scene.mode = Cesium.SceneMode.SCENE2D
          viewer.scene.requestRender()
        }
      } catch { /* keep default 3D */ }
    }
  }

  /** 在 2D / 3D 之间切换 */
  function toggleSceneMode() {
    if (!_viewer) return
    const newMode =
      sceneMode.value === Cesium.SceneMode.SCENE3D
        ? Cesium.SceneMode.SCENE2D
        : Cesium.SceneMode.SCENE3D
    _viewer.scene.mode = newMode
    sceneMode.value = newMode
    _viewer.scene.requestRender()
    scheduleSave(
      SETTINGS_KEY,
      JSON.stringify(newMode === Cesium.SceneMode.SCENE3D ? '3d' : '2d'),
    )
  }

  /** 仅设置 ref 值（settings 加载时用，此时 viewer 可能未创建） */
  function setModeValue(mode: '2d' | '3d') {
    sceneMode.value =
      mode === '2d' ? Cesium.SceneMode.SCENE2D : Cesium.SceneMode.SCENE3D
  }

  return { sceneMode, is3D, init, toggleSceneMode, setModeValue }
}
