<template>
  <Teleport to="body">
    <div class="dialog-overlay" @click.self="$emit('close')" @keydown.esc="$emit('close')">
      <div class="dialog-box">
        <div class="dialog-icon">
          <Globe :size="48" />
        </div>
        <h2 class="dialog-title">RadarView</h2>
        <p class="dialog-subtitle">雷达航迹可视化系统</p>
        <p class="dialog-version">版本 v0.1.0</p>
        <div class="dialog-tech">
          <span class="tech-tag">Tauri v2</span>
          <span class="tech-tag">Vue 3</span>
          <span class="tech-tag">CesiumJS</span>
          <span class="tech-tag">Rust</span>
          <span class="tech-tag">TypeScript</span>
          <span class="tech-tag">SQLite</span>
        </div>
        <p class="dialog-copy">&copy; 2026 RadarView Team</p>
        <button class="dialog-btn" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Globe } from '@lucide/vue'

defineEmits<{ close: [] }>()
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 32px 40px;
  text-align: center;
  min-width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-icon {
  margin-bottom: 12px;
  color: var(--accent-primary);
}

.dialog-title {
  font-size: 1.429rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.dialog-subtitle {
  font-size: 0.929rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.dialog-version {
  font-size: 0.929rem;
  color: var(--accent-primary);
  font-weight: 600;
  margin-bottom: 16px;
}

.dialog-tech {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-bottom: 16px;
}

.tech-tag {
  padding: 2px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  font-size: 0.786rem;
  color: var(--text-secondary);
}

.dialog-copy {
  font-size: 0.786rem;
  color: var(--text-tertiary);
  margin-bottom: 16px;
}

.dialog-btn {
  padding: 6px 24px;
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: 3px;
  font-size: 0.929rem;
  cursor: pointer;
}
.dialog-btn:hover {
  opacity: 0.9;
}
</style>
