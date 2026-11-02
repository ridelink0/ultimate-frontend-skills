# Gev plugin suite

The canonical source repository is `ridelink0/ultimate-frontend-skills`.
Its marketplace contains three independently selected plugins:

| Plugin | Source | Purpose |
| --- | --- | --- |
| ultimate-frontend-skills | repository root | Frontend workflows, motion, reference research and verification |
| usage-limits | plugins/usage-limits | Local usage accounting, fit reports and permission-preserving continuation |
| image-deep-research | plugins/image-deep-research | Standalone licensed-image and website research |

UFS already contains the image-research skill. Select the standalone image
plugin when using it without UFS; installing both creates duplicate skills.
Selecting UFS does not enable Usage Limits or the standalone image plugin.
No installer disables a third-party plugin or changes its permission policy.

## Install through native hosts

For Claude Code:

```sh
claude plugin marketplace add ridelink0/ultimate-frontend-skills
claude plugin install ultimate-frontend-skills@ultimate-frontend-skills
# Optional separate selection:
claude plugin install usage-limits@ultimate-frontend-skills
```

Codex can add the same marketplace through its native plugin controls. Its
CLI capabilities depend on the installed host version; use `codex plugin --help`
before choosing CLI arguments. A bare `npx skills add` installation copies skill
folders and does not supply the full UFS scripts, hooks or marketplace.

## Source and distribution

Usage Limits and image research were imported with `git subtree`, retaining
their original commit ancestry and MIT licenses. Existing upstream URLs and
the image-research lock retain historical provenance; they do not establish
that a new release was published there. Current listing, privacy and support
links point to the canonical repository.

The npm root allowlist includes each optional plugin's runtime distribution
so every marketplace source path resolves. It excludes their development tests,
tools and documentation folders. Hosts activate the explicitly selected
manifest; merely carrying source files does not activate another plugin.
No native binary, bytecode, WASM or install-time dependency payload is bundled.
Browsers, ffmpeg and optional Remotion dependencies remain explicit external
development tools. A source/package audit is not developer-directory approval.

```sh
node scripts/suite-check.mjs
node scripts/distribution.mjs
node scripts/suite-check.mjs --test
```

The first command checks manifest identity/version and image-source hashes.
The distribution command checks the package allowlist and readable payload.
The final command runs the three test groups independently. Browser checks
require a real Chrome, Edge or Chromium; a fast run with browser skips is not
full release qualification.

## Integration qualification

The ten additions are recorded with exact commits, selected skills, license
findings and qualification levels in
`skills/ultimate-frontend-skills/data/integrations-2026-11-01.json`.
They are optional, scoped source integrations. No premium 21st.dev assets are
redistributed. A native install/discovery check verifies host loading; it does
not prove an upstream framework's entire test suite or every task an AI model
could attempt. Remotion rendering has a separate runtime license and export
verification; no universal commercial-use entitlement is implied.

## Preview and deployment checks

`skills/link-preview/SKILL.md` connects cited deep research, image research and
the build-time PNG/metadata tool. The validator checks emitted routes,
canonicals, required tags, same-origin images and complete 1200x630 PNG data.
The generator refuses missing input and paths outside its output tree, keeps
scripts intact and uses content-derived image names. Inspect actual cards.
Then verify deployed status, content type, crawl access and real preview
refresh. Visual quality checks cannot prove whether an image was AI-generated.

Read `PRIVACY.md` and each selected plugin's policy before handling private
content. Browser studies contact named websites in a fresh profile; Usage
Limits reads local usage/log metadata and may obtain provider usage readings.
Directory submission and review remain separate, observable release steps.
