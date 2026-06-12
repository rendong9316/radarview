<template>
  <header class="titlebar">
    <!-- App logo (VS Code style: app icon top-left) -->
    <div class="titlebar-logo">
      <img :src="appIcon" class="titlebar-logo-img" alt="RadarView" />
    </div>

    <!-- Menu bar -->
    <div class="titlebar-menu">
      <MenuBar @action="(id: string) => $emit('menuAction', id)" />
    </div>

    <!-- Spacer (drag area) -->
    <div class="titlebar-spacer" data-tauri-drag-region @dblclick="onDblClick" />

    <!-- Window controls -->
    <div class="titlebar-controls">
      <button class="win-btn minimize" @pointerdown.prevent="onMinimize" title="最小化">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1" fill="currentColor"/></svg>
      </button>
      <button class="win-btn maximize" @pointerdown.prevent="onMaximize" :title="isMaximized ? '还原' : '最大化'">
        <!-- 最大化图标：单个方框 -->
        <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" stroke="currentColor" stroke-width="1" fill="none"/></svg>
        <!-- 还原图标：两个重叠方框 -->
        <svg v-else width="12" height="12" viewBox="0 0 12 12">
          <rect x="3" y="0" width="9" height="9" stroke="currentColor" stroke-width="1" fill="none"/>
          <rect x="0" y="3" width="9" height="9" stroke="currentColor" stroke-width="1" fill="var(--titlebar-bg)"/>
        </svg>
      </button>
      <button class="win-btn close" @pointerdown.prevent="onClose" title="关闭">
        <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" stroke-width="1.2"/><line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import MenuBar from './MenuBar.vue'

const appIcon = '/icon.png'

defineEmits<{
  menuAction: [id: string]
}>()

const appWindow = getCurrentWindow()
const isMaximized = ref(false)

let unlistenResize: UnlistenFn | null = null

async function updateMaximizedState() {
  isMaximized.value = await appWindow.isMaximized()
}

function onMinimize(e: PointerEvent) {
  e.preventDefault()
  appWindow.minimize()
}

async function onMaximize(e: PointerEvent) {
  e.preventDefault()
  await appWindow.toggleMaximize()
  // toggleMaximize 是异步的，稍等一下再读取状态
  await updateMaximizedState()
}

function onClose(e: PointerEvent) {
  e.preventDefault()
  appWindow.close()
}

async function onDblClick() {
  await appWindow.toggleMaximize()
  await updateMaximizedState()
}

onMounted(async () => {
  await updateMaximizedState()
  unlistenResize = await appWindow.onResized(() => {
    updateMaximizedState()
  })
})

onUnmounted(() => {
  if (unlistenResize) {
    unlistenResize()
  }
})
</script>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  height: 30px;
  background: var(--titlebar-bg);
  border-bottom: 1px solid var(--titlebar-border);
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
}

.titlebar-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 100%;
  flex-shrink: 0;
  margin-left: 4px;
}

.titlebar-logo-img {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.titlebar-menu {
  display: flex;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
}

.titlebar-spacer {
  flex: 1;
  height: 100%;
}

.titlebar-controls {
  display: flex;
  align-items: stretch;
  height: 100%;
  flex-shrink: 0;
}

.win-btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--titlebar-fg);
  cursor: pointer;
  transition: background 0.1s;
}
.win-btn:hover {
  background: var(--button-hover);
}
.win-btn.close:hover {
  background: #e81123;
  color: #fff;
}
</style>
