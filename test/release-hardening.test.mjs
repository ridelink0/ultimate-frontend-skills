import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditDistribution } from '../scripts/distribution.mjs';
import { readCorpus, writeCorpus } from '../scripts/awards.mjs';
import { renderTerminal } from '../scripts/terminal-ui.mjs';
import { checkScene, SCENE_BUDGET } from '../scripts/scene-budget.mjs';
import { createSoundFeedback } from '../skills/sound-design/assets/feedback.mjs';
import { commandsFor, loadPacks } from '../scripts/packs.mjs';
import { previewTags, checkPreviews, buildPreviews } from '../scripts/link-preview.mjs';
import { browserSkip } from './need-browser.mjs';
const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
test('shipped distribution is readable and contains offline packs and privacy', () => {
  const report = auditDistribution(root);
  assert.deepEqual(report.errors, []);
  assert.ok(report.files.some(f => f.path.startsWith('packs/')));
  assert.ok(report.files.some(f => f.path === 'PRIVACY.md'));
  assert.ok(!report.files.some(f => f.path.startsWith('plugins/')));
});
test('distribution rejects disguised executables, invalid UTF8 and lifecycle downloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-distribution-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ files: ['payload'], scripts: { postinstall: 'fetch-a-binary' } }));
    writeFileSync(join(dir, 'README.md'), 'source'); writeFileSync(join(dir, 'LICENSE'), 'license'); mkdirSync(join(dir, 'payload'));
    writeFileSync(join(dir, 'payload', 'hidden.png'), 'MZ executable');
    writeFileSync(join(dir, 'payload', 'invalid.js'), Buffer.from([0xff, 0x00]));
    writeFileSync(join(dir, 'payload', 'native.wasm'), 'source label');
    const r = auditDistribution(dir);
    for (const word of ['postinstall', 'image extension', 'not UTF-8', 'opaque']) assert.ok(r.errors.some(e => e.includes(word)), word);
    assert.ok(auditDistribution(dir, { paths: ['../outside'] }).errors.some(e => e.includes('escapes')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('corpus splits without losing rows or allowing manifest path traversal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-corpus-'));
  try {
    const file = join(dir, 'awards.json'), rows = Array.from({length: 12}, (_, i) => ({ id: String(i), detail: 'x'.repeat(40000) }));
    writeCorpus(rows, file); assert.deepEqual(readCorpus(file), rows);
    const manifest = JSON.parse(readFileSync(file)); assert.ok(manifest.parts.length > 1);
    writeCorpus([], file); assert.deepEqual(readCorpus(file), []);
    writeFileSync(file, JSON.stringify({format:'ufs-awards-parts-v1',count:1,parts:['../private.json']}));
    assert.throws(() => readCorpus(file), /part path/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('terminal output remains bounded and cannot execute incoming escape sequences', () => {
  for (const columns of [8, 24, 80, NaN]) {
    const output = renderTerminal({title:'a'.repeat(200), rows:['\x1b]0;attack\x07hello\nworld','\x1b[2Jclear'], columns, selected:999});
    assert.doesNotMatch(output, /\x1b|\x07/);
    for (const line of output.trimEnd().split('\n')) assert.ok(line.length <= (Number.isFinite(columns) ? columns : 80));
  }
  const cli = spawnSync(process.execPath, [join(root, 'scripts/terminal-ui.mjs')], { encoding:'utf8' });
  assert.equal(cli.status, 0); assert.match(cli.stdout, /demo data/); assert.doesNotMatch(cli.stdout, /\x1b/);
});
test('scene diagnostics explain overruns and preserve missing measurements as unknown', () => {
  assert.equal(checkScene({...SCENE_BUDGET}).ok, true);
  const result = checkScene({drawCalls:200,frameP95Ms:NaN,dpr:0});
  assert.equal(result.ok,false); assert.ok(result.findings.some(f=>f.key==='drawCalls' && /instance/.test(f.reason)));
  assert.equal(result.findings.find(f=>f.key==='frameP95Ms').level,'unknown');
  assert.throws(()=>checkScene({}, { ...SCENE_BUDGET,dpr:0 }),/invalid budget/);
});
test('sound stays silent until enable, rate limits and disconnects ended nodes', async () => {
  const made = []; let disconnected = 0;
  class Context {
    state='running'; currentTime=1; destination={};
    createOscillator(){const o={frequency:{setValueAtTime(){}},connect(){},disconnect(){disconnected++},start(){made.push(o)},stop(){}}; return o;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){disconnected++}};}
    async close(){this.state='closed';}
  }
  const document={hidden:false}, sound=createSoundFeedback({Context,document});
  assert.equal(sound.play(),false); assert.equal(made.length,0); assert.equal(await sound.enable(),true);
  assert.equal(sound.play(),true); assert.equal(sound.play(),false); made[0].onended(); assert.equal(disconnected,2);
  document.hidden=true; assert.equal(sound.play(),false); sound.mute(); assert.equal(sound.enabled,false); await sound.dispose();
});
test('mute wins a pending sound enable and rejected resume stays silent', async () => {
  let resume;
  class Pending {state='suspended'; resume(){return new Promise(r=>{resume=()=>{this.state='running';r();}})} async close(){this.state='closed';}}
  const sound=createSoundFeedback({Context:Pending}), enabling=sound.enable(); sound.mute(); resume();
  assert.equal(await enabling,false); assert.equal(sound.enabled,false); await sound.dispose();
  class Denied {state='suspended';async resume(){throw new Error('blocked')}}
  const denied=createSoundFeedback({Context:Denied}); assert.equal(await denied.enable(),false); assert.equal(denied.play(),false);
});
test('ten new integrations have exact source pins and scoped install commands', () => {
  const additions=JSON.parse(readFileSync(join(root,'skills/ultimate-frontend-skills/data/integrations-2026-11-01.json')));
  assert.equal(additions.length,10);assert.equal(new Set(additions.map(x=>x.id)).size,10);
  for(const pack of additions){assert.match(pack.sha,/^[a-f0-9]{40}$/);assert.ok(loadPacks().some(p=>p.id===pack.id));if(pack.kind==='skills'){const args=commandsFor(pack)[0][1];assert.ok(args.includes('--skill'));assert.ok(!args.includes('--all'));for(const name of pack.skills)assert.ok(args.includes(name));}}
});
test('preview metadata is escaped and missing images fail validation', () => {
  const dir=mkdtempSync(join(tmpdir(),'ufs-card-invalid-'));
  try{const tags=previewTags({title:'A "quote" <tag>',description:'Real detail',url:'https://example.com/',image:'https://example.com/social/card.png',siteName:'Example'});assert.ok(tags.includes('&quot;quote&quot; &lt;tag&gt;'));writeFileSync(join(dir,'index.html'),'<html><head>'+tags+'</head></html>');assert.equal(checkPreviews(dir,'https://example.com/').ok,false);assert.throws(()=>checkPreviews(dir,'http://example.com/'),/HTTPS/);}finally{rmSync(dir,{recursive:true,force:true})}
});
test('link card core flow builds PNG and metadata for every emitted page', {skip:browserSkip(),timeout:90000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ufs-card-build-'));
  try{mkdirSync(join(dir,'guide'));for(const file of ['index.html','guide/index.html'])writeFileSync(join(dir,file),'<!doctype html><html><head><title>Source review workflow</title><meta name="description" content="Review real source before a release."></head><body><h1>Workflow</h1></body></html>');const result=await buildPreviews(dir,'https://example.com/project/');assert.deepEqual(result,{ok:true,pages:2,errors:[]});assert.equal(checkPreviews(dir,'https://example.com/project/').ok,true);const html=readFileSync(join(dir,'guide/index.html'),'utf8');assert.match(html,/https:\/\/example.com\/project\/guide\//);assert.match(html,/og:image:width/);}finally{rmSync(dir,{recursive:true,force:true})}
});
