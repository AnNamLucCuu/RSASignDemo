// @vitest-environment jsdom
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {render,fireEvent,screen,waitFor,cleanup,configure} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {Blob as NodeBlob,File as NodeFile} from 'node:buffer';
import {URL as NodeURL} from 'node:url';
import App from '../src/App';
import {samplePDF} from './pdf-fixture';
vi.mock('../src/service',()=>import('./test-service'));
configure({asyncUtilTimeout:10000});
beforeEach(()=>{
  localStorage.clear();location.hash='';
  vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',NodeBlob);vi.stubGlobal('File',NodeFile);
  URL.createObjectURL=value=>NodeURL.createObjectURL(value as unknown as NodeBlob);URL.revokeObjectURL=NodeURL.revokeObjectURL;
  Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function startEnglish() {render(<App/>);fireEvent.change(screen.getByLabelText('Ngôn ngữ'),{target:{value:'en'}});}
async function createKeys() {
  fireEvent.click(screen.getByRole('button',{name:'Keys'}));
  fireEvent.change(screen.getByLabelText('RSA key size'),{target:{value:'2048'}});
  fireEvent.click(screen.getByRole('button',{name:'Create keys'}));
  await waitFor(()=>{const error=screen.queryByRole('alert');if(error)throw Error(error.textContent||'UI error');expect(screen.getByText('Keys created. Download and keep your private key before clearing the session.')).toBeTruthy();});
}
const inputFile=(label:string,file:NodeFile)=>fireEvent.change(screen.getByLabelText(label,{selector:'input'}),{target:{files:[file]}});
async function artifact(label:string) {const link=screen.getByRole('link',{name:label});return await fetch(link.getAttribute('href')!).then(r=>r.arrayBuffer());}
describe('UI with the production crypto worker over a Node transport',()=>{
  it('switches language and theme and persists only preferences',()=>{
    startEnglish();expect(screen.getByRole('heading',{level:1}).textContent).toBe('Put integrity on record.');
    fireEvent.change(screen.getByLabelText('Appearance'),{target:{value:'dark'}});expect(document.documentElement.dataset.theme).toBe('dark');
    expect(Object.keys(localStorage).sort()).toEqual(['rsa-language','rsa-theme']);
    fireEvent.change(screen.getByLabelText('Language'),{target:{value:'vi'}});expect(screen.getByRole('heading',{level:1}).textContent).toBe('Ghi nhận sự toàn vẹn.');
  });
  it('creates, signs, exports and verifies, then detects a modified document',async()=>{
    startEnglish();await createKeys();fireEvent.click(screen.getByRole('button',{name:'Download public key'}));
    const publicPem=new TextDecoder().decode(await artifact('Download public key'));
    fireEvent.click(screen.getByRole('button',{name:'Sign'}));
    inputFile('Document',new NodeFile(['Original exact bytes'],'document.txt'));fireEvent.click(screen.getByRole('button',{name:'Sign document'}));
    await screen.findByRole('heading',{name:'Signature created'});const signature=await artifact('Download signature');
    fireEvent.click(screen.getByRole('button',{name:'Verify'}));
    inputFile('Signature file',new NodeFile([new Uint8Array(signature)],'document.signature.json'));
    fireEvent.change(screen.getByLabelText('Public key or certificate'),{target:{value:publicPem}});fireEvent.click(screen.getByRole('button',{name:'Verify signature'}));
    await screen.findByRole('heading',{name:'Signature matches'});
    inputFile('Document',new NodeFile(['Modified exact bytes'],'document.txt'));fireEvent.click(screen.getByRole('button',{name:'Verify signature'}));
    await screen.findByRole('heading',{name:'Signature does not match'});
    expect(Object.keys(localStorage).sort()).toEqual(['rsa-language','rsa-theme']);
  });
  it('creates a certificate, signs a PDF and verifies its embedded signature',async()=>{
    startEnglish();await createKeys();fireEvent.change(screen.getByLabelText('Name on the certificate'),{target:{value:'Browser Flow Test'}});
    fireEvent.click(screen.getByRole('button',{name:'Create self-signed certificate'}));await screen.findByText('Certificate created.');
    fireEvent.click(screen.getByRole('button',{name:'Sign'}));fireEvent.click(screen.getByRole('button',{name:/Embedded PDF/}));
    inputFile('Document',new NodeFile([new Uint8Array(samplePDF())],'document.pdf'));fireEvent.click(screen.getByRole('button',{name:'Sign document'}));
    await screen.findByRole('heading',{name:'Signature created'});const pdf=await artifact('Download signed PDF');
    fireEvent.click(screen.getByRole('button',{name:'Verify'}));inputFile('Document',new NodeFile([new Uint8Array(pdf)],'document.signed.pdf'));
    fireEvent.click(screen.getByRole('button',{name:'Verify signature'}));await screen.findByRole('heading',{name:'Signature matches'});
    expect(screen.getByText('Browser Flow Test')).toBeTruthy();expect(screen.getByText('Identity is not verified')).toBeTruthy();
  });
  it('clears the worker, key, sensitive inputs and artifact links',async()=>{
    startEnglish();await createKeys();fireEvent.click(screen.getByRole('button',{name:'Download public key'}));
    fireEvent.change(screen.getByLabelText('Use a password of at least 12 characters'),{target:{value:'never-store-this'}});
    fireEvent.click(screen.getAllByRole('button',{name:'Clear session'})[0]);
    expect(screen.getByText('No key loaded')).toBeTruthy();expect(screen.queryByRole('link',{name:'Download public key'})).toBeNull();
    expect(screen.queryByLabelText('Use a password of at least 12 characters')).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('never-store-this');
  });
  it('does not leave an older file selected after an oversized upload',async()=>{
    startEnglish();inputFile('Document',new NodeFile(['small'],'previous.txt'));
    inputFile('Document',new NodeFile([new Uint8Array(50*1024*1024+1)],'too-large.bin'));
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('exceeds'));expect(screen.queryByText('previous.txt')).toBeNull();
  });
});
