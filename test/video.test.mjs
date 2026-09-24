import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeScene, renderVideo, parseSize } from '../scripts/video.mjs';
import { findBrowser } from '../scripts/inspect.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;
const ff = (...args) => assert.equal(spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true }).status, 0);

test('sizes are parsed to even sides and nonsense is refused', () => {
  assert.deepEqual(parseSize('1081x1921'), [1080, 1920]);
  assert.throws(() => parseSize('big'), /1920x1080/);
});

test('a scene never overwrites another scene, and unknown references are refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-video-'));
  try {
    makeScene(dir, { seconds: 2, size: '320x180', title: 'Held' });
    assert.throws(() => makeScene(dir, { seconds: 2 }), /already exists/);
    assert.throws(() => makeScene(join(dir, 'b'), { refs: [join(dir, 'video.json')] }), /Unsupported reference/);
    assert.throws(() => makeScene(join(dir, 'c'), { refs: [join(dir, 'missing.png')] }), /does not exist/);
    const html = readFileSync(join(dir, 'scene.html'), 'utf8');
    assert.match(html, /window\.ufsFrame = async function/);
    assert.doesNotMatch(html, /Math\.random|Date\.now|performance\.now/, 'a scene must be a pure function of t');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stills and a clip render to an MP4 with exactly the requested frames', { skip: !(hasFfmpeg && findBrowser()), timeout: 180000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-video-'));
  try {
    ff('-f', 'lavfi', '-i', 'color=c=0x8a6a3a:s=320x200', '-frames:v', '1', join(dir, 'a.png'));
    ff('-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'c.mp4'));
    const scene = makeScene(join(dir, 'cut'), { refs: [join(dir, 'a.png'), join(dir, 'c.mp4')], seconds: 1, fps: 12, size: '320x180', title: 'Test' });
    assert.equal(scene.plates.length, 1);
    assert.equal(scene.clips.length, 1);
    assert.equal(scene.studied[0].frames.length, 8);
    const out = await renderVideo(scene.scene, { draft: true });
    assert.ok(existsSync(out.file));
    assert.equal(out.frames, 12);
    assert.equal(out.width, 160);
    assert.equal(out.height, 90);
    assert.ok(Math.abs(out.duration - 1) < 0.05, 'duration ' + out.duration);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
