# Text tells: what makes copy read as AI-generated (2026)

Research compiled 2026-09-20 from primary sources (Wikipedia guideline pages, detector
vendors, an academic-adjacent corpus report, working copywriters, and my own reading of
AI-built showcase sites). Every claim below is sourced; anything I could not verify against
a primary source is marked UNVERIFIED.

## 1. Vocabulary

### 1a. The 2023 list is stale, but the underlying finding is confirmed
Wikipedia's own detection guide (see 1b) and independent word-frequency tracking agree:
"delve" spiked with GPT-4 in 2023, was heavily mocked, got RLHF'd down by OpenAI, and
"became less frequent later in 2024, then dropped off sharply in 2025" — confirmed by a
Wikipedia-writing analysis summarized by Beutler Ink
(https://www.beutlerink.com/blog/how-to-spot-ai-writing). The mechanism did not go away —
models still reach for statistically "safe," mid-frequency words — it is only the specific
word list that ages out as vendors patch the obvious ones.

### 1b. Primary source: Wikipedia:Signs of AI writing
(https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing, essay maintained by editors,
built from real cleanup cases)

Vocabulary by era, as the guide documents it:
- **2023–mid-2024 (GPT-4 era)**: additionally, boasts, bolstered, crucial, delve,
  emphasizing, enduring, garner, intricate, interplay, key, landscape, meticulous, pivotal,
  underscore, tapestry, testament, valuable, vibrant.
- **Mid-2024–mid-2025**: align with, enhance, fostering, highlighting, showcasing — the
  "softer" register that replaced the flashier 2023 words once those got called out.
- **Mid-2025+**: the guide notes the tell has moved from single words to *canned emphasis
  on notability/significance* — phrasing that manufactures importance rather than one
  flagged vocabulary item. Typical constructions: "stands as," "is a testament to,"
  "plays a crucial role," "underscores the importance of," "reflects a broader," "marks a
  turning point," "sets the stage for," "an evolving landscape."
- Also flagged: promotional/travel-copy words — boasts, vibrant, rich, profound,
  showcasing, exemplifies, commitment to, natural beauty, nestled, groundbreaking,
  renowned, diverse array.

### 1c. The current "kill list" from copywriting/SEO practitioners (2026)
Cross-referenced across ContentBeta's 300+ word list
(https://www.contentbeta.com/blog/list-of-words-overused-by-ai/), Ritner Digital
(https://www.ritnerdigital.com/blog/the-phrases-that-give-away-ai-writing-and-how-to-edit-them-out-before-they-cost-you-trust),
and oliviacal.com's 17-tell list (https://www.oliviacal.com/post/ai-writing-tells).
The words that persist into 2026 alongside/after the 2023 set:
delve, tapestry, realm, landscape, leverage, robust, seamless, testament, pivotal,
multifaceted, utilize, facilitate, unlock, harness, elevate, foster, showcase,
game-changer, journey (used for anything, not just travel), navigate, unpack, dive in,
empower, transformative, holistic, cutting-edge, future-ready, best-in-class,
in the realm of, in today's fast-paced [digital] landscape, plays a pivotal role, it's
important to note that, let's dive in.
UNVERIFIED as a single canonical list — these are the words that recur across independent
2025–2026 write-ups, not one dated study; treat as "current consensus," not a citable
frequency table.

### 1d. Why the word-list approach keeps losing
Multiple sources converge on the same point: vendors patch flagged words, so a plain
blocklist decays in months. The Wikipedia guide explicitly moved from "banned words" to
"patterns of emphasis" for this reason (1b). Practical implication for a scanner: match
*phrase patterns*, not just a static word array, and expect to refresh the list.

## 2. Sentence shapes

- **Two-beat / fragment taglines**: "X. Y." with both halves short, often alliterative or
  rhyming, e.g. the human ad "See it. Say it. Sorted." (UK rail safety campaign) is the
  textbook example of the *pattern itself* — real copywriters use it too, but AI overuses
  it because it is "simple... two beats to each clause" and scores well in the training
  data (Wikipedia rule-of-three article,
  https://en.wikipedia.org/wiki/Rule_of_three_(writing); GPTZero's own writeup on escaping
  it, https://gptzero.me/news/the-rule-of-three/).
- **The rule of three**: AI defaults to three-item lists/clauses because they "balance
  brevity and comprehensiveness" and are overrepresented in the training corpus (journalism,
  academic writing) — GPTZero calls this out as a tell to break, not just a rhetorical
  device (https://gptzero.me/news/the-rule-of-three/); Medium essay treats it as ambiguous
  evidence, "a sign of good writing or a sign of AI"
  (https://medium.com/practice-in-public/the-rule-of-three-a-sign-of-good-writing-or-a-sign-of-ai-d430435c51d6).
- **"Not just X, it's Y" / negative parallelism**: named explicitly by the Wikipedia guide
  as an avoided-"is/are" construction pattern (1b) and repeated across every 2026
  cliché list found (1c). Variants: "It's not just about X — it's about Y," "No fluff, no
  filler, just results."
- **Colon reveals**: SlopTrim's pattern page (https://sloptrim.com/patterns/colon-reveals)
  names this precisely — "a noun phrase, a colon, and a lowercase reveal" ("The best part:
  it scales," "Here's the kicker: nobody tested the backup"), a punchy two-beat rhythm that
  "scores well in engagement-tuned training data" and gets reproduced even where no
  suspense is warranted. Fix per that source: cut the setup, keep the reveal as a plain
  declarative, and reserve colons for real lists/definitions.
- **Avoidance of plain "is/are"**: replaced with "serves as," "stands as," "functions as,"
  "represents," "offers," "boasts," "maintains" — Wikipedia guide again (1b). This is a
  strong, checkable tell: count the ratio of copular "is/are" to synonym-verb substitutes.
- **"-ing" tacked-on significance clause**: sentences that end by bolting on a
  present-participle conclusion, e.g. "...further enhancing its significance" (1b) — a
  cheap way to manufacture a takeaway without actually arguing for it.

## 3. Structure

- **Every landing page section = eyebrow + headline + subhead + two buttons**: documented
  precisely by Superdesign's "Fix a Generic AI Landing Page" post
  (https://superdesign.dev/blog/fix-generic-ai-landing-page), which names the default as
  "Big centered H1, subhead, two buttons, a soft purple-to-indigo glow" and calls the
  overall page order "Hero, logos, three features, a testimonial, pricing, CTA — in that
  exact order, every time." UX Skill's piece makes the same point about the hero alone:
  "Every AI landing-page hero is the same"
  (https://uxskill.laithjunaidy.com/blog/ai-landing-page-hero-generic.html).
- **Three-feature-card row**: "always three, always an emoji or a thin-line icon, always a
  two-word title and a lorem-ish sentence" (Superdesign, same source). 925 Studios calls the
  broader symptom "flat pages lacking visual hierarchy through intentional variation" —
  "identical padding, identical border radius, and identical card heights" across cards
  (https://www.925studios.co/blog/ai-slop-web-design-guide).
- **The generic FAQ**: not covered by a single named primary source in this pass, but is
  the structural sibling of the above per every "AI slop" teardown found — the same
  question set (What is it? How much does it cost? Is my data safe? Can I cancel anytime?)
  recurring near-verbatim across unrelated products. Treat as a judgment-list item, not a
  confirmed checkable string, since I did not find a study enumerating the canonical FAQ set.
- **Generic/composite testimonial**: unnamed person, generic title ("VP of Growth"), a quote
  that praises the *category* rather than a specific outcome — implied by the same
  "stock section order" critique (Superdesign) and by 925 Studios' framing of "asymmetric
  effort" content generally (see AI Slop, 4 below).

## 4. Punctuation

- **Em dash density**: the most publicly litigated tell. Multiple sources debate it in
  2026: Fast Company covers a new Economist analysis arguing the em dash is *not* the best
  signal any more (title: "Forget em dashes: viral report on AI writing has surprising new
  clues," https://www.fastcompany.com/91584243/how-to-identify-ai-generated-writing-viral-report-has-surprising-new-clues-economist
  — I could not retrieve the article body, HTTP 403; the finding is UNVERIFIED beyond the
  headline/teaser). What IS confirmed by other sources in the same search cluster: AI text
  uses *fewer* commas, semicolons and parentheses than human text and instead writes overly
  long sentences with "and" as the single most overused word — i.e., punctuation *scarcity*
  combined with a long-clause style is argued to be a stronger signal than em-dash
  *presence* (aggregated summary from Plagiarism Today and related coverage,
  https://www.plagiarismtoday.com/2025/06/26/em-dashes-hyphens-and-spotting-ai-writing/).
  Quantitative threshold cited elsewhere: 3+ em dashes per 1,000 words raises a detector's
  AI-probability score (same search cluster; specific vendor UNVERIFIED — treat as a rule
  of thumb, not a documented Turnitin/GPTZero constant).
  Practical note for a script: em dash presence alone is a weak, now-gamed signal (writers
  self-censor it, per akerink.com and Writers Guide Substack); em dash *density paired with
  long sentences and low comma/semicolon count* is the more defensible pattern.
- **Title case on everything**: named directly by the Wikipedia guide as a formatting tell
  (1b), alongside excessive boldface and bullet-heavy layouts.
- **Emoji as a formatting/structuring device** (rather than a expressive add-on) — bullet
  points replaced by emoji "headers": Wikipedia guide, same paragraph (1b).

## 5. UI microcopy

- **Banned button verbs**: "Get Started" and "Learn More" are named explicitly as flagged
  generic CTAs by an anti-slop tooling writeup (Medium/Mohit Phogat,
  https://mohitphogat.medium.com/ai-design-slop-why-every-ai-built-interface-looks-the-same-and-how-to-fix-it-bf874e0b470c);
  a Claude Code skill README lists the banned-copy pattern set explicitly: "Seamlessly,"
  "Unleash," "Transform your workflow" (GitHub, Krirox/anti-ai-slop-skills,
  https://github.com/Krirox/anti-ai-slop-skills).
- **Gradient-hero copy cluster**: "Transform your X," "Supercharge," "Unleash,"
  "Effortlessly," "Your X, reimagined" — named as a matched set that habitually pairs with
  gradient-text styling (same Medium source).
- **Generic benefit copy**: "Save time. Work smarter. Scale faster." — cited by Superdesign
  as copy that "applies to any product" with no specific claim attached
  (https://superdesign.dev/blog/fix-generic-ai-landing-page).
- **Empty-state / system-voice phrasing**: not pinned to one named study in this pass, but
  is consistent across every AI-slop teardown read: "You're all set!", "Oops! Something
  went wrong", "Welcome back" as a blanket greeting regardless of context, empty states
  that restate the obvious ("No items yet") rather than offering the next concrete action.
  Flag this as a judgment-list item (recognizable, but not sourced to a frequency study).
- **Real AI-slop failure mode, confirmed primary example**: Wikipedia's AI Slop article
  (https://en.wikipedia.org/wiki/AI_slop) quotes an actual Amazon Prime synopsis that leaked
  the model's own refusal into production copy: *"Unfortunately I do not have enough
  information to summarize further."* This is the clearest primary-sourced example of AI
  authorship leaking into shipped microcopy.

## 6. Game UI copy

I could not find primary-sourced, attributable quotes for the exact lines given as
examples in the brief ("Keep moving. Cross the bridge.", "Headphones recommended", "THE
CITY DOESN'T WAIT", "TAKE A BREATH.") — targeted searches turned up generic slogan-generator
content and Wikipedia game articles, not a critique piece naming these lines. **I am marking
those four quotes UNVERIFIED / illustrative rather than attributing them to a real game.**
What the pattern they illustrate is real and is the game-marketing sibling of the landing-
page tells above:
- **Caps-lock eyebrow line above the logo**: a short imperative or declarative in full
  caps, standing in for a tagline (structurally identical to the "eyebrow label" in section
  3, just louder). Judgment-list item — recognizable from game trailer pages I have seen, not
  tied to a citable study in this pass.
- **Two-beat imperative taglines**: same mechanism as section 2's fragment pattern, applied
  to store-page copy ("Move fast. Trust no one." style) — pattern, not sourced quote.
  Treat with the same skepticism as section 2's tagline analysis: the *form* is confirmed by
  the rule-of-three/two-beat sourcing above; the specific in-brief wording is not attributed.
- **"Headphones recommended" / sensory-priming lines**: common on real game store pages
  (this is a real, long-standing genre convention predating AI, used on plenty of
  human-written store pages for audio-heavy games) — its presence alone is NOT a reliable
  AI tell; it only becomes suspicious paired with the generic caps-eyebrow + fragment
  tagline + no specific mechanic named. Judgment call, not a checkable string.

## 7. What human copy does instead

Synthesized from the contrast implicit in every source above, plus my own reading of the
Shader.se project pages (see shader.md in this scratchpad — e.g. "All models were made by
us using Blender," "The game was developed with 8th wall which is the same software used in
Pokemon GO," "Prices are being fetched from an API"):
- **Names the actual thing**: software (Blender, React Three Fiber, 8th Wall), a material
  (glass, coffee toppers), a place (Norrköping, Händelö Eco-Industrial Park) — not a
  category noun ("innovative solution").
- **Uses a real number, price, or date** instead of a vague superlative ("over 100 modeled
  products," "Christmas 2024," scores like "8.1/10" on an awards page) rather than
  "industry-leading" or "best-in-class."
  ​
- **A specific verb tied to a specific mechanic**: "scan ICA's products," "take a photo,"
  "fetch prices from an API" — not "unlock," "empower," "leverage."
- **One long sentence next to one short one**, on purpose, for rhythm — not a
  uniform-length paragraph of medium sentences (a stylistic fingerprint AI struggles to
  reproduce because it optimizes for the "digestible" rule-of-three cadence, per GPTZero's
  own writeup, https://gptzero.me/news/the-rule-of-three/).
- **An actual opinion or admission**, including a downside or a joke, rather than
  frictionless positivity: Shader's own home page is a useful case study in the inverse —
  its final paragraphs deliberately parody corporate-jargon voice ("synergize," "unlock new
  verticals," "maximize your digital ROI," "pick up the phone, send a fax") as a knowing
  joke, which only works *because* the site elsewhere is scrupulously specific about
  software and materials. The parody is legible as parody only against a backdrop of real
  specificity.
- **Silence / restraint**: says less where a generic page would over-explain (several
  Shader project pages are three sentences long and stop, e.g. eHealth Arena, HEIP,
  Norrköpings Symfoniorkester — no forced FAQ, no forced testimonial, no "why choose us"
  section).

## 8. Two lists for actual use

### Checkable (a script can scan for these)
1. Vocabulary hit-rate against the 2023 list (1b) AND the 2026 list (1c) — track both,
   report which era's words are firing (helps distinguish stale detectors from current
   ones).
2. Ratio of copula ("is"/"are") to synonym-substitute verbs ("serves as," "stands as,"
   "represents," "boasts," "offers," "functions as," "maintains") — high substitute ratio
   is a tell (1b).
3. Regex for negation-parallelism: `not (just |only )?\w+.{0,40}(it'?s|but)\b` and
   `no \w+,\s*no \w+,\s*just\b` (section 2).
4. Regex for colon-reveal: sentence-initial noun phrase (<=5 words) + `:` + lowercase
   continuation (section 2 / SlopTrim).
5. Count buttons per section header block; flag sections with exactly one eyebrow + one
   H1/H2 + one subhead + two CTAs, repeated identically across 3+ sections (section 3).
6. Count feature-card rows where n=3, each card has an icon + 2-word title + one sentence,
   and all three sentences are near-equal length (section 3).
7. Em dash count per 1,000 words AND comma+semicolon+parenthesis count per 1,000 words —
   flag high em-dash-with-low-other-punctuation combined with long average sentence length,
   not em dash alone (section 4).
8. Title-case detection on non-title strings (headers, buttons) as a formatting flag
   (section 4).
9. Button-text match against a small banned-verb list: "Get Started," "Learn More,"
   "Explore," "Unlock," "Unleash," "Discover," "Elevate Your ___" (section 5).
10. Flag any literal leaked-refusal string ("I do not have enough information," "as an AI
    language model") — rare but a 100%-confidence tell when present (section 5, AI Slop
    article).

### Judgment (needs a model, not a regex)
1. Does the copy name a real, checkable specific (a tool, a material, a place, a number,
   a price) anywhere in the first two sentences, or does it stay at the category level the
   whole way through?
2. Is the enthusiasm uniform, or does the piece admit a tradeoff, a limitation, or make a
   joke at its own expense? (Shader's home-page parody only reads as intentional because
   the rest of the site is deliberately restrained — a model should weigh copy *in context*
   of the surrounding specificity, not line by line.)
3. Does sentence length vary on purpose (one long, one short, back to back), or is every
   sentence roughly the same medium length — the "rule of three" cadence applied at the
   paragraph level?
4. Would this exact sentence still make sense if you swapped the product/brand name for a
   competitor's? If yes, it is generic-copy-shaped regardless of vocabulary.
5. Are structural elements (FAQ questions, testimonial shape, hero layout) load-bearing for
   *this* product, or copied wholesale from the landing-page template regardless of what is
   being sold?
6. For game/app microcopy specifically: does the caps-lock eyebrow or tagline name a
   mechanic or character, or is it swappable across any game in the genre (the
   "headphones recommended" convention is fine on its own; it is a tell only stacked with
   zero other specifics)?

## Sources (primary, all fetched 2026-09-20)
- Wikipedia:Signs of AI writing — https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- Wikipedia: AI slop — https://en.wikipedia.org/wiki/AI_slop
- Wikipedia: Rule of three (writing) — https://en.wikipedia.org/wiki/Rule_of_three_(writing)
- GPTZero, "How to Break Free from GPT's Rule of Three in Writing" — https://gptzero.me/news/the-rule-of-three/
- SlopTrim, "How to Fix Dramatic Colon Reveals in AI Writing" — https://sloptrim.com/patterns/colon-reveals
- Superdesign, "Fix a Generic AI Landing Page: 6 Tells and the Prompts That Kill Them" — https://superdesign.dev/blog/fix-generic-ai-landing-page
- UX Skill, "Every AI landing-page hero is the same" — https://uxskill.laithjunaidy.com/blog/ai-landing-page-hero-generic.html
- 925 Studios, "AI Slop Web Design: Complete Guide" — https://www.925studios.co/blog/ai-slop-web-design-guide
- Beutler Ink, "How to Spot AI Writing, According to Wikipedia" — https://www.beutlerink.com/blog/how-to-spot-ai-writing
- ContentBeta, "List of 300+ AI Words, Phrases and Sentences to Avoid (2026)" — https://www.contentbeta.com/blog/list-of-words-overused-by-ai/
- Ritner Digital, "The phrases that give away AI writing" — https://www.ritnerdigital.com/blog/the-phrases-that-give-away-ai-writing-and-how-to-edit-them-out-before-they-cost-you-trust
- oliviacal.com, "How to Spot AI Writing Tells: 17 Examples + AI Words Blacklist 2026" — https://www.oliviacal.com/post/ai-writing-tells
- GitHub, Krirox/anti-ai-slop-skills — https://github.com/Krirox/anti-ai-slop-skills
- Medium / Mohit Phogat, "AI Design Slop: Why Every AI-Built Interface Looks the Same" — https://mohitphogat.medium.com/ai-design-slop-why-every-ai-built-interface-looks-the-same-and-how-to-fix-it-bf874e0b470c
- Plagiarism Today, "Em Dashes, Hyphens and Spotting AI Writing" — https://www.plagiarismtoday.com/2025/06/26/em-dashes-hyphens-and-spotting-ai-writing/
- Fast Company (headline/teaser only, body blocked HTTP 403), "Forget em dashes..." — https://www.fastcompany.com/91584243/how-to-identify-ai-generated-writing-viral-report-has-surprising-new-clues-economist
- Medium / Lindsy Anderson, "The Rule of Three — a Sign of Good Writing or a Sign of AI?" — https://medium.com/practice-in-public/the-rule-of-three-a-sign-of-good-writing-or-a-sign-of-ai-d430435c51d6
