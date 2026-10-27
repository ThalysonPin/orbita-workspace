import { IntegrationError } from "./integration-config";

export type Encrypted = { iv: string; ciphertext: string };
const encoder = new TextEncoder();
const storeError = () => new Error("Invalid encryption input");
const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
export const randomOpaque = (bytes = 32): string => toBase64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function stateHash(state: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(state))), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function aad(ownerId: string, provider: string, companyId: string, purpose = "credentials"): Uint8Array<ArrayBuffer> { return encoder.encode(JSON.stringify(["orbita:v1", ownerId, provider, companyId, purpose])); }
export async function credentialsKey(encoded: unknown): Promise<CryptoKey> {
  try {
    if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw storeError();
    const bytes = fromBase64(encoded); if (bytes.length !== 32) throw storeError();
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch { throw new IntegrationError("encryption_unavailable", "A proteção das credenciais precisa ser configurada no servidor.", 503); }
}
export async function encryptIntegration(value: unknown, key: CryptoKey, ownerId: string, provider: string, companyId: string, purpose?: string): Promise<Encrypted> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(ownerId, provider, companyId, purpose), tagLength: 128 }, key, encoder.encode(JSON.stringify(value)));
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}
export async function decryptIntegration<T>(encrypted: Encrypted, key: CryptoKey, ownerId: string, provider: string, companyId: string, purpose?: string): Promise<T> {
  try {
    const iv = fromBase64(encrypted.iv); if (iv.length !== 12) throw storeError();
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(ownerId, provider, companyId, purpose), tagLength: 128 }, key, fromBase64(encrypted.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch { throw new IntegrationError("credentials_unreadable", "Não foi possível abrir as credenciais protegidas. Verifique a chave do servidor.", 503); }
}
