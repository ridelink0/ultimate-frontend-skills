---
description: "Preview a website locally - serve a folder on localhost, or run the dev loop that re-audits and re-renders screenshots on every save"
argument-hint: "<site dir> [--port 4321] [--watch]"
disable-model-invocation: true
---

The request is the text the user typed with this command (Claude Code appends
it below as ARGUMENTS; in Codex it is the rest of the message). With no
directory, serve the current one.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's folder. Codex runs this command as a
skill and leaves that variable empty; there, use the folder that holds
`.codex-plugin/`, three levels above this file.

Plain preview, loopback only:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" serve <dir> [--port 4321]
```

With `--watch`, or when the user is iterating on the page, run the dev loop
instead - it serves, watches, re-runs the audit and re-renders on each save:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" dev <dir> [--port 4321] [--widths 1440] [--scroll 0,900]
```

Both keep running: start them in the background, give the user the localhost
address, and read the dev loop's output after each save rather than polling.
