import {readFile,writeFile} from 'node:fs/promises';
import {createPDF} from './pdf-document.mjs';
const source=await readFile(new URL('../docs/report.md',import.meta.url),'utf8');
if(process.argv.includes('--browser')) {
  const {chromium}=await import('playwright');const browser=await chromium.launch();
  try {
    const page=await browser.newPage();
    const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let code=false;
    const html=source.split('\n').map(line=>{
      if(line.startsWith('```')){code=!code;return code?'<pre>':'</pre>';}
      if(code)return escape(line)+'\n';
      if(line==='---')return '<div class="break"></div>';
      if(line.startsWith('### '))return `<h3>${escape(line.slice(4))}</h3>`;
      if(line.startsWith('## '))return `<h2>${escape(line.slice(3))}</h2>`;
      if(line.startsWith('# '))return `<h1>${escape(line.slice(2))}</h1>`;
      return line.trim()?`<p>${escape(line.replace(/`/g,''))}</p>`:'';
    }).join('\n');
    const screenshots=[];
    for(const file of ['chromium-light.png','chromium-dark.png','chromium-mobile.png']) {
      try {const data=await readFile(new URL(`../test-results/${file}`,import.meta.url));screenshots.push(`<figure><img src="data:image/png;base64,${data.toString('base64')}"/><figcaption>Captured application: ${escape(file)}</figcaption></figure>`);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    await page.setContent(`<html><head><style>body{font:11px/1.6 Arial;color:#172635}h1{font-size:30px}h2{color:#2563eb;font-size:19px}h3{font-size:14px}p{margin:8px 0}pre{white-space:pre-wrap;font:9px/1.5 monospace}h2,h3{break-after:avoid}.break{break-before:page}figure{break-inside:avoid;margin:20px 0}img{width:100%}figcaption{color:#647383}</style></head><body>${html}${screenshots.length?'<div class="break"></div><h2>Captured UI</h2>'+screenshots.join(''):''}</body></html>`);
    await page.pdf({path:'report.pdf',format:'A4',printBackground:true,margin:{top:'18mm',right:'16mm',bottom:'18mm',left:'16mm'},displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:9px;width:100%;text-align:center;color:#647383">RSA Studio · <span class="pageNumber"></span></div>'});
  }finally{await browser.close();}
}else {
  await writeFile(new URL('../report.pdf',import.meta.url),createPDF(source));
}
console.log('Generated report.pdf from docs/report.md');
