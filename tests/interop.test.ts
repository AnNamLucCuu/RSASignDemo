import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import * as asn from 'asn1js';
import {generateKeys,exportPrivate,importKey,createCertificate,type KeySession} from '../src/crypto/keys';
import {signDetached,verifyDetached} from '../src/crypto/detached';
import {base64,buffer,unbase64,utf8} from '../src/crypto/bytes';
import {makeCMS,signPDF} from '../src/crypto/pdf';
import {parseCertificate} from '../src/crypto/keys';
import {PDFDocument,PDFString} from '../src/crypto/pdf-parser';
import {samplePDF} from './pdf-fixture';
describe('independent OpenSSL interoperability',()=>{
  let folder:string,keys:KeySession;
  const command=(...args:string[])=>execFileSync('openssl',args,{cwd:folder,encoding:'utf8',env:{...process.env,RSA_TEST_PASSWORD:'interoperability-only-password'}});
  beforeAll(async()=>{folder=await mkdtemp(join(tmpdir(),'rsa-interop-'));keys=await generateKeys(2048);await writeFile(join(folder,'private.pem'),await exportPrivate(keys.privateKey!));await writeFile(join(folder,'public.pem'),keys.publicPem);await writeFile(join(folder,'document.bin'),utf8('Exact bytes\r\n\x00PDF and RSA interoperability.'));});
  afterAll(async()=>{await rm(folder,{recursive:true,force:true});});
  it('OpenSSL verifies a Web Crypto PSS signature',async()=>{
    const data=await readFile(join(folder,'document.bin'));const signature=await signDetached(buffer(data),keys.privateKey!,keys.publicKey);
    await writeFile(join(folder,'signature.bin'),unbase64(signature.signature));
    expect(command('dgst','-sha256','-verify','public.pem','-signature','signature.bin','-sigopt','rsa_padding_mode:pss','-sigopt','rsa_pss_saltlen:32','-sigopt','rsa_mgf1_md:sha256','document.bin')).toContain('Verified OK');
  });
  it('Web Crypto verifies an OpenSSL PSS signature',async()=>{
    command('dgst','-sha256','-sign','private.pem','-sigopt','rsa_padding_mode:pss','-sigopt','rsa_pss_saltlen:32','-sigopt','rsa_mgf1_md:sha256','-out','openssl-signature.bin','document.bin');
    const envelope={version:1,algorithm:'RSA-PSS',hash:'SHA-256',mgf:'MGF1-SHA-256',saltLength:32,fingerprint:keys.fingerprint,signature:base64(await readFile(join(folder,'openssl-signature.bin')))};
    expect((await verifyDetached(buffer(await readFile(join(folder,'document.bin'))),JSON.stringify(envelope),keys.publicKey)).valid).toBe(true);
  });
  it('OpenSSL decrypts the exported encrypted PKCS#8',async()=>{
    await writeFile(join(folder,'encrypted.pem'),await exportPrivate(keys.privateKey!,'interoperability-only-password'));
    command('pkcs8','-in','encrypted.pem','-passin','env:RSA_TEST_PASSWORD','-out','decrypted.pem');
    const output=command('pkey','-in','decrypted.pem','-pubout');expect((await importKey(output)).fingerprint).toBe(keys.fingerprint);
  });
  it('imports encrypted PKCS#8 produced by OpenSSL',async()=>{
    command('pkcs8','-topk8','-in','private.pem','-out','external-encrypted.pem','-v2','aes-256-cbc','-v2prf','hmacWithSHA256','-iter','600000','-passout','env:RSA_TEST_PASSWORD');
    expect((await importKey(await readFile(join(folder,'external-encrypted.pem'),'utf8'),'interoperability-only-password')).fingerprint).toBe(keys.fingerprint);
  });
  it('OpenSSL verifies a self-signed X.509 certificate',async()=>{
    const cert=await createCertificate(keys,'Independent Test');await writeFile(join(folder,'cert.pem'),cert);
    expect(command('verify','-CAfile','cert.pem','cert.pem')).toContain('OK');
  });
  it('OpenSSL verifies the CMS extracted from a signed PDF',async()=>{
    const cert=await createCertificate(keys,'PDF Interoperability');const pdf=await signPDF(samplePDF(),keys,cert);
    const doc=await PDFDocument.load(new Uint8Array(pdf));const sig=(await doc.signatures())[0];
    const contents=sig.get('Contents') as PDFString;const decoded=asn.fromBER(buffer(contents.bytes));
    const ranges=sig.get('ByteRange') as number[];
    const raw=Buffer.from(pdf);const signedBytes=Buffer.concat([raw.subarray(0,ranges[1]),raw.subarray(ranges[2],ranges[2]+ranges[3])]);
    await writeFile(join(folder,'pdf-content.bin'),signedBytes);await writeFile(join(folder,'pdf-cms.der'),contents.bytes.subarray(0,decoded.offset));
    command('cms','-verify','-inform','DER','-in','pdf-cms.der','-content','pdf-content.bin','-binary','-noverify','-out','verified-content.bin');
    expect(await readFile(join(folder,'verified-content.bin'))).toEqual(signedBytes);
  });
  it('OpenSSL verifies standalone CMS without PDF parsing',async()=>{
    const cert=parseCertificate(await createCertificate(keys,'CMS Test'));const data=await readFile(join(folder,'document.bin'));
    await writeFile(join(folder,'cms.der'),await makeCMS(data,keys.privateKey!,cert));
    command('cms','-verify','-inform','DER','-in','cms.der','-content','document.bin','-binary','-noverify','-out','cms-verified.bin');
    expect(await readFile(join(folder,'cms-verified.bin'))).toEqual(data);
  });
});
