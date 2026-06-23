import { ref } from 'vue'

// ── Module-level singleton state ──

const visible = ref(false)
const title = ref('确认操作')
const message = ref('')
const confirmText = ref('确认')
const cancelText = ref('取消')
const variant = ref<'danger' | 'default'>('default')
const checkboxLabel = ref('')
const dontShowAgain = ref(false)

let resolvePromise: ((value: boolean) => void) | null = null

// ── Exported composable ──

export function useConfirmDialog() {
  /**
   * Show a confirmation dialog and return a Promise that resolves to:
   *   true  — user clicked confirm
   *   false — user clicked cancel or dismissed
   *
   * When `checkboxLabel` is provided, a "don't show again" checkbox
   * is rendered. Check `dontShowAgain` after the promise resolves.
   */
  function show(opts: {
    title?: string
    message: string
    confirmText?: string
    cancelText?: string
    variant?: 'danger' | 'default'
    checkboxLabel?: string
  }): Promise<boolean> {
    title.value = opts.title ?? '确认操作'
    message.value = opts.message
    confirmText.value = opts.confirmText ?? '确认'
    cancelText.value = opts.cancelText ?? '取消'
    variant.value = opts.variant ?? 'default'
    checkboxLabel.value = opts.checkboxLabel ?? ''
    dontShowAgain.value = false
    visible.value = true
    return new Promise((resolve) => {
      resolvePromise = resolve
    })
  }

  function onConfirm() {
    visible.value = false
    resolvePromise?.(true)
    resolvePromise = null
  }

  function onCancel() {
    visible.value = false
    resolvePromise?.(false)
    resolvePromise = null
  }

  return {
    visible,
    title,
    message,
    confirmText,
    cancelText,
    variant,
    checkboxLabel,
    dontShowAgain,
    show,
    onConfirm,
    onCancel,
  }
}
