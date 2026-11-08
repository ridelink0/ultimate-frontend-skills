import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkSource, checkThree, stripComments, RULES } from '../scripts/three-mistakes.mjs';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TUTORIAL = `import * as THREE from 'three';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputEncoding = THREE.sRGBEncoding;
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; renderer.setSize(innerWidth, innerHeight); });
const tex = new THREE.TextureLoader().load('wood.jpg');
function animate() {
  requestAnimationFrame(animate);
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const p = new THREE.Vector3(1, 2, 3);
  renderer.render(scene, camera);
}
const spin = () => { requestAnimationFrame(spin); renderer.render(scene, camera); };
animate(); spin();
export function teardown() { scene.clear(); renderer.domElement.remove(); }
`;
const CLEAN = `import * as THREE from 'three';
// renderer.setPixelRatio(devicePixelRatio) is the tutorial line; not this one.
const docs = 'https://threejs.org/manual/'; const re = /['"\`]/;
let renderer; try { renderer = new THREE.WebGLRenderer(); } catch { renderer = null; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
const _v = new THREE.Vector3();
const resize = () => { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
new ResizeObserver(resize).observe(stage);
let running = false;
function frame() { _v.set(1, 2, 3); renderer.render(scene, camera); if (running) requestAnimationFrame(frame); }
new IntersectionObserver(([e]) => { running = e.isIntersecting; if (running) requestAnimationFrame(frame); }).observe(stage);
document.addEventListener('visibilitychange', () => { running = !document.hidden; });
const tex = new THREE.TextureLoader().load('a.jpg'); tex.colorSpace = THREE.SRGBColorSpace;
export function teardown() { renderer.dispose(); renderer.domElement.remove(); }
`;

test('the tutorial scene fires every mistake it makes, on the right line, with why and how to avoid it', () => {
  const rows = checkSource(TUTORIAL);
  const at = Object.fromEntries(rows.map((r) => [r.rule, r.line]));
  assert.deepEqual(at, { 'dpr-uncapped': 3, 'stale-api': 4, 'aspect-without-projection': 6, 'texture-colorspace': 7,
    'loop-never-pauses': 9, 'gpu-alloc-per-frame': 10, 'per-frame-allocation': 11, 'several-render-loops': 14,
    'teardown-without-dispose': 16, 'no-webgl-fallback': 2 });
  for (const rule of Object.keys(RULES)) {
    assert.ok(RULES[rule].why.length > 60 && RULES[rule].avoid.length > 40, rule + ' explains too little');
    assert.match(RULES[rule].level, /^(error|warn)$/);
  }
});

test('the same scene written correctly, with the tutorial line in a comment and quotes in strings and regex, is clean', () => {
  assert.deepEqual(checkSource(CLEAN), []);
  const stripped = stripComments(CLEAN);
  assert.equal(stripped.length, CLEAN.length);
  assert.ok(stripped.includes("'https://threejs.org/manual/'"), 'a URL in a string is not a comment');
  assert.ok(!stripped.includes('tutorial line'));
});

test('a renderer without resize or with a resize that forgets the camera is caught; code without three is not checked', () => {
  assert.ok(checkSource('const r = new THREE.WebGLRenderer(); try{}catch{}').some((f) => f.rule === 'no-resize'));
  const squash = 'let r; try { r = new THREE.WebGLRenderer(); } catch {}\nconst c = new THREE.PerspectiveCamera();\nnew ResizeObserver(() => r.setSize(w, h));';
  assert.equal(checkSource(squash).find((f) => f.rule === 'resize-ignores-aspect')?.line, 3);
  assert.equal(checkSource('document.body.append("plain page")'), null);
});

test('an HTML page is read through its scripts and keeps its line numbers', () => {
  const html = '<!doctype html>\n<p>renderer.setPixelRatio(devicePixelRatio)</p>\n<script type="module">\nimport * as THREE from "three";\nrenderer.setPixelRatio(devicePixelRatio);\n</script>\n';
  assert.deepEqual(checkSource(html, { html: true }).map((f) => [f.rule, f.line]), [['dpr-uncapped', 5]]);
});

test('second pass: pause and resume, no-semicolon loops, other namespaces, promise catch, names in strings', () => {
  const resume = 'let r; try { r = new THREE.WebGLRenderer(); } catch {}\nnew ResizeObserver(f).observe(s);\nfunction animate() { r.render(scene, camera); }\nr.setAnimationLoop(animate);\ndocument.addEventListener("visibilitychange", () => r.setAnimationLoop(document.hidden ? null : animate));\nr.setAnimationLoop(animate);';
  assert.deepEqual(checkSource(resume).map((f) => f.rule), [], 'a paused and resumed loop is one loop');
  const asi = 'import * as THREE from "three"\nfunction animate() {\n  renderer.render(scene, camera)\n  requestAnimationFrame(animate)\n}';
  assert.equal(checkSource(asi).find((f) => f.rule === 'loop-never-pauses')?.line, 4, 'a loop without semicolons still runs forever');
  const guarded = 'import * as THREE from "three"\nfunction animate() {\n  renderer.render(scene, camera)\n  if (running) requestAnimationFrame(animate)\n}';
  assert.ok(!checkSource(guarded).some((f) => f.rule === 'loop-never-pauses'), 'an if head still makes it conditional');
  const ns = 'import * as T from "three"\nconst r = new T.WebGLRenderer();\nfetch(u).catch(() => {});\nfunction tick() { requestAnimationFrame(tick); const m = new T.MeshBasicMaterial(); r.render(s, c); }';
  const rules = checkSource(ns).map((f) => f.rule);
  for (const rule of ['no-webgl-fallback', 'gpu-alloc-per-frame', 'no-resize']) assert.ok(rules.includes(rule), rule + ' missed under another namespace or behind a promise catch');
  const msg = 'import * as THREE from "three"\nconsole.warn("outputEncoding was removed; setPixelRatio(devicePixelRatio) is the old way");';
  assert.deepEqual(checkSource(msg), [], 'an API name inside a message is not a use of it');
});

test('skipped files are named, the library is skipped even minified, and a mistyped flag is a usage error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-three-skip-'));
  try {
    writeFileSync(join(dir, 'three.min.js'), 'const REVISION="170";var THREE={};function a(){new WebGLRenderer()}');
    const result = checkThree(dir);
    assert.deepEqual(result.checked, []);
    assert.deepEqual(result.skipped, [{ file: 'three.min.js', reason: 'the three.js library itself' }]);
    const run = (args) => spawnSync(process.execPath, [join(root, 'scripts', 'three-mistakes.mjs'), ...args], { encoding: 'utf8' });
    const none = run([dir]);
    assert.equal(none.status, 2); assert.match(none.stderr, /Skipped: three\.min\.js/);
    const json = run([dir, '--json']);
    assert.equal(json.status, 2); assert.deepEqual(JSON.parse(json.stdout).checked, []);
    const typo = run([dir, '--jsn']);
    assert.equal(typo.status, 2); assert.match(typo.stderr, /unknown flag --jsn/);
    assert.equal(run([dir, dir]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the shipped three.js scenes pass their own checker', () => {
  for (const file of ['exploded.js', 'sky.js']) {
    const result = checkThree(join(root, 'skills/ultimate-frontend-skills/assets', file));
    assert.equal(result.checked.length, 1, file + ' was not recognised as three.js code');
    assert.deepEqual(result.findings.map((f) => f.rule + ':' + f.line), [], file);
  }
});

test('the CLI and webdesign three exit 1 on errors, 0 when clean, 2 when there is nothing to check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-three-'));
  try {
    for (const d of ['bad', 'good', 'none']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'bad', 'main.js'), TUTORIAL);
    writeFileSync(join(dir, 'good', 'main.js'), CLEAN);
    writeFileSync(join(dir, 'none', 'main.js'), 'console.log(1)');
    const run = (script, args) => spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { encoding: 'utf8' });
    const bad = run('three-mistakes.mjs', [join(dir, 'bad'), '--json']);
    assert.equal(bad.status, 1);
    const report = JSON.parse(bad.stdout);
    assert.equal(report.findings.find((f) => f.rule === 'dpr-uncapped').file, 'main.js');
    assert.match(report.findings[0].avoid, /\w/);
    assert.equal(run('three-mistakes.mjs', [join(dir, 'good')]).status, 0);
    const none = run('three-mistakes.mjs', [join(dir, 'none')]);
    assert.equal(none.status, 2); assert.match(none.stderr, /nothing was checked/);
    assert.equal(run('three-mistakes.mjs', []).status, 2);
    const via = run('webdesign.mjs', ['three', join(dir, 'bad')]);
    assert.equal(via.status, 1); assert.match(via.stdout, /why: /); assert.match(via.stdout, /instead: /);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
