import {buffer,utf8} from '../src/crypto/bytes';
export function samplePDF() {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'];
  const content='BT /F1 18 Tf 60 700 Td (RSA Studio test document) Tj ET';
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let text='%PDF-1.7\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(text.length);text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=text.length;text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return buffer(utf8(text));
}
