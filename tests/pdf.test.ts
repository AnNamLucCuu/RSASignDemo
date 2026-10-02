import {describe,it,expect,beforeAll} from 'vitest';
import {deflateSync} from 'node:zlib';
import * as pki from 'pkijs';
import {buffer,concat,utf8} from '../src/crypto/bytes';
import {createCertificate,generateKeys,parseCertificate,checkCertificate,type KeySession} from '../src/crypto/keys';
import {PDFDocument,PDFReader,PDFRef,dict,number,serialize} from '../src/crypto/pdf-parser';
import {signPDF,verifyPDF} from '../src/crypto/pdf';
import {samplePDF} from './pdf-fixture';
async function modernPDF() {
  const original=new Uint8Array(samplePDF());const doc=await PDFDocument.load(original);
  const root=dict(await doc.resolve(doc.root));const packed=utf8('1 0 '+serialize(root));const compressed=deflateSync(packed);
  const stream10=concat(utf8(`\n10 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),compressed,utf8('\nendstream\nendobj\n'));
  const offset10=original.length+1,offset11=original.length+stream10.length;
  const entries=[0,1,2,3,4,5,10,11].map(id=>{
    const row=new Uint8Array(7);row[0]=id===0?0:id===1?2:1;
    const offset=id===1?10:id===10?offset10:id===11?offset11:id===0?0:doc.entries.get(id)!.offset;
    row[1]=(offset>>>24)&255;row[2]=(offset>>>16)&255;row[3]=(offset>>>8)&255;row[4]=offset&255;row[5]=id===0?255:0;row[6]=id===0?255:0;return row;
  });
  const predicted=concat(...entries.map((entry,i)=>{const row=new Uint8Array(8);row[0]=2;for(let j=0;j<7;j++)row[j+1]=(entry[j]-(i?entries[i-1][j]:0))&255;return row;}));
  const xref=deflateSync(predicted);
  const stream11=concat(utf8(`11 0 obj\n<< /Type /XRef /Size 12 /Root 1 0 R /W [1 4 2] /Index [0 6 10 2] /Length ${xref.length} /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> >>\nstream\n`),xref,utf8(`\nendstream\nendobj\nstartxref\n${offset11}\n%%EOF\n`));
  return buffer(concat(original,stream10,stream11));
}
function appendRevision(original:ArrayBuffer,doc:PDFDocument,extraTrailer='') {
  const id=number(doc.trailer.get('Size'));
  const object=`\n${id} 0 obj\n<< /Producer (Untrusted subsequent edit) >>\nendobj\n`;
  const xref=original.byteLength+utf8(object).length;
  const text=object+`xref\n${id} 1\n${String(original.byteLength+1).padStart(10,'0')} 00000 n \ntrailer\n<< /Size ${id+1} /Root ${serialize(doc.root)} /Prev ${doc.xref} /Info ${id} 0 R ${extraTrailer} >>\nstartxref\n${xref}\n%%EOF\n`;
  return buffer(concat(new Uint8Array(original),utf8(text)));
}
describe('bounded PDF structure and coverage',()=>{
  let keys:KeySession,certificate:string;
  beforeAll(async()=>{keys=await generateKeys(2048);certificate=await createCertificate(keys,'PDF Structure Test');});
  it('reads and signs Flate xref streams with PNG predictors and compressed catalog objects',async()=>{
    const modern=await modernPDF();const doc=await PDFDocument.load(new Uint8Array(modern));expect(doc.entries.get(1)?.kind).toBe(2);
    const signed=await signPDF(modern,keys,certificate);expect((await verifyPDF(signed))[0].valid).toBe(true);
  });
  it('reports valid earlier signatures without authenticating appended revisions',async()=>{
    const signed=await signPDF(samplePDF(),keys,certificate);const doc=await PDFDocument.load(new Uint8Array(signed));
    const changed=appendRevision(signed,doc);const result=(await verifyPDF(changed))[0];
    expect(result).toMatchObject({valid:true,modifiedAfterSigning:true,trust:'unverified'});expect(result.totalBytes).toBe(changed.byteLength);
  });
  it('rejects encryption and hybrid cross references explicitly',async()=>{
    const data=samplePDF(),doc=await PDFDocument.load(new Uint8Array(data));
    await expect(signPDF(appendRevision(data,doc,'/Encrypt 50 0 R'),keys,certificate)).rejects.toThrow('PDF_ENCRYPTED');
    await expect(signPDF(appendRevision(data,doc,'/XRefStm 42'),keys,certificate)).rejects.toThrow('UNSUPPORTED');
  });
  it('does not discover fake signatures embedded in text streams',async()=>{
    const data=samplePDF(),doc=await PDFDocument.load(new Uint8Array(data));
    expect(await doc.signatures()).toEqual([]);
    // Object references, not textual patterns, govern resolution.
    expect(()=>new PDFReader(utf8('<< /ByteRange [0 20 30 40] /ByteRange [0 1 2 3] >>')).value()).toThrow('PDF_STRUCTURE');
  });
  it('checks object generation numbers even when the object is cached',async()=>{
    const doc=await PDFDocument.load(new Uint8Array(samplePDF()));await doc.resolve(doc.root);
    await expect(doc.resolve(new PDFRef(doc.root.id,1))).rejects.toThrow('PDF_STRUCTURE');
  });
  it('reports expired certificates during verification and prevents signing with them',async()=>{
    const cert=parseCertificate(certificate);cert.notAfter.value=new Date('2020-01-01');await cert.sign(keys.privateKey!,'SHA-256');
    await expect(checkCertificate(cert,keys)).rejects.toThrow('CERT_EXPIRED');
    expect(cert).toBeInstanceOf(pki.Certificate);
  });
  it('rejects recursive object references, malformed hex and unsupported filters',async()=>{
    expect(()=>new PDFReader(utf8('<xz>')).value()).toThrow('FORMAT');
    const doc=await PDFDocument.load(new Uint8Array(samplePDF()));
    await expect(doc.decodeStream(new Map([['Filter',new (await import('../src/crypto/pdf-parser')).PDFName('LZWDecode')]]),utf8('bytes'))).rejects.toThrow('UNSUPPORTED');
  });
});
