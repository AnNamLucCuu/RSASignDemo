import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
import {createPDF} from './pdf-document.mjs';

await mkdir('test-results',{recursive:true});
const root=path.resolve('dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try {
    let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.startsWith('/demo/'))pathname=pathname.slice(5);
    if(pathname.endsWith('/'))pathname+='index.html';
    const target=path.resolve(root,'.'+pathname);
    if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    const data=await readFile(target);res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');res.end(data);
  }catch{res.writeHead(404).end();}
});
const results=[];
try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address(),base=`http://127.0.0.1:${address.port}`;
  for(const [name,type]of Object.entries({chromium,firefox,webkit})) {
    let browser;
    try {
      browser=await type.launch();const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1080}});const page=await context.newPage();page.setDefaultTimeout(15000);
      const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));context.on('request',req=>requests.push({url:req.url(),method:req.method()}));
      await page.goto(base+'/');await page.getByLabel('Ngôn ngữ').selectOption('en');await page.getByLabel('Appearance').selectOption('light');
      await page.screenshot({path:`test-results/${name}-light.png`,fullPage:true});
      await page.getByRole('button',{name:'Keys',exact:true}).click();await page.getByLabel('RSA key size').selectOption('2048');await page.getByRole('button',{name:'Create keys',exact:true}).click();await page.getByText('Keys created. Download and keep your private key before clearing the session.').waitFor();
      const folder=path.resolve('test-results',name);await mkdir(folder,{recursive:true});
      const download=async(label,file)=>{const waiting=page.waitForEvent('download');await page.getByRole('link',{name:label,exact:true}).click();const downloaded=await waiting;await downloaded.saveAs(path.join(folder,file));return path.join(folder,file);};
      await page.getByRole('button',{name:'Download public key',exact:true}).click();const pub=await download('Download public key','public.pem');
      await page.getByRole('button',{name:'Unencrypted PEM',exact:true}).click();await page.getByRole('button',{name:'Export private key',exact:true}).click();await page.getByRole('link',{name:'Download private key'}).waitFor();const priv=await download('Download private key','private.pem');
      await page.getByRole('button',{name:'Clear session',exact:true}).click();await page.getByLabel('Key PEM').fill(await readFile(priv,'utf8'));await page.getByRole('button',{name:'Import key',exact:true}).click();await page.getByText('Key imported.').waitFor();
      await page.getByLabel('Name on the certificate').fill('Browser Verification');await page.getByRole('button',{name:'Create self-signed certificate',exact:true}).click();await page.getByText('Certificate created.').waitFor();
      await page.getByRole('button',{name:'Sign',exact:true}).click();await page.getByLabel('Document',{exact:true}).setInputFiles({name:'document.txt',mimeType:'text/plain',buffer:Buffer.from('Exact original document bytes.')});await page.getByRole('button',{name:'Sign document',exact:true}).click();await page.getByRole('heading',{name:'Signature created',exact:true}).waitFor();const signature=await download('Download signature','signature.json');
      await page.getByRole('button',{name:'Verify',exact:true}).click();await page.getByLabel('Signature file',{exact:true}).setInputFiles(signature);await page.getByLabel('Public key or certificate',{exact:true}).fill(await readFile(pub,'utf8'));await page.getByRole('button',{name:'Verify signature',exact:true}).click();await page.getByRole('heading',{name:'Signature matches',exact:true}).waitFor();
      await page.getByLabel('Document',{exact:true}).setInputFiles({name:'document.txt',mimeType:'text/plain',buffer:Buffer.from('Tampered bytes.')});await page.getByRole('button',{name:'Verify signature',exact:true}).click();await page.getByRole('heading',{name:'Signature does not match',exact:true}).waitFor();
      await page.getByRole('button',{name:'Sign',exact:true}).click();await page.getByRole('button',{name:/Embedded PDF/}).click();await page.getByLabel('Document',{exact:true}).setInputFiles({name:'document.pdf',mimeType:'application/pdf',buffer:createPDF('# Browser test\n\nIndependent UI end-to-end fixture.')});await page.getByRole('button',{name:'Sign document',exact:true}).click();await page.getByRole('heading',{name:'Signature created',exact:true}).waitFor();const signed=await download('Download signed PDF','signed.pdf');
      await page.getByRole('button',{name:'Verify',exact:true}).click();await page.getByLabel('Document',{exact:true}).setInputFiles(signed);await page.getByRole('button',{name:'Verify signature',exact:true}).click();await page.getByRole('heading',{name:'Signature matches',exact:true}).waitFor();
      await page.getByLabel('Appearance').selectOption('dark');await page.screenshot({path:`test-results/${name}-dark.png`,fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:`test-results/${name}-mobile.png`,fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile layout must not overflow');
      assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).sort()),['rsa-language','rsa-theme']);
      await page.getByRole('button',{name:'Clear session',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Sign document'}).waitFor({state:'visible'}).catch(()=>{});
      assert.ok(await page.getByRole('button',{name:'Verify signature'}).isDisabled());
      await page.goto(base+'/demo/#keys');await page.getByRole('heading',{name:'Your signature starts here.',exact:true}).waitFor();await page.getByLabel('RSA key size').selectOption('2048');await page.getByRole('button',{name:'Create keys',exact:true}).click();await page.getByText('Keys created. Download and keep your private key before clearing the session.').waitFor();
      assert.deepEqual(errors,[]);assert.ok(requests.every(req=>req.method==='GET'&&req.url.startsWith(base)),'No document upload or third-party request');
      results.push({browser:name,status:'passed',scenarios:['keys','import/export','detached signing','tampering','PDF signing/verification','themes','mobile','temporary session','subpath','no uploads']});
    }catch(error){results.push({browser:name,status:'failed',error:error.message});process.exitCode=1;}
    finally{await browser?.close();}
  }
}catch(error){results.push({status:'blocked',error:error.message});process.exitCode=1;}
finally{if(server.listening)await new Promise(resolve=>server.close(resolve));await writeFile('test-results/browser-results.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));}
