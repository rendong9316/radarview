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
      <component :is="item.icon" :size="24" class="activitybar-icon-svg" />
      <span v-if="item.badge != null" class="activitybar-badge">{{ item.badge }}</span>
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
      <Settings :size="24" class="activitybar-icon-svg" />
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
  badge?: number | string
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
  border-right: 1px solid var(--border-secondary);
  z-index: 20;
}

.activitybar-btn {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  color: var(--activitybar-fg);
  cursor: pointer;
  transition: color 0.15s ease;
  position: relative;
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

.activitybar-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 0.643rem;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  color: #fff;
  background: var(--accent-primary);
  border-radius: 8px;
  pointer-events: none;
}

.activitybar-spacer {
  flex: 1;
}
</style>
