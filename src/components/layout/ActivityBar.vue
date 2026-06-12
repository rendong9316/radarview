<template>
  <aside class="activitybar">
    <button
      v-for="item in items"
      :key="item.id"
      class="activitybar-btn"
      :class="{ active: isActive(item.id) }"
      :title="item.tooltip"
      :aria-label="item.tooltip"
      @click="activate(item.id)"
    >
      <component :is="item.icon" :size="20" class="activitybar-icon-svg" />
      <span class="activitybar-label">{{ item.label }}</span>
    </button>

    <!-- Spacer (push settings to bottom) -->
    <div class="activitybar-spacer" />

    <!-- Settings at bottom -->
    <button
      class="activitybar-btn"
      :class="{ active: isActive('settings') }"
      title="设置"
      aria-label="设置 (Ctrl+,)"
      @click="activate('settings')"
    >
      <Settings :size="20" class="activitybar-icon-svg" />
      <span class="activitybar-label">设置</span>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { useActivityBar, type PanelId } from '../../composables/useActivityBar'
import { List, BarChart3, Layers, Flag, Filter, Settings } from '@lucide/vue'
import type { Component } from 'vue'

const { activate, isActive } = useActivityBar()

interface ActivityItem {
  id: PanelId
  icon: Component
  label: string
  tooltip: string
}

const items: ActivityItem[] = [
  { id: 'tracks', icon: List, label: '航迹', tooltip: '轨迹面板 (Ctrl+Shift+T)' },
  { id: 'manage', icon: BarChart3, label: '管理', tooltip: '航迹管理系统 (Ctrl+Shift+M)' },
  { id: 'layers', icon: Layers, label: '图层', tooltip: '图层控制 (Ctrl+Shift+L)' },
  { id: 'flags', icon: Flag, label: '旗标', tooltip: '旗标面板 (Ctrl+Shift+F)' },
  { id: 'timeFilter', icon: Filter, label: '筛选', tooltip: '时间筛选 (Ctrl+Shift+E)' },
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
  gap: 2px;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  color: var(--activitybar-fg);
  cursor: pointer;
  transition: color 0.2s ease, border-color 0.2s ease;
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

.activitybar-icon-svg {
  flex-shrink: 0;
}

.activitybar-label {
  font-size: 0.643rem;
  line-height: 1;
}

.activitybar-spacer {
  flex: 1;
}
</style>
