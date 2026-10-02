import * as asn from 'asn1js';
import * as pki from 'pkijs';
import {buffer, checkSize, concat, digest, hex, utf8} from './bytes';
import {certName, certificatePublic, checkCertificate, decodeASN, type KeySession, parseCertificate} from './keys';
import {array, dict, number, PDFDocument, PDFName, PDFRef, PDFString, serialize} from './pdf-parser';

const DATA='1.2.840.113549.1.7.1', SIGNED='1.2.840.113549.1.7.2', SHA256='2.16.840.1.101.3.4.2.1', PSS='1.2.840.113549.1.1.10';
export async function makeCMS(bytes:Uint8Array, key:CryptoKey, cert:pki.Certificate) {
  const messageDigest=await crypto.subtle.digest('SHA-256',buffer(bytes));
  const signedData=new pki.SignedData({version:1,encapContentInfo:new pki.EncapsulatedContentInfo({eContentType:DATA}),certificates:[cert],signerInfos:[new pki.SignerInfo({version:1,sid:new pki.IssuerAndSerialNumber({issuer:cert.issuer,serialNumber:cert.serialNumber}),signedAttrs:new pki.SignedAndUnsignedAttributes({type:0,attributes:[
    new pki.Attribute({type:'1.2.840.113549.1.9.3',values:[new asn.ObjectIdentifier({value:DATA})]}),
    new pki.Attribute({type:'1.2.840.113549.1.9.4',values:[new asn.OctetString({valueHex:messageDigest})]}),
  ]})})]});
  await signedData.sign(key,0,'SHA-256',buffer(bytes));
  return new Uint8Array(new pki.ContentInfo({contentType:SIGNED,content:signedData.toSchema(true)}).toSchema().toBER(false));
}
export async function signPDF(data:ArrayBuffer, keys:KeySession, certificate:string) {
  checkSize(data);if(!keys.privateKey)throw Error('PRIVATE_REQUIRED');const cert=parseCertificate(certificate);await checkCertificate(cert,keys);
  const original=new Uint8Array(data),doc=await PDFDocument.load(original);
  if((await doc.signatures()).length)throw Error('PDF_ALREADY_SIGNED');
  const root=new Map(dict(await doc.resolve(doc.root)));
  if(root.has('Perms'))throw Error('PDF_ALREADY_SIGNED');
  const oldForm=root.has('AcroForm')?dict(await doc.resolve(root.get('AcroForm'))):new Map();
  if(oldForm.has('XFA'))throw Error('UNSUPPORTED');
  const fields=oldForm.has('Fields')?array(await doc.resolve(oldForm.get('Fields'))):[];
  let next=Math.max(number(doc.trailer.get('Size')),...doc.entries.keys())+1;
  const sigId=next++,fieldId=next++,formId=next++;
  const newForm=new Map(oldForm);newForm.set('Fields',[...fields,new PDFRef(fieldId)]);newForm.set('SigFlags',3);
  root.set('AcroForm',new PDFRef(formId));
  const placeholder='0'.repeat(32768);
  const range='[0 0000000000 0000000000 0000000000]';
  const prefix=`\n${sigId} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange ${range} /Contents <`;
  const offsets: {id:number;generation:number;offset:number}[]=[{id:sigId,generation:0,offset:original.length+1}];
  let addition=prefix+placeholder+'> >>\nendobj\n';
  const append=(id:number,generation:number,value:string)=>{offsets.push({id,generation,offset:original.length+utf8(addition).length});addition+=`${id} ${generation} obj\n${value}\nendobj\n`;};
  append(fieldId,0,`<< /FT /Sig /T (RSAStudioSignature) /V ${sigId} 0 R >>`);
  append(formId,0,serialize(newForm));append(doc.root.id,doc.root.generation,serialize(root));
  const xref=original.length+utf8(addition).length;
  addition+='xref\n';for(const item of offsets.sort((a,b)=>a.id-b.id))addition+=`${item.id} 1\n${String(item.offset).padStart(10,'0')} ${String(item.generation).padStart(5,'0')} n \n`;
  const trailer=new Map<string,import('./pdf-parser').PDFValue>([['Size',next],['Root',doc.root],['Prev',doc.xref]]);
  for(const name of ['ID','Info'])if(doc.trailer.has(name))trailer.set(name,doc.trailer.get(name)!);
  addition+=`trailer\n${serialize(trailer)}\nstartxref\n${xref}\n%%EOF\n`;
  const bytes=concat(original,utf8(addition));const contentsStart=original.length+utf8(prefix).length-1,contentsEnd=contentsStart+placeholder.length+2;
  const actual=`[0 ${String(contentsStart).padStart(10,'0')} ${String(contentsEnd).padStart(10,'0')} ${String(bytes.length-contentsEnd).padStart(10,'0')}]`;
  bytes.set(utf8(actual),original.length+prefix.indexOf(range));
  const cms=await makeCMS(concat(bytes.subarray(0,contentsStart),bytes.subarray(contentsEnd)),keys.privateKey,cert);
  const encoded=hex(cms);if(encoded.length>placeholder.length)throw Error('CERTIFICATE');bytes.set(utf8(encoded),contentsStart+1);
  // Verify our output before handing a signed file to the user.
  const verified=await verifyPDF(buffer(bytes));if(!verified[0]?.valid||verified[0].modifiedAfterSigning)throw Error('PDF_STRUCTURE');
  return buffer(bytes);
}
export type PDFVerification={valid:boolean;modifiedAfterSigning:boolean;coveredBytes:number;totalBytes:number;name:string;fingerprint:string;certificateStatus:'current'|'expired'|'not-yet-valid';trust:'unverified';algorithm:string};
export async function verifyPDF(data:ArrayBuffer):Promise<PDFVerification[]> {
  checkSize(data);const bytes=new Uint8Array(data),doc=await PDFDocument.load(bytes);const signatures=await doc.signatures();
  if(!signatures.length)throw Error('PDF_UNSIGNED');const results:PDFVerification[]=[];
  for(const sig of signatures) {
    const filter=sig.get('SubFilter');if(!(filter instanceof PDFName)||!['adbe.pkcs7.detached','ETSI.CAdES.detached'].includes(filter.value))throw Error('UNSUPPORTED');
    const range=array(sig.get('ByteRange')).map(number);if(range.length!==4||range[0]!==0||range[1]>=range[2]||range[2]+range[3]>bytes.length)throw Error('PDF_BYTERANGE');
    const contents=sig.get('Contents');
    if(!(contents instanceof PDFString)||!contents.isHex||contents.start!==range[1]||contents.end!==range[2])throw Error('PDF_BYTERANGE');
    const decoded=asn.fromBER(buffer(contents.bytes));if(decoded.offset===-1||decoded.offset>contents.bytes.length||contents.bytes.subarray(decoded.offset).some(n=>n!==0))throw Error('FORMAT');
    const cms=new pki.ContentInfo({schema:decoded.result});if(cms.contentType!==SIGNED)throw Error('UNSUPPORTED');
    const signed=new pki.SignedData({schema:cms.content});
    if(signed.signerInfos.length!==1||signed.encapContentInfo.eContentType!==DATA||signed.encapContentInfo.eContent)throw Error('UNSUPPORTED');
    const signer=signed.signerInfos[0];if(signer.digestAlgorithm.algorithmId!==SHA256)throw Error('UNSUPPORTED');
    const alg=signer.signatureAlgorithm.algorithmId;
    if(alg===PSS) {
      const params=new pki.RSASSAPSSParams({schema:signer.signatureAlgorithm.algorithmParams});
      if(params.hashAlgorithm.algorithmId!==SHA256||params.maskGenAlgorithm.algorithmId!=='1.2.840.113549.1.1.8'||!params.maskGenAlgorithm.algorithmParams||new pki.AlgorithmIdentifier({schema:params.maskGenAlgorithm.algorithmParams}).algorithmId!==SHA256||params.saltLength<0||params.saltLength>32||params.trailerField!==1)throw Error('UNSUPPORTED');
    } else if(!['1.2.840.113549.1.1.1','1.2.840.113549.1.1.11'].includes(alg))throw Error('UNSUPPORTED');
    if(!(signer.sid instanceof pki.IssuerAndSerialNumber))throw Error('UNSUPPORTED');
    const cert=signed.certificates?.find(c=>c instanceof pki.Certificate&&c.serialNumber.isEqual((signer.sid as pki.IssuerAndSerialNumber).serialNumber)&&c.issuer.isEqual((signer.sid as pki.IssuerAndSerialNumber).issuer));
    if(!(cert instanceof pki.Certificate))throw Error('CERTIFICATE');await certificatePublic(cert);
    const signedBytes=concat(bytes.subarray(0,range[1]),bytes.subarray(range[2],range[2]+range[3]));
    let valid=false;try {valid=await signed.verify({signer:0,data:buffer(signedBytes),checkChain:false});}catch{valid=false;}
    const now=new Date();results.push({valid,modifiedAfterSigning:range[2]+range[3]!==bytes.length,coveredBytes:range[1]+range[3],totalBytes:bytes.length,name:certName(cert),fingerprint:await digest(cert.subjectPublicKeyInfo.toSchema().toBER(false)),certificateStatus:cert.notBefore.value>now?'not-yet-valid':cert.notAfter.value<now?'expired':'current',trust:'unverified',algorithm:alg===PSS?'RSA-PSS / SHA-256':'RSASSA-PKCS1-v1.5 / SHA-256'});
  }return results;
}
