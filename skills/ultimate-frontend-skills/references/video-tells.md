# What gives a video away as machine-made, and what to do instead

Researched 2026-09-23. People catch generated and auto-edited video on two
levels: artifacts inside the frame (the generator's failures) and patterns
across the edit (the pipeline's defaults). This renderer cannot produce the
first kind - it draws real type, real photographs and real footage - so most
of the risk is the second. Both are listed, because a reference or a stock
clip can carry the first kind in.

Sources: VEED, "How to tell if a video is AI-generated"; Mission Cloud, "How
to detect deepfakes in 2026"; Reader's Digest, "How to tell if a video is
AI-generated"; CanIPhish, "10 techniques to spot AI videos"; Forbes, "How to
spot an AI-generated video"; OpusClip, "AI slop: 12 tells"; Artlist, "What is
AI slop"; NPR, 2025-08-28, on AI slop channels. Items marked *craft* are the
house's own editing judgement, not a sourced finding. Attributions come from
the search results for those pages; a claim seen only in a results summary,
not re-read on the page itself, says so.

## Inside the frame (keep out of references and footage)

1. **Temporal instability.** Textures that crawl, straight lines that bend as
   the camera pans, background people melting into shapes, fabric and
   jewellery that flicker (Mission Cloud, VEED). Any clip showing this is not
   used. Nothing in a scene may change shape without a physical reason.
2. **Hands and contact.** Fingers that merge, stretch or change count, hands
   sinking into tables or clothing (CanIPhish, Reader's Digest). Crop hands
   out or choose another take.
3. **Text that drifts.** Signs, pages and labels that turn to near-letters or
   change between shots (VEED). All text in a video is set as real type in the
   scene, never left inside a generated image.
4. **Faces.** Long unblinking stares, mechanical blinks, lips that slip off the
   words late in a sentence (Mission Cloud, Forbes). No synthetic presenters.
5. **Too-clean physics.** Motion without weight: no motion blur on fast moves,
   no settle at the end of a movement, water and hair that move like cloth
   (Mission Cloud). *Craft:* every move eases out and settles; nothing starts
   or stops at full speed.
6. **Missing provenance.** Generated files carry no camera metadata (Mission
   Cloud). Real footage stays real; do not launder it through a generator.

## Across the edit (what this renderer must not do)

7. **Flat, even pacing.** Every shot the same length, every cut on a grid
   (*craft*). Lengths vary with what the shot
   has to say. The scaffold's weights exist to break the grid; the brief
   decides the real lengths.
8. **A move on every shot.** A slow zoom on every still is the automated
   Ken Burns default (Pictory, StyleFrame and Visla all sell it as one
   switch). One move per shot at most, and some shots hold still. Pushes, drifts
   and holds alternate; no two neighbours share a move.
9. **Transitions as decoration.** Whooshes, spins, glitch hits and a dissolve
   on every cut (*craft*). Cut hard. One dissolve per film is a decision; ten
   is a preset.
10. **A still noise layer.** Real grain is new every frame; a fixed noise
    overlay reads as a filter (*craft*). The scaffold reseeds its grain per
    frame; keep it at the edge of visibility.
11. **Flat synthetic voice.** Text-to-speech with the same prosody on every
    sentence, no build, no drop (OpusClip). Use a real voice, or no voice and
    type on screen.
12. **Captions nobody designed.** Word-by-word pop captions with emoji, centred
    in a random box, not built for silent autoplay (2026 AI-slop coverage including OpusClip and
    Artlist; seen in a results summary, not re-read on the page). Captions are set in
    the scene's typeface, in phrases, placed in the safe area, timed to breath.
13. **Stock that does not fit the story.** Generic B-roll that illustrates the
    words instead of the subject (Artlist, NPR). Every shot is of the actual
    thing: the actual ride, the actual app screen, the actual people.
14. **The generic grade.** Teal-and-orange by default, crushed blacks,
    HDR sheen (*craft*). Take the grade from the references; one grade across
    every shot.
15. **The template ending.** Logo spin, "Like and subscribe", a stock swell
    (*craft*). End on the strongest real frame, held; a short fade to the
    ground is enough.
16. **Perfect camera.** Mathematically smooth glides with no operator in them
    (*craft*). The scaffold adds a few pixels of incommensurate drift; a locked
    shot stays locked.

## The check, before a final render

Watch the draft as frames and answer each with yes or no:

- Would a person who was there recognise every shot as real?
- Are no two consecutive shots the same length or the same move?
- Is every word on screen set type, spelled right in every frame?
- Is the grain moving, and is it nearly invisible?
- Does the cut end on a held real frame, with no template outro?

Any "no" is fixed in the scene before the final render.
