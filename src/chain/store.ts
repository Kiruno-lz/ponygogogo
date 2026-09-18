/**
 * localStorage 的薄封装。隐私模式与无头环境下访问会抛错，这里统一退回进程内存，
 * 让调用方的契约行为在两种环境里完全一致。**只放非机密数据**：私钥、助记词与 PRF 输出一律不进这里。
 */
const memoryStore = new Map<string, string>()

export const store = {
  get(key: string): string | null {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(key)
    } catch {
      /* 隐私模式下访问会抛错 */
    }
    return memoryStore.get(key) ?? null
  },
  set(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value)
        return
      }
    } catch {
      /* 同上 */
    }
    memoryStore.set(key, value)
  },
  remove(key: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key)
        return
      }
    } catch {
      /* 同上 */
    }
    memoryStore.delete(key)
  },
}

export type Store = typeof store
