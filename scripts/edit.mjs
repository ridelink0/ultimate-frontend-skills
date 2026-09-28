/* ultimate-frontend-skills/edit - editing real footage, with the tools an
   agent can drive. references/editing.md is the craft; this is the plumbing.

   Every wrapper finds its program first and, when it is not installed, says
   so and stops: nothing here pretends a step ran. ffmpeg and ffprobe are the
   floor (probe, scenes, deliver); whisper.cpp (transcribe) and auto-editor
   (cut --silence) are optional.

   edit probe <file>                        streams, duration, loudness
   edit scenes <file> [--threshold 10]      cut points (PySceneDetect if installed, else ffmpeg scdet)
   edit transcribe <file> [--model m.bin]   whisper.cpp -> SRT and JSON beside the file
   edit captions <words.json|file.srt>      timed words -> SRT that keeps the reading rules, or check an SRT
   edit cut <file> --silence                auto-editor: cut dead air
   edit deliver <file> --for youtube|reels|tiktok|shorts|ebu|atsc   two-pass loudness, shape check */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { parseCues, checkCaptions, splitCaptions, toSrt } from './captions.mjs';

const run = (bin, args, opts = {}) => spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 64 * 1024 * 1024, ...opts });
export function has(bin) {
  const r = run(bin, [bin === 'auto-editor' ? '--version' : bin.startsWith('whisper') ? '--help' : '-version'], { timeout: 20000 });
  return !r.error && (r.status === 0 || /usage|whisper/i.test((r.stdout || '') + (r.stderr || '')));
}
const need = (bin, what) => {
  if (!has(bin)) { const e = new Error(`${bin} is not installed, so ${what} did not run. ${INSTALL[bin] || ''}`.trim()); e.code = 'missing'; throw e; }
};
const INSTALL = {
  ffmpeg: 'Install FFmpeg (winget install Gyan.FFmpeg, brew install ffmpeg, apt-get install ffmpeg).',
  ffprobe: 'It comes with FFmpeg.',
  'auto-editor': 'pip install auto-editor (github.com/WyattBlue/auto-editor).',
  'whisper-cli': 'Build or download whisper.cpp (github.com/ggml-org/whisper.cpp) and a ggml model; put whisper-cli on PATH or pass --bin.',
  scenedetect: 'pip install scenedetect[opencv] (scenedetect.com).',
};

/* Loudness by EBU R128 (ffmpeg's ebur128 filter): integrated LUFS and true
   peak in dBTP. */
export function loudness(file) {
  need('ffmpeg', 'the loudness reading');
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', resolve(file), '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const text = r.stderr || '';
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const I = Number((summary.match(/I:\s*(-?[\d.]+) LUFS/) || [])[1]);
  const TP = Number((summary.match(/Peak:\s*(-?[\d.]+) dBFS/) || [])[1]);
  if (!Number.isFinite(I)) throw new Error('ffmpeg gave no loudness reading for ' + file);
  return { lufs: I, truePeak: Number.isFinite(TP) ? TP : null };
}

export function probe(file) {
  need('ffprobe', 'probe');
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', resolve(file)]);
  if (r.status !== 0) throw new Error('ffprobe could not read ' + file + ': ' + (r.stderr || '').trim());
  const j = JSON.parse(r.stdout);
  const video = (j.streams || []).find((s) => s.codec_type === 'video');
  const audio = (j.streams || []).find((s) => s.codec_type === 'audio');
  return {
    duration: Number(j.format?.duration) || null,
    video: video ? { codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate } : null,
    audio: audio ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels } : null,
    loudness: audio && has('ffmpeg') ? loudness(file) : null,
  };
}

/* Cut points in seconds. PySceneDetect's adaptive detector when it is
   installed; otherwise ffmpeg's scdet filter, whose score is 0-100. */
export function scenes(file, { threshold = 10 } = {}) {
  if (has('scenedetect')) {
    const r = run('scenedetect', ['-i', resolve(file), '-q', 'detect-adaptive', 'list-scenes', '-n', '-s']);
    const times = [...(r.stdout || '').matchAll(/\|\s*\d+\s*\|\s*\d+\s*\|\s*[\d:.]+\s*\|\s*\d+\s*\|\s*([\d.]+)\s*\|/g)].map((m) => Number(m[1]));
    if (r.status === 0 && times.length) return { via: 'scenedetect', cuts: times.slice(1) };
  }
  need('ffmpeg', 'scene detection');
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', resolve(file), '-vf', `scdet=threshold=${Number(threshold)},metadata=print`, '-an', '-f', 'null', '-']);
  const cuts = [...(r.stderr || '').matchAll(/lavfi\.scd\.time[=:]\s*([\d.]+)/g)].map((m) => Number(m[1]));
  return { via: 'ffmpeg scdet', cuts: [...new Set(cuts)] };
}

export function transcribe(file, { bin = 'whisper-cli', model } = {}) {
  need(bin, 'transcription');
  if (!model || !existsSync(model)) throw Object.assign(new Error('whisper.cpp needs a model: pass --model path/to/ggml-base.en.bin (github.com/ggml-org/whisper.cpp, models/).'), { code: 'missing' });
  need('ffmpeg', 'the audio extraction for transcription');
  const wav = resolve(dirname(file), basename(file, extname(file)) + '.16k.wav');
  const a = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(file), '-ar', '16000', '-ac', '1', wav]);
  if (a.status !== 0) throw new Error('ffmpeg could not extract audio: ' + a.stderr);
  const base = resolve(dirname(file), basename(file, extname(file)));
  const r = run(bin, ['-m', model, '-f', wav, '-osrt', '-ojf', '-of', base]);
  if (r.status !== 0) throw new Error('whisper.cpp failed: ' + (r.stderr || r.stdout).trim().slice(-400));
  return { srt: base + '.srt', json: base + '.json' };
}

/* whisper.cpp's full JSON (-ojf) or a plain [{word,start,end}] list -> words. */
export function wordsFrom(json) {
  if (Array.isArray(json)) return json.filter((w) => w && w.word !== undefined).map((w) => ({ word: String(w.word).trim(), start: Number(w.start), end: Number(w.end) }));
  const out = [];
  for (const seg of json.transcription || []) {
    for (const t of seg.tokens || []) {
      const text = String(t.text || '');
      if (!text.trim() || /^\[_/.test(text.trim())) continue;
      const start = Number(t.offsets?.from) / 1000, end = Number(t.offsets?.to) / 1000;
      if (text.startsWith(' ') || !out.length) out.push({ word: text.trim(), start, end });
      else { out[out.length - 1].word += text.trim(); out[out.length - 1].end = end; }
    }
  }
  return out;
}

export function captions(input, { out } = {}) {
  const text = readFileSync(input, 'utf8');
  if (/\.(srt|vtt)$/i.test(input)) return { file: input, findings: checkCaptions(parseCues(text)) };
  const cues = splitCaptions(wordsFrom(JSON.parse(text)));
  const target = out || resolve(dirname(input), basename(input, extname(input)) + '.captions.srt');
  writeFileSync(target, toSrt(cues));
  return { file: target, cues: cues.length, findings: checkCaptions(cues) };
}

export function cutSilence(file, { out, margin = '0.2s' } = {}) {
  need('auto-editor', 'the silence cut');
  const target = out || resolve(dirname(file), basename(file, extname(file)) + '.cut' + extname(file));
  const r = run('auto-editor', [resolve(file), '--margin', String(margin), '--output', target, '--no-open']);
  if (r.status !== 0) throw new Error('auto-editor failed: ' + (r.stderr || r.stdout).trim().slice(-400));
  return { file: target };
}

/* Delivery targets. Spotify's help page gives -14 LUFS and a true peak below
   -1 dBTP; YouTube normalises to about -14 LUFS; EBU R128 is -23 LUFS and ATSC
   A/85 -24 LKFS. The vertical shape and safe areas are the platforms' as
   Sprout Social lists them, not read from the platforms' own pages. */
export const TARGETS = {
  youtube: { lufs: -14, tp: -1, aspect: null },
  reels: { lufs: -14, tp: -1, aspect: [9, 16] },
  tiktok: { lufs: -14, tp: -1, aspect: [9, 16] },
  shorts: { lufs: -14, tp: -1, aspect: [9, 16] },
  ebu: { lufs: -23, tp: -1, aspect: null },
  atsc: { lufs: -24, tp: -2, aspect: null },
};

export function deliver(file, { for: target = 'youtube', out } = {}) {
  const t = TARGETS[target];
  if (!t) throw new Error(`unknown target "${target}". Try: ${Object.keys(TARGETS).join(', ')}`);
  need('ffmpeg', 'delivery');
  const info = probe(file);
  if (!info.audio) throw new Error(file + ' has no audio to set the loudness of');
  const notes = [];
  if (t.aspect && info.video) {
    const want = t.aspect[0] / t.aspect[1], have = info.video.width / info.video.height;
    if (Math.abs(have - want) > 0.01) notes.push(`${info.video.width}x${info.video.height} is not ${t.aspect.join(':')}; ${target} crops or pillarboxes it`);
  }
  // Pass 1 measures, pass 2 applies the measured values with linear=true, the
  // two-pass form of ffmpeg's loudnorm.
  const spec = `I=${t.lufs}:TP=${t.tp}:LRA=11`;
  const m = run('ffmpeg', ['-hide_banner', '-nostats', '-i', resolve(file), '-af', `loudnorm=${spec}:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(((m.stderr || '').match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/) || ['{}'])[0]);
  if (!j.input_i) throw new Error('the loudnorm measurement pass gave no reading');
  const target2 = out || resolve(dirname(file), basename(file, extname(file)) + '.' + target + extname(file));
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(file),
    '-af', `loudnorm=${spec}:measured_I=${j.input_i}:measured_LRA=${j.input_lra}:measured_TP=${j.input_tp}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`,
    '-ar', String(info.audio.sampleRate || 48000)];
  if (info.video) args.push('-c:v', 'copy');
  args.push(target2);
  const p = run('ffmpeg', args);
  if (p.status !== 0) throw new Error('ffmpeg could not write the delivery file: ' + (p.stderr || '').trim().slice(-400));
  const after = loudness(target2);
  if (Math.abs(after.lufs - t.lufs) > 1) notes.push(`landed at ${after.lufs} LUFS, not ${t.lufs}: loudnorm fell back to dynamic mode (the range was too wide for a linear gain)`);
  if (after.truePeak !== null && after.truePeak > t.tp) notes.push(`true peak ${after.truePeak} dBTP is above ${t.tp}`);
  return { file: target2, target, before: { lufs: Number(j.input_i), truePeak: Number(j.input_tp) }, after, notes };
}

/* video-watch (the plugin) reads a video with a token budget and contact
   sheets; when it is installed, it is the better way to look at footage. */
export function findVideoWatch(home = process.env.USERPROFILE || process.env.HOME || '') {
  try {
    const installed = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    const all = installed.plugins || installed;
    for (const [id, list] of Object.entries(all)) {
      if (!id.startsWith('video-watch@')) continue;
      for (const entry of list) {
        for (const rel of ['skills/watch-video/scripts/watch.mjs', 'scripts/watch.mjs', 'watch.mjs']) {
          const p = join(entry.installPath, rel);
          if (existsSync(p)) return p;
        }
      }
    }
  } catch { /* not installed, or not readable */ }
  return null;
}
