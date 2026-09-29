/**
 * 内存认证器：把 WebAuthn 的那一层换成可预测的实现，让通行密钥的注册与登录能在
 * 无浏览器环境里逐字段验证。**PRF 输出是 sha256(凭据密钥 ‖ rpId ‖ salt)**，因此
 * 和真实认证器一样：同一把密钥 + 同一个 rpId + 同一个 salt 必然得到同一个输出。
 */
import type { WebAuthnClient } from '@category-labs/mera'

type StoredCredential = {
  readonly id: Uint8Array
  readonly rpId: string
  readonly secret: Uint8Array
  /** 创建时 WebAuthn 收到的 user.name，真实认证器就是拿它列在密钥清单里 */
  readonly userName: string
  readonly displayName: string
}

/** 认证器的行为开关，用来构造失败路径 */
export type FakeAuthenticatorMode =
  /** 正常工作 */
  | 'ok'
  /** 用户取消或认证器不可用 */
  | 'cancel'
  /** 认证器不支持 PRF 扩展（桌面版 Chrome 的本地 profile 就是这种） */
  | 'no-prf'

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export class FakeAuthenticator {
  mode: FakeAuthenticatorMode = 'ok'
  /** 断言时优先挑这把凭据，模拟用户在系统弹窗里选了另一个账户 */
  preferred: Uint8Array | null = null
  /** Model a platform/provider returning a different credential than the requested allowCredential. */
  returnedCredentialId: Uint8Array | null = null

  readonly credentials: StoredCredential[] = []
  private seq = 0

  readonly client: WebAuthnClient

  constructor(mode: FakeAuthenticatorMode = 'ok') {
    this.mode = mode
    this.client = {
      createCredential: (req) => this.create(req),
      getCredential: (req) => this.get(req),
    }
  }

  /** 认证器里已有的凭据数量——注册必须是「新增一把」而不是「覆盖一把」 */
  get size(): number {
    return this.credentials.length
  }

  private async prf(credential: StoredCredential, salt: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const material = concat(credential.secret, new TextEncoder().encode(credential.rpId), salt)
    return new Uint8Array(await crypto.subtle.digest('SHA-256', material))
  }

  private async create(
    req: WebAuthnClient.CreateCredentialRequest,
  ): Promise<WebAuthnClient.CreateCredentialResult> {
    if (this.mode === 'cancel') throw new DOMException('user cancelled', 'NotAllowedError')
    // 每把凭据一个固定密钥，序号决定它，方便测试里复现
    const secret = new Uint8Array(32).fill(0x10 + this.seq)
    const id = new Uint8Array(16).fill(0x40 + this.seq)
    this.seq++
    const credential: StoredCredential = {
      id,
      rpId: req.rp.id,
      secret,
      userName: req.user.name,
      displayName: req.user.displayName,
    }
    this.credentials.push(credential)
    if (this.mode === 'no-prf') {
      return { credentialId: id, transports: ['internal'], prfEnabled: false }
    }
    return {
      credentialId: id,
      transports: ['internal'],
      prfEnabled: true,
      prfOutput: await this.prf(credential, req.prfSalt),
    }
  }

  private async get(req: WebAuthnClient.GetCredentialRequest): Promise<WebAuthnClient.GetCredentialResult> {
    if (this.mode === 'cancel') throw new DOMException('user cancelled', 'NotAllowedError')
    const forRp = this.credentials.filter((c) => c.rpId === req.rpId)
    // allowCredential 是硬限定，真实认证器不会拿别的凭据来答；
    // preferred 模拟的是「系统弹窗让用户挑」，只在没有限定时才起作用
    const chosen = req.allowCredential
      ? forRp.find((c) => sameBytes(c.id, req.allowCredential!.credentialId))
      : (this.preferred ? forRp.find((c) => sameBytes(c.id, this.preferred!)) : undefined) ?? forRp[0]
    if (!chosen) throw new DOMException('no credential', 'NotAllowedError')
    if (this.mode === 'no-prf') return { credentialId: chosen.id }
    return { credentialId: this.returnedCredentialId ?? chosen.id, prfOutput: await this.prf(chosen, req.prfSalt) }
  }
}
