<template>
  <aside class="activitybar">
    <button
      v-for="item in items"
      :key="item.id"
      class="activitybar-btn"
      :class="{ active: isActive(item.id) }"
      :title="item.tooltip"
      @click="activate(item.id)"
    >
      <span class="activitybar-icon">{{ item.icon }}</span>
      <span class="activitybar-label">{{ item.label }}</span>
    </button>

    <!-- Spacer (push settings to bottom) -->
    <div class="activitybar-spacer" />

    <!-- Settings at bottom -->
    <button
      class="activitybar-btn"
      :class="{ active: isActive('settings') }"
      title="设置"
      @click="activate('settings')"
    >
      <span class="activitybar-icon">⚙</span>
      <span class="activitybar-label">设置</span>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { useActivityBar, type PanelId } from '../../composables/useActivityBar'

const { activate, isActive } = useActivityBar()

interface ActivityItem {
  id: PanelId
  icon: string
  label: string
  tooltip: string
}

const items: ActivityItem[] = [
  { id: 'tracks', icon: '📋', label: '航迹', tooltip: '轨迹面板 (Ctrl+Shift+T)' },
  { id: 'layers', icon: '🗺', label: '图层', tooltip: '图层控制 (Ctrl+Shift+L)' },
  { id: 'flags', icon: '🏴', label: '旗标', tooltip: '旗标面板 (Ctrl+Shift+F)' },
  { id: 'timeFilter', icon: '⏱', label: '过滤', tooltip: '时间过滤 (Ctrl+Shift+E)' },
]
</script>

<style scoped>
.activitybar {
  width: 48px;
  background: var(--activitybar-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  padding-top: 4px;
  border-right: 1px solid var(--border-secondary);
  z-index: 20;
}

.activitybar-btn {
  width: 40px;
  height: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  color: var(--activitybar-fg);
  cursor: pointer;
  transition: color 0.1s;
  position: relative;
  margin-bottom: 2px;
  border-radius: 0;
}
.activitybar-btn:hover {
  color: var(--activitybar-active);
}
.activitybar-btn.active {
  color: var(--activitybar-active);
  border-left-color: var(--activitybar-active-border);
}

.activitybar-icon {
  font-size: 1.429rem;
  line-height: 1;
}

.activitybar-label {
  font-size: 0.643rem;
  line-height: 1;
}

.activitybar-spacer {
  flex: 1;
}
</style>
