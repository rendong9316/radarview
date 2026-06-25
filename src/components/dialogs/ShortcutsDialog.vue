<template>
  <Teleport to="body">
    <div class="dialog-overlay" @click.self="$emit('close')" @keydown.esc="$emit('close')">
      <div class="dialog-box">
        <h2 class="dialog-title">键盘快捷键参考</h2>
        <div class="shortcut-group">
          <div class="group-title">文件</div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+O</span>
            <span class="shortcut-desc">导入 ADS-B 数据</span>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+Shift+O</span>
            <span class="shortcut-desc">导入雷达数据</span>
          </div>
        </div>
        <div class="shortcut-group">
          <div class="group-title">编辑</div>
          <div class="shortcut-row">
            <span class="shortcut-key">Esc</span>
            <span class="shortcut-desc">清除选中</span>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+,</span>
            <span class="shortcut-desc">首选项设置</span>
          </div>
        </div>
        <div class="shortcut-group">
          <div class="group-title">视图</div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+R</span>
            <span class="shortcut-desc">重置地图视角</span>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+T</span>
            <span class="shortcut-desc">切换标签显示</span>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+Shift+T</span>
            <span class="shortcut-desc">轨迹面板</span>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+Shift+M</span>
            <span class="shortcut-desc">航迹管理系统</span>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+Shift+L</span>
            <span class="shortcut-desc">图层控制</span>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+Shift+F</span>
            <span class="shortcut-desc">旗标面板</span>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-key">Ctrl+Shift+E</span>
            <span class="shortcut-desc">时间过滤</span>
          </div>
        </div>
        <button class="dialog-btn" @click="$emit('close')" title="关闭快捷键参考">关闭</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
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
  border-radius: 6px;
  padding: 24px 32px;
  min-width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-title {
  font-size: 1.143rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  text-align: center;
}

.shortcut-group {
  margin-bottom: 12px;
}

.group-title {
  font-size: 0.857rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-secondary);
}

.shortcut-row {
  display: flex;
  align-items: center;
  padding: 3px 0;
}

.shortcut-key {
  width: 120px;
  padding: 2px 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  font-size: 0.786rem;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: var(--text-primary);
  text-align: center;
  flex-shrink: 0;
}

.shortcut-desc {
  margin-left: 12px;
  font-size: 0.857rem;
  color: var(--text-secondary);
}

.dialog-btn {
  display: block;
  margin: 16px auto 0;
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
