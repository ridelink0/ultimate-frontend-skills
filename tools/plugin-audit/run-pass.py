import concurrent.futures,json,os,pathlib,re,subprocess,sys,time
root=pathlib.Path(os.environ.get('PLUGIN_AUDIT_ROOT', pathlib.Path.cwd()))
label=sys.argv[1]
out=root/label
out.mkdir(exist_ok=True)
env=dict(os.environ,PYTHONUTF8='1',PLUGIN_AUDIT_ROOT=str(root))
report_path=root/'buildwithclaude/hook-validation-report.json'
report_before=report_path.read_bytes() if report_path.exists() else None
jobs=[]
def add(name,repo,args):jobs.append((name,repo,args))
add('usage','claude-code-usage-limits',['node','--test'])
for name in ['policy','sessions','astra','build']:
 add('computer-'+name,'claude-computer-use',['node','tools/'+name+'-test.mjs'])
add('computer-start-apps','claude-computer-use',['node','--test','tools/start-apps-test.mjs'])
add('computer-driver','claude-computer-use',['node','--test','tools/driver-test.mjs'])
for repo in ['atelier','ultimate-frontend-skills']:
 files=sorted(str(p.relative_to(root/repo)) for p in (root/repo/'test').glob('*.test.mjs'))
 add(repo,repo,['node','--test']+files)
add('bwc-validation','buildwithclaude',['node','scripts/validate-all.js'])
add('bwc-pagination','buildwithclaude',['node','--test','scripts/github-search-pagination.test.js'])
add('bwc-unit','buildwithclaude',['node','--experimental-strip-types','--test','web-ui/lib/indexer/search-pagination.test.ts','web-ui/lib/search/search-types.test.ts','web-ui/lib/search/search-hydration.test.ts','web-ui/lib/stories-server.test.ts'])
add('bwc-skills','buildwithclaude',['node','--test','plugins/all-skills/skills/checkpointed-agent-loop/scripts/checkpoint-loop.test.mjs','plugins/all-skills/skills/rag-evaluation-harness/scripts/evaluate-rag.test.mjs'])
for name,repo,where in [('bwc','buildwithclaude','plugins/all-skills/skills/pdf/scripts'),('awesome','awesome-claude-skills','document-skills/pdf/scripts')]:
 add(name+'-pdf',repo+'/'+where,['python','-X','utf8','check_bounding_boxes_test.py'])
add('structure','',['node',str(pathlib.Path(__file__).parent/'audit-structure.cjs')])
add('frontmatter','',['node',str(pathlib.Path(__file__).parent/'audit-frontmatter.cjs')])
add('python','',['python','-X','utf8',str(pathlib.Path(__file__).parent/'audit-python.py')])
add('manifests','',['node',str(pathlib.Path(__file__).parent/'validate-manifests.cjs')])
def run(job):
 name,repo,args=job
 start=time.time()
 try:
  result=subprocess.run(args,cwd=root/repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=600)
  text=result.stdout.decode('utf8','replace');code=result.returncode
 except Exception as e:text=str(e);code=-1
 (out/(name+'.log')).write_text(text,encoding='utf8')
 row={'check':name,'exit':code,'seconds':round(time.time()-start,2)}
 print(json.dumps(row),flush=True)
 return row
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(run,jobs))
# Assertion-based postchecks: several legacy audit scripts report failures only in JSON.
for name,key in [('structure','issues'),('frontmatter','errors'),('python','errors')]:
 rows=json.loads((root/(name+'-results.json')).read_text(encoding='utf8'))
 errors=sum(len(r[key]) for r in rows)
 results.append({'check':name+'-findings','exit':int(errors>0),'findings':errors})
 (out/(name+'-results.json')).write_text(json.dumps(rows,indent=2),encoding='utf8')
rows=json.loads((root/'manifest-results.json').read_text(encoding='utf8'))
results.append({'check':'manifest-findings','exit':int(any(not r['success'] for r in rows)),'targets':len(rows),'failures':sum(not r['success'] for r in rows)})
(out/'manifest-results.json').write_text(json.dumps(rows,indent=2),encoding='utf8')
# Fresh scaffolds must have only their expected placeholder error and meta warning.
for repo,cli in [('atelier','atelier'),('ultimate-frontend-skills','webdesign')]:
 target=out/('scaffold-'+repo)
 made=subprocess.run(['node','scripts/'+cli+'.mjs','new',str(target),'--name','T'],cwd=root/repo,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 audit=subprocess.run(['node','scripts/'+cli+'.mjs','audit',str(target)],cwd=root/repo,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 text=audit.stdout.decode('utf8','replace')
 (out/('scaffold-'+repo+'.log')).write_text(text,encoding='utf8')
 ok=made.returncode==0 and audit.returncode==1 and '1 error(s), 1 warning(s)' in text and 'scaffold copy still present' in text
 results.append({'check':repo+'-scaffold','exit':int(not ok),'expectedPlaceholderFailure':True})
# Restore only this known generated validator report.
if report_before is not None: report_path.write_bytes(report_before)
elif report_path.exists(): report_path.unlink()
(out/'results.json').write_text(json.dumps(results,indent=2),encoding='utf8')
print(json.dumps({'pass':label,'checks':len(results),'failed':[r['check'] for r in results if r['exit']]}),flush=True)
sys.exit(int(any(r['exit'] for r in results)))
