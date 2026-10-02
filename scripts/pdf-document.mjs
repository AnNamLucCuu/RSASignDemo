// Dependency-free English report renderer; PDF text uses the standard Helvetica fonts.
const ascii=text=>text.replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,'-').replace(/→/g,'->').replace(/·/g,'/').replace(/…/g,'...').replace(/[^\x20-\x7e\n]/g,'');
const escape=text=>ascii(text).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
function width(text,size,font) {
  if(font==='F3')return text.length*size*.6;
  return [...text].reduce((sum,c)=>sum+(/[ilI.,:;!'|]/.test(c)?.25:/[MW@%]/.test(c)?.85:/[A-Z]/.test(c)?.65:/[mw]/.test(c)?.75:c===' '?.28:.52),0)*size;
}
function wrap(text,size,font,max=493) {
  const lines=[];let line='';
  for(let word of text.split(/\s+/)) {
    while(width(word,size,font)>max) {let split=1;while(width(word.slice(0,split+1),size,font)<max)split++;if(line){lines.push(line);line='';}lines.push(word.slice(0,split));word=word.slice(split);}
    if(width(line+' '+word,size,font)>max&&line){lines.push(line);line='';}
    line+=`${line?' ':''}${word}`;
  }if(line)lines.push(line);return lines;
}
export function createPDF(markdown) {
  const pages=[];let content='',y=758,code=false;
  const draw=(text,x,y,size,font='F1',color='0.1 0.15 0.2')=>`BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj ET\n`;
  const begin=()=>{content='0.15 0.39 0.92 rg 48 790 499 3 re f\n'+draw('RSA STUDIO  /  TECHNICAL REPORT',48,773,8,'F2','0.35 0.42 0.49');y=742;};
  const finish=()=>{if(!content)return;content+='0.88 0.91 0.94 RG 48 42 m 547 42 l S\n'+draw('RSA Studio / Browser-local document signatures',48,28,8,'F1','0.35 0.42 0.49')+draw(String(pages.length+1),535,28,8);pages.push(content);};
  begin();
  const space=(height=10)=>{if(y-height<65){finish();begin();}else y-=height;};
  const print=(text,size=10,font='F1',color='0.1 0.15 0.2',spacing=15)=>{
    for(const line of wrap(ascii(text),size,font)){if(y-spacing<65){finish();begin();}content+=draw(line,48,y,size,font,color);y-=spacing;}
  };
  const lines=markdown.split('\n');
  for(let i=0;i<lines.length;i++) {
    let line=lines[i].trimEnd();
    if(line==='---'){finish();begin();continue;}
    if(line.startsWith('```')){code=!code;space(6);continue;}
    if(!line.trim()){space(7);continue;}
    if(code){print(line,8,'F3','0.15 0.28 0.42',12);continue;}
    if(line.startsWith('# ')){print(line.slice(2),28,'F2','0.1 0.15 0.2',34);space(12);continue;}
    if(line.startsWith('## ')){if(y<130){finish();begin();}space(7);print(line.slice(3),16,'F2','0.15 0.39 0.92',23);space(5);continue;}
    if(line.startsWith('### ')){if(y<110){finish();begin();}space(6);print(line.slice(4),12,'F2',undefined,18);continue;}
    if(line.startsWith('- ')){print('- '+line.slice(2).replace(/`/g,''),10,'F1',undefined,15);space(4);continue;}
    while(i+1<lines.length&&lines[i+1].trim()&&!/^(#|- |---|```)/.test(lines[i+1]))line+=' '+lines[++i].trim();
    print(line.replace(/`/g,'').replace(/\*\*/g,''));space(5);
  }
  finish();
  const objects=['','<< /Type /Catalog /Pages 2 0 R >>','',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'];
  const kids=[];
  for(const stream of pages){const pageId=objects.length;const streamId=pageId+1;kids.push(`${pageId} 0 R`);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${streamId} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);}
  objects[2]=`<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
  let pdf='%PDF-1.7\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets[i]=Buffer.byteLength(pdf);pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
