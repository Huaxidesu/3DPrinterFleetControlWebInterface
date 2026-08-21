/**
 * Encrypted secrets.json for file-storage mode (AES-256-GCM via secretCrypto).
 * Legacy plaintext maps are migrated on next write.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { decodeSecretValue, encryptSecret } from './secretCrypto'

export function loadFileSecrets(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const map =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? ((raw as { secrets?: unknown }).secrets &&
          typeof (raw as { secrets: unknown }).secrets === 'object' &&
          !Array.isArray((raw as { secrets: unknown }).secrets)
            ? ((raw as { secrets: Record<string, unknown> }).secrets as Record<string, unknown>)
            : (raw as Record<string, unknown>))
        : {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(map)) {
      if (k === '__format' || k === 'secrets') continue
      if (typeof v !== 'string' || !v) continue
      out[k] = decodeSecretValue(v)
    }
    return out
  } catch {
    return {}
  }
}

export function saveFileSecrets(path: string, secrets: Record<string, string>): void {
  const enc: Record<string, string> = {}
  for (const [k, v] of Object.entries(secrets)) {
    if (!k || typeof v !== 'string') continue
    enc[k] = encryptSecret(v)
  }
  writeFileSync(
    path,
    JSON.stringify({ __format: 'enc-v1', secrets: enc }, null, 2),
    'utf8'
  )
}
