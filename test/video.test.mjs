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

test('stills and a clip render to an MP4 with exactly the requested frames', { skip: !(hasFfmpeg && findBrowser()), timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 180000 }, async () => {
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

/* references/motion-graphics.md: copy is counted before it is animated, and
   on-screen text and captions keep Netflix's reading rules. */
import { writeFileSync as writeFile } from 'node:fs';
import { lintVideo } from '../scripts/video.mjs';
import { parseCues, checkCaptions, splitCaptions, toSrt, RULES } from '../scripts/captions.mjs';

const words = (n) => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');
function scene(seconds, body, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-lint-'));
  writeFile(join(dir, 'video.json'), JSON.stringify({ seconds }));
  writeFile(join(dir, 'scene.html'), `<!doctype html><title>t</title><style>.a{}</style><script>var x = "not copy";</script><p>${body}</p>`);
  for (const [f, t] of Object.entries(extra)) writeFile(join(dir, f), t);
  return dir;
}

test('video lint warns when the copy outruns the runtime, and counts a narration script', () => {
  const ok = scene(15, words(30));
  const fast = scene(15, words(60));
  const vo = scene(15, words(10), { 'script.txt': words(50) });
  try {
    assert.deepEqual(lintVideo(ok).findings, []);
    const f = lintVideo(fast);
    assert.equal(f.words, 60);
    assert.equal(f.findings.length, 1);
    assert.equal(f.findings[0].rule, 'video-script-density');
    assert.match(f.findings[0].text, /60 words in 15 s is 4\.0 a second/);
    assert.equal(lintVideo(vo).words, 60);
  } finally { for (const d of [ok, fast, vo]) rmSync(d, { recursive: true, force: true }); }
});

test('captions: a line over 42 characters or a third line is an error; too fast, too short or too long a warning', () => {
  const srt = `1\n00:00:00,000 --> 00:00:02,000\nA short line\n\n2\n00:00:02,000 --> 00:00:04,000\nThis caption line is far longer than forty-two characters\n\n3\n00:00:04,000 --> 00:00:06,000\none\ntwo\nthree\n\n4\n00:00:06,000 --> 00:00:06,500\nToo quick\n\n5\n00:00:07,000 --> 00:00:15,000\nToo long on screen\n\n6\n00:00:15,000 --> 00:00:16,000\nThis is a lot of text to read in one second\n`;
  const found = checkCaptions(parseCues(srt));
  const at = (cue) => found.filter((f) => f.cue === cue).map((f) => f.level + ' ' + f.text);
  assert.deepEqual(at(1), []);
  assert.match(at(2).join(), /^error cue 2 has a line of \d+ characters/);
  assert.match(at(3).join(), /^error cue 3 has 3 lines/);
  assert.match(at(4).join(), /warn cue 4 is on screen 0\.50 s/);
  assert.match(at(5).join(), /warn cue 5 is on screen 8\.00 s/);
  assert.match(at(6).join(), /warn cue 6 asks for \d+\.\d characters per second/);
  // WebVTT, tags and all, reads the same way.
  assert.deepEqual(parseCues('WEBVTT\n\n00:01.000 --> 00:03.000 align:start\n<v Ana><i>Hello</i> there\n'), [{ start: 1, end: 3, lines: ['Hello there'] }]);
  const dir = scene(20, words(10), { 'captions.srt': srt });
  try { assert.ok(lintVideo(dir).findings.some((f) => f.level === 'error' && /captions\.srt: cue 2/.test(f.text))); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('timed words are split into captions that keep every reading rule', () => {
  const text = 'Wood-fired stoneware from the old mill on Kiln Row. It is fired twice a year and sold from the yard, and the next firing is in October. Bring a box.';
  const ws = text.split(' ').map((word, i) => ({ word, start: i * 0.32 + (i > 9 ? 0.4 : 0), end: i * 0.32 + 0.28 + (i > 9 ? 0.4 : 0) }));
  const cues = splitCaptions(ws);
  assert.ok(cues.length >= 3, JSON.stringify(cues));
  assert.deepEqual(checkCaptions(cues).filter((f) => f.level === 'error' || /characters per second|at most 7/.test(f.text)), []);
  assert.equal(cues.map((c) => c.lines.join(' ')).join(' '), text, 'no word lost or reordered');
  assert.ok(cues.every((c) => c.lines.length <= RULES.maxLines && c.lines.every((l) => l.length <= RULES.maxLine)));
  assert.match(toSrt(cues), /^1\n00:00:00,000 --> 00:00:0\d,\d{3}\n/);
  assert.match(toSrt([{ start: 1.9996, end: 3, lines: ['x'] }]), /00:00:02,000 --> 00:00:03,000/);
});

/* references/editing.md: the edit tools either run or say plainly that they
   could not. */
import * as edit from '../scripts/edit.mjs';

test('edit deliver sets a quiet track to -14 LUFS with its true peak under -1 dBTP', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-deliver-'));
  try {
    const src = join(dir, 'tone.wav');
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-af', 'volume=-9dB', '-ar', '48000', src);
    const before = edit.loudness(src);
    assert.ok(before.lufs < -25, 'the fixture should start quiet: ' + before.lufs);
    const r = edit.deliver(src, { for: 'youtube' });
    assert.ok(Math.abs(r.after.lufs + 14) <= 1, 'landed at ' + r.after.lufs);
    assert.ok(r.after.truePeak <= -1, 'true peak ' + r.after.truePeak);
    assert.deepEqual(r.notes, []);
    assert.throws(() => edit.deliver(src, { for: 'radio' }), /unknown target "radio"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('edit scenes finds a hard cut, and a missing tool is named instead of faked', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-scenes-'));
  try {
    const clip = join(dir, 'cut.mp4');
    ff('-f', 'lavfi', '-i', 'color=c=0x2a1f14:s=320x180:d=2:r=25', '-f', 'lavfi', '-i', 'color=c=0xe8dcc8:s=320x180:d=2:r=25',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-pix_fmt', 'yuv420p', clip);
    const s = edit.scenes(clip);
    assert.ok(s.cuts.some((t) => Math.abs(t - 2) < 0.2), JSON.stringify(s));
    if (!edit.has('auto-editor')) {
      assert.throws(() => edit.cutSilence(clip), (e) => e.code === 'missing' && /auto-editor is not installed, so the silence cut did not run/.test(e.message));
    }
    assert.throws(() => edit.transcribe(clip, { bin: 'no-such-whisper-bin' }), (e) => e.code === 'missing' && /not installed/.test(e.message));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('whisper.cpp JSON becomes timed words, and edit captions writes an SRT that keeps the rules', () => {
  const json = { transcription: [{ tokens: [
    { text: '[_BEG_]', offsets: { from: 0, to: 0 } }, { text: ' The', offsets: { from: 0, to: 300 } }, { text: ' kiln', offsets: { from: 300, to: 700 } },
    { text: ' is', offsets: { from: 700, to: 900 } }, { text: ' l', offsets: { from: 900, to: 1100 } }, { text: 'it.', offsets: { from: 1100, to: 1400 } },
  ] }] };
  assert.deepEqual(edit.wordsFrom(json).map((w) => w.word), ['The', 'kiln', 'is', 'lit.']);
  const dir = mkdtempSync(join(tmpdir(), 'ufs-caps-'));
  try {
    writeFile(join(dir, 'words.json'), JSON.stringify(json));
    const r = edit.captions(join(dir, 'words.json'));
    assert.equal(r.cues, 1);
    assert.deepEqual(r.findings, []);
    assert.match(readFileSync(r.file, 'utf8'), /^1\n00:00:00,000 --> 00:00:01,400\nThe kiln is lit\.\n/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* The real programs, where they are installed (on PATH, or named by
   UFS_SCENEDETECT, UFS_AUTO_EDITOR and UFS_WHISPER with UFS_WHISPER_MODEL).
   Registered only where they are all there, because CI fails any run with a
   skipped test and does not install them; the wrappers' "not installed" path
   is tested above on every machine. */
const toolsHere = hasFfmpeg && edit.has('scenedetect') && edit.has('auto-editor') && edit.has('whisper-cli') && Boolean(process.env.UFS_WHISPER_MODEL);
if (toolsHere) test('edit drives PySceneDetect, auto-editor and whisper.cpp when they are installed', { timeout: 600000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-tools-'));
  try {
    const clip = join(dir, 'cut.mp4');
    ff('-f', 'lavfi', '-i', 'color=c=0x2a1f14:s=320x180:d=2:r=25', '-f', 'lavfi', '-i', 'color=c=0xe8dcc8:s=320x180:d=2:r=25',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-pix_fmt', 'yuv420p', clip);
    const s = edit.scenes(clip);
    assert.equal(s.via, 'scenedetect');
    assert.ok(s.cuts.some((t) => Math.abs(t - 2) < 0.2), JSON.stringify(s));
    const gaps = join(dir, 'gaps.wav');
    ff('-f', 'lavfi', '-i', 'sine=f=440:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=3', '-f', 'lavfi', '-i', 'sine=f=660:d=2',
      '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]', '-map', '[a]', gaps);
    const cut = edit.cutSilence(gaps);
    const d = edit.probe(cut.file).duration;
    assert.ok(d > 3.5 && d < 5.5, 'the 3 s of silence should be gone from a 7 s file: ' + d);
    const tone = join(dir, 'tone.wav');
    ff('-f', 'lavfi', '-i', 'sine=f=440:d=2', tone);
    const t = edit.transcribe(tone, { model: process.env.UFS_WHISPER_MODEL });
    assert.ok(existsSync(t.json) && existsSync(t.srt), JSON.stringify(t));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
