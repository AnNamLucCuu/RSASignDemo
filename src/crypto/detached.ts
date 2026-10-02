import {base64, buffer, checkSize, digest, unbase64} from './bytes';
import {validateKey} from './keys';
export type DetachedSignature = {version:1; algorithm:'RSA-PSS'; hash:'SHA-256'; mgf:'MGF1-SHA-256'; saltLength:32; fingerprint:string; signature:string};
export async function signDetached(data: ArrayBuffer, privateKey: CryptoKey, publicKey: CryptoKey): Promise<DetachedSignature> {
  checkSize(data); validateKey(privateKey); validateKey(publicKey);
  const signature = await crypto.subtle.sign({name:'RSA-PSS',saltLength:32},privateKey,data);
  if (!await crypto.subtle.verify({name:'RSA-PSS',saltLength:32},publicKey,signature,data)) throw new Error('KEY_MISMATCH');
  return {version:1,algorithm:'RSA-PSS',hash:'SHA-256',mgf:'MGF1-SHA-256',saltLength:32,fingerprint:await digest(await crypto.subtle.exportKey('spki',publicKey)),signature:base64(signature)};
}
export function parseSignature(text:string): DetachedSignature {
  if (text.length > 16384) throw new Error('FORMAT');
  let value; try {value = JSON.parse(text);} catch {throw new Error('FORMAT');}
  if (!value || typeof value !== 'object') throw new Error('FORMAT');
  if (value.version !== 1 || value.algorithm !== 'RSA-PSS' || value.hash !== 'SHA-256' || value.mgf !== 'MGF1-SHA-256' || value.saltLength !== 32) throw new Error('UNSUPPORTED');
  if (typeof value.signature !== 'string' || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new Error('FORMAT');
  unbase64(value.signature); return value;
}
export async function verifyDetached(data: ArrayBuffer, signatureText:string, publicKey: CryptoKey) {
  checkSize(data); validateKey(publicKey); const signature = parseSignature(signatureText);
  const actual = await digest(await crypto.subtle.exportKey('spki',publicKey));
  const bytes = unbase64(signature.signature);
  const valid = bytes.length === (publicKey.algorithm as RsaKeyAlgorithm).modulusLength / 8 && await crypto.subtle.verify({name:'RSA-PSS',saltLength:32}, publicKey, buffer(bytes), data);
  return {valid, fingerprint:actual, fingerprintMatches:actual === signature.fingerprint};
}
