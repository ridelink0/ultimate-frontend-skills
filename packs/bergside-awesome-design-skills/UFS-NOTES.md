# bergside/awesome-design-skills - vendored copy

Upstream: https://github.com/bergside/awesome-design-skills at f631a09
Licence: MIT (file kept beside this note)
Copied: 2026-09-21
Skills: agentic, ant, artistic, basic, bento, bold, brutalism, cafe, claude, claymorphism, clean, codex, colorful, contemporary, corporate, cosmic, creative, dithered, doodle, dramatic, editorial, enterprise, expressive, fantasy, fiction, flat, friendly, futuristic, geometric, glassmorphism, gradient, immersive, impeccable, levels, lingo, material, matrix, minimal, modern, mono, neobrutalism, neon, neumorphism, pacman, paper, perspective, power, premium, professional, pulse, refined, retro, riso, roku, sega, shadcn, sketch, skeumorphism, sleek, spacious, square, stitch, storytelling, terracotta, tetris, vibrant, vintage

This is the copy packs --install uses when the pack is absent; --upstream installs the original instead.
Everything changed from upstream is listed below so the author can take it back or ask for it out.

## Improvements

Every entry names the file and the reason. The font facts come from fonts.google.com/metadata/fonts, fetched 2026-09-20 (1,946 families); nothing below is guessed.

- Every `<style>/SKILL.md`, Style Foundations, `weights=`: upstream claimed weights 100-900 in 61 of the 67 styles regardless of the fonts named. Replaced with the weights each named family actually ships on Google Fonts, per font (Gelasio is 400/500/600/700, Ubuntu Mono is 400/700, JetBrains Mono stops at 800, Space Mono is 400/700, and so on). A rule that asks for weight 200 of a font that has none produces a synthesised or substituted face.
- Every `<style>/DESIGN.md`, frontmatter `weights:` and the "Typography weights" bullet: the same correction, so the human-facing file agrees with the machine-facing one.
- Every `<style>/SKILL.md`, Style Foundations: added "Font source" (the Google Fonts specimen URL of each named family) and "Font loading" (an @font-face for the primary family with its real weight range, the self-hosting instruction, and the fonts.googleapis.com css2 URL for the families and weights, which resolves - checked with a 200). Upstream named fonts with no source and no loading rule at all.
- `claude/SKILL.md`: Anthropic Sans is not on Google Fonts and upstream gives no source or licence for it; the Font source line says so plainly instead of inventing a URL. The rest of the style is unchanged.
- `claude/SKILL.md`, `impeccable/SKILL.md`: a one-paragraph note above the managed block that the preset is not affiliated with Anthropic or with pbakaus/impeccable, and that `npx typeui.sh pull impeccable` fetches this preset rather than the review skill. docs/research/2026-09-20-packs.md flagged the two slugs as a naming collision; the note is the smallest fix that does not rename a directory the install step relies on.
- `artistic`, `bold`, `editorial`, `futuristic`, `geometric`, `minimal`, `neobrutalism`, `power`, `retro`, `square` `SKILL.md`: removed an empty "## Brand" heading (a section with nothing under it). The other 57 keep theirs, which have content.
- Not changed: the shared managed block (Mission, Accessibility, Rules, Workflow, Output Structure, Quality Gates) is identical across all 67 files and is what `typeui.sh` regenerates; trimming it would make every style diverge from its generator, so it stays. Not changed: `LICENSE`, `README.md`.
