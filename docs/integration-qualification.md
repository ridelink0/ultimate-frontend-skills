# Gev integration qualification

The ten additions were tested on Windows using exact clean source commits from
`skills/ultimate-frontend-skills/data/integrations-2026-11-01.json`. Evidence is
in `integration-qualification-2026-11-01.json` beside that catalog.

All ten passed **isolated install and discovery**:

1. Verify the actual checkout commit and reject a dirty source tree.
2. Resolve the selected marketplace/plugin manifest and SKILL frontmatter names.
3. Use the native Claude plugin installer or Vercel skills CLI1.7.4 to install
   only the selected plugin/skills into disposable profiles.
4. Run the native list/discovery command.
5. Load installed selected instructions and match their SHA256 hashes to the
   pinned source bytes.

This proves the catalog can install/discover the selected instructions. It does
not certify every upstream framework build, model execution of a skill, remote
backend access, scanners, premium features or commercial licenses. Plugin-kind
entries install the selected upstream plugin, which can contain additional
skills. Skill-kind entries select the named skills explicitly.

| Source | Selected feature | Qualification |
|---|---|---|
| nextlevelbuilder/ui-ux-pro-max-skill | ui-ux-pro-max plugin | Native install/discovery and source hash match |
| anthropics/skills | webapp-testing | Scoped install/discovery and source hash match |
| expo/skills | expo plugin | Native install/discovery and source hash match |
| trailofbits/skills | static-analysis plugin | Native install/discovery and source hash match; scanners not run |
| remotion-dev/skills | best practices, markup, render | Scoped install/discovery; original local runtime render separately verified |
| supabase/agent-skills | Postgres best practices | Scoped install/discovery; no database queries or migrations |
| vuejs-ai/skills | Vue best practices/debug | Scoped install/discovery; no application build implied |
| antfu/skills | Vite/Vitest | Scoped install/discovery; no additional framework added to UFS |
| wshobson/agents | frontend-mobile-development plugin | Native install/discovery; no agents or model calls launched |
| google-labs-code/stitch-skills | react-vite-dashboard | Scoped install/discovery; no Stitch account action |

Qualification found a real catalog mismatch: the `react-components` directory's
frontmatter name is `stitch::react-components`. It is excluded from the portable
Windows selection; `react-vite-dashboard` was installed successfully. The source
license and exact commit remain recorded; no third-party files are vendored.

`node scripts/qualify-integrations.mjs <pinned-source-parent> <new-output>` checks
source without installing. Add `--install` to perform the explicit native host
test. Each checkout is named `owner-repo` below the supplied source parent.
Output must be new; existing evidence is never deleted. Source drift and missing
selected names fail. Tests cover source drift, mismatched names, invalid selectors,
credential stripping and refusal to overwrite earlier evidence.

The subprocess environment redirects HOME, USERPROFILE, CLAUDE_CONFIG_DIR,
CODEX_HOME, XDG configuration/cache/data, APPDATA, LOCALAPPDATA and npm config/cache
into each disposable profile. Provider tokens and inherited secrets are removed.
The harness invokes no models, hooks, remote database actions or paid APIs.
Windows pack commands now invoke the native executable or npm's JS entry point
with literal argv and `shell:false`; shell metacharacters stay data.

## Remotion evaluation

`skills/remotion-video/assets/example/` is original MIT UFS source. Its optional
dependencies are pinned and are installed only in a separate evaluation copy.
The plugin does not ship node_modules, native codecs, MP4s or downloaded browsers.
The example uses an existing browser and records five stills plus an MP4 receipt.
See `docs/remotion-evaluation.md` for the actual render/decode result.

The current [official FAQ](https://www.remotion.dev/docs/license/faq) permits
noncommercial evaluation. The [pricing page](https://www.remotion.dev/docs/license/pricing)
states separate eligibility for individuals/small organizations. This run is
local evaluation, not a general commercial license determination. The
[upcoming terms](https://www.remotion.dev/docs/terms) explicitly apply from5.0;
the example pins4.0.539, so review the version4 license shipped with that package
and [version4 terms](https://www.remotion.pro/terms-4-0) for applicability.
