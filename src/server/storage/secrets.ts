/**
 * MySQL-backed encrypted device secrets.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { getPool } from '../db/pool'
import { decryptSecret, encryptSecret } from './secretCrypto'

export async function getSecret(secretKey: string): Promise<string | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT value_enc FROM device_secrets WHERE secret_key = ? LIMIT 1',
    [secretKey]
  )
  const blob = rows[0]?.value_enc
  if (!blob) return null
  try {
    return decryptSecret(String(blob))
  } catch {
    return null
  }
}

export async function setSecret(secretKey: string, value: string): Promise<void> {
  await getPool().query(
    'INSERT INTO device_secrets (secret_key, value_enc) VALUES (?, ?) ON DUPLICATE KEY UPDATE value_enc = VALUES(value_enc)',
    [secretKey, encryptSecret(value)]
  )
}

export async function deleteSecret(secretKey: string): Promise<void> {
  await getPool().query('DELETE FROM device_secrets WHERE secret_key = ?', [secretKey])
}

export async function listSecretKeys(): Promise<string[]> {
  const [rows] = await getPool().query<RowDataPacket[]>('SELECT secret_key FROM device_secrets')
  return rows.map((r) => String(r.secret_key))
}

export async function getAllSecretsMap(): Promise<Record<string, string>> {
  const keys = await listSecretKeys()
  const out: Record<string, string> = {}
  for (const k of keys) {
    const v = await getSecret(k)
    if (v != null) out[k] = v
  }
  return out
}
