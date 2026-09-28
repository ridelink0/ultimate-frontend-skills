# Editing real footage

`references/video.md` renders a film UFS writes. This file is for footage
someone shot: an interview, a screen recording, a product demo, a vlog. It is
the craft, then the delivery targets, then the tools (`webdesign.mjs edit`).
`video-tells.md` is the check at the end.

## The order a cut is decided in

Walter Murch's Rule of Six (*In the Blink of an Eye*), in his order: emotion,
story, rhythm, eye trace, the two-dimensional plane of the screen, and
three-dimensional space. Emotion outweighs the rest together: a cut that is
true to the feeling of the moment survives a broken rule further down the
list; the reverse does not (studiobinder.com's summary of the book; the
often-quoted percentage split was not on the page and is not repeated here).

The joins that serve it:

- **J and L cuts** are the default join for people talking. A J cut starts
  the next shot's sound before its picture; an L cut carries the last shot's
  sound over the next picture. A hard cut on both at once is for a change of
  scene.
- **Match on action**: cut in the middle of a movement, so the eye follows
  the movement across the cut and does not see the cut.
- **The 180-degree rule**: keep the camera on one side of the line between
  two people. To cross it, show a shot on the line, move the camera across
  it, or cut away first.
- **Jump cuts** compress time within one shot. Use them where compression is
  the point (a long process shown fast); in a talking head they are the
  every-breath-removed look (`video-tells.md`).
- **Short form**: the first frame carries the subject, with no build-up, and
  captions are on from the first word, since most people watch with the sound
  off (later.com gives 69% for YouTube Shorts; a marketing blog, not a
  platform figure). Do not fill the maximum runtime.

## Delivery

| Target | Loudness | Peak | Source |
|---|---|---|---|
| Streaming: YouTube, Spotify, most platforms | -14 LUFS integrated | true peak below -1 dBTP | Spotify's loudness page; YouTube is about -14 |
| Broadcast, Europe (EBU R128) | -23 LUFS | -1 dBTP | EBU R128 |
| Broadcast, US (ATSC A/85) | -24 LKFS | -2 dBTP | ATSC A/85 |

`edit deliver <file> --for youtube|reels|tiktok|shorts|ebu|atsc` sets the
loudness with ffmpeg's two-pass `loudnorm` (measure, then apply the measured
values with `linear=true`), measures the result with `ebur128`, and says when
it did not land. It copies the picture untouched and says when the shape is
not the platform's.

Vertical video (Reels, TikTok, Shorts) is 9:16, 1080x1920. Keep text out of
the top 14% (about 250 px) and the bottom 20% (about 340 px), where the
platform draws its own interface (Sprout Social's spec guide; the platforms'
own help pages were not read, so treat the margins as a starting point).

Captions: `scripts/captions.mjs` holds Netflix's reading rules (42 characters
a line, two lines, 20 characters a second, 5/6 s to 7 s on screen), and
`edit captions` turns a transcript into an SRT that keeps them or checks one
that exists. Captions on prerecorded video are WCAG 1.2.2, Level A.

Colour: balance every shot to neutral first (lift, gamma, gain), then apply
one look taken from the references. One preset over every clip is a tell
(`video-tells.md`, E4). Rec. 709 and sRGB share primaries and white point and
differ in their transfer function; SDR is about 100 nits.

## Tools

| Step | Command | Program | When it is missing |
|---|---|---|---|
| What is in the file | `edit probe <file>` | ffprobe, ffmpeg (loudness) | install FFmpeg |
| Where the cuts are | `edit scenes <file> [--threshold 10]` | PySceneDetect (`detect-adaptive`) if installed, else ffmpeg's `scdet` | ffmpeg is the floor |
| What is said | `edit transcribe <file> --model ggml-base.en.bin` | whisper.cpp (`whisper-cli`) | says so and exits 2 |
| Captions | `edit captions <words.json or file.srt>` | none (captions.mjs) | - |
| Dead air out | `edit cut <file> --silence [--margin 0.2s]` | auto-editor | says so and exits 2 |
| Loudness and shape | `edit deliver <file> --for youtube` | ffmpeg | install FFmpeg |

Also worth knowing: WhisperX for word timestamps and speaker labels,
faster-whisper, OpenTimelineIO for handing a timeline between programs,
auto-editor's `--export resolve|premiere|fcp7` for handing a cut to an editor.
DaVinci Resolve's external scripting needs Resolve Studio; the free version
does not allow it (Blackmagic, and the davinci-resolve-mcp README for 21.1).
CapCut and Descript have no public automation route; do not plan around
them.

## Looking at footage

`video <file> --frames 12` extracts frames. When the video-watch plugin is
installed, `video` prints the command that reads the footage better (scene
detection, contact sheets, a token budget): look at the source with it, read
the transcript, write the edit decisions against the Rule of Six, cut, then
look at the output with it again before calling the edit done.
