/**
 * src/composables/useDialogPrompt.ts — 替代 window.prompt() 的模态输入框
 *
 * 使用 Tauri 原生对话框代替浏览器 prompt()，避免显示 "localhost:1420 显示" 字样。
 * 通过 Promise 实现异步等待用户输入。
 */

import { ref } from 'vue'

interface PromptState {
  message: string
  defaultValue: string
  resolve: (value: string | null) => void
}

const state = ref<PromptState | null>(null)

/**
 * 显示一个模态输入对话框。
 * @param message 提示文字
 * @param defaultValue 默认值
 * @returns 用户输入的值，取消时返回 null
 */
export function showPrompt(message: string, defaultValue: string = ''): Promise<string | null> {
  return new Promise((resolve) => {
    state.value = { message, defaultValue, resolve }
  })
}

/** 获取当前 prompt 状态（供组件使用） */
export function useDialogPrompt() {
  function confirm(value: string) {
    const s = state.value
    if (s) {
      state.value = null
      s.resolve(value)
    }
  }

  function cancel() {
    const s = state.value
    if (s) {
      state.value = null
      s.resolve(null)
    }
  }

  return { promptState: state, confirm, cancel, showPrompt }
}
