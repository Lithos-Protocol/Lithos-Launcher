/// <reference types="svelte" />
/// <reference types="vite/client" />
import type { LauncherApi } from '@shared/types'

declare global {
  interface Window {
    lithos: LauncherApi
  }
}

export {}
