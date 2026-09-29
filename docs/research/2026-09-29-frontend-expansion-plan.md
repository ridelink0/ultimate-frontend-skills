# Atelier ships the AI look it bans

UFS's atelier side, the part whose job is output that does not read as AI-made, has never been measured, and the one measurement that now exists goes against it. A fresh `/atelier` scaffold (the bone preset, which `/atelier` forces by default) scores **13/100, "Mild"** on the public slop-detect 0.5.2 detector. impeccable 4.1.0 flags the same page for a **cream background, an overused font (Instrument Sans) and a marquee**. UFS's own audit flags none of it: it has no cream-ground check, and its font list names Instrument Serif but not Instrument Sans. Bone's ground (#f2efe7) sits next to the #F4F1EA cream that Anthropic's current frontend-design skill names as the first cluster of AI design, and bone's tracked all-caps eyebrows and mono labels are that skill's fifth cluster. No competitor publishes a blind or repeated measurement either, so there is a real opening. UFS can be the first frontend skill whose tells detector is fitted to human labels, and whose with-vs-without-UFS A/B is held to atlias's rules: a fixed corpus, `--repeat 3`, paired statistics, and six one-way flips as the floor. The order of work is as follows. Fix headless rendering in the cloud container, where it fails as root today. Build a rendered tells vector that includes the second-order "tasteful AI" tells, and run impeccable and slop-detect beside it. Build an A/B harness that writes the JSON `atlias compare` already accepts. Put a real art-direction step behind a flag. Then Gev's PC session collects blind human ratings and runs the paid 30-brief study. Outside atelier, the gaps with the best evidence are accessibility (UFS has no axe-core), framework-version routing, and modern-CSS Baseline gating. On the atlias side, the gate does not count UFS's own `verify`, `look` or `audit` as checks, the router misses most frontend prompts, and atlias has no frontend task. Fixing those makes frontend "done" checkable. "Does not look AI-made" can join the gate once the detector's false-positive rate on human-made sites has been measured.

Evidence rules for this report: a statement is presented as fact only if an independent verifier confirmed it at the primary source, or if it is a local fact shown with a file, line or commit. The local facts refer to UFS 6.8.1 at `7983bb2` (branch `claude/session-limits-usage-credits-dm3isz`) and atlias 3.8.1 at `6c710ae`. The report writer re-checked the key ones on 2026-09-29. Inferences are labelled as inferences. Unverified claims are listed under "Could not be verified", and refuted claims are named as refuted. Two corrections to the brief this round started from. The reference corpus holds **454** sites, not 444. The 2026-09-21 research's "ten highest-value changes" were built on 2026-09-21 in 6.1.0 and 6.1.1, not in 6.8.0; 6.8.0 was built from a separate 16-item plan that is not in the repo (`CHANGELOG.md:14`; commits [ef13bc6](https://github.com/ridelink0/ultimate-frontend-skills/commit/ef13bc698acbb168d1df85c1a94763d896a6ce46), [cb58a57](https://github.com/ridelink0/ultimate-frontend-skills/commit/cb58a5788423b93960af65d0a7a0f8a718929c5c)). Of the 09-21 list, only three items are still open: the Codex nudge hook (partly done, never live-tested), a line-level audit of the CSS rules in the references (partly done), and a real app/game chassis (the wording was fixed; no chassis was built).

## Two free detectors already call atelier's default AI-made

**The measurement.** When no preset is given, `/atelier` appends `--preset bone` (`scripts/atelier.mjs:3-5`), and the scaffolder's own default is also bone (`scripts/webdesign.mjs:110`). A fresh bone scaffold, served locally, scores **13/100, tier Mild, on slop-detect 0.5.2**. The score comes from cream_default_bg (weight 7), all_caps_labels (3) and stat_banner (3) ([slop-detect](https://github.com/ravidsrk/slop-detect)). **impeccable 4.1.0** flags `cream-palette`, `overused-font` (the UI face is Instrument Sans) and `marquee`. It also raises quality flags: cramped padding ×5, a buried raster and a clipped overflow container ([impeccable on npm](https://www.npmjs.com/package/impeccable)). An independent verifier re-ran both on 2026-09-29 and got the same result.

The researcher also ran the other three presets. Ink scored Mild through perma-dark mode, cinema and fable scored Mild on the same three hits as bone, and all four presets trip Instrument Sans and the marquee. The verifier did not re-run ink, cinema or fable, so those are a single local measurement. Copy scored Clean, but the scaffold carries placeholder copy, so that says nothing about the copy atelier writes on a real brief.

**UFS's own audit sees none of this.** The ground is `--bone-100: oklch(95.2% 0.011 91)`, commented "THE GROUND" (`skills/ultimate-frontend-skills/assets/core.css:13`), which renders as rgb(242,239,231). The display and text face is Newsreader and the UI face is Instrument Sans (`core.css:55-58`). `SLOP_FONTS` lists Instrument *Serif* but not Instrument Sans (`scripts/audit.mjs:156-159`). No code in audit.mjs, tells.mjs or webdesign.mjs checks for a cream ground. That is true even though the comment directly above the font list says the weights put "the reflexive cream ground" third (`audit.mjs:150-152`). It is also true even though `references/tells.md` ranks cream as tell #3 and says "If you ship bone plus a serif and nothing else, you have built the tell." Its "one-line version" still opens with "no reflexive cream" (`tells.md:197`).

The tells data is stale in the same direction. `data/ai-tells.json` has 34 rows; none mentions cream, and all 34 say `ufs_chassis_ships_it: false`. Of the 15 web and motion rows, 12 are "scraper-fetched" and only 3 are verifier-confirmed. One UFS rule contradicts the field outright: `audit.mjs:637` warns when a page has *no* negative letter-spacing ("large serif needs it"), while slop-detect scores `crushed_tracking` at weight 5.

**The collision with Anthropic's skill is specific.** The frontend-design SKILL.md mounted in this environment is 9,390 bytes. Its mount time is 2026-09-28, so whether it matches Anthropic's latest public revision is not established. It lists five clusters that AI design "right now clusters around" (`/mnt/skills/public/frontend-design/SKILL.md:39-43`):

1. a warm cream ground near #F4F1EA with a high-contrast serif and a terracotta accent near #D97757;
2. near-black with one acid-green or vermilion accent;
3. broadsheet layouts;
4. the SaaS card kit;
5. template chrome: tracked ALL-CAPS eyebrows, "·"-joined meta strings, monospace data labels and "→" on links.

Bone's #f2efe7 is two or three RGB steps from #F4F1EA. Its accent hue is 62, ochre rather than terracotta (`webdesign.mjs:69`), so bone matches cluster 1 on ground and type, not on accent. core.css sets `.eyebrow` in uppercase at 0.18em tracking with a monospace `.idx`, and sets `.stat__label` in uppercase (`core.css:237-251, 457`). That is cluster 5. Ink is cluster 2. Anthropic's skill also bans accenting a single headline word; UFS allows one per page and fails the build at two. Inference: when both skills are installed, they give opposite instructions about the same page.

Two framings in the research notes were **refuted** and should not be repeated.
- Bone is not a single-serif-family preset: it also ships Instrument Sans and IBM Plex Mono.
- The section order is not fixed on every build.

The accurate version is worse for atelier. `DEFAULT_SECTIONS` (nav, hero-photo, manifesto, services, stats, faq, contact, footer) is only the fallback for `--sections` (`webdesign.mjs:87, 113`). But neither `commands/atelier.md` nor `atelier.mjs` sets `--sections`. So unless the model overrides it, atelier ships the section waterfall that UFS's own tell W5 names.

**Nobody in the field has validated a detector against people.**
- impeccable (72.1k stars, Apache-2.0, 61 deterministic rules) says "A clean detector run is evidence, not proof" and publishes no false-positive rate ([impeccable](https://github.com/pbakaus/impeccable)).
- slop-detect has 27 patterns whose weights are its author's judgement. Its tiers are Clean 0-9, Mild 10-27 and Heavy ≥28. It is MIT-licensed, has 12 stars and discloses no false-positive measurement.
- avoid-ai-design (67 tells, MIT) says "the tells are model-agnostic because the convergence is". It names "cream with a terracotta accent (Claude's own interface color)" as a second-order default ([avoid-ai-design](https://github.com/funboy322/avoid-ai-design)).
- Anthropic's own post calls the problem "distributional convergence" and backs its fix with before/after images only, with no quantitative or human evaluation ([Anthropic](https://claude.com/blog/improving-frontend-design-through-skills)).
- The one 2026 paper on homogenisation in web vibe coding is a qualitative risk analysis with no measurements ([Microsoft Research](https://www.microsoft.com/en-us/research/publication/interrogating-design-homogenization-in-web-vibe-coding/)).
- This round found **no published study of how accurately people can tell AI-made websites from human-made ones**.

**The tells move.** impeccable's npm release, last modified 2026-09-08, ships a rule that "a warm cream or beige page background has become the default 'tasteful' AI surface", and its overused-font list now includes Instrument Sans. slop-detect has weighted cream since its 2026.08 definitions. So the escape route that Anthropic's November 2025 post pushed models toward is now a scored tell. Inference from those dates, not a measured rate: a "use X instead" list lasts roughly six to ten months. A static list inside UFS will go stale on the same schedule, so the list has to be re-measured regularly, not edited by hand.

## A tells detector earns trust only from human labels

**What to build.** UFS needs an instrument, not a longer list: a vector of tell features computed from the rendered page, with weights that come from people. Each feature is a boolean or a count, read from computed styles in headless Chromium rather than by regex over the source. The feature list:
- the ground's OKLCH;
- the font family per role and how common it is;
- the CTA's hue and chroma;
- the number of distinct border-radius and box-shadow values;
- the section order;
- the share of blocks centred on the page axis;
- tracked caps and mono microlabels, stat banners, marquees, single accented headline words and 01/02/03 numbering;
- UFS's existing copy checks.

impeccable and slop-detect run beside it, and their verdicts become extra columns. They matter because their authors are not UFS's authors; UFS grading UFS is circular.

**The corpora.** Three frozen, dated corpora:
1. human-made: the 393 verified rows of UFS's award corpus, plus a pre-2023 slice that cannot be AI-contaminated;
2. raw AI output: the same briefs run through a model with no skill;
3. UFS output on the same briefs.

**Labels and fitting.** Raters see pairs blind and answer "which of these two looks more AI-made?", with positions swapped and several raters per pair. Fit logistic or Bradley-Terry weights to those labels, then report:
- AUC for AI versus human;
- Spearman correlation against the human scores;
- per-tell likelihood ratios, P(tell | AI) / P(tell | human);
- **the false-positive rate on the human-made corpus**.

That last number decides whether the score may ever hold a reply in atlias. The per-tell likelihood ratios also handle drift. If the crawl is re-run each quarter, a tell whose ratio falls toward 1, meaning it has become common in human work too, loses weight without anyone editing a list. All of this paragraph is design inference; the measured parts are cited above.

**A model judge is a tie-breaker, not the grader.** The VLM-uncertainty study's README reports these rank correlations with human scores ([VLM-Judge-Uncertainty](https://github.com/divake/VLM-Judge-Uncertainty)), which make them weak rankers:

| Judge | Pearson |
|---|---|
| Phi-4 | 0.303 |
| LLaVA-Critic | 0.402 |
| Gemini 2.5 Flash | 0.459 |

The notes' "0.402-0.459" range was **refuted**. So was their use of its "4.5× narrower intervals" figure as evidence for multi-annotator labels: that figure compares two different datasets, not the same data with more annotators. ArtifactsBench reports 94.4% ranking consistency with WebDev Arena for a checklist-guided judge. That is agreement on the ranking of *models* across 1,825 tasks, not a verdict on one page ([ArtifactsBench](https://github.com/Tencent-Hunyuan/ArtifactsBenchmark)). The per-page judge agreement figures could not be verified. So the judge's rules are:
- pairwise only;
- both orders;
- one pinned model;
- trusted only on the kinds of pairs where it has been checked against human labels;
- never the only thing that decides.

**The award corpus is not ready to be the human baseline.** `data/awards.json` holds 454 rows (the README still says "444 at 6.1.0"). Of those:
- 393 are verified;
- 98 palettes are marked UNVERIFIED;
- 239 rows have empty tags;
- no row has a screenshot or image field.

Two verifiers profiled the file, and the report writer's own count at `7983bb2` agrees on 454 and 393. By kind: portfolio 94, brand 83, product 71, experiment 53, ecommerce 47, editorial 35, app 29, game 18, studio 16, 3d 8.

The cloud researcher could not reach the corpus sites through the container's egress proxy, so capturing the human baseline is a PC-session job. CREDITS.md promises that the corpus stores "no markup, CSS, image or copy from any site" (`CREDITS.md:6-8`). Storing derived fingerprints (font families, OKLCH values, counts) and fetching screenshots into a local cache at run time keeps to the letter of that promise. No legal source was consulted, so treat that as open.

## Art direction has to stop being a default

**Today, and what competitors do.** `/atelier` is a prompt that says "Use the bone preset by default" plus a five-line wrapper that appends `--preset bone` (`commands/atelier.md`; `scripts/atelier.mjs`). The skills that take the problem seriously make direction a process:
- Anthropic's current skill has the model write a token plan and check it against "the generic default you would produce for any similar page (work through a similar prompt to see if you arrive somewhere similar)". Then it revises, builds and critiques screenshots. It adds that "human creatives have memory and always try to do something new" (`frontend-design/SKILL.md:53, 59`).
- Hallmark runs "fifty-seven slop-test gates plus a pre-emit self-critique". It has a `study` mode that extracts design DNA from screenshots or URLs ([Hallmark](https://github.com/Nutlope/hallmark)).

None of them publishes a measured effect. The evidence that sampling several options helps comes from text, not UI. The Verbalized Sampling repo headline claims a "2-3x diversity improvement" from asking a model for several answers with their probabilities ([CHATS-lab](https://github.com/CHATS-lab/verbalized-sampling)). The paper's own figures could not be verified from this container.

**The workflow to build.** It ships behind a flag, and every step leaves something a check can read.
- **A direction card, written before any code.** It lists five candidate directions. Each names:
  - a palette source;
  - a ground and accent in OKLCH;
  - display and text families;
  - a layout idea;
  - one bold move;
  - the model's estimate of how likely that direction is to be the default for this brief.
- **The most probable candidate is discarded.** This is the mechanised form of Anthropic's "work through a similar prompt".
- **References.** Three to five are pulled from the award corpus by kind and tags, from at least two different kinds. The card names what is taken from each, for example the palette logic from one and the type treatment from another.
- **Sections come from the brief**, not from `DEFAULT_SECTIONS`.
- **Tokens and fonts come from the card**, not from a preset.

Three mechanical checks follow:
1. the chosen direction is not the highest-probability candidate;
2. it is outside clusters 1, 2 and 5 unless the brief asked for them;
3. the rendered page matches the card: computed ground, accent and families within tolerance.

A log of past directions (`.ufs/directions.jsonl`) gives the "memory" Anthropic's skill describes, so ten atelier projects do not converge on one another. The judgement calls stay with the screenshot critique and the human raters: whether the bold move lands, and whether the palette carries an idea.

**What stays unproven** is whether any of this makes pages look less AI-made to people. The first prediction to test is blunt. Atelier as shipped may score *worse* than no skill at all among raters who know 2026 AI output, because it sits in cluster 1. That is an inference from the collision described above, and it is the fastest falsifiable test this round can run.

The direction step therefore ships default-off, so bone stays reproducible as its own arm, and the default flips only on a measured result. That is the same rule the atlias round-five plan applies to every behaviour change: land it default-off behind a flag, and flip the default in a separate commit after the PC session's result clears a bar set before the run (`/home/user/reports/Atlias round five joint plan.md`, "How the two sessions stay out of each other's way").

## The protocol: 30 briefs, three arms, three repeats, six flips

The protocol follows atlias's rules from `docs/NEXTGEN-4.md`: a fixed corpus, `--repeat 3`, pairing per task on the pass fraction, exact paired tests, and "six one-way flips are the minimum before p < 0.05 is possible at all".

**No atlias change is needed to judge UFS.** On 2026-09-29 the report writer checked that `atlias compare` (atlias 3.8.1 at `6c710ae`) accepts a minimal file of the form `{results:[{id, pass, passes, tries}]}` with no other fields. It prints the paired sign test, the six-flip floor, Wilson intervals and a Beta-Jeffreys paired interval. A synthetic ten-brief pair with six one-way gains printed "p = 0.031" and "6 one-way flips are needed for p < 0.05" (pairing code at `lib/eval.mjs:620-642`). UFS's harness only has to write that shape once per metric.

**The corpora.** The **Atelier Brief Corpus v1** (`evals/atelier-briefs-v1.json` in UFS) has 30 website briefs, frozen by SHA-256, written for this study and approved by Gev.
- **Mix:** the briefs follow the kind mix of UFS's award corpus: portfolio 6, brand 6, product 5, experiment 3, ecommerce 3, editorial 3, app landing 2, game start screen 1, studio 1. 3D is left out because the cloud has no GPU.
- **Content:** each brief names a subject, an audience, a primary job and real content, and **no colours, fonts or style words**, so the arm is the only source of style.
- **Source:** new, so it cannot have leaked into any training set. The cost is that it has no outside credibility; competitive arms, and later an external benchmark, address that.

A second corpus, **frontend-12**, is the functional guardrail and the corpus for the atlias gate study. It holds 12 tasks in atlias's own task format (seed files, prompt, check command, and hidden grader files; see `atlias/evals/add-function.json`): 3 landing or atelier pages, 3 React/Vue/Svelte component edits, 2 CSS bug fixes, 2 match-this-design tasks and 2 canvas or game screens. None of its checks use UFS.

**The arms.**

| Arm | What runs |
|---|---|
| A | Same model, same Claude Code version, no UFS and no other design skill |
| B | UFS 6.8.1 `/atelier` as shipped |
| C | UFS with the direction step (build-queue item 5) |
| D, E (later, paid, PC) | Anthropic frontend-design alone; impeccable alone |

The Claude Code 2.1.284 install in the container has `--plugin-dir`, `--output-format json`, `--max-budget-usd` and `--model` (`claude --help`). That is enough to switch the arm and cap each run's spend.

**Contamination is the first threat to validity.** This environment mounts frontend-design under `/mnt/skills/public`, and this very session lists impeccable and Emil Kowalski's skills. Arm A is not "no skill" unless the harness proves it. `--bare` strips most of that, but it reads credentials only from `ANTHROPIC_API_KEY`, which is not set in the container. Its help text also says that "Skills still resolve via /skill-name". So the harness must record which skills and plugins each run could see, and refuse to run arm A when any design skill is visible.

**Graders.**

| Metric | Grader | Per-run outcome | Role |
|---|---|---|---|
| Looks human-made | Blind pairwise: "Which looks designed by a human art director?", left/right randomised, arm traces stripped, 3-5 raters, majority per pair | pair winner | **primary** |
| Detector-clean | slop-detect 0.5.2 tier Clean (≤9) AND impeccable 4.1.0 zero slop-category rules | pass/fail | secondary; independent of UFS |
| UFS tells score | the rendered tells vector (build item 2), calibrated later | continuous | reported, not relied on: UFS grading itself is circular |
| Distinctiveness | share of pages in clusters 1, 2 and 5; font-family entropy and accent-hue bins across the 30 briefs | per arm | secondary |
| Not broken | no same-origin console error or uncaught exception (playwright-cli), no horizontal overflow at 390 and 1440, axe-core serious+critical = 0 | pass/fail | guardrail: B and C must not lose to A |
| Cost | the CLI's JSON usage ($, input/output/cache tokens), wall time, turns, KB of UFS references read | per run | reported per page and per detector-clean page |

**Statistics.**
- Each run gets binary outcomes. Each brief gets a pass fraction over its three repeats.
- `atlias compare` pairs the arms on those fractions and runs the exact sign test over briefs. Correlated repeats of one brief are never counted as independent trials.
- For the human metric, pair A_i with B_i for repeat i and take the majority vote per pair. Each arm's per-brief fraction is the share of its three pairs that it won, and the same comparator applies.
- Six one-way flips with none the other way is the floor (p = 0.031, two-sided). Power is the real constraint.

The report writer's exact-binomial power for the brief-level sign test (two-sided α = 0.05, every brief decisive) is below; the columns are the true per-brief win rate of the better arm.

| Briefs | 60% | 65% | 70% | 75% | 80% | Wins needed |
|---|---|---|---|---|---|---|
| 20 | 0.13 | 0.25 | 0.42 | 0.62 | 0.80 | 15 |
| 30 | 0.18 | 0.36 | 0.59 | **0.80** | 0.94 | 21 |
| 40 | 0.21 | 0.44 | 0.70 | 0.90 | 0.98 | 27 |
| 60 | 0.26 | 0.56 | 0.84 | 0.97 | 1.00 | 39 |

With 30 briefs, the study reliably detects only a **large** effect: one arm winning about three briefs in four. The verifier-checked pair-level sample sizes treat pairs as independent, which the repeats violate, so report them only as a secondary, brief-clustered analysis:

| True preference | Pairs needed (exact test) |
|---|---|
| 70% | 49-54 |
| 65% | 90-97 |
| 60% | 199-210 |

Ties and "can't tell" answers are reported, not dropped. Agreement between raters is reported as Cohen's κ. The VLM judge is calibrated on 40-60 human-labelled pairs and reported beside them, never instead of them.

**Cost per run.** Prices from the Claude pricing page, fetched by the report writer on 2026-09-29 ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)); the Batch API is half price.

| Model | Input | Output | Cache hits | 5-minute cache writes |
|---|---|---|---|---|
| Opus 5.5 | $4/MTok | $20/MTok | $0.20/MTok | $5/MTok |
| Sonnet 5.5 | $2/MTok | $10/MTok | $0.20/MTok | $2.50/MTok |

An image costs ⌈w/28⌉ × ⌈h/28⌉ tokens: 1,716 at 1440×900 and 434 at 390×844 ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)). One pairwise judge call shows two pages at both widths, about 4.3k image tokens plus about 1.5k of rubric. With about 300 output tokens, that comes to about **$0.015 on Sonnet 5.5 and $0.03 on Opus 5.5**. Judging 90 pairs in both orders costs $3-5, and half that by batch.

Generation is the cost that matters, and nobody has measured it for a UFS run. Here is a **planning assumption only**, not a measurement: an agentic page build that reads about 1.2M cumulative input tokens (90% of them cache hits) and writes about 40k output tokens.

| Scope | Sonnet 5.5 | Opus 5.5 |
|---|---|---|
| One run | about $0.9 | about $1.6 |
| Full study (30 briefs × 3 arms × 3 repeats = 270 runs) | about $250 | about $430 |

That is far past the ~$60 cloud reserve, so the full study belongs to the PC session on Gev's plan.

The cloud pilot is **6 briefs × arms A and B × 1 run = 12 runs**. Each run is capped at `--max-budget-usd 1.5`, so the total is at most $18. The pilot has three jobs:
- replace the assumption with a measured cost per run;
- prove that the harness, the contamination guard and the blind packets work;
- size the full study.

UFS's own per-use overhead is also only estimated, at 4 bytes per token. SKILL.md plus pipeline.md is 28 KB, about 7k tokens. The usual website route reaches about 200 KB, about 50k tokens: pipeline.md, then tells, copy-tells, typography, checklist and imagery, then craft, motion and sections. Report cost the way atlias does, per solved task.

**Threats the harness must handle.**
- **Fonts.** Google Fonts fail certificate checks behind the container's proxy (`ERR_CERT_AUTHORITY_INVALID`, seen by both UFS and playwright-cli). Cloud screenshots therefore render in fallback fonts, which distorts exactly the typography raters judge. The harness must record which webfonts loaded. It must then either serve fonts from a local cache (npm-hosted font packages install here) or send those pages to the PC for rendering.
- **The scaffold's own missing hero image.** It is a real same-origin 404.
- **Version drift.** Pin the model ID and the Claude Code version, and stamp every run with the UFS SHA.

## Beyond atelier: accessibility, framework routing and Baseline gating lead

**Where UFS is deep and where it is thin.** UFS is deep on art direction, motion, three.js, games, app screens by category and AI tells. For "any other page" it defers the aesthetic to Anthropic's frontend-design when that is installed (`SKILL.md:60-63`). It is thin or absent on most everyday frontend work.
- A grep of all references at v6.8.1, checked by a verifier, finds **zero** mentions of: hydration, `use client`, runes, `@scope`, DTCG, i18n and `Intl.`, JSON-LD and structured data, `useActionState`, Base UI and `@theme`.
- It finds **no RTL guidance at all**. The notes' RTL hits were substrings of "effortlessly" and "Artlist" (refuted).
- Svelte, Vue and Astro appear only as credits on award sites.
- typography.md mentions `clamp` once, oklch on three lines, and container queries, `prefers-reduced-motion`, `@layer` and `font-display` never.

**Test status.** The fast pass is 235 tests: 171 pass, 0 fail, 64 skip (verifier re-run). With a `--no-sandbox` wrapper the researcher saw 232 of 235 pass, with 3 ffmpeg skips; that full run was not re-run by the verifier. Headless rendering fails as root because UFS does not pass `--no-sandbox` and does not look in `/opt/pw-browsers` (verified). The browser tests use `skip: !findBrowser()`, so in the cloud they skip silently instead of failing. One audit claim, that inspect-website-styles has only a routing test, was **refuted**: `test/browser.test.mjs:349-375` tests its behaviour. So re-check the other "routing-only" claims before relying on them. Those cover Blender, textures, image generation, the rembg cut, `dev` and `study`.

**Accessibility is the best-evidenced gap.** No script under `scripts/` uses axe-core. axe-core's README says "It returns zero false positives (bugs notwithstanding)" ([axe-core](https://github.com/dequelabs/axe-core)); version 4.13.0 is MPL-2.0. The WCAG 2.2 criteria that agent-made showpiece pages most plausibly break are mechanically checkable in headless Chromium:
- 2.5.8, target size of at least 24×24 CSS px ([W3C](https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/22/target-size-minimum.html)), verified;
- 2.4.11, focus not entirely hidden by author content ([W3C](https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/22/focus-not-obscured-minimum.html));
- 2.5.7, a single-pointer alternative to dragging ([W3C](https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/22/dragging-movements.html)).

The researcher read 2.4.11 and 2.5.7 at the W3C source, but a verifier did not re-check them.

That they are the ones these pages break is an inference: sticky headers, small icon buttons and drag-only carousels. The population and agent-failure statistics for accessibility could not be verified; they are listed below. Build axe (0 serious or critical), a 24-px target check, a focus-obscured check and a keyboard tab walk into `verify`, plus a `references/accessibility.md` that says "native element first, ARIA last".

**Frameworks need routing, not rewriting.** Vercel's public Next.js agent evals (35 model/harness rows, exported 2026-09-25) show two things ([agent-results.json](https://raw.githubusercontent.com/vercel/next-evals-oss/main/agent-results.json)).

First, bundled docs help mid-tier models a lot and the frontier not at all:

| Model | Base | With bundled docs |
|---|---|---|
| Kimi K2.5 | 16 | 45 |
| Sonnet 4.6 | 45 | 74 |
| Opus 4.6 | 58 | 74 |
| Sonnet 5 | 81 | 97 |
| Fable 5 | 77 | 77 |
| Opus 5.5 | 97 | 97 |

Second, the failures sit on the newest API surface. The hardest evals are prefetch control (37-43%), Cache Components (40-43%) and instant navigation (43%), all Next.js 16. Old idioms pass at 100%. The notes' framing, "September frontier models 94-97% against April models 39-68%", was **refuted**: models run in September range from 74 to 97. The conclusion stands anyway. A static framework reference would be wrong within months.

So `references/frameworks.md` should detect and route:
1. read the framework and major version from package.json;
2. load that vendor's own agent docs;
3. run the vendor's checker;
4. apply a short, dated stale-pattern list.

The verified stale patterns and checkers:
- React 19 renamed `useFormState` to `useActionState` and says `forwardRef` will be deprecated ([react.dev](https://raw.githubusercontent.com/reactjs/react.dev/main/src/content/blog/2024/12/05/react-19.md)).
- Tailwind v4 moved its PostCSS plugin to `@tailwindcss/postcss`, removed `bg-opacity-*`, renamed the shadows, changed the default border to `currentColor` and gated `hover:` behind `(hover: hover)` ([upgrade guide](https://raw.githubusercontent.com/tailwindlabs/tailwindcss.com/main/src/docs/upgrade-guide.mdx)).
- shadcn/ui made Base UI its default on 2026-07-02 ([changelog](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/content/docs/changelog/2026-07-base-ui-default.mdx)).
- Svelte's own checker, `npx -y @sveltejs/mcp svelte-autofixer <file>`, flags Svelte 4's `export let` and asks for `$props()`. It works here, but it crashes after printing because svelte.dev is blocked, so a gate must parse its stdout and ignore its exit code. The rest of the Svelte 5 rune migration ([migration guide](https://raw.githubusercontent.com/sveltejs/svelte/main/documentation/docs/07-misc/07-v5-migration-guide.md)) was read at source by the researcher but not re-checked by a verifier.

Current npm versions: next 16.3.6, react 19.3.0, tailwindcss 4.3.3, svelte 5.57.1, astro 7.3.5, and vue 3.5.43 (3.6 is still a release candidate).

Stock shadcn is already a tell in tells.md. That makes token discipline a second atelier lever: a token file compiled to Tailwind `@theme` forces a non-default palette, radius and type scale (inference; test it in the A/B).

**Modern CSS gets a Baseline gate.** The `web-features` 3.40.0 package on npm, the dataset behind the Baseline badges, sorts the features UFS leans on:

| Status | Features |
|---|---|
| Widely available | `:has`, container queries, nesting, AVIF, `:user-valid` |
| Newly available | `@scope`, same-document view transitions, invoker commands, `field-sizing` |
| Not Baseline (no Firefox) | scroll-driven animations, cross-document view transitions, `text-wrap: pretty`, WebGPU |
| Not Baseline (other) | customizable `<select>` |
| Practically usable, but young | anchor positioning: 323 of its 325 keys are newly available, some only since 2026-09-14 (the notes' "since 2026-01-13" was refuted as too broad) |

([web-features](https://www.npmjs.com/package/web-features)). A script can label every CSS feature in an output page and fail any `baseline: false` feature that has no `@supports` fallback. That turns "check browser support" from a model's judgement into a deterministic gate. For award-style scroll-driven heroes this matters directly: without a fallback, they are static or broken in Firefox.

**Performance measurement has a hole where INP should be.** `scripts/measure.mjs` has **no INP**. The notes' "10 mentions" were substrings of `hadRecentInput` (refuted). It does measure long tasks, long-animation-frame blocking time (a TBT-like proxy), layout shift and `scrollWidth`. Lighthouse's default weights are TBT 30, LCP 25, CLS 25, FCP 10, SI 10 and INP 0, and its INP audit runs only in timespan mode ([Lighthouse source](https://github.com/GoogleChrome/lighthouse)). UFS should add Event-Timing INP over scripted interactions, and LCP-element checks: not lazy-loaded, AVIF or WebP, correctly sized.

**Lower priority.** Forms, SEO, dark mode, i18n/RTL and HTML email rest on platform facts only; this round found no agent-specific evidence for them. WebGPU is not Baseline and the cloud has no GPU, so cloud checks assert that a WebGL2 fallback renders, and real GPU checks belong to the PC.

## atlias should count UFS checks, gate on renders, then gate on the AI look

**What atlias does today** (verified on atlias `6c710ae`):
- **Router.** It classifies prompts with one regex, `FRONTEND_RE` (`lib/router.mjs:9`), tests `CODEBASE_RE` first, and hints UFS once per session. On prompt sets that researchers wrote by hand, it classified 5 of 40 and 3 of 12 frontend prompts as frontend; a verifier re-ran 10 of the 40 and all 12 and got the same answers. "Build a portfolio site for a photographer" comes out as `other`. The sets are illustrative; a real miss rate needs labelled prompts from Gev's transcripts.
- **Check detection.** `looksLikeVerification()` returns false for `webdesign.mjs verify`, `look` and `audit`, and for `npx lighthouse`, `pa11y`, `next build` and `playwright screenshot`. It returns true for a file literally named `scripts/verify.mjs`, for `npx playwright test` and for `npm run build`.
- **File types.** `CODE_EXT` includes .html, .css, .md, .vue and .svelte but not .scss, .sass, .less, .styl, .astro, .mdx or .svg.
- **Claims.** `PASS_CLAIM_RE` catches claims about tests, checks, suites, specs, builds and lint, but not "renders" or "looks right".
- **Eval corpus.** It has no frontend task.
- **Eval driver.** `atlias eval` drives its own loop through an Ollama or OpenAI-compatible engine (`lib/loop.mjs` header; `lib/eval.mjs` `runTask`), so it cannot A/B Claude Code with a plugin today.

**The consequence.** atlias holds a frontend turn for "a check", and the checks UFS tells the model to run do not count. So the gate pushes the model toward `npm run build` rather than toward looking at the page, which runs against UFS's own rule to read the PNGs. That last point is an inference built from the verified parts.

**The design** is inference built on verified parts. It has three layers, each its own A/B.

**Layer 1: recognition.**
- `VERIFY_RE` learns:
  - `webdesign.mjs (verify|look|audit|debug|quality|parity|security)`;
  - playwright-cli `screenshot`, `console` and `snapshot`;
  - the agent-browser and chrome-devtools CLIs;
  - lighthouse, pa11y, axe, stylelint, svelte-check, `astro check`, `vite build` and `next build`.
- A new `render` event kind is recorded for MCP screenshot and console tools.
- `UI_EXT` gains the missing stylesheet, Astro, MDX and SVG extensions.

**Layer 2: the render gate.**
- **Trigger.** A UI file changed this turn, and no render or frontend check has run since the last UI edit.
- **Block text.** It names the changed files and the fix: `node "<UFS>/scripts/webdesign.mjs" verify <dir|url> --json`.
- **Pass.** `verify` exits 0, with environment-class findings excluded.
- **Integrity findings**, the same family as "says the tests pass, but ran none":
  - *claimed but not rendered*: the reply says "looks good", "responsive" or "matches the design" with no render this turn;
  - *rendered but not looked at*: UFS printed PNG paths and no Read of them followed;
  - *claimed parity with no reference*.

The browser runs in the agent's turn, not inside the Stop hook. In the container, `verify` took about 34 s and `look` about 10 s (single runs). If a background variant is tried, Claude Code still enforces `timeout` on `asyncRewake` hooks, and caps Stop-hook continuations at 8 in a row ([hooks docs](https://code.claude.com/docs/en/hooks)). `bashEditDiff` records only inside a git repository, and only in auto or bypass mode unless a setting enables it. So a stylesheet edited through the shell in default mode is invisible to it, and the UI-file signal must also come from Edit and Write events and from `git status`.

**Layer 3: the AI look.** Once the calibrated tells score exists and its false-positive rate on the human corpus is measured, `verify --json` carries an `aiLook` section with the score and its threshold. atlias then holds a reply on it only under two conditions: the task was classified as page design (atelier, landing page, restyle), never a CSS bug fix; and the score exceeds a threshold whose measured false-positive rate Gev has accepted. Until then it is advisory text inside the block. That is what makes "does not look AI-made" checkable: a number with a known error rate, from a command atlias recognises.

**The contract between the two repos is UFS's `verify --json` output.** It needs a schema version and a separate `env` array for three kinds of finding: TLS or proxy failures to third-party origins, a favicon 404 when the page declares no icon, and blocked CDNs. That keeps the gate from flapping per machine. Today this container's proxy makes both UFS and playwright-cli report Google Fonts as a certificate error.

**The router** should also trigger on files, not only on words, and should hint once per task rather than once per session:
- **File trigger:** edits to stylesheets and to Vue, Svelte, Astro, HTML and MDX files; JSX or TSX files that actually contain JSX; and `tailwind.config`, `components.json` or token files.
- **Measurement:** precision and recall on about 200 real prompts, labelled by someone other than the author of the rules.
- **Alternative:** injecting a compressed frontend docs index instead of a hint rests on a Vercel number that could not be verified, so A/B it rather than adopt it.

**Browser tooling.** atlias should never auto-enable a browser MCP server. The measured tool schemas (single runs, bytes/4) are below; the CLIs cost nothing up front, and the playwright-cli README says CLI invocations "are more token-efficient" ([playwright-cli](https://github.com/microsoft/playwright-cli)).

| Server | Tools exposed | Schema cost per request |
|---|---|---|
| Playwright MCP 0.0.83, headless | 25 | about 5.1k tokens |
| Playwright MCP 0.0.83, with vision, devtools and testing | 49 | about 8.7k tokens |
| chrome-devtools-mcp 1.10.1 | 30 | about 6.6k tokens |
| chrome-devtools-mcp 1.10.1 `--slim` | 3 | about 0.24k tokens |

**Proving it.**
- Run frontend-12 with arm A as today's atlias and arm B with layers 1-2, `--repeat 3`.
- Judge outcomes with checks that do not use UFS: playwright-cli console, axe, and a fixed overflow script.
- Also record tokens, wall time and extra tool rounds, and apply the six-flip floor.

atlias is being changed by other work right now; its HEAD moved from `fd92b54` to `6c710ae`, a gate change, while this research ran. So every atlias item below sits in the ranked plan under the round-five ownership rules, and none is in the cloud build queue.

## Ranked plan

**Owners.**
- **Cloud:** buildable and testable on Linux with headless Chromium, no GPU and npm reachable.
- **PC:** needs Blender, a GPU, real browsers, open network access to third-party sites, human raters, Gev's plan, or long paid runs.

Efforts are the report writer's estimates. "Unknown until measured" is stated wherever that is the truth.

| # | Item | Attacks | Measured by | Expected effect (evidence) | Effort | Owner | Repo |
|---|---|---|---|---|---|---|---|
| 1 | Headless render works as root; `env` finding class; `verify` schema version | Every visual check and the A/B fail in the cloud; tests skip silently | Full suite with a browser required: 0 fails, only ffmpeg skips | Goes from broken to working (verified failure: no `--no-sandbox`, `/opt/pw-browsers` not searched) | 2 h | Cloud | UFS |
| 2 | Rendered tells vector with the second-order tells; ai-tells.json and tells.md corrected | UFS misses the cream ground, Instrument Sans, caps chrome, stat banner and marquee it ships | Fixture pairs; bone fires what the two external detectors fire | UFS agrees with independent detectors on its own chassis (verified: both flag bone, UFS flags nothing) | 4 h | Cloud | UFS |
| 3 | External detectors run beside UFS (impeccable 4.1.0, slop-detect 0.5.2) with an agreement table | UFS grading itself | Bone reproduces 13/Mild and impeccable's three flags | An outside second opinion in every report (both verified to run here) | 3 h | Cloud | UFS |
| 4 | A/B harness: Atelier Brief Corpus v1, arms, render, grade, cost ledger, atlias-compare JSON, blind packet and tally | No with-vs-without number exists | Dry-mode tests; `atlias compare` accepts the output | Makes every later claim measurable (compare shape verified by the report writer) | 5 h | Cloud | UFS |
| 5 | Direction step for `/atelier`, default-off: card, candidate sampling, references, sections from the brief, card-to-render parity | Atelier ships one default direction inside clusters 1 and 5 | Arm C versus A and B in item 9 | Mechanically leaves the default clusters; human effect unknown until measured (sampling evidence is text-only and unverified) | 4 h | Cloud | UFS |
| 6 | Cloud pilot: 6 briefs × A, B × 1 run, capped at $1.50 a run | The cost per run is a guess; the harness is untested live | Ledger; contamination guard; packets render | Measured cost per run; not an effect claim (6 briefs cannot pass the six-flip floor with room to spare) | ≤ $18 | Cloud | UFS |
| 7 | Human-made baseline: tells vectors over the 393 verified corpus sites plus a pre-2023 slice; fingerprints only | No false-positive rate exists for any detector | Share of human sites each detector flags | The first published FP rate for a design detector (none found in the field) | 2 h machine + 1 h setup | PC | UFS |
| 8 | Blind human ratings: Gev plus 2-4 designers rate the packets | No ground truth for "looks AI-made" | κ between raters; majority per pair | Labels for items 9 and 10; the cash cost of crowd raters is unknown | about 45 min per rater | PC (Gev) | UFS |
| 9 | Full A/B: 30 briefs × arms A, B, C × 3 repeats; later D (frontend-design) and E (impeccable) | Whether atelier helps, hurts or does nothing | Primary: human pairwise; `atlias compare`; six-flip floor | Unknown; 80% power only for about a 75% brief-level win rate (report writer's calculation) | $250-430 (assumed) | PC (paid) | UFS |
| 10 | Fit detector weights to the labels; publish AUC, per-tell likelihood ratios and the human-corpus FP rate; the calibrated score replaces the binary list | Weights are author judgement everywhere | Held-out AUC; FP on human corpus | A calibrated score; publish it whatever it shows | 3 h after data | Cloud | UFS |
| 11 | Re-default atelier on item 9's result | Bone may be the tell | The flip decided by item 9 | Follows the data | 1 h | Cloud | UFS |
| 12 | atlias counts frontend checks (`VERIFY_RE`, `render` events, `UI_EXT`) | UFS's own checks do not count as checks | Probe unit tests; frontend-12 A/B | Removes the wrong push toward `npm run build` (verified: the checks are not recognised) | 2 h | Cloud, when atlias is free | atlias |
| 13 | atlias frontend gate section and integrity findings (claimed-not-rendered, rendered-not-read, parity without reference) | "Looks right" claims with no render | frontend-12, `--repeat 3`, graders that do not use UFS | Fewer shipped console errors and overflows; unknown until measured | 1 day | Cloud build, PC run | atlias |
| 14 | frontend-12 corpus and a Claude Code driver for `atlias eval` | atlias has no frontend task and cannot drive Claude Code | Tasks fail as shipped and pass with a reference | A prerequisite for any frontend claim | 1 day | Cloud build, PC run | atlias |
| 15 | Router file trigger, wider prompt regex, hint per task | Most frontend prompts are missed (illustrative sets) | Precision and recall on about 200 prompts labelled from Gev's transcripts | Higher recall; precision must hold on backend prompts | 3 h + labelling | Cloud build, PC labels | atlias |
| 16 | The AI-look score joins the gate for page-design tasks | "Done" does not include "not AI-made" | Items 10 and 13; FP below a threshold Gev sets | Checkable "does not look AI-made" | 2 h after 10 | Cloud | atlias + UFS |
| 17 | axe-core (0 serious or critical), 24-px targets, focus not obscured and a tab walk in `verify`; accessibility.md | No accessibility engine in UFS | Fixture pairs; frontend-12 guardrail | Real violations caught with near-zero false positives (axe's stated goal, verified) | 4 h | Cloud | UFS |
| 18 | frameworks.md detect-and-route plus a stale-pattern lint (React 19, Tailwind v4, shadcn/Base UI, Svelte 5, Astro) | Version drift on new APIs | Fixture repos per framework | Big gains for mid-tier models, small for the frontier (Next evals, verified) | 4 h | Cloud | UFS |
| 19 | Baseline gate over output CSS using web-features; first check whether an existing linter already does this | Non-Baseline CSS with no fallback | Fixtures: `animation-timeline` without `@supports` fails | Deterministic support check (dataset verified) | 3 h | Cloud | UFS |
| 20 | Hydration console gate; Event-Timing INP; LCP-element checks | No INP; hydration errors unseen | Fixtures, including a Next build | Closes the INP hole (verified absent) | 3 h | Cloud | UFS |
| 21 | Reference corpus upgrade: tags filled, fingerprints, retrieval by brief across kinds | The corpus cannot drive visual retrieval | Retrieval returns 3-5 references from 2+ kinds | Feeds item 5; the effect is measured through it | 3 h code + PC capture | Cloud + PC | UFS |
| 22 | VLM critique of the screenshot against references; pairwise judge calibrated on item 8 | No automated taste signal | κ against the human pairs | Advisory ranking only (per-page accuracy unverified) | 3 h | Cloud | UFS |
| 23 | Quarterly tells re-crawl; first-seen and last-confirmed dates per tell | Tells drift within months | Likelihood ratios per quarter | Keeps the score current | 2 h per quarter | PC | UFS |
| 24 | Distribution: `npx skills add` layout, official directory submission, more harnesses | No install count to show | Installs | Adoption; see the revenue section | 2 h + Gev's call | PC | UFS |
| 25 | Carry-overs: live Codex hook test; typography.md line-level CSS audit; app/game chassis; forms, SEO, dark mode, i18n and email sections; WebGPU currency; Figma variables to parity | 09-21 leftovers and thin coverage | Per item | Small each | varies | Codex, GPU and Figma: PC; the rest: Cloud | UFS |

## Build queue for the cloud session now

Five UFS-repo items, each sized for one agent in one sitting. Item 1 unblocks everything visual. Items 2, 3, 4 and 5 are atelier work. Every item lands as a PR on the cloud branch with its tests. Behaviour changes are default-off where they change what users get.

### 1. Headless rendering works in the cloud container (about 2 hours)

**Why.** In this container, `findBrowser()` returns null because its Linux candidates are only the system Chrome and Chromium paths. With a browser forced, Chrome still refuses to start as root because `LAUNCH_FLAGS` has no `--no-sandbox` (`scripts/inspect.mjs:24-44, 251-255`). The browser tests skip rather than fail (`test/browser.test.mjs:40`). All three were verified.

**Spec.**
- On Linux, after `ATELIER_BROWSER` and the existing candidates, `findBrowser()` searches, newest revision first:
  - `$PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux/chrome`;
  - `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`;
  - `/opt/pw-browsers/chromium-*/chrome-linux/chrome`.
- Add `--no-sandbox` to the launch flags only when `process.getuid?.() === 0` or `UFS_NO_SANDBOX=1`.
- Replace `skip: !findBrowser()` with a shared helper that returns a skip reason normally, but throws when `UFS_REQUIRE_BROWSER=1` or `CI` is set.
- In `inspect` and `verify`, add an **env** class for:
  - network errors matching `ERR_CERT_*`, `ERR_TUNNEL_*` or `ERR_PROXY_*` to an origin other than the page's own;
  - a `/favicon.ico` 404 when the page declares no icon;
  - requests to hosts listed in `UFS_ENV_HOSTS`.
- Env findings print under their own heading, go to `env[]` in `--json`, and never change the exit code.
- `verify --json` gains `"schema": "ufs-verify/1"`.

| Acceptance test | Pass condition |
|---|---|
| Render as root, with `ATELIER_BROWSER` unset | `node scripts/webdesign.mjs look <fresh bone scaffold> --widths 1440,390` writes the four PNGs (1440, 1440@600, 390, 390@600) |
| Browser required | `UFS_REQUIRE_BROWSER=1 npm test`: 0 failures; the only skips are the ffmpeg-labelled ones |
| Discovery and flags | With an injected fs, `findBrowser` returns `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; uid 0 adds `--no-sandbox` and uid 1000 does not; the Windows and macOS candidate lists are unchanged |
| Real errors survive | An `err.html` fixture (one `console.error`, one uncaught throw, one missing image) still reports 3 errors at each width |
| Env is not an error | A fixture requesting a third-party https URL that fails TLS reports it under `env`; `verify`'s exit code is the same with and without that request; the scaffold's same-origin `img/hero.jpg` 404 stays an error |

### 2. Rendered tells vector with the second-order tells (about 4 hours, atelier)

**Why.** Bone ships five tells that impeccable or slop-detect flag and UFS does not: the cream ground, Instrument Sans, caps and mono chrome, the stat banner and the marquee. Its data file says UFS ships none of them. Both points were verified above.

**Spec.** Add `scripts/tells-render.mjs`: one in-page function run through the existing CDP session. Expose it as `webdesign.mjs tells <dir|url> [--json] [--widths 1440,390]`. The output schema is `ufs-tells/1`: `{target, widths, ufsSha, features: [{id, fired, value, evidence}]}`.

The v1 feature ids, which stay stable:

| Feature id | Fires when |
|---|---|
| `cream-ground` | The largest-area background among html, body, main and the first section is OKLCH L ≥ 0.90, 0.005 ≤ C ≤ 0.04, 60 ≤ H ≤ 100 |
| `perma-dark` | Ground L ≤ 0.25 and no `prefers-color-scheme: light` rule |
| `cluster-1` | `cream-ground`, a serif h1, and an accent with 20 ≤ H ≤ 60 and C ≥ 0.08 |
| `cluster-2` | `perma-dark` with exactly one chromatic hue at C ≥ 0.15 |
| `template-chrome` | Counts: text ≤ 14 px set in uppercase with letter-spacing ≥ 0.08em; mono-family labels; "·"-joined meta strings; link text ending in "→" |
| `overused-face` | The first loaded family for h1, body or button is on a dated list: the current `SLOP_FONTS` plus Instrument Sans, Plus Jakarta Sans, Mona Sans, Open Sans and Geist Mono |
| `accent-word` | An h1 child that differs in colour or style from the rest of the h1 |
| `decorative-numbering` | 01/02/03 prefixes on sibling headings |
| `stat-banner` | Three or more siblings whose main text is a number at least 2× body size |
| `uniform-radius` | Six or more card-like boxes sharing one border-radius and one shadow |
| `marquee` | An infinite animation that translates a row horizontally |
| `centred-share` | Share of text blocks centred within 2% of the page axis |
| `section-waterfall` | The section sequence equals `DEFAULT_SECTIONS` |
| `display-tracking` | Records the negative tracking on display text. This holds the `audit.mjs:637` versus `crushed_tracking` conflict open until the fitted weights decide it |

Thresholds live in `data/tells-render.json`, with a `why` and a `source` for each, so the fitted weights can change them without code edits.

Data changes:
- `SLOP_FONTS` gains the five faces, with the date.
- `data/ai-tells.json` gains one row per new tell with `source` (impeccable 4.1.0, slop-detect 0.5.2, avoid-ai-design or frontend-design SKILL.md), `first_seen`, `last_confirmed: 2026-09-29` and `source_verified`.
- Those rows set `ufs_chassis_ships_it: true` for cream-ground, overused-face, template-chrome, stat-banner and marquee.
- tells.md regenerates through the existing sync test. Its one-line version stops claiming "no reflexive cream" while bone ships cream, and says instead why bone is cream.

| Acceptance test | Pass condition |
|---|---|
| Bone | `tells --json` on a fresh `new --preset bone` scaffold fires cream-ground, overused-face (Instrument Sans), template-chrome, stat-banner, marquee and section-waterfall |
| Ink | `--preset ink` fires perma-dark |
| Fixtures | One fire/no-fire fixture pair per feature under `test/fixtures/tells-render/`; a restrained negative page (white ground, one unlisted grotesk, left-aligned, varied sections) fires nothing |
| Honest scaffold test | The old assertion that every scaffold passes every tell check becomes an explicit expected-fires list per preset, so any chassis change shows up as a test diff |
| Data | The ai-tells.json and tells.md sync test passes; every new row has a source URL and a date |
| Budget | ≤ 15 s per page at two widths in this container; no network beyond the page's own origin |

### 3. External detectors side by side (about 3 hours, atelier)

**Why.** A detector written by UFS's own authors cannot be the only judge of UFS output. Both external tools were verified to run in this container, and slop-detect only runs once its Playwright is pointed at the local Chromium, because its lazy download from cdn.playwright.dev is blocked.

**Spec.** `tells --external` runs both tools on the same target:
- `npx -y impeccable@4.1.0 detect --json <path|url>`;
- slop-detect 0.5.2, with its browser path set to item 1's Chromium.

Neither tool is vendored. Both versions are pinned in one constant and printed with every report.

`data/detector-map.json` maps overlapping rules to item-2 feature ids:
- cream-palette = cream_default_bg = cream-ground;
- overused-font = slop_fonts = overused-face;
- all_caps_labels = template-chrome;
- stat_banner = stat-banner;
- marquee;
- perma_dark_mode = perma-dark;
- plus purple, gradient text, accent stripe and eyebrow pill.

The output adds `external: {impeccable: {version, findings, slopCount}, slopDetect: {version, score, tier, patterns}}`, an `agreement` row per mapped feature, and a one-line summary: "k of 3 detectors call this page AI-patterned". A tool that cannot run is reported `unavailable` with the reason and exit code 3. It is never reported as clean.

| Acceptance test | Pass condition |
|---|---|
| Bone reproduces | slop-detect 13, Mild (cream_default_bg, all_caps_labels, stat_banner); impeccable reports cream-palette, overused-font and marquee; the agreement row for cream-ground shows all three detectors |
| Negative page | Item 2's restrained fixture is Clean on slop-detect with zero slop-category impeccable findings. If it is not, the test prints both reports so the fixture gets fixed |
| Failure is loud | With npx stubbed to fail, the exit code is 3 and the output says `unavailable`, never Clean |
| Schema | JSON validates against `ufs-tells/1` with the external block |
| Network | Only the npm registry, and only on first run |

### 4. The atelier A/B harness (about 5 hours; the cut line splits it into two sittings if needed)

**Why.** There is no with-vs-without number, and `atlias compare` already accepts the shape this harness writes (verified above).

**Spec, part one: corpus and runs.**
- **Briefs.** `evals/atelier-briefs-v1.json` holds the 30 briefs specified in the protocol. Its header carries a SHA-256 of the brief array. `test/ab.test.mjs` fails if a brief changes without a version bump.
- **Arms.** `evals/arms.json` defines A, B and C: a pinned model ID, `--plugin-dir` for B and C, the prompt template, and C's flag.
- **`ab run --arms A,B --briefs v1 --repeat 3 --budget-usd 1.5 --total-usd N --out runs/<stamp>`.** For every brief, arm and repeat it creates a fresh scratch directory and calls `claude -p <prompt> --output-format json --max-budget-usd <cap> --model <m> [arm flags]`. It keeps:
  - the CLI's JSON;
  - wall time;
  - the files produced;
  - the skills and plugins the run could see;
  - the UFS SHA and the Claude Code version.

  It refuses arm A if any design skill is visible, and stops the whole run once the ledger passes `--total-usd`.
- **`ab render`.** Serves each output locally and captures 1440×900 and 390×844 above the fold, plus viewport-sized slices down the page. It records loaded and failed webfonts and marks pages with failed fonts `env-fonts`.
- **`ab grade`.** Runs items 2 and 3 plus the not-broken checks (same-origin console errors and exceptions; overflow at 390 and 1440). It writes one atlias-compatible `{results: [{id, pass, passes, tries}]}` file per arm for each of detector-clean and not-broken.
- **`ab cost`.** Prints per arm: runs, total $, $ per run, $ per detector-clean page, tokens in, out and cached, wall time and turns.

**Cut line.** Everything above is sitting one.

**Spec, part two: blind packet and tally.**
- **`ab packet`.** Builds a blind HTML packet with the A and B screenshots side by side for each brief and repeat.
  - Left and right come from a seeded RNG, and filenames are hashed.
  - The page carries no arm names.
  - It asks "Which looks designed by a human art director?" and "Which looks more AI-made?", each with a "can't tell" option.
  - Answers save to a downloadable JSON; the key is kept in a separate file.
- **`ab tally`.** Unblinds the answers, takes the majority per pair, writes the atlias-compatible `human-preferred` file per arm, and prints Cohen's κ for every pair of raters.
- **`--dry`.** Runs every step on canned outputs in `test/fixtures/ab/` with no model calls.

| Acceptance test | Pass condition |
|---|---|
| Dry run | `ab run --dry`, 3 fixture briefs × 2 arms × 3 repeats: 18 run directories, a ledger, no network |
| atlias accepts it | For a fixture where B is detector-clean on 6 briefs and A on none, `node /home/user/atlias/bin/atlias.mjs compare A.json B.json` prints 6 gained, 0 lost, p = 0.031 |
| Contamination guard | Arm A is refused given a fixture CLI init that lists a frontend-design skill |
| Blindness | Packet HTML and filenames contain none of "atelier", "ultimate", "UFS", "bone" or "arm"; left and right are balanced within one per arm |
| Tally | A fixture answer set reproduces its known majorities and κ |
| Frozen corpus | Editing one brief makes the hash test fail |
| Spend cap | With `--total-usd 0.01` and a stubbed CLI that reports cost, the run stops after the first ledger entry |

### 5. The direction step, default-off (about 4 hours, atelier)

**Why.** Atelier's only direction today is a default that sits in clusters 1 and 5, and it ships the W5 section waterfall. This item creates arm C, so the first paid run tests a change instead of only the status quo.

**Spec: the card.** `atelier.mjs new --direction <card.json>`, or `/atelier --direction`, builds tokens (ground, ink derived from it, accent, families) and sections from a card instead of from a preset and `DEFAULT_SECTIONS`. **Without the flag, output is byte-identical to 6.8.1.** The card schema is `ufs-direction/1`:
- `brief`;
- `candidates[5]`, each with `palette_source`, `ground` (oklch), `accent` (oklch), `display_family`, `text_family`, `layout_idea`, `bold_move` and `p_default` (0-1);
- `chosen`;
- `why_not_default`;
- `references[3-5]`, each with an awards id and `takes` (palette, type, composition, motion or imagery);
- `sections[]`.

**Spec: validation.** The card is refused, with the rule named, when:
- `chosen` has the highest `p_default`;
- `chosen` falls in cluster 1, 2 or 5 per item 2's boxes and the brief did not request it;
- the references span fewer than two kinds, or cite an id that is missing from awards.json;
- `sections` equals `DEFAULT_SECTIONS`;
- a family on the overused list has no `why`.

**Spec: parity and procedure.** `tells --direction card.json` adds card parity: the computed ground and accent must be within ΔE(OKLab) 0.02 of the card, and the h1 and body families must match. `commands/atelier.md` gains the `--direction` procedure:
1. read `.ufs/directions.jsonl` first;
2. list five directions with `p_default`;
3. drop the most probable;
4. pull references with `awards`;
5. write the card;
6. run `new --direction`;
7. render;
8. critique the screenshots against the references;
9. append the card to the log.

| Acceptance test | Pass condition |
|---|---|
| Parity | `new --direction test/fixtures/cards/ok.json` builds a page whose computed ground, accent and families match the card and whose section order is the card's |
| Refusals | Cards that pick the highest-`p_default` candidate, sit in cluster 1 (ground near #F4F1EA, serif display, accent near #D97757) without a brief request, or cite a single kind of reference are each refused with the rule named |
| Arm B unchanged | A golden-file test shows `new --preset bone` and flagless `atelier.mjs new` produce byte-identical output to 6.8.1 |
| Leaves the clusters | Item 2's `tells` on the ok.json page fires none of cream-ground, cluster-1, template-chrome or section-waterfall |
| Browser-light | Every test passes with `UFS_NO_BROWSER=1` except the parity test, which needs item 1 |

## Adoption and revenue, as far as evidence goes

**Evidence (verified).**
- **The field is free.** impeccable (Apache-2.0), Hallmark (MIT), taste-skill (MIT) and Anthropic's frontend-design have no paid tier.
- **Adoption is large.** GitHub stars on 2026-09-29: anthropics/skills 178.8k, UI UX Pro Max 131.3k, taste-skill 90.9k, impeccable 72.1k, Hallmark 29.3k ([impeccable](https://github.com/pbakaus/impeccable); [Hallmark](https://github.com/Nutlope/hallmark); [taste-skill](https://github.com/Leonxlnx/taste-skill); [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)).
- **Only one sells anything.** Of the skills examined, only UI UX Pro Max sells a paid "Premium" tier, and its price could not be fetched.
- **Nobody publishes a measured effect.**
  - taste-skill's README claims no benchmark or eval.
  - impeccable publishes no false-positive rate.
  - Anthropic's frontend-design plugin README describes no verification step ([frontend-design](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design)).
  - The Claude Design launch post describes no way to verify output quality ([Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs)).

**Levers (inference, not evidence).**
- **Lever 1 is the number itself.** "A blind panel preferred UFS pages over bare-model pages on k of 30 briefs; here is the harness" is a claim no competitor can copy without doing the work, and it fits atlias's "verified or it isn't said" brand.
- **The same fact is a risk.** Today anyone can run `npx` and see two free detectors call atelier's default "Mild" AI. UFS should not market "does not look AI-made" before item 9 reports, and should publish item 9's result even if bone loses.
- **Distribution.** Every leading design skill installs with one command. Whether UFS is listed on skills.sh or in Anthropic's official plugin directory was not established this round.
- **Money, in order of precedent:**
  1. open-core premium direction packs and industry brief sets, the UI UX Pro Max model;
  2. a bundled "frontend done" gate sold with atlias;
  3. a hosted "AI-look and accessibility" audit of a live URL, at the risk that impeccable's local detector is free;
  4. Figma-parity checking as a pro feature. Figma's MCP server limits Starter and View/Collab seats to 6 tool calls a month, so it is already a paid-seat feature ([Figma guide](https://github.com/figma/mcp-server-guide)).
- **No data.** No revenue figure exists for any paid design-skill tier. The install counts, builder revenue figures and consumer-trust survey numbers that circulate are unverified; see below.

## Could not be verified

Each claim below rests on a source the verifiers could not reach (arxiv.org, skills.sh, webaim.org, vercel.com and developers.google.com were all blocked from the container), or on search snippets only. None of it is used as fact above.

| Claim | Status |
|---|---|
| Krebs's crawl: 1,590 Show HN pages, 22% heavy / 32% mild AI patterns, 16 patterns, 5-10% false positives | Primary blocked; conflicts with slop-detect's README citing "~1,400 … 67%" (that quote is verified). UFS `tells.md:8` still uses the 1,590/22/32 figures, so it cites an unverified number |
| Verbalized Sampling: 1.6-2.1× diversity, +25.7% human score, 66.8% diversity recovered | arXiv blocked; only the repo's "2-3x" headline is verified |
| Artificial Hivemind: NeurIPS 2025 Best Paper, 26K queries, judges punish diversity | Primary pages blocked; snippets consistent |
| UICrit: 55% better critiques from few-shot visual prompting | Paper blocked; the repo now describes 11,344 critiques on 1,000 UIs |
| WebDevJudge: best judge 66.06% pairwise, 89.7% inter-annotator agreement | Conflicting snippets (70.34%; 84.82%) |
| ArtifactsBench κ > 0.85 against experts | Dataset card snippet only |
| Deque: axe catches 57% of issues by volume | deque.com blocked |
| SkillsBench: +16.6 pp from curated skills, +4.5 pp for software engineering | arXiv blocked; the study size conflicts between versions |
| Vercel: an AGENTS.md docs index scores 100% against 79% for skills; the skill went uninvoked in 56% of cases | vercel.com and aggregators blocked. The "inject an index instead of a hint" idea rests on this, so it goes to an A/B |
| Next.js evals use pass@4 | Not stated in the results file |
| WebAIM Million 2026 (56.1 errors per page; ARIA pages 59.1 against 42) | webaim.org blocked |
| Accessibility studies of AI code (ASSETS'24, CHI 2026's 541 violations, W4A 2025, AccessGuru's 84%) | Snippets only |
| Human detection accuracy for AI images (about 61%; CISPA near chance); consumer self-reports (Animoto 83%; TrustedSite 94% concerned) | Snippets only; none concerns websites |
| Design Arena / UI-Bench standings and methods; AesEval-Bench | Snippets or aggregators |
| Awwwards judging weights (Design 40, Usability 30, Creativity 20, Content 10) | awwwards.com blocked |
| FAQ rich results ending 2026-05-07; classic Outlook's Word engine losing support in October 2026 | Secondary sources only |
| Web Almanac 2025 Core Web Vitals pass rates | Secondary sources only |
| skills.sh installs (frontend-design ~862K, taste-skill ~532K, UI UX Pro Max ~374.5K, impeccable ~299.7K); "277k installs" of frontend-design | skills.sh blocked; site-wide totals conflict |
| Lovable $500M ARR, Bolt $40M ARR, Gumroad skill-pack prices | Aggregators and snippets |
| agent-browser's "93% less context", and ~114k against ~27k tokens for MCP versus CLI | The claim is not in the README; the benchmark method was not opened |
| Codex's in-app browser (April 2026) | openai.com blocked |
| Whether the cloud session can run nested `claude -p` generations billed to the $60 reserve, and whether the CLI's JSON output carries cost | Not tested. `--bare` needs `ANTHROPIC_API_KEY`, which is unset here. The pilot's first step settles it |

**Refuted, with what is true instead.**

| Claim in the notes | What is true |
|---|---|
| VLM judges rank at Pearson 0.402-0.459 | 0.303 (Phi-4) to 0.459; the "4.5× narrower with multi-annotator labels" figure compares two datasets |
| Bone uses a single serif family | Newsreader plus Instrument Sans plus IBM Plex Mono (the eyebrow and stat-label chrome) |
| Atelier has a fixed section order on every build | `DEFAULT_SECTIONS` is only a fallback, but `/atelier` never sets `--sections`, so the waterfall ships by default |
| Anthropic's blog: "still tend[s] to converge on common choices (Space Grotesk, for example)" | It reads "the model can default to other common choices (like Space Grotesk for typography)" |
| Anthropic's frontend-design skill is about 400 tokens and targets rounded cards | The blog describes a ~400-token prompt; the skill that ships today is 9.4 KB; the blog does not mention rounded cards |
| `measure.mjs` measures INP | No INP; the hits were `hadRecentInput` |
| September frontier models score 94-97% on Next evals, April models 39-68% | September runs range 74-97; the April rows range 16-65 |
| Anchor positioning has been Baseline since 2026-01-13 | Most keys since then; some only since 2026-09-14 |
| UFS mentions RTL | It does not; the hits were substrings |
| inspect-website-styles has only a routing test | It has a behaviour test |
| typography.md mentions oklch once | On three lines |
| Claude Design's tells are not in UFS | Accent stripe, nested cards and the Lucide set are already covered; missing are the teal accent, the blinking status dot, and the default serif headline over a sans body |
| Emil Kowalski ships 12 design and animation skills | 13 SKILL.md files, several of them not design |
| The corpus holds 444 sites | 454 |
| The 09-21 changes were built in 6.8.0 | 6.1.0-6.1.1, on 2026-09-21 |

## Conclusion

The round changes what "make UFS as good as it can be" means. The gap is not more rules; UFS already has more tells than most competitors. The gap is that no one, UFS included, knows whether any of these rules makes a page look less AI-made to a person, and the first hard evidence says UFS's own default is on the wrong side of the line. The most valuable thing UFS can ship is a number with an error bar: a detector fitted to blind human ratings, with a published false-positive rate on human-made sites, and a with-vs-without result on a frozen brief corpus. The first result may well be that bone loses to no skill at all. Publishing that, and then the fix that beats it, is the atlias brand applied to design, and a claim none of the free, heavily starred competitors can make.

Integration comes in two speeds. The research method transfers today, because `atlias compare` already takes UFS's A/B output unchanged. The gate needs staging. First atlias must recognise UFS's checks. Then it should hold "looks right" claims until a render has run. Only after the detector's false-positive rate on human work has been measured should "does not look AI-made" be allowed to hold a reply, and even then only for page-design tasks. Because the tells drift within months, that detector has to be refitted on a schedule, not edited. A quarterly re-crawl of UFS's own reference corpus is the cheapest way to keep "not AI-looking" meaning something.
