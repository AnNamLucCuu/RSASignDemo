export const MAX_FILE = 50 * 1024 * 1024;
export function buffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  return data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
}
export function base64(data: Uint8Array | ArrayBuffer): string {
  const bytes = new Uint8Array(data); let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function unbase64(text: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) || !text) throw new Error('FORMAT');
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
export function pem(label: string, data: ArrayBuffer): string {
  return `-----BEGIN ${label}-----\n${base64(data).match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`;
}
export function readPem(text: string): {label: string; data: ArrayBuffer} {
  const match = text.trim().match(/^-----BEGIN ([A-Z0-9 ]+)-----\s+([A-Za-z0-9+/=\s]+)-----END \1-----$/);
  if (!match || text.length > 1024 * 1024) throw new Error('PEM');
  return {label: match[1], data: buffer(unbase64(match[2].replace(/\s/g, '')))};
}
export const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (text: string) => {
  if (!/^(?:[a-fA-F0-9]{2})*$/.test(text)) throw new Error('FORMAT');
  return Uint8Array.from(text.match(/../g) || [], s => parseInt(s, 16));
};
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) {out.set(part, offset); offset += part.length;} return out;
}
export const utf8 = (text: string) => new TextEncoder().encode(text);
export function checkSize(data: ArrayBuffer | Uint8Array) {if (data.byteLength > MAX_FILE) throw new Error('SIZE');}
export async function digest(data: ArrayBuffer | Uint8Array) {return hex(await crypto.subtle.digest('SHA-256', buffer(data)));}
