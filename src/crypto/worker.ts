/// <reference lib="webworker" />
import {createCertificate, exportPrivate, generateKeys, importKey, parseCertificate, checkCertificate, type KeySession} from './keys';
import {signDetached, verifyDetached} from './detached';
let keys:KeySession|undefined, certificate='';
const info=()=>keys?{publicPem:keys.publicPem,fingerprint:keys.fingerprint,bits:keys.bits,hasPrivate:!!keys.privateKey,certificate}:null;
self.onmessage=async(event:MessageEvent)=>{
  const {id,action,args}=event.data;
  try {
    let result:unknown;
    switch(action) {
      case 'generate': keys=await generateKeys(args.bits);certificate='';result=info();break;
      case 'import': keys=await importKey(args.pem,args.password);certificate='';result=info();break;
      case 'certificate': if(!keys)throw Error('PRIVATE_REQUIRED');await checkCertificate(parseCertificate(args.pem),keys);certificate=args.pem;result=info();break;
      case 'createCertificate': if(!keys)throw Error('PRIVATE_REQUIRED');certificate=await createCertificate(keys,args.name);result=info();break;
      case 'exportPrivate': if(!keys?.privateKey)throw Error('PRIVATE_REQUIRED');result=await exportPrivate(keys.privateKey,args.password);break;
      case 'sign':
        if(!keys?.privateKey)throw Error('PRIVATE_REQUIRED');
        if(args.mode==='pdf') {if(!certificate)throw Error('CERTIFICATE');const {signPDF}=await import('./pdf');result=await signPDF(args.data,keys,certificate);}
        else result=await signDetached(args.data,keys.privateKey,keys.publicKey);
        break;
      case 'verify':
        if(args.mode==='pdf') {const {verifyPDF}=await import('./pdf');result=await verifyPDF(args.data);}
        else {const verificationKeys=await importKey(args.pem);result=await verifyDetached(args.data,args.signature,verificationKeys.publicKey);}
        break;
      default:throw Error('UNSUPPORTED');
    }
    self.postMessage({id,result});
  } catch(error) {
    const message=error instanceof Error?error.message:'UNKNOWN';
    const code=/^[A-Z_]+$/.test(message)?message:error instanceof DOMException?'CRYPTO':'FORMAT';
    self.postMessage({id,error:code});
  }
};
