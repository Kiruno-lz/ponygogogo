type D1Result = { meta: { changes: number } }
type D1Statement = {
  bind(...values: (string | number)[]): D1Statement
  first<T>(): Promise<T | null>
  run(): Promise<D1Result>
}
type D1 = { prepare(sql: string): D1Statement }
type Env = { COLLECTION_DB: D1; ASSETS: { fetch(request: Request): Promise<Response> } }

const encoder = new TextEncoder()
const MAX_BODY = 8192
const TTL_MS = 120_000
const noStore = { 'Cache-Control': 'no-store' }

type Challenge = { challenge: string; challengeId: string; expiresAt: number }
type Envelope = { version: 1; iv: string; ciphertext: string }
type Document = { version: number; envelope: Envelope }

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: noStore })
}

function fail(code: string, status: number): Response {
  return json({ error: code }, status)
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function unhex(value: string, bytes: number): Uint8Array | null {
  if (!new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(value)) return null
  return Uint8Array.from(value.match(/../g)!.map((part) => Number.parseInt(part, 16)))
}

async function digest(value: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value))))
}

export function signedMessage(origin: string, method: string, path: string, publicKey: string, challengeId: string, challenge: string, payload: unknown): Uint8Array {
  return encoder.encode(['ponygogogo/collection/v1', origin, method, path, publicKey.toLowerCase(), challengeId, challenge, JSON.stringify(payload)].join('\n'))
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY) return null
  const body = await request.text()
  if (body.length > MAX_BODY) return null
  try {
    const value: unknown = JSON.parse(body)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function validEnvelope(value: unknown): value is Envelope {
  if (value === null || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return item.version === 1
    && typeof item.iv === 'string' && /^0x[0-9a-fA-F]{24}$/.test(item.iv)
    && typeof item.ciphertext === 'string' && /^0x[0-9a-fA-F]{32,4096}$/.test(item.ciphertext)
}

async function createChallenge(db: D1, body: Record<string, unknown>, ip: string): Promise<Response> {
  if (typeof body.publicKey !== 'string') return fail('INVALID_PUBLIC_KEY', 400)
  const key = unhex(body.publicKey, 32)
  if (!key) return fail('INVALID_PUBLIC_KEY', 400)
  const userId = await digest(key)
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  const ipHash = await digest(encoder.encode(ip))
  await db.prepare('DELETE FROM collection_challenges WHERE expires_at < ?').bind(now).run()
  await db.prepare('DELETE FROM collection_rate_limits WHERE window_minute < ?').bind(minute - 1440).run()
  await db.prepare('INSERT OR IGNORE INTO collection_rate_limits (ip_hash, window_minute, count) VALUES (?, ?, 0)')
    .bind(ipHash, minute).run()
  await db.prepare('UPDATE collection_rate_limits SET count = CASE WHEN window_minute = ? THEN count + 1 ELSE 1 END, window_minute = ? WHERE ip_hash = ?')
    .bind(minute, minute, ipHash).run()
  const rate = await db.prepare('SELECT count FROM collection_rate_limits WHERE ip_hash = ?')
    .bind(ipHash).first<{ count: number }>()
  if ((rate?.count ?? 0) > 30) return fail('CHALLENGE_RATE_LIMIT', 429)
  const active = await db.prepare('SELECT COUNT(*) AS count FROM collection_challenges WHERE user_id = ? AND expires_at > ? AND consumed = 0')
    .bind(userId, now).first<{ count: number }>()
  if ((active?.count ?? 0) >= 10) return fail('CHALLENGE_RATE_LIMIT', 429)
  const challenge = hex(crypto.getRandomValues(new Uint8Array(32)))
  const challengeId = crypto.randomUUID()
  const expiresAt = now + TTL_MS
  await db.prepare('INSERT INTO collection_challenges (id, user_id, challenge, expires_at, consumed) VALUES (?, ?, ?, ?, 0)')
    .bind(challengeId, userId, challenge, expiresAt).run()
  return json({ challenge, challengeId, expiresAt } satisfies Challenge)
}

async function authenticate(request: Request, db: D1, body: Record<string, unknown>): Promise<{ userId: string; publicKey: string; payload: unknown } | Response> {
  const { publicKey, challengeId, signature, payload } = body
  if (typeof publicKey !== 'string' || typeof challengeId !== 'string' || typeof signature !== 'string'
    || payload === undefined || challengeId.length > 80) return fail('INVALID_AUTH', 400)
  const keyBytes = unhex(publicKey, 32)
  const signatureBytes = unhex(signature, 64)
  if (!keyBytes || !signatureBytes) return fail('INVALID_AUTH', 400)
  const userId = await digest(keyBytes)
  const row = await db.prepare('SELECT challenge, expires_at, consumed FROM collection_challenges WHERE id = ? AND user_id = ?')
    .bind(challengeId, userId).first<{ challenge: string; expires_at: number; consumed: number }>()
  if (!row || row.expires_at < Date.now() || row.consumed !== 0) return fail('CHALLENGE_EXPIRED', 401)
  const url = new URL(request.url)
  const key = await crypto.subtle.importKey('raw', new Uint8Array(keyBytes), { name: 'Ed25519' }, false, ['verify'])
  const message = signedMessage(url.origin, request.method, url.pathname, publicKey, challengeId, row.challenge, payload)
  if (!await crypto.subtle.verify('Ed25519', key, new Uint8Array(signatureBytes), new Uint8Array(message))) return fail('INVALID_SIGNATURE', 401)
  const consumed = await db.prepare('UPDATE collection_challenges SET consumed = 1 WHERE id = ? AND consumed = 0 AND expires_at >= ?')
    .bind(challengeId, Date.now()).run()
  if (consumed.meta.changes !== 1) return fail('CHALLENGE_EXPIRED', 401)
  return { userId, publicKey: publicKey.toLowerCase(), payload }
}

async function readDocument(db: D1, userId: string): Promise<Response> {
  const row = await db.prepare('SELECT version, iv, ciphertext FROM collection_documents WHERE user_id = ?')
    .bind(userId).first<{ version: number; iv: string; ciphertext: string }>()
  if (!row) return fail('COLLECTION_NOT_FOUND', 404)
  return json({ version: row.version, envelope: { version: 1, iv: row.iv, ciphertext: row.ciphertext } } satisfies Document)
}

async function writeDocument(db: D1, userId: string, publicKey: string, payload: unknown): Promise<Response> {
  if (payload === null || typeof payload !== 'object') return fail('INVALID_DOCUMENT', 400)
  const item = payload as Record<string, unknown>
  if (!Number.isSafeInteger(item.expectedVersion) || (item.expectedVersion as number) < 0 || !validEnvelope(item.envelope)) {
    return fail('INVALID_DOCUMENT', 400)
  }
  const expected = item.expectedVersion as number
  const envelope = item.envelope
  let result: D1Result
  if (expected === 0) {
    result = await db.prepare('INSERT OR IGNORE INTO collection_documents (user_id, public_key, version, iv, ciphertext, updated_at) VALUES (?, ?, 1, ?, ?, ?)')
      .bind(userId, publicKey, envelope.iv, envelope.ciphertext, Date.now()).run()
  } else {
    result = await db.prepare('UPDATE collection_documents SET version = version + 1, iv = ?, ciphertext = ?, updated_at = ? WHERE user_id = ? AND public_key = ? AND version = ?')
      .bind(envelope.iv, envelope.ciphertext, Date.now(), userId, publicKey, expected).run()
  }
  if (result.meta.changes !== 1) {
    const current = await db.prepare('SELECT version FROM collection_documents WHERE user_id = ?')
      .bind(userId).first<{ version: number }>()
    return json({ error: 'VERSION_CONFLICT', currentVersion: current?.version ?? 0 }, 409)
  }
  return json({ version: expected + 1 })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/collection')) return env.ASSETS.fetch(request)
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return fail('CROSS_ORIGIN', 403)
    if (url.pathname === '/api/collection/challenge' && request.method === 'POST') {
      const body = await readJson(request)
      return body ? createChallenge(env.COLLECTION_DB, body, request.headers.get('CF-Connecting-IP') ?? 'local') : fail('INVALID_BODY', 400)
    }
    if ((url.pathname === '/api/collection/read' && request.method === 'POST')
      || (url.pathname === '/api/collection' && request.method === 'PUT')) {
      const body = await readJson(request)
      if (!body) return fail('INVALID_BODY', 400)
      const auth = await authenticate(request, env.COLLECTION_DB, body)
      if (auth instanceof Response) return auth
      return request.method === 'POST'
        ? readDocument(env.COLLECTION_DB, auth.userId)
        : writeDocument(env.COLLECTION_DB, auth.userId, auth.publicKey, auth.payload)
    }
    return fail('NOT_FOUND', 404)
  },
}
