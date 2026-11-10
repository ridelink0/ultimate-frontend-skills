#!/usr/bin/env node
// Explicit, isolated qualification. No model calls, plugin hooks or live profiles.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { findClaude } from './claude-cli.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const SKILLS_CLI_VERSION='1.7.4';
const cleanLog=s=>String(s||'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[^\x20-\x7e\r\n\t]/g,'');
const digest=s=>createHash('sha256').update(s).digest('hex');
function confined(root,path){const r=relative(realpathSync(root),realpathSync(path));if(r.startsWith('..')||/^[A-Za-z]:/.test(r))throw Error('source path escapes selected root');return path;}
export function isolatedEnvironment(profile, inherited=process.env){
  profile=resolve(profile);
  const env = {
    ...inherited,
    HOME: profile,
    USERPROFILE: profile,
    CLAUDE_CONFIG_DIR: join(profile, '.claude'),
    CODEX_HOME: join(profile, '.codex'),
    XDG_CONFIG_HOME: join(profile, '.config'),
    XDG_CACHE_HOME: join(profile, '.cache'),
    XDG_DATA_HOME: join(profile, '.local/share'),
    APPDATA: join(profile, 'AppData/Roaming'),
    LOCALAPPDATA: join(profile, 'AppData/Local'),
    npm_config_cache: join(profile, '.npm-cache'),
    npm_config_userconfig: join(profile, '.npmrc'),
    npm_config_globalconfig: join(profile, 'npm-global.conf'),
    npm_config_prefix: join(profile, 'npm-global'),
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    CI: '1',
    NO_COLOR: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  for(const key of Object.keys(env))if(/(?:API_KEY|TOKEN|SECRET|PASSWORD)|^(?:AWS_|AZURE_|GOOGLE_|GCLOUD_)/i.test(key))delete env[key];
  return env;
}
function skillFiles(root,depth=0){
  if(depth>7)return[];
  return readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{
    if(e.isSymbolicLink()||['.git','node_modules'].includes(e.name))return[];
    const path=join(root,e.name);return e.isDirectory()?skillFiles(path,depth+1):e.name==='SKILL.md'?[path]:[];
  });
}
export function inspectIntegration(pack,source){
  if(!/^[\w.-]+\/[\w.-]+$/.test(pack.id)||!/^[a-f0-9]{40}$/.test(pack.sha)||!Array.isArray(pack.skills)||!pack.skills.length||pack.skills.some(s=>typeof s!=='string'||!s||s.startsWith('-')))throw Error('invalid integration identity, pin or selected skill');
  source=realpathSync(source);
  const git=spawnSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8',shell:false,windowsHide:true});
  if(git.status!==0||git.stdout.trim()!==pack.sha)throw Error('source commit does not match registry pin');
  const status=spawnSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8',shell:false,windowsHide:true});
  if(status.status!==0||status.stdout.trim())throw Error('qualification requires a clean pinned source checkout');
  let pluginDir=source,marketplace=null;
  if(pack.kind==='plugin'){
    marketplace=JSON.parse(readFileSync(join(source,'.claude-plugin/marketplace.json'),'utf8'));
    if(marketplace.name!==pack.marketplaceName)throw Error('marketplace name mismatch');
    const entry=marketplace.plugins.find(p=>p.name===pack.plugin);
    if(!entry||typeof entry.source!=='string'||!entry.source.startsWith('./'))throw Error('selected plugin has no local source entry');
    pluginDir=confined(source,resolve(source,entry.source));
    const manifest=JSON.parse(readFileSync(join(pluginDir,'.claude-plugin/plugin.json'),'utf8'));
    if(manifest.name!==pack.plugin)throw Error('plugin manifest name mismatch');
  }
  const candidates=skillFiles(pluginDir).map(path=>({path,name:readFileSync(path,'utf8').match(/^name:\s*["']?([^\r\n"']+)/m)?.[1]?.trim()}));
  const selected=pack.skills.map(name=>{
    const found=candidates.find(s=>s.name===name);
    if(!found)throw Error('selected skill frontmatter not found: '+name);
    const bytes=readFileSync(found.path);if(!/^description:/m.test(bytes.toString('utf8')))throw Error('skill description missing: '+name);
    return {name,path:relative(source,found.path).replaceAll('\\','/'),sha256:digest(bytes)};
  });
  return {commit:git.stdout.trim(),clean:true,pluginPath:relative(source,pluginDir).replaceAll('\\','/')||'.',selected};
}
function command(file,args,{cwd,env,log,timeout=120000}){
  const r=spawnSync(file,args,{cwd,env,encoding:'utf8',shell:false,windowsHide:true,timeout,maxBuffer:12*1024*1024});
  writeFileSync(log,cleanLog((r.stdout||'')+'\n'+(r.stderr||'')));
  return {command:[file,...args],exit:r.status,error:r.error?.message||null,log};
}
export function qualifyIntegrations({sourceBase,output,install=false,npxCli=join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js'),rows=null}={}){
  if(!sourceBase||!output)throw Error('sourceBase and output are required');
  output=resolve(output);if(existsSync(output))throw Error('output must be a new disposable directory');mkdirSync(output,{recursive:true});
  const packs=rows||JSON.parse(readFileSync(join(ROOT,'skills/ultimate-frontend-skills/data/integrations-2026-11-01.json'),'utf8'));
  const cli=install?findClaude():null;
  const results=[];
  for(const pack of packs){
    const key=pack.id.replaceAll('/','-'),profile=join(output,key),cwd=join(profile,'project');mkdirSync(cwd,{recursive:true});
    const result={id:pack.id,pin:pack.sha,license:pack.licence,level:'failed',commands:[],unverified:['No model inference, framework-wide suite, production backend or remote service action is exercised.']};
    try{
      const source=resolve(sourceBase,key);result.source=inspectIntegration(pack,source);result.level='pinned-source';
      if(install){
        const env=isolatedEnvironment(profile);for(const p of [env.CLAUDE_CONFIG_DIR,env.CODEX_HOME,env.APPDATA,env.LOCALAPPDATA])mkdirSync(p,{recursive:true});
        if(pack.kind==='plugin'){
          if(!cli)throw Error('Claude CLI unavailable');
          for(const [label,args]of [['validate',['plugin','validate',source]],['marketplace',['plugin','marketplace','add',source,'--json']],['install',['plugin','install',pack.plugin+'@'+pack.marketplaceName,'--scope','user','--json']],['list',['plugin','list','--json']]]){
            const c=command(cli.file,[...cli.prefix,...args],{cwd,env,log:join(profile,label+'.log')});result.commands.push(c);if(c.exit!==0)throw Error(label+' failed; see '+c.log);
          }
          const registry=JSON.parse(readFileSync(join(env.CLAUDE_CONFIG_DIR,'plugins/installed_plugins.json'),'utf8'));
          const installed=registry.plugins?.[pack.plugin+'@'+pack.marketplaceName]?.[0]?.installPath;
          if(!installed)throw Error('installed plugin absent from isolated registry');confined(profile,installed);
          const candidates=skillFiles(installed);
          result.installed=result.source.selected.map(s=>{const match=candidates.find(p=>digest(readFileSync(p))===s.sha256);if(!match)throw Error('installed skill differs from pinned source: '+s.name);return{name:s.name,path:relative(profile,match).replaceAll('\\','/'),sha256:s.sha256}});
        }else{
          if(!existsSync(npxCli))throw Error('npm npx-cli.js unavailable; provide its absolute path');
          for(const[label,args]of [['install',['--yes','skills@'+SKILLS_CLI_VERSION,'add',source,'--skill',...pack.skills,'--agent','claude-code','--copy','--yes','--json']],['list',['--yes','skills@'+SKILLS_CLI_VERSION,'list','--agent','claude-code','--json']]]){
            const c=command(process.execPath,[npxCli,...args],{cwd,env,log:join(profile,label+'.log')});result.commands.push(c);if(c.exit!==0)throw Error(label+' failed; see '+c.log);
          }
          const candidates=skillFiles(join(cwd,'.claude/skills'));
          result.installed=result.source.selected.map(s=>{const match=candidates.find(p=>digest(readFileSync(p))===s.sha256);if(!match)throw Error('installed skill differs from pinned source: '+s.name);return{name:s.name,path:relative(profile,match).replaceAll('\\','/'),sha256:s.sha256}});
          if(result.installed.length!==pack.skills.length)throw Error('selected skill count mismatch');
        }
        result.level='isolated-install-discovery';result.coreFlow='Selected instructions installed through the native host installer, listed, and matched byte-for-byte to the pinned source.';
      }
    }catch(err){result.error=err.message;result.level='failed'}
    results.push(result);writeFileSync(join(output,'qualification.json'),JSON.stringify({schema:1,generatedAt:new Date().toISOString(),install,skillsCliVersion:SKILLS_CLI_VERSION,results},null,2)+'\n');
  }
  return {ok:results.every(r=>r.level===(install?'isolated-install-discovery':'pinned-source')),output,results};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const [sourceBase, output, ...flags] = process.argv.slice(2);
    const result = qualifyIntegrations({ sourceBase, output, install: flags.includes('--install') });
    const results = result.results.map(({ id, level, error }) => ({ id, level, error }));
    console.log(JSON.stringify({ ok: result.ok, output: result.output, results }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (err) {
    console.error('qualify-integrations: ' + err.message);
    process.exitCode = 2;
  }
}
