/**
 * Shared AES-256-GCM helpers for device secrets (MySQL + JSON file mode).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

function masterKey(): Buffer {
  const raw = process.env.SECRETS_MASTER_KEY || process.env.JWT_SECRET || ''
  if (!raw || raw === 'change-me-in-production') {
    if (!(globalThis as { __hanyeSecretsKeyWarned?: boolean }).__hanyeSecretsKeyWarned) {
      ;(globalThis as { __hanyeSecretsKeyWarned?: boolean }).__hanyeSecretsKeyWarned = true
      console.warn(
        '[secrets] 未设置 SECRETS_MASTER_KEY / JWT_SECRET，使用临时随机密钥（重启后已存密文可能无法解密）。生产环境请配置强密钥。'
      )
    }
    const g = globalThis as { __hanyeSecretsEphemeralKey?: Buffer }
    if (!g.__hanyeSecretsEphemeralKey) g.__hanyeSecretsEphemeralKey = randomBytes(32)
    return g.__hanyeSecretsEphemeralKey
  }
  return createHash('sha256').update(raw).digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(':')
  if (parts[0] !== 'v1' || parts.length !== 4) throw new Error('Invalid secret blob')
  const iv = Buffer.from(parts[1]!, 'base64')
  const tag = Buffer.from(parts[2]!, 'base64')
  const data = Buffer.from(parts[3]!, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function isEncryptedSecretBlob(value: string): boolean {
  return value.startsWith('v1:') && value.split(':').length === 4
}

/** Decrypt if encrypted; otherwise treat as legacy plaintext. */
export function decodeSecretValue(raw: string): string {
  if (isEncryptedSecretBlob(raw)) {
    try {
      return decryptSecret(raw)
    } catch {
      return raw
    }
  }
  return raw
}
