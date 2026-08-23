
const fs=require('fs'); const path=require('path'); const zlib=require('zlib');
function slug(v){return String(v||'document').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'document';}
function parseCsv(text){
 const lines=String(text).split(/\r?\n/).filter(Boolean); if(!lines.length)return [];
 const headers=lines[0].split(',').map(x=>x.trim());
 return lines.slice(1).map(line=>{const vals=line.split(',');return Object.fromEntries(headers.map((h,i)=>[h,(vals[i]||'').trim()]));});
}
class DocumentIngestor{
 constructor({knowledgeRepository=null}={}){this.knowledgeRepository=knowledgeRepository;}
 async ingestFile({tenantId,filePath,tenantsDir,destinationName=null}){
  if(!tenantId||!filePath||!tenantsDir)throw new TypeError('tenantId, filePath and tenantsDir are required');
  const ext=path.extname(filePath).toLowerCase();
  if(!['.txt','.md','.csv','.json','.pdf'].includes(ext))throw new Error(`Unsupported knowledge file '${ext}'. Supported: .txt, .md, .pdf, .csv, .json`);
  const base=path.join(tenantsDir,tenantId,'knowledge','documents'); fs.mkdirSync(base,{recursive:true});
  let body,targetExt=ext,originalPath=null;
  if(ext==='.pdf'){
    body=await extractPdfText(filePath);targetExt='.txt';
    if(!body.trim())throw new Error('The PDF did not contain extractable text.');
    const originals=path.join(tenantsDir,tenantId,'knowledge','originals');fs.mkdirSync(originals,{recursive:true});
    originalPath=path.join(originals,(destinationName?slug(destinationName):slug(path.basename(filePath,ext)))+'.pdf');
    fs.copyFileSync(filePath,originalPath);
  }else{
    body=fs.readFileSync(filePath,'utf8');
    if(ext==='.csv'){body=JSON.stringify(parseCsv(body),null,2);targetExt='.json';}
    if(ext==='.json'){JSON.parse(body);}
  }
  const target=path.join(base,(destinationName?slug(destinationName):slug(path.basename(filePath,ext)))+targetExt);
  fs.writeFileSync(target,body);

  this.knowledgeRepository?.clearCache?.(tenantId);
  return {tenantId,path:target,format:targetExt.slice(1),originalPath,sourceFormat:ext.slice(1)};
 }
 ingestContent({tenantId,text,tenantsDir,name='notes',format='txt'}){
  const fmt=String(format||'txt').toLowerCase().replace(/^\./,'');
  if(!['txt','md','csv','json'].includes(fmt))throw new Error(`Unsupported knowledge format '${fmt}'.`);
  const base=path.join(tenantsDir,tenantId,'knowledge','documents'); fs.mkdirSync(base,{recursive:true});
  let body=String(text||'').trim();
  if(fmt==='json')body=JSON.stringify(JSON.parse(body),null,2);
  const target=path.join(base,slug(name)+'.'+fmt); fs.writeFileSync(target,body+'\n');
  this.knowledgeRepository?.clearCache?.(tenantId);
  return {tenantId,path:target,format:fmt};
 }
 ingestText({tenantId,text,tenantsDir,name='notes'}){
  return this.ingestContent({tenantId,text,tenantsDir,name,format:'txt'});
 }
}

async function extractPdfText(filePath){
  const buffer=fs.readFileSync(filePath);
  if(buffer.length<8 || buffer.subarray(0,5).toString('latin1')!=='%PDF-') throw new Error('Invalid PDF file.');

  // Prefer the maintained pure-Node parser. This handles modern text PDFs
  // without requiring Poppler, pdftotext, Python, or another host binary.
  // The deterministic built-in parser below remains as a safe fallback for
  // installations upgrading before their next npm install and for parser
  // failures on otherwise ordinary text PDFs.
  try{
    const {PDFParse}=require('pdf-parse');
    const parser=new PDFParse({data:buffer});
    try{
      const result=await parser.getText();
      const text=cleanPdfText(result?.text);
      if(text)return text;
    } finally {
      try{await parser.destroy();}catch{}
    }
  }catch{}

  return extractPdfTextFallback(buffer);
}

function extractPdfTextFallback(buffer){
  const latin=buffer.toString('latin1');
  const chunks=[];

  // Extract page/content streams. This supports ordinary text PDFs using
  // literal/hex strings and FlateDecode, which covers the common PDFs Nova
  // receives from office software and generated business documents.
  const streamMarker=/stream\r?\n/g;
  let m;
  while((m=streamMarker.exec(latin))){
    const contentStart=m.index+m[0].length;
    const contentEnd=latin.indexOf('endstream',contentStart);
    if(contentEnd<0)break;
    const dictEnd=latin.lastIndexOf('>>',m.index);
    const dictStart=dictEnd>=0?latin.lastIndexOf('<<',dictEnd): -1;
    const dict=(dictStart>=0&&dictEnd>dictStart&&m.index-dictEnd<200)?latin.slice(dictStart,dictEnd+2):'';
    const raw=Buffer.from(latin.slice(contentStart,contentEnd).replace(/\r?\n$/,''),'latin1');
    streamMarker.lastIndex=contentEnd+9;
    let decoded=raw;
    if(/\/(?:DCTDecode|JPXDecode|CCITTFaxDecode)\b/.test(dict))continue;
    try{
      // PDF filters are applied in the listed order while writing, therefore
      // decoding applies them from left to right as they appear in /Filter.
      const filterMatch=dict.match(/\/Filter\s*(\[[^\]]+\]|\/\w+)/);
      const filters=(filterMatch?.[1]?.match(/\/(\w+)/g)||[]).map(x=>x.slice(1));
      for(const filter of filters){
        if(filter==='ASCII85Decode'||filter==='A85')decoded=decodeAscii85(decoded);
        else if(filter==='ASCIIHexDecode'||filter==='AHx')decoded=decodeAsciiHex(decoded);
        else if(filter==='FlateDecode'||filter==='Fl')decoded=zlib.inflateSync(decoded);
        else if(filter==='RunLengthDecode')decoded=decodeRunLength(decoded);
      }
      // Some producers omit /Filter array parsing patterns but still expose
      // a single FlateDecode token.
      if(!filters.length&&/\/FlateDecode\b/.test(dict))decoded=zlib.inflateSync(decoded);
    }catch{continue;}
    const text=extractPdfTextOperators(decoded.toString('latin1'));
    if(text)chunks.push(text);
  }

  // Some small/simple PDFs place uncompressed text outside detected streams.
  if(!chunks.length){
    const fallback=extractPdfTextOperators(latin);
    if(fallback)chunks.push(fallback);
  }

  const text=cleanPdfText(chunks.join('\n')).replace(/[ \t]{2,}/g,' ');
  if(!text) throw new Error('The PDF contains no extractable text. Scanned/image-only PDFs require OCR before ingestion.');
  return text;
}

function cleanPdfText(value){
  return String(value||'').replace(/\u0000/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function decodeAscii85(input){
  const str=Buffer.isBuffer(input)?input.toString('ascii'):String(input||'');
  const bytes=[];let group=[];
  for(let i=0;i<str.length;i++){
    const ch=str[i];
    if(/\s/.test(ch))continue;
    if(ch==='<'&&str[i+1]==='~'){i++;continue;}
    if(ch==='~')break;
    if(ch==='z'&&group.length===0){bytes.push(0,0,0,0);continue;}
    const code=ch.charCodeAt(0);if(code<33||code>117)continue;
    group.push(code-33);
    if(group.length===5){emit85(group,5,bytes);group=[];}
  }
  if(group.length){
    const original=group.length;while(group.length<5)group.push(84);
    emit85(group,original,bytes);
  }
  return Buffer.from(bytes);
}
function emit85(group,originalLength,out){
  let value=0;for(const x of group)value=value*85+x;
  const tmp=[Math.floor(value/16777216)%256,Math.floor(value/65536)%256,Math.floor(value/256)%256,value%256];
  const count=originalLength===5?4:Math.max(0,originalLength-1);
  for(let i=0;i<count;i++)out.push(tmp[i]);
}
function decodeAsciiHex(input){
  let hex=(Buffer.isBuffer(input)?input.toString('ascii'):String(input||'')).replace(/\s+/g,'').replace(/>.*$/s,'');
  if(hex.length%2)hex+='0';return Buffer.from(hex,'hex');
}
function decodeRunLength(input){
  const src=Buffer.from(input),out=[];
  for(let i=0;i<src.length;){
    const n=src[i++];if(n===128)break;
    if(n<=127){for(let j=0;j<n+1&&i<src.length;j++)out.push(src[i++]);}
    else if(i<src.length){const b=src[i++];for(let j=0;j<257-n;j++)out.push(b);}
  }
  return Buffer.from(out);
}

function extractPdfTextOperators(content){
  const blocks=String(content||'').match(/BT[\s\S]*?ET/g)||[];
  const lines=[];
  for(const block of blocks){
    const parts=[];
    const tokenRe=/(\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>)\s*(?:Tj|'|")|\[((?:[^\[\]]|\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>)*)\]\s*TJ/g;
    let m;
    while((m=tokenRe.exec(block))){
      if(m[1])parts.push(decodePdfStringToken(m[1]));
      else if(m[2]){
        const inner=m[2],stringRe=/\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>/g;let sm;
        while((sm=stringRe.exec(inner)))parts.push(decodePdfStringToken(sm[0]));
      }
    }
    const joined=parts.join('').replace(/\s+/g,' ').trim();
    if(joined)lines.push(joined);
  }
  return lines.join('\n');
}

function decodePdfStringToken(token){
  if(!token)return '';
  if(token[0]==='<'){
    const hex=token.slice(1,-1).replace(/\s+/g,'');
    if(!hex)return '';
    const buf=Buffer.from(hex.length%2?hex+'0':hex,'hex');
    // UTF-16BE BOM or common two-byte encoded text.
    if(buf.length>=2&&buf[0]===0xFE&&buf[1]===0xFF)return decodeUtf16Be(buf.subarray(2));
    if(buf.length>=4&&buf.filter((_,i)=>i%2===0).every(x=>x===0))return decodeUtf16Be(buf);
    return buf.toString('latin1');
  }
  const s=token.slice(1,-1);
  return s.replace(/\\([0-7]{1,3}|[nrtbf()\\])/g,(_,esc)=>{
    if(/^[0-7]/.test(esc))return String.fromCharCode(parseInt(esc,8));
    return ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(':'(',')':')','\\':'\\'})[esc]||esc;
  }).replace(/\\\r?\n/g,'');
}
function decodeUtf16Be(buf){
  const out=Buffer.alloc(buf.length);for(let i=0;i+1<buf.length;i+=2){out[i]=buf[i+1];out[i+1]=buf[i];}
  return out.toString('utf16le').replace(/\u0000/g,'');
}

module.exports={DocumentIngestor,parseCsv,extractPdfText,extractPdfTextFallback,extractPdfTextOperators};
