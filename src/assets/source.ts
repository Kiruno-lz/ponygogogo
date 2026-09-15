/**
 * 加载抽象。现在读本地，将来读分布式存储，差别必须收敛在这一个接口里。
 * 调用方只认 key，永远不拼路径。
 */
export type AssetKind = 'image' | 'audio' | 'json'

export interface ManifestEntry {
  kind: AssetKind
  path: string
  bytes: number
  sha256: string
  alt?: string
  cid?: string
}

export type AssetManifest = Record<string, ManifestEntry>
export type AssetKey = string

export interface LoadedAsset {
  url: string
  bytes: number
}

export interface AssetSource {
  /** 加载并返回可直接使用的资源 URL */
  load(key: AssetKey): Promise<LoadedAsset>
  keys(): AssetKey[]
  entry(key: AssetKey): ManifestEntry | undefined
}

/** 拉取资源清单。清单是进入加载流程前的第一份数据，必须可取消 */
export async function fetchManifest(signal?: AbortSignal): Promise<AssetManifest> {
  const res = await fetch('/assets/manifest.json', { signal })
  if (!res.ok) throw new Error(`资源清单加载失败：${res.status}`)
  return (await res.json()) as AssetManifest
}

function canPlay(path: string): boolean {
  if (typeof document === 'undefined') return true
  const a = document.createElement('audio')
  if (path.endsWith('.ogg')) return a.canPlayType('audio/ogg; codecs=opus') !== '' || a.canPlayType('audio/ogg') !== ''
  if (path.endsWith('.mp3')) return a.canPlayType('audio/mpeg') !== ''
  return true
}

/** 从构建产物读取 manifest[key].path，通过浏览器资源加载事件报告完成 */
export class LocalAssetSource implements AssetSource {
  constructor(private readonly manifest: AssetManifest, private readonly base = '/') {}

  keys(): AssetKey[] {
    return Object.keys(this.manifest)
  }

  entry(key: AssetKey): ManifestEntry | undefined {
    return this.manifest[key]
  }

  async load(key: AssetKey): Promise<LoadedAsset> {
    const e = this.manifest[key]
    if (!e) throw new Error(`资源清单里没有这一项：${key}`)
    let path = e.path
    if (e.kind === 'audio' && e.alt && !canPlay(path)) path = e.alt
    const url = this.base + path
    await verify(e.kind, url, key)
    return { url, bytes: e.bytes }
  }
}

/** 从 ${gateway}/${cid} 读取；gateway 只存在于构造参数，调用方不拼接路径 */
export class RemoteAssetSource implements AssetSource {
  constructor(
    private readonly manifest: AssetManifest,
    private readonly gateway: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  keys(): AssetKey[] {
    return Object.keys(this.manifest)
  }

  entry(key: AssetKey): ManifestEntry | undefined {
    return this.manifest[key]
  }

  async load(key: AssetKey): Promise<LoadedAsset> {
    const e = this.manifest[key]
    if (!e) throw new Error(`资源清单里没有这一项：${key}`)
    if (!e.cid) throw new Error(`资源 ${key} 缺少 cid，无法远程加载`)
    const res = await this.fetchImpl(`${this.gateway}/${e.cid}`)
    if (!res.ok) throw new Error(`远程加载失败 ${key}: ${res.status}`)
    const blob = await res.blob()
    return { url: URL.createObjectURL(blob), bytes: blob.size }
  }
}

function verify(kind: AssetKind, url: string, key: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  if (kind === 'image') {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`图片加载失败：${key}`))
      img.src = url
    })
  }
  if (kind === 'audio') {
    return new Promise((resolve, reject) => {
      const a = new Audio()
      let done = false
      const ok = () => {
        if (done) return
        done = true
        resolve()
      }
      a.oncanplaythrough = ok
      a.onloadeddata = ok
      a.onerror = () => {
        if (done) return
        done = true
        reject(new Error(`音频加载失败：${key}`))
      }
      a.preload = 'auto'
      a.src = url
      // 部分浏览器不触发 canplaythrough，给一个上限
      setTimeout(ok, 4000)
    })
  }
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`资源加载失败：${key}`)
  })
}
