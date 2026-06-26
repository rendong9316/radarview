<template>
  <Teleport to="body">
    <div class="dialog-overlay" @click.self="$emit('close', false)" @keydown.esc="$emit('close', false)">
      <div class="dialog-box">
        <div class="dialog-icon">
          <GlobeOff :size="48" />
        </div>
        <h2 class="dialog-title">未找到离线地图数据</h2>
        <p class="dialog-message">
          程序未能在任何目录下找到 <code>.mbtiles</code> 瓦片文件，地图将无法显示底图。
        </p>
        <p class="dialog-message">
          请将 <code>.mbtiles</code> 文件放入以下目录后重启程序：
        </p>
        <div class="dialog-path">
          <code>{{ appDataDir || '(正在获取路径...)' }}</code>
        </div>
        <label class="dialog-checkbox">
          <input v-model="dontShowAgain" type="checkbox" />
          <span>不再提示</span>
        </label>
        <div class="dialog-actions">
          <button class="dialog-btn" @click="$emit('close', dontShowAgain)" title="关闭对话框">我知道了</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { GlobeOff } from '@lucide/vue'

defineProps<{ appDataDir: string }>()
defineEmits<{ close: [dontShowAgain: boolean] }>()

const dontShowAgain = ref(false)
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 24px 32px;
  text-align: center;
  min-width: 360px;
  max-width: 480px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-icon {
  margin-bottom: 8px;
  color: var(--error);
}

.dialog-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.dialog-message {
  font-size: 0.857rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 6px;
  text-align: left;
}

.dialog-message code {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 2px;
  padding: 1px 5px;
  font-size: 0.857rem;
  color: var(--accent-primary);
  font-family: 'Consolas', 'Courier New', monospace;
}

.dialog-path {
  margin: 10px 0 16px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  text-align: left;
  word-break: break-all;
}

.dialog-path code {
  font-size: 0.786rem;
  color: var(--accent-primary);
  font-family: 'Consolas', 'Courier New', monospace;
  line-height: 1.5;
}

.dialog-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 16px;
  font-size: 0.786rem;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
}

.dialog-checkbox input[type="checkbox"] {
  accent-color: var(--accent-primary);
  cursor: pointer;
}

.dialog-actions {
  display: flex;
  justify-content: center;
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
