/* Criptografia do cofre Secrets — 100% no navegador (WebCrypto).
   Derivação: PBKDF2-SHA256 (600k iterações) da senha-mestra + salt →
   chave-mestra MK; HKDF-SHA256 separa MK em:
     EK = chave AES-256-GCM (non-extractable, SÓ memória) — cifra os itens;
     AK = authKey hex — vai ao servidor SÓ para verificação (bcrypt lá).
   O servidor nunca vê senha, MK, EK ou plaintext. Esquecer a senha-mestra
   = itens irrecuperáveis (zero-knowledge de verdade). */

export const KDF_ITERATIONS = 600_000;

export interface SecretField {
  id: string;
  label: string;
  value: string;
  secret: boolean;
}
export interface SecretItem {
  id: string;
  title: string;
  segment: string;
  fields: SecretField[];
}
export interface SecretCipherItem {
  id: string;
  ciphertext: string;
  iv: string;
  created?: number;
  updated?: number;
}

const te = new TextEncoder();
const td = new TextDecoder();

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function novoSalt(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer);
}

export async function deriveKeys(
  password: string,
  saltHex: string,
  iterations: number,
): Promise<{ encKey: CryptoKey; authKey: string }> {
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const mkBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations },
    base,
    256,
  );
  const mk = await crypto.subtle.importKey('raw', mkBits, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('agendamestre/secrets/enc/v1') },
    mk,
    { name: 'AES-GCM', length: 256 },
    false /* non-extractable: a chave não sai nem por inspeção */,
    ['encrypt', 'decrypt'],
  );
  const akBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('agendamestre/secrets/auth/v1') },
    mk,
    256,
  );
  return { encKey, authKey: hex(akBits) };
}

export async function encryptItem(
  encKey: CryptoKey,
  item: Omit<SecretItem, 'id'>,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); /* novo iv a cada gravação */
  const plain = te.encode(JSON.stringify({ title: item.title, segment: item.segment, fields: item.fields }));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, plain);
  return { ciphertext: b64(ct), iv: b64(iv) };
}

export async function decryptItem(encKey: CryptoKey, c: SecretCipherItem): Promise<SecretItem> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(c.iv) },
    encKey,
    fromB64(c.ciphertext),
  );
  const obj = JSON.parse(td.decode(plain));
  return {
    id: c.id,
    title: String(obj?.title ?? ''),
    segment: String(obj?.segment ?? ''),
    fields: Array.isArray(obj?.fields)
      ? obj.fields.map((f: any) => ({
          id: String(f?.id ?? ''),
          label: String(f?.label ?? ''),
          value: String(f?.value ?? ''),
          secret: !!f?.secret,
        }))
      : [],
  };
}
