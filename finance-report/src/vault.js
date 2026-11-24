// Encrypted credential vault: AES-256-GCM, key derived from a master password with scrypt.
// The plaintext never touches disk. File format: JSON {v, salt, iv, tag, data} (base64).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(password, salt) {
  return crypto.scryptSync(password.normalize('NFKC'), salt, 32, SCRYPT);
}

export function encrypt(obj, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return { v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decrypt(blob, password) {
  const b = (k) => Buffer.from(blob[k], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, b('salt')), b('iv'));
  decipher.setAuthTag(b('tag'));
  try {
    return JSON.parse(Buffer.concat([decipher.update(b('data')), decipher.final()]).toString('utf8'));
  } catch {
    throw new Error('Wrong master password (or the vault file is corrupted).');
  }
}

export class Vault {
  constructor(file) { this.file = file; }
  exists() { return fs.existsSync(this.file); }
  read(password) {
    if (!this.exists()) return {};
    return decrypt(JSON.parse(fs.readFileSync(this.file, 'utf8')), password);
  }
  write(secrets, password) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(encrypt(secrets, password)), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
