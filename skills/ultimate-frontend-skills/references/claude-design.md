# Claude Design with Ultimate Frontend Skills

Rewritten 8 September 2026 against **the running host**, not only against the
published documentation. The earlier version of this page described one route -
an HTTP MCP server you register - and that is not the route a current Claude
Code build uses. Everything below says how it was established, and anything
that was not exercised is marked as not exercised.

Find out what you have before doing anything else:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/design.mjs" detect
```

That command only reports. It does not register an MCP server, consent, log in
or publish; each of those changes your account or environment and is yours to
run.

## The routes, and which one you are on

**1. The built-in `design` canvas skill (Claude Code).** Verified live on the
machine this page was written on: invoking the skill returns its own SKILL.md,
and it unpacks `seed-canvas.mjs` and `payload.template.html` into the host's
temp dir under `claude/bundled-skills/<version>/<hash>/design/` - not into
`~/.claude`. This is the route most people are actually on, and the previous
version of this document did not mention it at all.

You draft a design as `.dc.html` artboards, seed them into one self-contained
canvas page, and publish that page as an Artifact. The published page is what
this plugin can measure.

```sh
node seed-canvas.mjs --template payload.template.html --out study.html \
  --title "Study" --artboard Main.dc.html [--canvas canvas.json] [--image logo.png]
node seed-canvas.mjs --extract <published-or-seeded page>.html --to <fresh empty dir>
```

Two facts that decide how you work with it:

- **A bare `.dc.html` is not a renderable page.** It expects a runtime the
  editor injects (`support.js`, `DCLogic`), leaves `{{handlebars}}` unresolved,
  and resolves `<img src>` against base64 state in the canvas. Opened in a
  browser it produces a degraded skeleton that still *measures* like a design.
  `webdesign parity` refuses one rather than measuring it.
- **The seeded canvas works entirely offline from `file://`.** No login, no
  network, no publish is needed to render or measure it. The artboard width in
  `canvas.json` is a real responsive viewport - media queries inside the
  artboard key off it - so author artboards at the widths you will build at.

**Not exercised.** The canvas skill's own text points people at claude.ai/design
for import, export and status rather than at a `/design ...` spelling, and this
page previously turned that into "those verbs are not available while the
preview is on". That is more than was established: the shipped binary does
carry a `/design` dispatch table with `import`, `export` and `status` entries,
gated on the Design tools being present. None of the three was run, so treat
their availability as unknown on your build and read the skill's own text
first. (The host spells the sign-in command both ways - `/design login` inside
that table, `/design-login` everywhere else, which is the form used below.)

**2. The native `DesignSync` tool and `/design consent` (Claude Code).** This is
a first-party tool in the host, **not** an MCP server, reaching
`/v1/design/consent`, `/v1/design/grants` and `/v1/design/` under the
`user:design:read` scope. Its methods are `list_projects`, `get_project`,
`list_files`, `get_file`, `create_project`, `finalize_plan`, `write_files`,
`delete_files`, `register_assets`, `unregister_assets`, `report_validate`, and
it enforces an order: list/read, then `finalize_plan`, then write/delete.

Three things worth knowing before you reach for it:

- `/design consent` grants and `/design revoke` undoes, and the binary makes
  both conditional: they are "available only with a first-party claude.ai login
  and a policy that permits Design access". `/design-login` is not a
  browser-reachability fallback - it is the **authorization** command, with its
  own browser flow and a paste-the-code fallback *inside* it, and the host's
  own error strings name it as the remedy for a session whose login carries no
  Design access: "most likely because a /login token carries no Claude Design
  access. Run /design-login and retry". The DesignSync schema says the same -
  access comes "through their claude.ai login (or, for sessions without one, a
  dedicated design authorization from /design-login)". So on an API-key,
  Bedrock or Vertex session, or a token without the grant, `/design consent`
  cannot work and `/design-login` is the step. Established by reading those
  strings in the running binary; neither command was run.
- `/design-sync` **pushes**, it does not import. It bundles a **React** design
  system - from Storybook or a bare package - and uploads it. This plugin
  builds plain HTML and CSS, so `/design-sync` does not apply to anything
  produced here.
- The target project must have been created as
  `type: PROJECT_TYPE_DESIGN_SYSTEM`, which is fixed at creation. Pushing to an
  ordinary project never turns it into a design system.

**Not exercised.** Whether this account has consented was not checked and no
authenticated Design call was made while writing this. Do not assume the grant
exists, and never report a remote Design operation as successful without its
actual result.

**3. The HTTP MCP server, for hosts that use it - Codex among them.** This
plugin ships for Claude Code and Codex, and not every host has the built-in
skill.

Claude Code registers it with a command:

```sh
claude mcp add --scope user --transport http claude-design https://api.anthropic.com/v1/design/mcp
```

Codex does not have that CLI, and running it there would enrol the server into
the *other* host - the one this page has just said already has the native
routes. Codex names its MCP servers in `~/.codex/config.toml`, where an HTTP
server is a table with a `url` key:

```toml
[mcp_servers.claude-design]
url = "https://api.anthropic.com/v1/design/mcp"
```

That is the shape `scripts/design.mjs` looks for when it reports this route on
a Codex host, and the shape a config on the machine this page was written on
already uses for a different HTTP MCP server. Recent Codex builds also have a
`codex mcp` subcommand; it was not exercised here, so the file is what is
documented - check `codex mcp --help` on your build if you would rather use a
command.

The endpoint is real: an unauthenticated MCP `initialize` POST answers HTTP 401
`unauthorized`, not 404. But on a Claude Code build that already ships the
canvas skill and `DesignSync`, registering it adds a server that duplicates a
native capability - so `scripts/design.mjs` prints this command and refuses to
run it for you. Run it only if `detect` shows you have no other route.
[Anthropic's setup and usage documentation](https://support.claude.com/en/articles/14604416-get-started-with-claude-design).

**4. Send to Netlify.** The Netlify MCP server exposes
`import-claude-design-from-url` (described by Netlify as the "Send to Netlify"
destination for Claude Design) and `get-design-import-job-status`. It consumes
a short-lived public HTTPS URL to a **self-contained** HTML bundle with images,
fonts and styles inlined - exactly the shape `seed-canvas.mjs` emits. Passing
`claude_design_project_id` updates the same Netlify site in place instead of
creating a new one. Not exercised here; listed because it is connected on this
machine and because it is the only documented deploy path straight out of a
canvas.

## September 2026: what changed, and what was seen from inside a session

Read on 20 September 2026 from Anthropic's own post
(https://claude.com/blog/claude-design-stays-on-brand-for-daily-work) and from
the `DesignSync` tool schema as loaded inside a Claude Code 2.1.263 session on
the machine this was written on:

- **Claude Design now works inside any conversation**, including Claude Code
  and the Artifacts tab, in beta on paid plans (Pro, Max and Team on by
  default; Enterprise off until an admin enables it).
- **It shares usage limits with Claude Code.** A design pass and a build pass
  now draw on the same 5-hour and weekly windows. Budget them together.
- Anthropic describes **`/design-sync` as two-way**: it pulls a design system
  into Claude Code so a build uses the project's real components, and pushes
  what was written back to the canvas. The tool underneath has both halves:
  `list_files` and `get_file` are the pull, `finalize_plan` then
  `write_files` / `delete_files` the push, in that fixed order. The earlier
  section above says "pushes, it does not import"; that was true of the sync
  command in June and is superseded for the tool, not for plain HTML: the
  bundle it syncs is still a React design system, so a UFS page is measured
  against a canvas with `parity`, not pushed with `/design-sync`.
- **The Design System pane indexes cards from a marker**: the first line of a
  preview HTML file, `<!-- @dsCard group="..." -->`, compiled into
  `_ds_manifest.json`. `register_assets` is legacy. Verified from the tool's
  own description; which other attributes the marker accepts beyond `group`
  is UNVERIFIED (the legacy call took `name`, `subtitle` and `viewport`).
  To hand a UFS section library to Claude Design as a design system, write one
  preview HTML per section with that marker on line 1, in a directory the user
  points `/design-sync` at.
- **This plugin never calls `DesignSync` on its own.** Its schema says it is
  for the `/design-sync` skill the user starts. UFS reads the result, builds
  against it, and measures parity; it does not create projects or write files
  to one.
- Export from the canvas is PDF, PowerPoint or HTML; connected destinations
  are Adobe, Base44, Canva, Gamma, Lovable, Miro, Replit, Vercel and Wix.

## Implementing a supplied design

1. Read the brief. If a Design project, a published canvas or an exported
   bundle is supplied, that is the design. It takes precedence over this
   plugin's house style, completely.
2. Implement it in the project's framework. Keep its typography, spacing,
   composition, palette, assets and components. Replace prototype-only
   behaviour with working interactions.
3. Use this plugin's section library, CSS chassis and motion runtime only where
   they are compatible with that design. The house style is the fallback for a
   project that has no design, never a reason to overwrite one that does.
4. **Measure it.** This is the step that turns "preserve the supplied design"
   from an instruction into something checkable:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" parity <built dir|file|url> --design <seeded canvas>.html
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" verify <built dir|url> --design <seeded canvas>.html
```

`verify --design` folds parity into the single verdict alongside the audit, the
render/quality pass and the security scan, under the same severities and the
same exit codes.

## What parity measures, and what it cannot

One browser session, one set of probes, pointed first at the design and then at
the page, so a difference in the numbers is a difference in the pages. It
compares the type sizes actually used, the rendered palette (text colours and
area-weighted backgrounds), the vertical spacing rhythm, and the geometry of
the content band and the leading headline.

Every colour is converted to sRGB inside the page before it is compared -
`getComputedStyle` returns `oklch()` and `color-mix()` verbatim, and this
plugin's own `core.css` is written in oklch, so a comparison that read the
numbers out of an `rgb()` string could not match a house-style page against its
own palette. A value that still cannot be read is reported as unread and left
out of the verdict rather than counted as different.

The whole tolerance table lives in `TOLERANCE` at the top of the comparison in
`scripts/parity.mjs`, and none of it is adjustable from the command line - the
numbers are fixed, and editing them means editing the plugin:

| what | value |
| --- | --- |
| type size | within 2px |
| colour | RGB distance 40 |
| content band, heading width | 8% and 12% of the viewport |
| vertical rhythm | 40% drift in the dominant gap |
| a background counts as a ground at | 3% of what the page paints |
| a size or colour is a stray below | 2 uses on the page |

A false "does not match" on a good implementation is the worst outcome
available: it would send an agent off to damage a page that was right. The
report names things (`3 type sizes are not in the design: 30px, 13px, 11px`)
rather than scoring a percentage.

Two rules keep the stray filter honest. **The display line is exempt from it**
on both sides: the largest text on a page appears exactly once by definition,
so filtering it out as a stray would exempt the element a design is most about
from the entire check - its size and its colour are compared and named
separately. And **severity follows area, not count**: one background colour
under the whole page is a warning, two tint bands covering four points each are
a note, and the finding says what share of the page's paint it covers.

Only one combination is escalated to an error: a page whose type scale **and**
palette are both mostly absent from the design. That is not drift, that is a
supplied design that was thrown away and rebuilt in the house style - the exact
thing both command files forbid. It needs a design substantial enough for
"absent from it" to mean something (three sizes and two colours); measured
against a hero-only artboard, a whole page will always look mostly absent, so
that case is a warning saying the reference is too thin, not an error saying
the page is wrong.

Known limits, all real:

- **Fonts are the sharpest one.** A canvas artboard can only load stylesheets
  from fonts.googleapis.com and files from fonts.gstatic.com; anything else has
  to be a `data:` URI `@font-face`. A page on Adobe Fonts or self-hosted woff2
  therefore resolves a *different* face inside the artboard, and line-height,
  wrap points and measure diverge for reasons that are not design differences.
  Compare sizes and colours freely; treat wrap-dependent geometry as suspect
  unless both sides resolve the same family. Parity reports a family difference
  as a note and never escalates it.
- **Geometry is skipped across breakpoints.** If the artboard and the page are
  rendered more than 25% apart in width, the comparison would be measuring the
  media query rather than the implementation, and parity says so instead.
- **Artboards live in their own out-of-process frame.** Parity attaches to it
  deliberately. If it ever fails to find one, the report says so on its own line
  rather than quietly measuring the editor chrome around the design.
- **Pixel probes, not DOM probes, are what break here.** The canvas renders at
  a Fit zoom, so screenshot coordinates are scaled; parity uses in-frame DOM
  geometry, which is true CSS px, and does not sample the canvas's pixels.
- **One artboard at a time.** A canvas with several artboards attaches one
  frame per artboard, and nothing in the frame's own identity says which
  `.dc.html` it came from - they are all `about:srcdoc`. Parity reads the frame
  with the most content and names it in the report; mapping a specific artboard
  to a specific page is not implemented, so compare one page against a canvas
  whose main artboard is the design for that page.
- **Scope.** This compares an artboard against an implementation. It cannot
  compare anything against claude.ai/design proper, and the canvas preview's own
  documentation says parity with claude.ai/design is not a goal.

## If no route is available

`node "${CLAUDE_PLUGIN_ROOT}/scripts/design.mjs" detect` will tell you which. Check the Claude Code
version, account eligibility and organisation policy. The local scaffolding,
audit, render, quality, security and verify passes all work with no Design
connection at all - and so does the canvas skill, which needs no login to draft,
seed and render a design locally.
