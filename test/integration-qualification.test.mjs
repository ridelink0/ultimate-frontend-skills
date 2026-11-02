import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {isolatedEnvironment,inspectIntegration,qualifyIntegrations} from '../scripts/qualify-integrations.mjs';
import {runPackCommand} from '../scripts/packs.mjs';
function git(dir,args){const r=spawnSync('git',['-C',dir,...args],{encoding:'utf8',shell:false});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
test('qualification isolates profile paths and removes inherited credentials',()=>{
  const env=isolatedEnvironment('/disposable',{PATH:'tool-path',HOME:'live-home',USERPROFILE:'live-profile',OPENAI_API_KEY:'hidden',GH_TOKEN:'hidden',AWS_SECRET_ACCESS_KEY:'hidden',NPM_TOKEN:'hidden'});
  assert.equal(env.PATH,'tool-path');for(const name of ['HOME','USERPROFILE','CLAUDE_CONFIG_DIR','CODEX_HOME','APPDATA','LOCALAPPDATA','npm_config_cache','npm_config_userconfig'])assert.ok(env[name].includes('disposable'),name);
  for(const name of ['OPENAI_API_KEY','GH_TOKEN','AWS_SECRET_ACCESS_KEY','NPM_TOKEN'])assert.equal(name in env,false,name);
});
test('pinned source qualification rejects drift, wrong frontmatter selection and invalid selectors',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ufs-integration-'));
  try{
    mkdirSync(join(dir,'skills/task'),{recursive:true});writeFileSync(join(dir,'skills/task/SKILL.md'),'---\nname: actual-name\ndescription: Real task instructions\n---\nRead source.\n');
    git(dir,['init','--quiet']);git(dir,['add','.']);git(dir,['-c','user.name=Gev','-c','user.email=gev@example.invalid','commit','--quiet','-m','Gev qualification fixture']);
    const pack={id:'owner/source',sha:git(dir,['rev-parse','HEAD']),kind:'skills',skills:['actual-name']};
    assert.equal(inspectIntegration(pack,dir).selected[0].name,'actual-name');
    assert.throws(()=>inspectIntegration({...pack,skills:['task']},dir),/frontmatter/);
    assert.throws(()=>inspectIntegration({...pack,sha:'0'.repeat(40)},dir),/pin/);
    assert.throws(()=>inspectIntegration({...pack,skills:['--all']},dir),/invalid integration/);
    writeFileSync(join(dir,'uncommitted.txt'),'drift');assert.throws(()=>inspectIntegration(pack,dir),/clean pinned/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
test('qualification refuses reusing a directory containing earlier evidence',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ufs-evidence-'));
  try{assert.throws(()=>qualifyIntegrations({sourceBase:dir,output:dir,rows:[]}),/new disposable/)}finally{rmSync(dir,{recursive:true,force:true})}
});
test('Windows pack installation keeps shell metacharacters as literal argv',()=>{
  const calls=[],spawn=(...args)=>{calls.push(args);return{status:0}};
  const args=['plugin','install','name & unintended-command'];
  assert.equal(runPackCommand('claude',args,{platform:'win32',claude:{file:'native.exe',prefix:[]},spawn,log(){}}).ok,true);
  assert.deepEqual(calls[0][1],args);assert.equal(calls[0][2].shell,false);
  assert.equal(runPackCommand('npx',['--yes','skills','add','a/b&bad'],{platform:'win32',execPath:'C:/node/node.exe',exists:()=>true,spawn,log(){}}).ok,true);
  assert.equal(calls[1][0],'C:/node/node.exe');assert.equal(calls[1][1].at(-1),'a/b&bad');assert.equal(calls[1][2].shell,false);
});
