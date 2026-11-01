#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, closeBrowser, Session } from './inspect.mjs';
const escape = s => String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),m[2]??m[3]]));
export function previewTags(data) {
  const values={ 'og:title':data.title,'og:description':data.description,'og:image':data.image,'og:image:width':'1200','og:image:height':'630','og:image:alt':data.title,'og:url':data.url,'og:type':'website','og:site_name':data.siteName,'twitter:card':'summary_large_image','twitter:image':data.image,'twitter:image:alt':data.title };
  return Object.entries(values).map(([key,value])=>'<meta '+(key.startsWith('og:')?'property':'name')+'="'+key+'" content="'+escape(value)+'">').join('\n');
}
function pages(dir) { return readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isSymbolicLink()||['node_modules','.git'].includes(e.name)?[]:e.isDirectory()?pages(join(dir,e.name)):e.name.endsWith('.html')?[join(dir,e.name)]:[]); }
export function checkPreviews(dir, base) {
  dir=resolve(dir); const origin=new URL(base); if(origin.protocol!=='https:')throw Error('base URL must use HTTPS');
  const errors=[];const files=pages(dir);
  if(!files.length) errors.push('no emitted HTML pages');
  for(const file of files){
    const html=readFileSync(file,'utf8'), entries=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>{const a=attrs(m[0]);return [a.property||a.name,a.content]}),meta=Object.fromEntries(entries);
    for(const [key] of entries)if(/^(og:|twitter:)/.test(key)&&entries.filter(e=>e[0]===key).length>1)errors.push(relative(dir,file)+': duplicate '+key);
    for(const key of ['og:title','og:description','og:image','og:image:width','og:image:height','og:image:alt','og:url','og:type','og:site_name','twitter:card','twitter:image','twitter:image:alt']) if(!meta[key])errors.push(relative(dir,file)+': missing '+key);
    if(meta['twitter:card']!=='summary_large_image')errors.push(relative(dir,file)+': wrong twitter:card');
    if(meta['og:image:width']!=='1200'||meta['og:image:height']!=='630')errors.push(relative(dir,file)+': expected 1200x630 metadata');
    try{
      const image=new URL(meta['og:image']);if(image.protocol!=='https:'||image.origin!==origin.origin)throw Error('image must use the site HTTPS origin');
      const page=new URL(meta['og:url']);if(page.protocol!=='https:'||page.origin!==origin.origin)throw Error('page must use the site HTTPS origin');
      if(meta['twitter:image']!==meta['og:image'])throw Error('Twitter and OG images differ');
      const prefix=origin.pathname.replace(/\/?$/,'/');if(!image.pathname.startsWith(prefix))throw Error('image is outside base path');
      const path=resolve(dir,decodeURIComponent(image.pathname.slice(prefix.length)));if(!relative(dir,path)||relative(dir,path).startsWith('..'))throw Error('image escapes output directory');
      const actual=realpathSync(path);if(relative(realpathSync(dir),actual).startsWith('..'))throw Error('image symlink escapes output directory');
      const png=readFileSync(actual);if(png.length<24||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.readUInt32BE(16)!==1200||png.readUInt32BE(20)!==630)throw Error('image is not a 1200x630 PNG');
    }catch(err){errors.push(relative(dir,file)+': '+err.message)}
  }
  return {ok:errors.length===0,pages:files.length,errors};
}
export async function buildPreviews(dir, base) {
  dir=resolve(dir);const site=new URL(base);if(site.protocol!=='https:')throw Error('base URL must use HTTPS');if(!site.pathname.endsWith('/'))site.pathname+='/';
  const files=pages(dir),bin=findBrowser();if(!files.length)throw Error('no emitted HTML pages');if(!bin)throw Error('Chrome, Edge or Chromium is required to build cards');
  const browser=await launch(bin);let session;
  try{
    session=await Session.open(browser.port);await session.send('Page.enable');await session.send('Runtime.enable');
    await session.send('Emulation.setDeviceMetricsOverride',{width:1200,height:630,deviceScaleFactor:1,mobile:false});
    mkdirSync(join(dir,'social'),{recursive:true});
    for(const [i,file] of files.entries()){
      let html=readFileSync(file,'utf8');const title=html.match(/<title\b[^>]*>([^<]+)<\/title>/i)?.[1];
      const description=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>attrs(m[0])).find(a=>a.name?.toLowerCase()==='description')?.content;
      if(!title||!description)throw Error(relative(dir,file)+': supply a real title and meta description first');
      const card='<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;padding:64px;background:#f1f3f5;color:#1b2530;font:28px system-ui;display:flex;flex-direction:column;justify-content:space-between}h1{font-size:72px;line-height:1.08;overflow-wrap:anywhere;max-height:400px;overflow:hidden;margin:32px 0}p{margin:0}</style><p>'+escape(site.hostname)+'</p><h1>'+escape(title)+'</h1><p>'+escape(description.slice(0,130))+'</p>';
      const nav=await session.send('Page.navigate',{url:'data:text/html;charset=utf-8,'+encodeURIComponent(card)});if(nav.errorText)throw Error(nav.errorText);if(!await session.waitForEvent('Page.loadEventFired'))throw Error('card page load timed out');
      await session.send('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true});
      const fit=await session.send('Runtime.evaluate',{expression:"(()=>{const h=document.querySelector('h1');while(h.scrollHeight>h.clientHeight&&parseFloat(getComputedStyle(h).fontSize)>40)h.style.fontSize=(parseFloat(getComputedStyle(h).fontSize)-2)+'px';return h.scrollHeight<=h.clientHeight})()",returnByValue:true});if(fit.result?.value!==true)throw Error(relative(dir,file)+': title will not fit the preview card');
      const shot=await session.send('Page.captureScreenshot',{format:'png'}),imagePath='social/card-'+String(i+1).padStart(3,'0')+'.png';writeFileSync(join(dir,imagePath),Buffer.from(shot.data,'base64'));
      const route=relative(dir,file).replaceAll('\\','/').replace(/index\.html$/,'');
      html=html.replace(/<meta\b[^>]*>/gi,tag=>{const a=attrs(tag);return /^(og:|twitter:)/.test(a.property||a.name||'')?'':tag});
      if(!/<\/head>/i.test(html))throw Error(relative(dir,file)+': closing head tag required');
      html=html.replace(/<\/head>/i,previewTags({title,description,url:new URL(route,site).href,image:new URL(imagePath,site).href,siteName:site.hostname})+'\n</head>');writeFileSync(file,html);
    }
  }finally{session?.close();await closeBrowser(browser)}
  return checkPreviews(dir,site.href);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [dir,base]=process.argv.slice(2);if(!dir||!base)throw Error('usage: link-preview.mjs <built-dir> <https://site.example/> [--check]');const result=process.argv.includes('--check')?checkPreviews(dir,base):await buildPreviews(dir,base);console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1}catch(err){console.error('link-preview: '+err.message);process.exitCode=2}
}
