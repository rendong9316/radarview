<template>
  <span class="help-tip" ref="triggerRef">
    <button class="help-btn" @click.stop="toggle" title="点击查看帮助">
      <HelpCircle :size="14" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        class="help-popover"
        :style="popoverStyle"
        @click.stop
      >
        <div class="help-popover-content">{{ text }}</div>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { HelpCircle } from '@lucide/vue'

const props = withDefaults(defineProps<{
  text: string
  position?: 'top' | 'bottom' | 'right'
}>(), {
  position: 'bottom',
})

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const triggerRect = ref({ top: 0, left: 0, width: 0, height: 0 })

function toggle() {
  if (!open.value) {
    const el = triggerRef.value
    if (el) {
      const r = el.getBoundingClientRect()
      triggerRect.value = { top: r.top, left: r.left, width: r.width, height: r.height }
    }
  }
  open.value = !open.value
}

function close() {
  open.value = false
}

const popoverStyle = computed(() => {
  const r = triggerRect.value
  const gap = 6
  let top = 0, left = 0

  switch (props.position) {
    case 'top':
      top = r.top - gap
      left = r.left + r.width / 2
      return {
        bottom: `${window.innerHeight - top}px`,
        left: `${left}px`,
        transform: 'translate(-50%, -100%)',
        position: 'fixed' as const,
        zIndex: 100,
      }
    case 'right':
      top = r.top + r.height / 2
      left = r.left + r.width + gap
      return {
        top: `${top}px`,
        left: `${left}px`,
        transform: 'translateY(-50%)',
        position: 'fixed' as const,
        zIndex: 100,
      }
    case 'bottom':
    default:
      top = r.top + r.height + gap
      left = r.left + r.width / 2
      return {
        top: `${top}px`,
        left: `${left}px`,
        transform: 'translateX(-50%)',
        position: 'fixed' as const,
        zIndex: 100,
      }
  }
})

function onGlobalClick(e: MouseEvent) {
  if (!open.value) return
  const target = e.target as HTMLElement
  if (triggerRef.value && !triggerRef.value.contains(target)) {
    close()
  }
}

onMounted(() => document.addEventListener('click', onGlobalClick))
onUnmounted(() => document.removeEventListener('click', onGlobalClick))
</script>

<style scoped>
.help-tip {
  display: inline-flex;
  align-items: center;
  position: relative;
  flex-shrink: 0;
}

.help-btn {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--text-tertiary);
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.help-btn:hover {
  color: var(--accent-primary);
  border-color: var(--accent-primary);
  background: rgba(0, 122, 204, 0.1);
}

.help-popover {
  max-width: 280px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  padding: 10px 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  font-size: 0.786rem;
  color: var(--text-primary);
  line-height: 1.55;
  pointer-events: auto;
}

.help-popover-content {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
