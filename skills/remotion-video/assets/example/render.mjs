// Run only in a disposable copy after explicitly installing optional packages.
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia, renderStill } from '@remotion/renderer';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const browserExecutable=process.env.REMOTION_BROWSER_EXECUTABLE;
if(!browserExecutable||!existsSync(browserExecutable))throw Error('Set REMOTION_BROWSER_EXECUTABLE to an existing Chrome, Edge or Chromium executable; this example never downloads a browser.');
const output=resolve(process.argv[2]||join(here,'out'));mkdirSync(output,{recursive:true});
// A real writable temp directory avoids Windows app-container/profile path
// virtualization. Keep every newly launched browser's profile under this run.
const browserTemp=join(output,'browser-temp');mkdirSync(browserTemp,{recursive:true});
process.env.TEMP=browserTemp;process.env.TMP=browserTemp;process.env.TMPDIR=browserTemp;
const serveUrl=await bundle({entryPoint:join(here,'Root.mjs'),outDir:join(output,'bundle')});
const composition=await selectComposition({serveUrl,id:'WorkflowReview',browserExecutable});
const options={composition,serveUrl,browserExecutable,logLevel:'error',concurrency:1};
for(const frame of [0,33,66,102,119])await renderStill({...options,frame,output:join(output,'frame-'+String(frame).padStart(3,'0')+'.png')});
await renderMedia({...options,codec:'h264',pixelFormat:'yuv420p',outputLocation:join(output,'workflow-review.mp4')});
writeFileSync(join(output,'render-receipt.json'),JSON.stringify({composition:{id:composition.id,width:composition.width,height:composition.height,fps:composition.fps,durationInFrames:composition.durationInFrames},frames:[0,33,66,102,119],video:'workflow-review.mp4',note:'Original UFS composition; no audio track or external media. Validate decoder output separately.'},null,2)+'\n');
console.log(join(output,'workflow-review.mp4'));
