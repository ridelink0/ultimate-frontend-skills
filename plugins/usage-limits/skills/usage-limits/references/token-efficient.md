# Token efficient: the rule set and where each rule comes from

When a prompt asks for token efficiency ("be token efficient", "save tokens",
"fewer tokens", "token-efficiency"), the UserPromptSubmit brief appends the
seven rules in `scripts/thrift.js` to that prompt. This file is their source
list. Researched 2026-11-09 with the deep-research process: primary Anthropic
docs only, each page read past the snippet. `tactics.md` has the longer
argument and the arithmetic; this is the short form.

| # | Rule | Evidence | Source | Confidence |
|---|------|----------|--------|------------|
| 1 | Keep the cache prefix stable; no model, effort or fast-mode switch mid-session; do not idle past five minutes | Cache reads bill at 0.1x base input; 5-minute TTL by default, refreshed free on each use, measured from the request start; changes invalidate their level and everything after it (tools, system, messages) | [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching); [Costs: why usage climbs](https://code.claude.com/docs/en/costs) ("your first message after a break longer than the cache lifetime misses the cache and reprocesses your full context") | High (fact) for rates and TTL; the effort/fast-mode cache-key point is from `tactics.md` lever 5 and the fast-mode header note, medium |
| 2 | Read ranges, not files; grep or outline first; never reread | "Specific requests ... let Claude work efficiently with minimal file reads"; code intelligence replaces "a grep followed by reading multiple candidate files"; full conversation is resent every request, so every read is a recurring cost | [Costs: write specific prompts, code intelligence, long context](https://code.claude.com/docs/en/costs) | High for the resend; the range-read habit is an inference from it |
| 3 | Batch independent tool calls in one turn | "whenever you need to perform multiple independent operations, invoke all relevant tools simultaneously rather than sequentially"; each tool round trip is another request carrying the context | [Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use); [Costs: long context](https://code.claude.com/docs/en/costs) | High |
| 4 | Answer short; no preamble or recap | Lower effort makes Claude "proceed directly to action without preamble" and "use terse confirmation messages"; higher effort adds plan explanations and detailed summaries; thinking tokens bill as output | [Effort](https://platform.claude.com/docs/en/build-with-claude/effort); [Costs: adjust extended thinking](https://code.claude.com/docs/en/costs) | High; the 5x output/input ratio is list pricing and varies by model, medium |
| 5 | Low or medium effort for mechanical work, high for hard-to-undo decisions, set at session start | low: "Significant token savings with some capability reduction ... such as subagents"; medium: "moderate token savings"; effort is "a behavioral signal, not a strict token budget"; Opus 5.5 and Haiku 5.5 default to medium, most others to high | [Effort](https://platform.claude.com/docs/en/build-with-claude/effort); [Costs: adjust extended thinking](https://code.claude.com/docs/en/costs) | High |
| 6 | Keep verbose output out of context: filter logs, delegate to a smaller-model subagent | A hook can grep a 10,000-line log "reducing context from tens of thousands of tokens to hundreds"; subagents keep verbose output in their own context, "only a summary returns"; subagent requests still draw usage, so pick a smaller model | [Costs: offload to hooks, delegate verbose operations](https://code.claude.com/docs/en/costs) | High |
| 7 | Non-urgent API work through Message Batches at half price | "All usage is charged at 50 percent of the standard API prices"; most batches finish within an hour, all within 24 hours | [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing) | High; applies to API work, not to an interactive Claude Code turn |

## What the rules do not say

- No rule trades quality for tokens: the rule set ends by keeping the real
  check. Lower effort is for mechanical work, where the effort page says
  quality holds.
- `/clear` between related tasks is not on the list: a fresh session pays a
  fresh cache write (see `tactics.md`, "What does not save money"). The costs
  page recommends it only for unrelated work.
- No savings figure is claimed. The rates above are list prices from the
  pages cited; what a given session saves depends on its context size and
  how many turns it runs.
