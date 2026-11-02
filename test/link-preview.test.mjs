import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPreviews, checkPreviews, previewTags } from '../scripts/link-preview.mjs';
import { browserSkip } from './need-browser.mjs';

const page=(title='A release guide',description='Review source before release.',extra='')=>'<!doctype html><html><head><title>'+title+'</title><meta name="description" content="'+description+'">'+extra+'</head><body>Actual page</body></html>';
function fixture(){const root=mkdtempSync(join(tmpdir(),'ufs-preview-'));return {root,put(file,html){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),html)},close(){assert.ok(root.startsWith(join(tmpdir(),'ufs-preview-')));rmSync(root,{recursive:true,force:true})}}}

test('comments and script strings cannot impersonate actual preview metadata',()=>{
  const f=fixture();try{
    const fake=previewTags({title:'Fake',description:'Fake',url:'https://example.com/',image:'https://example.com/social/x.png',siteName:'Fake'});
    f.put('index.html',page('Real','Real','<!--'+fake+'--><script>const metadata='+JSON.stringify(fake)+'</script>'));
    const result=checkPreviews(f.root,'https://example.com/');
    assert.ok(result.errors.includes('index.html: missing og:title'));
  }finally{f.close()}
});

test('header-only PNGs cannot pass preview validation',()=>{
  const f=fixture();try{
    const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(1200,16);png.writeUInt32BE(630,20);
    f.put('social/x.png',png);f.put('index.html',page('Real','Real','<link rel="canonical" href="https://example.com/">'+previewTags({title:'Real',description:'Real',url:'https://example.com/',image:'https://example.com/social/x.png',siteName:'Real'})));
    assert.match(checkPreviews(f.root,'https://example.com/').errors.join('\n'),/complete decodable/);
  }finally{f.close()}
});

test('generation checks all page inputs and output confinement before writes',{skip:browserSkip()},async()=>{
  const f=fixture(),outside=fixture();try{
    const original=page();f.put('a.html',original);f.put('z.html','<html><head><title>No description</title></head></html>');
    await assert.rejects(buildPreviews(f.root,'https://example.com/'),/real title and meta description/);
    assert.equal(readFileSync(join(f.root,'a.html'),'utf8'),original);
    f.put('z.html',page());symlinkSync(outside.root,join(f.root,'social'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(buildPreviews(f.root,'https://example.com/'),/directory escapes/);
    assert.deepEqual(readdirSync(outside.root),[]);
    assert.equal(readFileSync(join(f.root,'a.html'),'utf8'),original);
  }finally{f.close();outside.close()}
});

test('generation preserves scripts, decodes titles once and keeps card identity across added pages',{skip:browserSkip(),timeout:90000},async()=>{
  const f=fixture();try{
    const script='<script>const example='+JSON.stringify('<meta property="og:title" content="not metadata"><link rel="canonical" href="https://unrelated.example/"></head>')+';</script>';
    f.put('guide #1.html',page('Gev &amp; source &copy;','Literal &amp;lt;tag&amp;gt;',script));
    const result=await buildPreviews(f.root,'https://example.com/project/');assert.equal(result.ok,true);
    const first=readFileSync(join(f.root,'guide #1.html'),'utf8');assert.ok(first.includes(script),'script string was changed');
    assert.match(first,/<meta property="og:title" content="Gev &amp; source ©">/);
    assert.match(first,/<meta property="og:description" content="Literal &amp;lt;tag&amp;gt;">/);
    assert.match(first,/https:\/\/example.com\/project\/guide%20%231.html/);
    const image=first.match(/<meta property="og:image" content="([^"]+)"/)[1];
    f.put('aaa.html',page('Added page'));assert.equal((await buildPreviews(f.root,'https://example.com/project/')).ok,true);
    const second=readFileSync(join(f.root,'guide #1.html'),'utf8');assert.ok(second.includes('content="'+image+'"'));
    assert.equal(checkPreviews(f.root,'https://example.com/project/').ok,true);
    f.put('guide #1.html',second.replace('rel="canonical"','rel="alternate"'));
    assert.match(checkPreviews(f.root,'https://example.com/project/').errors.join('\n'),/canonical URL/);
  }finally{f.close()}
});
