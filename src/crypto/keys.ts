import * as asn from 'asn1js';
import * as pki from 'pkijs';
import { buffer, readPem, pem, digest, utf8, unbase64 } from './bytes';

pki.setEngine('webcrypto', new pki.CryptoEngine({name: 'webcrypto', crypto, subtle: crypto.subtle}));
export type KeySession = {privateKey?: CryptoKey; publicKey: CryptoKey; publicPem: string; fingerprint: string; bits: number};
export function decodeASN(data: ArrayBuffer) {
  const result = asn.fromBER(data);
  if (result.offset !== data.byteLength || result.offset === -1) throw new Error('FORMAT');
  return result.result;
}
export function validateKey(key: CryptoKey) {
  const alg = key.algorithm as RsaHashedKeyAlgorithm;
  if (alg.name !== 'RSA-PSS' || ![2048, 3072, 4096].includes(alg.modulusLength)) throw new Error('KEY_POLICY');
  let exponent = 0n; for (const n of alg.publicExponent) exponent = exponent * 256n + BigInt(n);
  if (exponent <= 65536n || exponent >= 2n ** 256n || exponent % 2n === 0n) throw new Error('KEY_POLICY');
}
async function session(publicKey: CryptoKey, privateKey?: CryptoKey): Promise<KeySession> {
  validateKey(publicKey); if (privateKey) validateKey(privateKey);
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return { publicKey, privateKey, publicPem: pem('PUBLIC KEY', spki), fingerprint: await digest(spki), bits: (publicKey.algorithm as RsaKeyAlgorithm).modulusLength };
}
export async function generateKeys(bits = 3072): Promise<KeySession> {
  if (![2048,3072,4096].includes(bits)) throw new Error('KEY_POLICY');
  const pair = await crypto.subtle.generateKey({name:'RSA-PSS', modulusLength: bits, publicExponent: new Uint8Array([1,0,1]), hash:'SHA-256'}, true, ['sign','verify']);
  return session(pair.publicKey, pair.privateKey);
}
export function parseCertificate(text: string): pki.Certificate {
  const decoded = readPem(text); if (decoded.label !== 'CERTIFICATE') throw new Error('CERTIFICATE');
  return new pki.Certificate({schema: decodeASN(decoded.data)});
}
export async function certificatePublic(cert: pki.Certificate) {
  const key = await crypto.subtle.importKey('spki', cert.subjectPublicKeyInfo.toSchema().toBER(false), {name:'RSA-PSS',hash:'SHA-256'}, true, ['verify']);
  validateKey(key); return key;
}
export async function importKey(text: string, password = ''): Promise<KeySession> {
  const decoded = readPem(text);
  if (decoded.label === 'PUBLIC KEY' || decoded.label === 'CERTIFICATE') {
    const spki = decoded.label === 'CERTIFICATE' ? parseCertificate(text).subjectPublicKeyInfo.toSchema().toBER(false) : decoded.data;
    const publicKey = await crypto.subtle.importKey('spki', spki, {name:'RSA-PSS',hash:'SHA-256'}, true, ['verify']);
    return session(publicKey);
  }
  if (!['PRIVATE KEY', 'ENCRYPTED PRIVATE KEY'].includes(decoded.label)) throw new Error('PEM');
  let data = decoded.data;
  if (decoded.label === 'ENCRYPTED PRIVATE KEY') {
    if (!password) throw new Error('PASSWORD');
    const bag = new pki.PKCS8ShroudedKeyBag({schema: decodeASN(data)});
    // Bound attacker-controlled PBKDF2 work before attempting decryption.
    if (bag.encryptionAlgorithm.algorithmId !== '1.2.840.113549.1.5.13' || !bag.encryptionAlgorithm.algorithmParams) throw new Error('UNSUPPORTED');
    const params = new pki.PBES2Params({schema: bag.encryptionAlgorithm.algorithmParams});
    if (params.keyDerivationFunc.algorithmId !== '1.2.840.113549.1.5.12' || !params.keyDerivationFunc.algorithmParams) throw new Error('UNSUPPORTED');
    const kdf = new pki.PBKDF2Params({schema: params.keyDerivationFunc.algorithmParams});
    if (kdf.iterationCount < 1 || kdf.iterationCount > 2_000_000) throw new Error('UNSUPPORTED');
    try {
      data = await pki.getCrypto(true).decryptEncryptedContentInfo({password:buffer(utf8(password)), encryptedContentInfo: new pki.EncryptedContentInfo({contentType:'1.2.840.113549.1.7.1',contentEncryptionAlgorithm:bag.encryptionAlgorithm,encryptedContent:bag.encryptedData})});
    } catch { throw new Error('PASSWORD'); }
  }
  let keyInfo:pki.PrivateKeyInfo;
  try {keyInfo = new pki.PrivateKeyInfo({schema:decodeASN(data)});} catch {throw new Error(decoded.label === 'ENCRYPTED PRIVATE KEY'?'PASSWORD':'FORMAT');}
  if(keyInfo.privateKeyAlgorithm.algorithmId !== '1.2.840.113549.1.1.1') throw new Error('UNSUPPORTED');
  const rsa = new pki.RSAPrivateKey({schema:decodeASN(keyInfo.privateKey.valueBlock.valueHexView.slice().buffer)});
  if(rsa.version !== 0 || rsa.otherPrimeInfos?.length) throw new Error('KEY_POLICY');
  const privateKey = await crypto.subtle.importKey('pkcs8', data, {name:'RSA-PSS',hash:'SHA-256'}, true, ['sign']);
  validateKey(privateKey);
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  if (jwk.oth) throw new Error('KEY_POLICY');
  const publicKey = await crypto.subtle.importKey('jwk', {kty:'RSA',n:jwk.n,e:jwk.e,ext:true}, {name:'RSA-PSS',hash:'SHA-256'}, true, ['verify']);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const signature = await crypto.subtle.sign({name:'RSA-PSS',saltLength:32}, privateKey, challenge);
  if (!await crypto.subtle.verify({name:'RSA-PSS',saltLength:32}, publicKey, signature, challenge)) throw new Error('KEY_MISMATCH');
  return session(publicKey, privateKey);
}
export async function exportPrivate(key: CryptoKey, password = '') {
  const data = await crypto.subtle.exportKey('pkcs8', key);
  if (!password) return pem('PRIVATE KEY', data);
  const encrypted = await pki.getCrypto(true).encryptEncryptedContentInfo({password:buffer(utf8(password)),contentEncryptionAlgorithm:{name:'AES-CBC',length:256,iv:crypto.getRandomValues(new Uint8Array(16))},hmacHashAlgorithm:'SHA-256',iterationCount:600000,contentToEncrypt:data,contentType:'1.2.840.113549.1.7.1'});
  const bag = new pki.PKCS8ShroudedKeyBag({encryptionAlgorithm:encrypted.contentEncryptionAlgorithm,encryptedData:encrypted.encryptedContent!});
  return pem('ENCRYPTED PRIVATE KEY', bag.toSchema().toBER(false));
}
export async function checkCertificate(cert: pki.Certificate, keys: KeySession) {
  if (await digest(cert.subjectPublicKeyInfo.toSchema().toBER(false)) !== keys.fingerprint) throw new Error('KEY_MISMATCH');
  const now = new Date(); if (cert.notBefore.value > now || cert.notAfter.value < now) throw new Error('CERT_EXPIRED');
  const usage = cert.extensions?.find(x => x.extnID === '2.5.29.15');
  if (usage) {
    const bits = decodeASN(usage.extnValue.valueBlock.valueHexView.slice().buffer) as asn.BitString;
    if (!(bits.valueBlock.valueHexView[0] & 128)) throw new Error('CERT_USAGE');
  }
}
export async function createCertificate(keys: KeySession, name: string) {
  if (!keys.privateKey || !name.trim() || name.length > 200) throw new Error('NAME');
  const cert = new pki.Certificate(); cert.version = 2;
  const serial = crypto.getRandomValues(new Uint8Array(16)); serial[0] &= 0x7f; serial[0] |= 1;
  cert.serialNumber = new asn.Integer({valueHex: buffer(serial)});
  const cn = new pki.AttributeTypeAndValue({type:'2.5.4.3',value:new asn.Utf8String({value:name.trim()})});
  cert.subject.typesAndValues.push(cn); cert.issuer.typesAndValues.push(cn);
  cert.notBefore.value = new Date(Date.now() - 5 * 60 * 1000);
  cert.notAfter.value = new Date(); cert.notAfter.value.setUTCFullYear(cert.notAfter.value.getUTCFullYear() + 1);
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  cert.extensions = [new pki.Extension({extnID:'2.5.29.19',critical:true,extnValue:new pki.BasicConstraints({cA:false}).toSchema().toBER(false)}),
    new pki.Extension({extnID:'2.5.29.15',critical:true,extnValue:new asn.BitString({valueHex:new Uint8Array([128]).buffer,unusedBits:7}).toBER(false)})];
  await cert.sign(keys.privateKey, 'SHA-256');
  return pem('CERTIFICATE', cert.toSchema(true).toBER(false));
}
export function certName(cert: pki.Certificate) {
  const cn = cert.subject.typesAndValues.find(x => x.type === '2.5.4.3');
  return cn && 'value' in cn.value.valueBlock ? String(cn.value.valueBlock.value) : 'Unknown';
}
// Public JWK values are used only to expose the exponent/modulus, never for signing.
export const jwkBytes = (value: string) => unbase64(value.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-value.length%4)%4));
