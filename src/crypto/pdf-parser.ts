// A bounded PDF structural reader. It follows cross-reference tables/streams;
// it never discovers signature dictionaries by matching document text.
import {buffer, concat, fromHex, hex, utf8} from './bytes';
export class PDFName {constructor(public value:string) {}}
export class PDFRef {constructor(public id:number, public generation=0) {}}
export class PDFString {constructor(public bytes:Uint8Array, public start:number, public end:number, public isHex=false) {}}
export type PDFValue = number | boolean | null | PDFName | PDFRef | PDFString | PDFValue[] | Map<string,PDFValue>;
export type PDFDict = Map<string,PDFValue>;
const white = (n:number) => [0,9,10,12,13,32].includes(n);
const delim = (n:number) => white(n) || [40,41,60,62,91,93,123,125,47,37].includes(n);
const latin = (b:Uint8Array) => Array.from(b, n => String.fromCharCode(n)).join('');
export class PDFReader {
  position:number;
  constructor(public bytes:Uint8Array, position=0) {this.position = position;}
  skip() {
    while (this.position < this.bytes.length) {
      if (white(this.bytes[this.position])) {this.position++; continue;}
      if (this.bytes[this.position] === 37) {while(this.position < this.bytes.length && ![10,13].includes(this.bytes[this.position])) this.position++; continue;}
      break;
    }
  }
  token() {this.skip(); const start=this.position; while(this.position<this.bytes.length && !delim(this.bytes[this.position])) this.position++; return latin(this.bytes.subarray(start,this.position));}
  value(depth=0):PDFValue {
    if(depth>64) throw Error('PDF_STRUCTURE'); this.skip(); const start=this.position; const b=this.bytes;
    if(b[start] === 47) {
      this.position++; const begin=this.position; while(this.position<b.length&&!delim(b[this.position])) this.position++;
      return new PDFName(latin(b.subarray(begin,this.position)).replace(/#([0-9a-fA-F]{2})/g, (_,h)=>String.fromCharCode(parseInt(h,16))));
    }
    if(b[start] === 60 && b[start+1] === 60) {
      this.position += 2; const dict:PDFDict=new Map();
      for(let count=0; count<10000; count++) {
        this.skip(); if(b[this.position]===62&&b[this.position+1]===62) {this.position+=2; return dict;}
        const name=this.value(depth+1); if(!(name instanceof PDFName)||dict.has(name.value)) throw Error('PDF_STRUCTURE');
        dict.set(name.value,this.value(depth+1));
      } throw Error('PDF_STRUCTURE');
    }
    if(b[start]===60) {
      this.position++; let text='';
      while(this.position<b.length&&b[this.position]!==62) {if(!white(b[this.position])) text+=String.fromCharCode(b[this.position]); this.position++;}
      if(b[this.position++]!==62) throw Error('PDF_STRUCTURE'); if(text.length%2) text+='0';
      return new PDFString(fromHex(text),start,this.position,true);
    }
    if(b[start]===40) {
      this.position++; let nested=1; const result:number[]=[];
      while(this.position<b.length&&nested) {
        let n=b[this.position++];
        if(n===92) {
          n=b[this.position++]; const escaped:Record<number,number>={110:10,114:13,116:9,98:8,102:12};
          if(n===10) continue; if(n===13) {if(b[this.position]===10)this.position++;continue;}
          if(n>=48&&n<=55) {let digits=String.fromCharCode(n);for(let i=0;i<2&&b[this.position]>=48&&b[this.position]<=55;i++)digits+=String.fromCharCode(b[this.position++]);result.push(parseInt(digits,8)&255);continue;}
          result.push(escaped[n]??n); continue;
        }
        if(n===40) nested++; if(n===41&&!--nested) break;
        if(n===13) {if(b[this.position]===10)this.position++;n=10;}
        result.push(n);
      }
      if(nested)throw Error('PDF_STRUCTURE'); return new PDFString(new Uint8Array(result),start,this.position);
    }
    if(b[start]===91) {
      this.position++; const array:PDFValue[]=[];
      for(let count=0;count<100000;count++){this.skip();if(b[this.position]===93){this.position++;return array;}array.push(this.value(depth+1));}
      throw Error('PDF_STRUCTURE');
    }
    const token=this.token();
    if(token==='true')return true;if(token==='false')return false;if(token==='null')return null;
    if(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      const number=Number(token); if(!Number.isFinite(number))throw Error('PDF_STRUCTURE');
      const saved=this.position;
      if(Number.isSafeInteger(number)&&number>=0) {
        const second=this.token(); if(/^\d+$/.test(second)&&this.token()==='R') return new PDFRef(number,Number(second));
      }
      this.position=saved;return number;
    }
    throw Error('PDF_STRUCTURE');
  }
}
export const dict = (value:PDFValue|undefined):PDFDict => {if(!(value instanceof Map))throw Error('PDF_STRUCTURE');return value;};
export const number = (value:PDFValue|undefined):number => {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('PDF_STRUCTURE');return value;};
export const array = (value:PDFValue|undefined):PDFValue[] => {if(!Array.isArray(value))throw Error('PDF_STRUCTURE');return value;};
export const nameIs=(value:PDFValue|undefined,name:string)=>value instanceof PDFName&&value.value===name;
export function serialize(value:PDFValue):string {
  if(value===null)return 'null';if(typeof value==='number'||typeof value==='boolean')return String(value);
  if(value instanceof PDFName)return '/'+value.value.replace(/[^A-Za-z0-9_.-]/g,c=>'#'+c.charCodeAt(0).toString(16).padStart(2,'0'));
  if(value instanceof PDFRef)return `${value.id} ${value.generation} R`;
  if(value instanceof PDFString)return `<${hex(value.bytes)}>`;
  if(Array.isArray(value))return `[${value.map(serialize).join(' ')}]`;
  return `<< ${Array.from(value,([key,val])=>`${serialize(new PDFName(key))} ${serialize(val)}`).join(' ')} >>`;
}
type Entry={kind:0|1|2; offset:number; generation:number};
export class PDFDocument {
  entries=new Map<number,Entry>(); cache=new Map<number,PDFValue>(); active=new Set<number>();
  trailer:PDFDict=new Map(); xref=0; root!:PDFRef;
  constructor(public bytes:Uint8Array) {}
  static async load(bytes:Uint8Array) {
    if(latin(bytes.subarray(0,8)).indexOf('%PDF-')!==0)throw Error('PDF_STRUCTURE');
    const doc=new PDFDocument(bytes);
    const tail=latin(bytes.subarray(Math.max(0,bytes.length-2048)));
    const match=tail.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
    if(!match)throw Error('PDF_STRUCTURE');doc.xref=Number(match[1]);
    await doc.readXref(doc.xref,new Set());
    if(doc.trailer.has('Encrypt'))throw Error('PDF_ENCRYPTED');
    const root=doc.trailer.get('Root');if(!(root instanceof PDFRef))throw Error('PDF_STRUCTURE');doc.root=root;
    if(!nameIs(dict(await doc.resolve(root)).get('Type'),'Catalog'))throw Error('PDF_STRUCTURE');
    return doc;
  }
  async readXref(offset:number, visited:Set<number>) {
    if(visited.has(offset)||visited.size>=32||offset<0||offset>=this.bytes.length)throw Error('PDF_STRUCTURE');visited.add(offset);
    const reader=new PDFReader(this.bytes,offset); const first=reader.token(); let trailer:PDFDict;
    if(first==='xref') {
      for(let count=0;count<10000;count++) {
        const start=reader.token(); if(start==='trailer')break;
        const size=reader.token();if(!/^\d+$/.test(start)||!/^\d+$/.test(size)||Number(size)>100000)throw Error('PDF_STRUCTURE');
        for(let i=0;i<Number(size);i++) {
          const pos=reader.token(),gen=reader.token(),type=reader.token();
          if(!/^\d+$/.test(pos)||!/^\d+$/.test(gen)||!['n','f'].includes(type))throw Error('PDF_STRUCTURE');
          const id=Number(start)+i;if(!this.entries.has(id))this.entries.set(id,{kind:type==='n'?1:0,offset:Number(pos),generation:Number(gen)});
          if(this.entries.size>100000)throw Error('PDF_STRUCTURE');
        }
        if(count===9999)throw Error('PDF_STRUCTURE');
      }
      trailer=dict(reader.value());
      if(trailer.has('XRefStm'))throw Error('UNSUPPORTED');
    } else {
      const object=await this.indirect(offset);trailer=dict(object.value);
      if(!nameIs(trailer.get('Type'),'XRef'))throw Error('PDF_STRUCTURE');
      const decoded=await this.decodeStream(trailer,object.stream!);
      const widths=array(trailer.get('W')).map(number);if(widths.length!==3||widths.some(n=>n>8)||widths.reduce((s,n)=>s+n,0)===0)throw Error('PDF_STRUCTURE');
      const indices=trailer.has('Index')?array(trailer.get('Index')).map(number):[0,number(trailer.get('Size'))];
      if(indices.length%2)throw Error('PDF_STRUCTURE');let pos=0;
      for(let j=0;j<indices.length;j+=2) {
        if(indices[j+1]>100000)throw Error('PDF_STRUCTURE');
        for(let i=0;i<indices[j+1];i++) {
          const values=widths.map((width,k)=>{let n=width===0&&k===0?1:0;for(let m=0;m<width;m++){if(pos>=decoded.length)throw Error('PDF_STRUCTURE');n=n*256+decoded[pos++];}if(!Number.isSafeInteger(n))throw Error('PDF_STRUCTURE');return n;});
          if(![0,1,2].includes(values[0]))throw Error('PDF_STRUCTURE');const id=indices[j]+i;
          if(!this.entries.has(id))this.entries.set(id,{kind:values[0] as 0|1|2,offset:values[1],generation:values[2]});
          if(this.entries.size>100000)throw Error('PDF_STRUCTURE');
        }
      }
    }
    for(const [key,value]of trailer)if(!this.trailer.has(key))this.trailer.set(key,value);
    if(trailer.has('Prev'))await this.readXref(number(trailer.get('Prev')),visited);
  }
  async indirect(offset:number) {
    const reader=new PDFReader(this.bytes,offset); const id=reader.token(),generation=reader.token();
    if(!/^\d+$/.test(id)||!/^\d+$/.test(generation)||reader.token()!=='obj')throw Error('PDF_STRUCTURE');
    const value=reader.value();reader.skip();const saved=reader.position;
    let stream:Uint8Array|undefined;
    if(reader.token()==='stream') {
      if(this.bytes[reader.position]===13)reader.position++;
      if(this.bytes[reader.position]===10)reader.position++;else throw Error('PDF_STRUCTURE');
      const rawLength=dict(value).get('Length');
      const length=number(rawLength instanceof PDFRef?await this.resolve(rawLength):rawLength);
      if(reader.position+length>this.bytes.length)throw Error('PDF_STRUCTURE');
      stream=this.bytes.slice(reader.position,reader.position+length);reader.position+=length;
      if(reader.token()!=='endstream')throw Error('PDF_STRUCTURE');
    }else reader.position=saved;
    if(reader.token()!=='endobj')throw Error('PDF_STRUCTURE');return {id:Number(id),generation:Number(generation),value,stream};
  }
  async decodeStream(dictionary:PDFDict, bytes:Uint8Array) {
    if(!bytes)throw Error('PDF_STRUCTURE');
    const filter=dictionary.get('Filter'); if(!filter)return bytes;
    if(!(nameIs(filter,'FlateDecode')||(Array.isArray(filter)&&filter.length===1&&nameIs(filter[0],'FlateDecode'))))throw Error('UNSUPPORTED');
    const stream=new Blob([buffer(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'));
    const chunks:Uint8Array[]=[];let total=0;const reader=stream.getReader();
    for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>64*1024*1024){await reader.cancel();throw Error('SIZE');}chunks.push(value);}
    const result=concat(...chunks);let params=dictionary.get('DecodeParms');if(Array.isArray(params))params=params[0];
    if(!params||params===null)return result;const p=dict(params);const predictor=p.has('Predictor')?number(p.get('Predictor')):1;
    if(predictor===1)return result;
    if(predictor<10||predictor>15||(p.has('Colors')&&number(p.get('Colors'))!==1)||(p.has('BitsPerComponent')&&number(p.get('BitsPerComponent'))!==8))throw Error('UNSUPPORTED');
    const columns=p.has('Columns')?number(p.get('Columns')):1;
    if(columns<1||columns>100000||result.length%(columns+1))throw Error('PDF_STRUCTURE');
    const output=new Uint8Array(result.length/(columns+1)*columns);
    for(let row=0;row<result.length/(columns+1);row++) {
      const mode=result[row*(columns+1)];if(mode>4)throw Error('PDF_STRUCTURE');
      for(let col=0;col<columns;col++) {
        const idx=row*columns+col,left=col?output[idx-1]:0,up=row?output[idx-columns]:0,ul=row&&col?output[idx-columns-1]:0;
        const pred=mode===0?0:mode===1?left:mode===2?up:mode===3?Math.floor((left+up)/2):(()=>{const s=left+up-ul,a=Math.abs(s-left),b=Math.abs(s-up),c=Math.abs(s-ul);return a<=b&&a<=c?left:b<=c?up:ul;})();
        output[idx]=(result[row*(columns+1)+1+col]+pred)&255;
      }
    }return output;
  }
  async resolve(value:PDFValue|undefined):Promise<PDFValue> {
    if(value===undefined)throw Error('PDF_STRUCTURE');if(!(value instanceof PDFRef))return value;
    const cachedEntry=this.entries.get(value.id);
    if(!cachedEntry||cachedEntry.kind===0||(cachedEntry.kind===1?cachedEntry.generation!==value.generation:value.generation!==0))throw Error('PDF_STRUCTURE');
    if(this.cache.has(value.id))return this.cache.get(value.id)!;
    if(this.active.has(value.id)||this.active.size>64)throw Error('PDF_STRUCTURE');this.active.add(value.id);
    try {
      const entry=this.entries.get(value.id);if(!entry||entry.kind===0)throw Error('PDF_STRUCTURE');let resolved:PDFValue;
      if(entry.kind===1) {
        if(entry.generation!==value.generation)throw Error('PDF_STRUCTURE');const object=await this.indirect(entry.offset);
        if(object.id!==value.id||object.generation!==value.generation)throw Error('PDF_STRUCTURE');resolved=object.value;
      } else {
        if(value.generation!==0)throw Error('PDF_STRUCTURE');const owner=this.entries.get(entry.offset);if(!owner||owner.kind!==1)throw Error('PDF_STRUCTURE');
        const object=await this.indirect(owner.offset);const d=dict(object.value);if(!nameIs(d.get('Type'),'ObjStm'))throw Error('PDF_STRUCTURE');
        const bytes=await this.decodeStream(d,object.stream!);const reader=new PDFReader(bytes);const n=number(d.get('N')),first=number(d.get('First'));
        if(n>100000||entry.generation>=n||first>=bytes.length)throw Error('PDF_STRUCTURE');let target=-1;
        for(let i=0;i<n;i++){const id=reader.token(),pos=reader.token();if(!/^\d+$/.test(id)||!/^\d+$/.test(pos))throw Error('PDF_STRUCTURE');if(i===entry.generation){if(Number(id)!==value.id)throw Error('PDF_STRUCTURE');target=first+Number(pos);}}
        reader.position=target;resolved=reader.value();
      }
      this.cache.set(value.id,resolved);return resolved;
    } finally {this.active.delete(value.id);}
  }
  async signatures() {
    const root=dict(await this.resolve(this.root));if(!root.has('AcroForm'))return [];
    const form=dict(await this.resolve(root.get('AcroForm')));const signatures:PDFDict[]=[];const visited=new Set<number>();let count=0;
    const visit=async(fields:PDFValue[],inherited?:PDFValue,depth=0)=>{
      if(depth>32)throw Error('PDF_STRUCTURE');
      for(const field of fields) {
        if(++count>10000)throw Error('PDF_STRUCTURE');if(field instanceof PDFRef){if(visited.has(field.id))throw Error('PDF_STRUCTURE');visited.add(field.id);}
        const d=dict(await this.resolve(field));const type=d.get('FT')??inherited;
        if(nameIs(type,'Sig')&&d.get('V')!==null&&d.has('V'))signatures.push(dict(await this.resolve(d.get('V'))));
        if(d.has('Kids'))await visit(array(await this.resolve(d.get('Kids'))),type,depth+1);
      }
    };
    if(form.has('Fields'))await visit(array(await this.resolve(form.get('Fields'))));return signatures;
  }
}
export const pdfText=utf8;
