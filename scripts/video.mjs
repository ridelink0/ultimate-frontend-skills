import { spawn, spawnSync } from 'node:child_process';
import { resolve, join, basename, dirname, relative } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function studyVideo(file, { out, frames = 8 } = {}) {
  if (!existsSync(file)) throw new Error('Video does not exist: ' + file);
  if (!Number.isInteger(frames) || frames < 2 || frames > 24) throw new Error('Frames must be between 2 and 24.');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', resolve(file)], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000 });
  if (probe.status !== 0) throw new Error('ffprobe failed; install FFmpeg and check the input video.');
  const duration = Number(JSON.parse(probe.stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video duration is unavailable.');
  const dir = resolve(out || 'video-review'); mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < frames; i++) {
    const time = duration * (i + 0.5) / frames;
    const target = join(dir, 'frame-' + String(i + 1).padStart(2, '0') + '.jpg');
    const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', resolve(file), '-frames:v', '1', '-vf', 'scale=960:-2', '-y', target], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000 });
    if (run.status !== 0) throw new Error('FFmpeg could not extract frame ' + (i + 1));
    files.push({ file: target, seconds: time });
  }
  writeFileSync(join(dir, 'frames.json'), JSON.stringify({ duration, frames: files }, null, 2) + '\n');
  return files;
}

/* ------------------------------------------------------------ making video --
   A video here is a web page rendered one frame at a time. The page exposes
   window.ufsFrame(t), a pure function of time; the renderer seeks it to every
   frame, screenshots the viewport and pipes the PNGs into ffmpeg. Nothing is
   recorded in real time, so a slow machine makes a slow render, never a
   stuttering one, and the same scene renders the same file twice. */

const IMAGE = /\.(jpe?g|png|webp|avif)$/i;
const CLIP = /\.(mp4|mov|m4v|webm)$/i;

export function parseSize(size) {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(size || '').trim());
  if (!m) throw new Error('Size must look like 1920x1080.');
  // H.264 in yuv420p needs even sides.
  const even = (n) => Math.max(16, Math.min(4096, Number(n) - (Number(n) % 2)));
  return [even(m[1]), even(m[2])];
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Copies still references in as plates, links clips by file URL (footage is
   often gigabytes), pulls study frames from every clip so its look can be
   read before anything is written, and writes a scene that already follows
   references/video-tells.md: unequal shot lengths, hard cuts, one move per
   shot, grain that changes every frame, a held last frame. */
export function makeScene(dir, { refs = [], seconds = 12, size = '1920x1080', title = 'Untitled', fps = 30 } = {}) {
  const [width, height] = parseSize(size);
  if (!(seconds >= 1 && seconds <= 600)) throw new Error('Seconds must be between 1 and 600.');
  if (!(fps >= 12 && fps <= 60)) throw new Error('Frame rate must be between 12 and 60.');
  const out = resolve(dir);
  if (existsSync(join(out, 'scene.html'))) throw new Error('A scene already exists in ' + out + '; give the new one its own folder.');
  mkdirSync(join(out, 'refs'), { recursive: true });
  const plates = [], clips = [], studied = [];
  refs.forEach((ref, i) => {
    const file = resolve(ref);
    if (!existsSync(file)) throw new Error('Reference does not exist: ' + ref);
    const n = String(i + 1).padStart(2, '0');
    if (IMAGE.test(file)) {
      const name = n + '-' + basename(file).replace(/[^\w.-]/g, '_');
      copyFileSync(file, join(out, 'refs', name));
      plates.push({ kind: 'img', src: 'refs/' + name });
    } else if (CLIP.test(file)) {
      const frames = studyVideo(file, { out: join(out, 'refs', 'clip-' + n), frames: 8 });
      studied.push({ source: file, frames: frames.map((f) => relative(out, f.file).replace(/\\/g, '/')) });
      plates.push({ kind: 'clip', src: pathToFileURL(file).href });
      clips.push(pathToFileURL(file).href);
    } else throw new Error('Unsupported reference: ' + ref + ' (stills: jpg png webp avif; clips: mp4 mov m4v webm)');
  });
  const meta = { title, seconds, fps, width, height, plates: plates.filter((p) => p.kind === 'img').map((p) => p.src), clips, studied };
  writeFileSync(join(out, 'video.json'), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(join(out, 'scene.html'), sceneHtml({ title, seconds, fps, width, height, plates }));
  return { dir: out, scene: join(out, 'scene.html'), ...meta };
}

function sceneHtml({ title, seconds, fps, width, height, plates }) {
  const shots = plates.map((p, i) => p.kind === 'img'
    ? '    <figure class="shot"><img src="' + esc(p.src) + '" alt=""></figure>'
    : '    <figure class="shot"><video src="' + esc(p.src) + '" muted playsinline preload="auto"></video></figure>').join('\n');
  const type = Math.round(Math.min(width, height) * (width >= height ? 0.105 : 0.12));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300..600&display=swap" rel="stylesheet">
<style>
  /* Everything below is the starting cut. Rewrite the copy, the order and the
     moves for the brief; keep ufsFrame a pure function of t. */
  :root { --ground: oklch(0.15 0.012 75); --ink: oklch(0.94 0.014 85); }
  html, body { margin: 0; background: var(--ground); }
  #stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: var(--ground); color: var(--ink); font-family: Newsreader, Georgia, serif; }
  #camera { position: absolute; inset: 0; }
  .shot { position: absolute; inset: 0; margin: 0; visibility: hidden; }
  .shot img, .shot video { width: 100%; height: 100%; object-fit: cover; display: block; transform-origin: 50% 46%; }
  .title { position: absolute; left: 7.5%; bottom: 11%; margin: 0; max-width: 13ch; font-size: ${type}px; line-height: 0.92; letter-spacing: -0.024em; font-weight: 320; font-variation-settings: "opsz" 72; text-wrap: balance; opacity: 0; }
  .scrim { position: absolute; inset: 0; background: linear-gradient(to top, oklch(0.12 0.01 75 / 0.62), transparent 55%); opacity: 0; }
  .grain { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.09; mix-blend-mode: overlay; pointer-events: none; }
  .fade { position: absolute; inset: 0; background: var(--ground); opacity: 0; }
</style>
</head>
<body>
<div id="stage">
  <div id="camera">
${shots}
  </div>
  <div class="scrim"></div>
  <h1 class="title">${esc(title)}</h1>
  <svg class="grain" aria-hidden="true"><filter id="g"><feTurbulence id="turb" type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="1"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>
  <div class="fade"></div>
</div>
<script>
  // The whole film as a function of time. The renderer calls ufsFrame(t) once
  // per frame and waits for it; nothing here may read the clock or roll dice.
  var DURATION = ${seconds}, FPS = ${fps};
  var shots = Array.prototype.slice.call(document.querySelectorAll('.shot'));
  var title = document.querySelector('.title'), scrim = document.querySelector('.scrim');
  var fade = document.querySelector('.fade'), turb = document.getElementById('turb');
  var camera = document.getElementById('camera');
  // Unequal lengths: a cut on an even grid is the first thing that reads as generated.
  var WEIGHTS = [1.35, 0.8, 1.1, 0.7, 1.5, 0.9];
  var spans = (function () {
    var w = shots.map(function (_, i) { return WEIGHTS[i % WEIGHTS.length]; });
    var sum = w.reduce(function (a, b) { return a + b; }, 0) || 1, at = 0;
    return w.map(function (x) { var s = { a: at, b: at + DURATION * x / sum }; at = s.b; return s; });
  })();
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function seg(t, a, b) { return clamp01((t - a) / (b - a)); }
  function inOut(x) { return 0.5 - Math.cos(Math.PI * x) / 2; }
  function outCubic(x) { return 1 - Math.pow(1 - x, 3); }
  // Operator drift: incommensurate sines, a few pixels, never a perfect glide.
  function drift(t) {
    var k = Math.min(${width}, ${height}) * 0.0022;
    return [k * (Math.sin(t * 0.71) + 0.45 * Math.sin(t * 1.93 + 1.1)), k * (Math.sin(t * 0.53 + 2.0) + 0.4 * Math.sin(t * 1.61))];
  }
  function waitFor(el, ev) { return new Promise(function (r) { el.addEventListener(ev, r, { once: true }); }); }
  window.ufsFrame = async function (t) {
    var d = drift(t);
    camera.style.transform = 'translate(' + d[0].toFixed(2) + 'px,' + d[1].toFixed(2) + 'px)';
    var seeks = [];
    shots.forEach(function (shot, i) {
      var s = spans[i], on = t >= s.a && (t < s.b || i === shots.length - 1);
      shot.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return;
      var p = inOut(seg(t, s.a, s.b)), media = shot.firstElementChild, move = i % 3, tf;
      if (move === 0) tf = 'scale(' + (1.03 + 0.05 * p).toFixed(4) + ')';
      else if (move === 1) tf = 'scale(1.07) translateX(' + (-1.4 + 2.8 * p).toFixed(3) + '%)';
      else tf = 'scale(1.035)';
      media.style.transform = tf;
      if (media.tagName === 'VIDEO') {
        seeks.push((async function () {
          if (media.readyState < 2) await waitFor(media, 'loadeddata');
          var want = Math.min(Math.max(0, (media.duration || 0) - 0.05), t - s.a);
          if (Math.abs(media.currentTime - want) > 0.001) { var done = waitFor(media, 'seeked'); media.currentTime = want; await done; }
        })());
      }
    });
    var tin = outCubic(seg(t, 0.35, 1.25)), tout = seg(t, 2.7, 3.2);
    title.style.opacity = (tin * (1 - tout)).toFixed(3);
    title.style.transform = 'translateY(' + ((1 - tin) * 0.3).toFixed(3) + 'em)';
    scrim.style.opacity = (0.9 * tin * (1 - tout)).toFixed(3);
    fade.style.opacity = seg(t, DURATION - 0.5, DURATION).toFixed(3);
    // Real grain changes every frame; a still noise layer is a tell.
    turb.setAttribute('seed', String(Math.floor(t * FPS) % 97 + 1));
    await Promise.all(seeks);
  };
  window.ufsFrame(0);
</script>
</body>
</html>
`;
}

async function evaluate(session, expression) {
  const r = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('Scene script failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]);
  return r.result?.value;
}

function tool(name) {
  const r = spawnSync(name, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (r.status !== 0) throw new Error(name + ' is not installed or not on PATH; install FFmpeg first.');
}

/* Renders a scene page to an MP4. Defaults come from video.json beside the
   scene; flags override. `draft` renders at half resolution with a fast
   encode, for looking at the cut before paying for the final. */
export async function renderVideo(scene, { out, fps, seconds, width, height, draft = false, audio = null, onFrame = null } = {}) {
  const file = resolve(scene);
  if (!existsSync(file)) throw new Error('Scene does not exist: ' + scene);
  let meta = {};
  const metaFile = join(dirname(file), 'video.json');
  if (existsSync(metaFile)) { try { meta = JSON.parse(readFileSync(metaFile, 'utf8')); } catch { throw new Error('video.json beside the scene is not valid JSON.'); } }
  fps = Number(fps || meta.fps || 30);
  seconds = Number(seconds || meta.seconds || 10);
  [width, height] = parseSize((width || meta.width || 1920) + 'x' + (height || meta.height || 1080));
  if (!(fps >= 1 && fps <= 120)) throw new Error('Frame rate must be between 1 and 120.');
  if (!(seconds > 0 && seconds <= 600)) throw new Error('Seconds must be above 0 and at most 600.');
  if (audio && !existsSync(resolve(audio))) throw new Error('Audio file does not exist: ' + audio);
  tool('ffmpeg');
  const { findBrowser, launch, Session, closeBrowser } = await import('./inspect.mjs');
  const bin = findBrowser();
  if (!bin) throw new Error('No Chrome, Edge or Chromium found; set ATELIER_BROWSER to one.');
  const target = resolve(out || join(dirname(file), draft ? 'draft.mp4' : 'video.mp4'));
  mkdirSync(dirname(target), { recursive: true });
  const scale = draft ? 0.5 : 1;
  const outW = Math.round(width * scale / 2) * 2, outH = Math.round(height * scale / 2) * 2;

  const browser = await launch(bin);
  let session, ff;
  try {
    session = await Session.open(browser.port);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    await session.send('Page.navigate', { url: pathToFileURL(file).href });
    await session.waitForEvent('Page.loadEventFired', 30000);
    await evaluate(session, 'document.fonts.ready.then(function () { return true; })');
    // A page without ufsFrame is still renderable: every CSS/Web Animation and
    // a GSAP global timeline are paused and seeked instead.
    await evaluate(session, `(function () {
      if (typeof window.ufsFrame === 'function') return 'ufsFrame';
      window.ufsFrame = function (t) {
        document.getAnimations().forEach(function (a) { a.pause(); a.currentTime = t * 1000; });
        if (window.gsap && gsap.globalTimeline) { gsap.globalTimeline.pause(); gsap.globalTimeline.seek(t); }
      };
      return 'seek';
    })()`);
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
    if (audio) args.push('-i', resolve(audio));
    args.push('-vf', 'scale=' + outW + ':' + outH + ':flags=lanczos', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '26' : '16', '-r', String(fps), '-movflags', '+faststart');
    if (audio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    args.push(target);
    ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr += d; if (ffErr.length > 8000) ffErr = ffErr.slice(-4000); });
    const closed = new Promise((res) => ff.on('close', res));
    let stdinError = null;
    ff.stdin.on('error', (e) => { stdinError = e; });
    const total = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < total; i++) {
      const t = i / fps;
      await evaluate(session, 'Promise.resolve(window.ufsFrame(' + t + ')).then(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); })');
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      if (stdinError || ff.exitCode !== null) break;
      if (!ff.stdin.write(Buffer.from(shot.data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
      if (onFrame) onFrame(i + 1, total);
    }
    ff.stdin.end();
    const code = await closed;
    if (code !== 0 || stdinError) throw new Error('ffmpeg failed: ' + (ffErr.trim().split('\n').pop() || (stdinError && stdinError.message) || 'exit ' + code));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=width,height,nb_read_packets:format=duration', '-of', 'json', target], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    let info = {};
    try { const j = JSON.parse(probe.stdout); info = { width: j.streams[0].width, height: j.streams[0].height, frames: Number(j.streams[0].nb_read_packets), duration: Number(j.format.duration) }; } catch {}
    return { file: target, fps, seconds, requested: { width, height, frames: total }, ...info, draft };
  } finally {
    try { if (ff && ff.exitCode === null) ff.stdin.end(); } catch {}
    try { session?.close(); } catch {}
    // Not just a kill: the throwaway profile has to go too, and only after the
    // browser process is gone (see inspect.mjs closeBrowser).
    await closeBrowser(browser);
  }
}
