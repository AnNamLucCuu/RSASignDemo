import {beforeAll,describe,it,expect} from 'vitest';
import {generateKeys,importKey,exportPrivate,createCertificate,parseCertificate,checkCertificate,type KeySession} from '../src/crypto/keys';
import {signDetached,verifyDetached,parseSignature} from '../src/crypto/detached';
import {buffer,utf8,readPem} from '../src/crypto/bytes';
import {signPDF,verifyPDF} from '../src/crypto/pdf';
import {PDFDocument} from '../src/crypto/pdf-parser';
import {samplePDF} from './pdf-fixture';
describe('RSA profile and keys',()=>{
  let keys:KeySession,other:KeySession;
  beforeAll(async()=>{keys=await generateKeys(2048);other=await generateKeys(2048);});
  it('signs and verifies raw bytes; detects tampering and wrong keys',async()=>{
    const data=buffer(utf8('Document\r\nUTF-8: tài liệu'));const sig=JSON.stringify(await signDetached(data,keys.privateKey!,keys.publicKey));
    expect((await verifyDetached(data,sig,keys.publicKey)).valid).toBe(true);
    expect((await verifyDetached(buffer(utf8('edited')),sig,keys.publicKey)).valid).toBe(false);
    expect((await verifyDetached(data,sig,other.publicKey)).valid).toBe(false);
    const modified=JSON.parse(sig);modified.fingerprint='0'.repeat(64);
    expect(await verifyDetached(data,JSON.stringify(modified),keys.publicKey)).toMatchObject({valid:true,fingerprintMatches:false});
  });
  it('rejects malformed signatures and unsupported profiles',()=>{
    expect(()=>parseSignature('{')).toThrow('FORMAT');
    expect(()=>parseSignature('{"version":2}')).toThrow('UNSUPPORTED');
  });
  it('round trips plaintext and encrypted PKCS#8, rejects wrong passwords',async()=>{
    const plain=await exportPrivate(keys.privateKey!);expect((await importKey(plain)).fingerprint).toBe(keys.fingerprint);
    const encrypted=await exportPrivate(keys.privateKey!,'test-password');expect(readPem(encrypted).label).toBe('ENCRYPTED PRIVATE KEY');
    expect((await importKey(encrypted,'test-password')).fingerprint).toBe(keys.fingerprint);
    await expect(importKey(encrypted,'incorrect')).rejects.toThrow('PASSWORD');
    expect((await importKey(keys.publicPem)).privateKey).toBeUndefined();
  });
  it.each([3072,4096])('supports %i bit keys',async bits=>{const generated=await generateKeys(bits);const sig=JSON.stringify(await signDetached(new ArrayBuffer(0),generated.privateKey!,generated.publicKey));expect((await verifyDetached(new ArrayBuffer(0),sig,generated.publicKey)).valid).toBe(true);});
  it('rejects weak keys',async()=>{const pair=await crypto.subtle.generateKey({name:'RSA-PSS',modulusLength:1024,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);await expect(importKey(await exportPrivate(pair.privateKey))).rejects.toThrow('KEY_POLICY');});
  it('checks self-signed certificates and key matching',async()=>{
    const cert=await createCertificate(keys,'Test Signer');await checkCertificate(parseCertificate(cert),keys);
    expect(await parseCertificate(cert).verify()).toBe(true);
    await expect(checkCertificate(parseCertificate(cert),other)).rejects.toThrow('KEY_MISMATCH');
  });
  it('signs a PDF, detects tampering, refuses repeat signing',async()=>{
    const cert=await createCertificate(keys,'PDF Signer');const signed=await signPDF(samplePDF(),keys,cert);
    expect((await verifyPDF(signed))[0]).toMatchObject({valid:true,modifiedAfterSigning:false,trust:'unverified',name:'PDF Signer'});
    const changed=new Uint8Array(signed.slice(0));const marker=new TextDecoder().decode(changed).indexOf('RSA Studio test document');changed[marker]=88;
    expect((await verifyPDF(buffer(changed)))[0].valid).toBe(false);
    await expect(signPDF(signed,keys,cert)).rejects.toThrow('PDF_ALREADY_SIGNED');
  });
  it('rejects unsigned, malformed and invalid ByteRange PDFs',async()=>{
    await expect(verifyPDF(samplePDF())).rejects.toThrow('PDF_UNSIGNED');
    await expect(PDFDocument.load(utf8('not a pdf'))).rejects.toThrow('PDF_STRUCTURE');
    const signed=new Uint8Array(await signPDF(samplePDF(),keys,await createCertificate(keys,'Test')));
    const text=new TextDecoder().decode(signed);const marker=text.indexOf('/ByteRange [0 ')+13;signed[marker]=49;
    await expect(verifyPDF(buffer(signed))).rejects.toThrow('PDF_BYTERANGE');
  });
});
