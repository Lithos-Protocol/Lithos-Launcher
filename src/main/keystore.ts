import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

// A node keystore is a few hundred bytes of JSON.
const MAX_BYTES = 16 * 1024
const HEX_RE = /^[0-9a-f]+$/i
const NAME_RE = /^[\w.-]{1,100}\.json$/i

/**
 * The node opens its keystore with its own encryption settings (Ergo's defaults, which the
 * launcher never changes), not the ones recorded in the file, so the two have to match.
 */
const NODE_ENCRYPTION = { prf: 'HmacSHA256', c: 128000, dkLen: 256 }

const NOT_A_KEYSTORE =
  "That file isn't an Ergo node keystore. It's the .json file in a node's .ergo/wallet/keystore folder."

/**
 * Reads an Ergo node keystore and checks it has the encrypted-secret fields the node expects.
 * Nothing is decrypted here: the node checks the password itself when it unlocks the wallet.
 */
export async function readKeystore(path: string): Promise<string> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Choose a keystore file, not a folder')
  if (info.size > MAX_BYTES) throw new Error(NOT_A_KEYSTORE)
  const text = await readFile(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(NOT_A_KEYSTORE)
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error(NOT_A_KEYSTORE)
  const k = parsed as Record<string, unknown>
  const hex = (key: string, bytes?: number): boolean => {
    const v = k[key]
    return typeof v === 'string' && HEX_RE.test(v) && (bytes === undefined || v.length === bytes * 2)
  }
  const params = k.cipherParams
  if (!hex('cipherText') || !hex('salt') || !hex('iv', 12) || !hex('authTag', 16) || typeof params !== 'object' || !params) {
    throw new Error(NOT_A_KEYSTORE)
  }
  const p = params as Record<string, unknown>
  if (p.prf !== NODE_ENCRYPTION.prf || p.c !== NODE_ENCRYPTION.c || p.dkLen !== NODE_ENCRYPTION.dkLen) {
    throw new Error(
      `This keystore uses non-default encryption settings (${String(p.prf)}, ${String(p.c)} rounds, ` +
        `${String(p.dkLen)}-bit key) that the node can't open.`
    )
  }
  return text
}

/** Keeps the file's own name (the node names keystores <uuid>.json) when it is a plain one. */
export function keystoreFileName(source: string): string {
  const name = basename(source)
  return NAME_RE.test(name) ? name : `${randomUUID()}.json`
}
