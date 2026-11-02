#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, closeBrowser, Session } from './inspect.mjs';
const escape = s => String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),m[2]??m[3]]));
const inside=(root,path)=>{const r=relative(root,path);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\'))};
const decode=s=>String(s).replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi,entity=>{const n=entity.toLowerCase();if(n.startsWith('&#')){const value=n.startsWith('&#x')?parseInt(n.slice(3,-1),16):Number(n.slice(2,-1));return value>0&&value<=0x10ffff&&!(value>=0xd800&&value<=0xdfff)?String.fromCodePoint(value):'\ufffd'}return {'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[n]});
function tokens(html){
  const result=[],tag=/<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/gi;let match;
  while((match=tag.exec(html))){if(match[0].startsWith('<!--'))continue;const name=match[0].match(/^<(\/?[\w:-]+)/)[1].toLowerCase(),start=match.index,openEnd=tag.lastIndex;
    if(/^(script|style|template|noscript|title|textarea)$/.test(name)){const close=new RegExp('</'+name+'\\s*>','gi');close.lastIndex=openEnd;const end=close.exec(html);result.push({name,start,end:end?close.lastIndex:html.length,markup:match[0],body:html.slice(openEnd,end?end.index:html.length)});tag.lastIndex=end?close.lastIndex:html.length}
    else result.push({name,start,end:openEnd,markup:match[0]});
  }return result;
}
function headRange(html){const tags=tokens(html),open=tags.find(t=>t.name==='head'),close=tags.find(t=>t.name==='/head'&&(!open||t.start>=open.end));return open&&close?{start:open.end,end:close.start}:null}
const head=html=>{const range=headRange(html);return range?html.slice(range.start,range.end):''};
const headTokens=html=>tokens(head(html));
const metaTags=html=>headTokens(html).filter(t=>t.name==='meta').map(t=>{const a=attrs(t.markup);return [String(a.property||a.name||'').toLowerCase(),decode(a.content??'')]});
function replaceMetadata(html,metadata){const range=headRange(html);if(!range)throw Error('closing head tag required');let content=html.slice(range.start,range.end);for(const token of tokens(content).reverse()){const a=attrs(token.markup);if((token.name==='meta'&&/^(og:|twitter:)/i.test(a.property||a.name||''))||(token.name==='link'&&a.rel?.toLowerCase()==='canonical'))content=content.slice(0,token.start)+content.slice(token.end)}return html.slice(0,range.start)+content+'\n'+metadata+'\n'+html.slice(range.end)}
const routeFor=(dir,file)=>relative(dir,file).replaceAll('\\','/').split('/').map(encodeURIComponent).join('/').replace(/index\.html$/,'');
function siteUrl(base){const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('base URL must use HTTPS without credentials, query or fragment');if(!url.pathname.endsWith('/'))url.pathname+='/';return url}
// Check complete PNG chunks and raster data, not just the 24-byte header.
function validPng(bytes){
  if(bytes.length<57||bytes.length>8*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
  const crc=b=>{let value=0xffffffff;for(const byte of b){value^=byte;for(let j=0;j<8;j++)value=value&1?0xedb88320^(value>>>1):value>>>1}return (value^0xffffffff)>>>0};
  let offset=8,header=null,ended=false,palette=false;const data=[];
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),end=offset+12+length;if(end>bytes.length)return false;const type=bytes.toString('ascii',offset+4,offset+8),chunk=bytes.subarray(offset+8,offset+8+length);if(crc(bytes.subarray(offset+4,offset+8+length))!==bytes.readUInt32BE(offset+8+length))return false;
    if(!header){if(type!=='IHDR'||length!==13||chunk.readUInt32BE(0)!==1200||chunk.readUInt32BE(4)!==630)return false;header=chunk}
    else if(type==='IHDR')return false;
    if(type==='PLTE')palette=length>0&&length%3===0;
    if(type==='IDAT')data.push(chunk);
    if(type==='IEND'){if(length!==0||end!==bytes.length)return false;ended=true;break}offset=end;
  }
  if(!header||!ended||!data.length||header[10]!==0||header[11]!==0||header[12]>1)return false;
  const depth=header[8],color=header[9],channels={0:1,2:3,3:1,4:2,6:4}[color],allowed={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
  if(!channels||!allowed[color].includes(depth)||(color===3&&!palette))return false;
  const passes=header[12]?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>({height:Math.ceil((630-y)/dy),stride:1+Math.ceil(Math.ceil((1200-x)/dx)*channels*depth/8)}));
  const expected=rows.reduce((n,r)=>n+r.height*r.stride,0);let raster;try{raster=inflateSync(Buffer.concat(data),{maxOutputLength:expected})}catch{return false}if(raster.length!==expected)return false;
  let row=0;for(const pass of rows)for(let y=0;y<pass.height;y++){if(raster[row]>4)return false;row+=pass.stride}return true;
}
export function previewTags(data) {
  const values={ 'og:title':data.title,'og:description':data.description,'og:image':data.image,'og:image:width':'1200','og:image:height':'630','og:image:alt':data.title,'og:url':data.url,'og:type':'website','og:site_name':data.siteName,'twitter:card':'summary_large_image','twitter:image':data.image,'twitter:image:alt':data.title };
  return Object.entries(values).map(([key,value])=>'<meta '+(key.startsWith('og:')?'property':'name')+'="'+key+'" content="'+escape(value)+'">').join('\n');
}
function pages(dir) { return readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isSymbolicLink()||['node_modules','.git'].includes(e.name)?[]:e.isDirectory()?pages(join(dir,e.name)):e.name.endsWith('.html')?[join(dir,e.name)]:[]); }
export function checkPreviews(dir, base) {
  dir=realpathSync(resolve(dir)); const origin=siteUrl(base);
  const errors=[];const files=pages(dir);
  if(!files.length) errors.push('no emitted HTML pages');
  for(const file of files){
    const html=readFileSync(file,'utf8'), entries=metaTags(html),meta=Object.fromEntries(entries);
    for(const [key] of entries)if(/^(og:|twitter:)/.test(key)&&entries.filter(e=>e[0]===key).length>1)errors.push(relative(dir,file)+': duplicate '+key);
    for(const key of ['og:title','og:description','og:image','og:image:width','og:image:height','og:image:alt','og:url','og:type','og:site_name','twitter:card','twitter:image','twitter:image:alt']) if(!meta[key])errors.push(relative(dir,file)+': missing '+key);
    if(meta['twitter:card']!=='summary_large_image')errors.push(relative(dir,file)+': wrong twitter:card');
    if(meta['og:image:width']!=='1200'||meta['og:image:height']!=='630')errors.push(relative(dir,file)+': expected 1200x630 metadata');
    try{
      const image=new URL(meta['og:image']);if(image.protocol!=='https:'||image.origin!==origin.origin||image.username||image.password)throw Error('image must use the site HTTPS origin without credentials');
      const page=new URL(meta['og:url']);if(page.protocol!=='https:'||page.origin!==origin.origin)throw Error('page must use the site HTTPS origin');
      if(page.href!==new URL(routeFor(dir,file),origin).href)throw Error('og:url does not match emitted page');
      const canonical=headTokens(html).filter(t=>t.name==='link').map(t=>attrs(t.markup)).filter(a=>a.rel?.toLowerCase()==='canonical');
      if(canonical.length!==1||decode(canonical[0].href)!==page.href)throw Error('canonical URL is missing, duplicated or differs from emitted page');
      if(meta['twitter:image']!==meta['og:image'])throw Error('Twitter and OG images differ');
      const prefix=origin.pathname.replace(/\/?$/,'/');if(!image.pathname.startsWith(prefix))throw Error('image is outside base path');
      const path=resolve(dir,decodeURIComponent(image.pathname.slice(prefix.length)));if(path===dir||!inside(dir,path))throw Error('image escapes output directory');
      const actual=realpathSync(path);if(!inside(dir,actual))throw Error('image symlink escapes output directory');
      if(statSync(actual).size>8*1024*1024||!validPng(readFileSync(actual)))throw Error('image is not a complete decodable 1200x630 PNG');
    }catch(err){errors.push(relative(dir,file)+': '+err.message)}
  }
  return {ok:errors.length===0,pages:files.length,errors};
}
export async function buildPreviews(dir, base) {
  dir=realpathSync(resolve(dir));const site=siteUrl(base);
  const files=pages(dir),bin=findBrowser();if(!files.length)throw Error('no emitted HTML pages');if(!bin)throw Error('Chrome, Edge or Chromium is required to build cards');
  const prepared=files.map(file=>{const html=readFileSync(file,'utf8'),tags=headTokens(html),title=tags.find(t=>t.name==='title')?.body,description=tags.filter(t=>t.name==='meta').map(t=>attrs(t.markup)).find(a=>a.name?.toLowerCase()==='description')?.content;if(!title?.trim()||!description?.trim())throw Error(relative(dir,file)+': supply a real title and meta description first');return {file,html,title,description}});
  mkdirSync(join(dir,'social'),{recursive:true});if(!inside(dir,realpathSync(join(dir,'social'))))throw Error('social image directory escapes output directory');
  const browser=await launch(bin);let session;
  try{
    session=await Session.open(browser.port);await session.send('Page.enable');await session.send('Runtime.enable');await session.send('Page.setLifecycleEventsEnabled',{enabled:true});
    await session.send('Emulation.setDeviceMetricsOverride',{width:1200,height:630,deviceScaleFactor:1,mobile:false});
    const pending=[];
    for(const row of prepared){
      const {file}=row;let {html}=row;
      const decoded=await session.send('Runtime.evaluate',{expression:'('+((values)=>values.map(value=>{const el=document.createElement('textarea');el.innerHTML=value.replaceAll('<','&lt;');return el.value})).toString()+')('+JSON.stringify([row.title,row.description])+')',returnByValue:true});
      if(decoded.exceptionDetails||!Array.isArray(decoded.result?.value))throw Error('card text decoding failed');const [title,description]=decoded.result.value;
      // A line box shorter than the system font's glyphs never passes the fit
      // test, even when shrinking a short title. Reserve the actual font height.
      const card='<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;padding:64px;background:#f1f3f5;color:#1b2530;font:28px system-ui;display:flex;flex-direction:column;justify-content:space-between}h1{font-size:72px;line-height:normal;overflow-wrap:anywhere;max-height:350px;overflow:hidden;margin:24px 0}p{margin:0}</style><p>'+escape(site.hostname)+'</p><h1>'+escape(title)+'</h1><p>'+escape(description.slice(0,130))+'</p>';
      session.events.length=0;
      const nav=await session.send('Page.navigate',{url:'data:text/html;charset=utf-8,'+encodeURIComponent(card)});if(nav.errorText)throw Error(nav.errorText);
      // A prior document's load event does not qualify the next card. Tie the
      // load receipt to this navigation's loader before evaluating its title.
      const deadline=Date.now()+25000;let loaded=false;
      while(Date.now()<deadline){const event=session.events.find(e=>e.method==='Page.lifecycleEvent'&&e.params?.loaderId===nav.loaderId&&e.params?.name==='load');if(event){loaded=true;break}await new Promise(r=>setTimeout(r,50))}
      if(!loaded)throw Error('card page load timed out');
      const fonts=await session.send('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true});if(fonts.exceptionDetails)throw Error('card font evaluation failed');
      const fit=await session.send('Runtime.evaluate',{expression:"(()=>{const h=document.querySelector('h1');if(!h)throw Error('card heading is missing');while(h.scrollHeight>h.clientHeight&&parseFloat(getComputedStyle(h).fontSize)>40)h.style.fontSize=(parseFloat(getComputedStyle(h).fontSize)-2)+'px';return h.scrollHeight<=h.clientHeight})()",returnByValue:true});if(fit.exceptionDetails)throw Error(relative(dir,file)+': card evaluation failed: '+(fit.exceptionDetails.exception?.description||fit.exceptionDetails.text));if(fit.result?.value!==true)throw Error(relative(dir,file)+': title will not fit the preview card');
      const route=routeFor(dir,file),imagePath='social/card-'+createHash('sha256').update(JSON.stringify([route,title,description])).digest('hex').slice(0,20)+'.png';
      const shot=await session.send('Page.captureScreenshot',{format:'png'});const image=Buffer.from(shot.data,'base64');if(!validPng(image))throw Error('browser did not return a complete 1200x630 PNG');
      const url=new URL(route,site).href;
      html=replaceMetadata(html,'<link rel="canonical" href="'+escape(url)+'">\n'+previewTags({title,description,url,image:new URL(imagePath,site).href,siteName:site.hostname}));pending.push({file,html,imagePath,image});
    }
    for(const row of pending){writeFileSync(join(dir,row.imagePath),row.image);writeFileSync(row.file,row.html)}
  }finally{session?.close();await closeBrowser(browser)}
  return checkPreviews(dir,site.href);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [dir,base]=process.argv.slice(2);if(!dir||!base)throw Error('usage: link-preview.mjs <built-dir> <https://site.example/> [--check]');const result=process.argv.includes('--check')?checkPreviews(dir,base):await buildPreviews(dir,base);console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1}catch(err){console.error('link-preview: '+err.message);process.exitCode=2}
}
