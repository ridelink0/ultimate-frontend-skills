// Independent planted regressions for Gev's preview release. No live source edits.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const source=readFileSync(new URL('../scripts/link-preview.mjs',import.meta.url),'utf8');
const importUrl=new URL('../scripts/inspect.mjs',import.meta.url).href;
const sandbox=mkdtempSync(join(tmpdir(),'ufs-preview-mutants-'));
const results=[];
function put(name,content){const file=join(sandbox,name);writeFileSync(file,content);return file}
function site(name){const dir=join(sandbox,name);mkdirSync(dir);writeFileSync(join(dir,'index.html'),'<!doctype html><html><head><title>Source review workflow</title><meta name="description" content="Review real source before release."></head><body>Workflow</body></html>');return dir}
async function moduleFor(name,text){assert.ok(text.includes("'./inspect.mjs'"));return import(pathToFileURL(put(name+'.mjs',text.replace("'./inspect.mjs'",JSON.stringify(importUrl)))).href)}
try{
  const control=await moduleFor('control',source);
  const built=await control.buildPreviews(site('functional'),'https://example.com/');assert.equal(built.ok,true);results.push({name:'actual browser generation control',passed:true});
  assert.ok(source.includes('line-height:normal'),'mutation anchor missing');
  const clipped=await moduleFor('clipped',source.replace('line-height:normal','line-height:1.08'));
  await assert.rejects(clipped.buildPreviews(site('clipped-title'),'https://example.com/'),/title will not fit the preview card/);results.push({name:'original clipped-font regression caught',passed:true});
  const invalid=site('truncated-png');mkdirSync(join(invalid,'social'));
  const bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(1200,16);bytes.writeUInt32BE(630,20);writeFileSync(join(invalid,'social/x.png'),bytes);
  writeFileSync(join(invalid,'index.html'),'<html><head><link rel="canonical" href="https://example.com/">'+control.previewTags({title:'Real',description:'Real',url:'https://example.com/',image:'https://example.com/social/x.png',siteName:'Real'})+'</head></html>');
  assert.equal(control.checkPreviews(invalid,'https://example.com/').ok,false);results.push({name:'truncated PNG refusal control',passed:true});
  const anchor='statSync(actual).size>8*1024*1024||!validPng(readFileSync(actual))';assert.ok(source.includes(anchor),'mutation anchor missing');
  const unchecked=await moduleFor('unchecked-png',source.replace(anchor,'false'));
  assert.equal(unchecked.checkPreviews(invalid,'https://example.com/').ok,true,'planted validator break must actually admit the invalid image');results.push({name:'disabled raster validation regression caught',passed:true});
  const receipt={sourceSha256:createHash('sha256').update(source).digest('hex'),results};
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}finally{assert.ok(sandbox.startsWith(join(tmpdir(),'ufs-preview-mutants-')));rmSync(sandbox,{recursive:true,force:true})}
