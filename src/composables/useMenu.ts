import { ref } from 'vue'

export type MenuName = 'file' | 'edit' | 'view' | 'tools' | 'help'
export type SubMenuName = 'appearance'

const openMenu = ref<MenuName | null>(null)
const openSubMenu = ref<SubMenuName | null>(null)

export function useMenu() {
  function isOpen(name: MenuName): boolean {
    return openMenu.value === name
  }

  function open(name: MenuName): void {
    openMenu.value = name
    openSubMenu.value = null
  }

  function close(): void {
    openMenu.value = null
    openSubMenu.value = null
  }

  function toggle(name: MenuName): void {
    if (openMenu.value === name) {
      close()
    } else {
      open(name)
    }
  }

  function hoverOpen(name: MenuName): void {
    if (openMenu.value !== null) {
      open(name)
    }
  }

  function closeAll(): void {
    close()
  }

  return {
    openMenu,
    openSubMenu,
    isOpen,
    open,
    close,
    toggle,
    hoverOpen,
    closeAll,
  }
}
