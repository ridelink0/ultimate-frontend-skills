---
topic: Claude Code unattended resume from a Windows scheduled task keeps failing for Gev's usage-limits relay (github.com/ridelink0/claude-code-usage-limits; wake.js opens a cmd window that runs `claude --resume <id> --permission-mode bypassPermissions --remote-control ...` in the project folder). Tonight it stopped at Claude Code's folder-trust question; ~/.claude.json shows projects["C:/Users/OWNER"].hasTrustDialogAccepted=false and no bypassPermissionsModeAccepted key, while the claude.exe binary (2.1.263) contains both key names. Find, from primary sources (code.claude.com/docs, the Claude Code changelog and GitHub issues in anthropics/claude-code, the CLI's own strings), every prompt or dialog Claude Code can show at startup or on --resume that would stall an unattended launch - folder trust, bypass-permissions acceptance, first-run onboarding and theme, login expiry and OAuth refresh, the resume picker when the id is not found, MCP server approval prompts, plugin or marketplace update prompts, Windows console prompts. For each give the exact ~/.claude.json or settings.json key, flag or environment variable that pre-answers it, how the projects key in ~/.claude.json is spelled on Windows and which spelling the trust check reads, whether a Task Scheduler task can show an interactive TUI at all, how other people run Claude Code unattended on Windows, and how to wake two or more sessions at once from one scheduler. Deliver a ranked list of blockers with the exact fix for each.
date: 2026-09-20
mode: mixed
sources_count: 53
---

# Unattended `claude --resume` from a Windows scheduled task: ranked blockers and fixes

Research run 1789957731, tier thorough (verify stage trimmed to 8 claims x 1 voter for the 75 percent usage cap; all 8 confirmed, high). Primary sources: code.claude.com/docs, the anthropics/claude-code changelog and issues, learn.microsoft.com, and the strings of the two claude.exe binaries on this machine (2.1.263 npm, the one the relay runs; 2.1.278 VS Code). Community sources are labelled. Anything not from a primary source is marked UNVERIFIED.

## The three plain answers

1. **Can a resume launched in `C:\Users\OWNER` ever skip the trust question?** Not as an interactive session. Trust for the home directory is held for the current session only, never written to disk, and there is no setting to persist it; writing `hasTrustDialogAccepted: true` for `$HOME` "will not stick" [^1][^2]. Verified against the live security page (confirmed, high). The local file agrees: the session ran for hours in `C:\Users\OWNER` under 2.1.278 and `projects["C:/Users/OWNER"].hasTrustDialogAccepted` is still `false` [^38][^39]. The relay's `preflightPrompts()` writing `true` for every spelling of the home key therefore cannot work for this one folder [^40].
2. **Does `-p` (headless) avoid it?** Yes. "A `-p` session shows no workspace trust dialog and no per-server approval prompt" [^3] (confirmed, high). But `-p` is not a window: the 2026-09-14 wake proved a headless run shows nothing on screen and registers nothing with Remote Control [^40], and a `setup-token` credential "can't establish Remote Control sessions" [^7]. So `-p` is the fallback, not the visible path.
3. **Does a cross-directory `--resume` avoid it?** Yes, and it is the fix. Since v2.1.223 `claude --resume <id>` works from any directory: it searches the current project and its worktrees, then every other project on the machine, and resolves when exactly one other project holds a transcript with messages for that id [^4] (confirmed, high). The relay runs 2.1.263, so launching from a trusted project subfolder and resuming the home-directory session by id skips the dialog because the folder being trusted is the cwd, not the folder the session started in [^4][^2].

## Ranked blockers, each with its exact fix

### 1. cwd is the home directory, so the trust dialog is unavoidable  ·  Confidence: high
What happens: the launcher does `cd /d "C:\Users\OWNER"` [^40], Claude Code asks whether to trust the folder, nobody answers, the window sits there. Trust for `$HOME` is by design never persisted [^1][^2]; there is no flag to skip the dialog without going headless [^5][^50]; the 2.1.263 binary short-circuits trust only for `CLAUDE_CODE_SANDBOXED`, an in-session "trust accepted" flag, or `--bg` mode [^37].
Fix (exact):
- In `relay.js` `arm()`, when `process.cwd()` is the user's home directory (`os.homedir()` compared after `h$`-style normalisation), record `cwd` as the project folder instead (the `record.project` folder, e.g. `C:\Users\OWNER\Downloads\claude-code-usage-limits`), or refuse to arm with the message "cannot relay from the home folder: trust is never saved for it" [^1][^40].
- In `wake.js` `launcherScript()`, `cd /d` into that project folder; keep `--resume <id>` as is. The transcript stays where it is (`~/.claude/projects/C--Users-OWNER/<id>.jsonl`) and the cross-project search finds it [^4][^39].
- Pre-trust the target folder in `~/.claude.json` under the spelling 2.1.263 reads: forward slashes, drive letter case preserved, no trailing slash, e.g. `projects["C:/Users/OWNER/Downloads/claude-code-usage-limits"].hasTrustDialogAccepted = true` [^37][^2]. Both spellings already exist and are `true` for that folder [^38].
- Do not rely on `CLAUDE_CODE_SANDBOXED=1`: it is present in the binary and short-circuits the trust check [^37], but it is undocumented and its other effects are unknown (UNVERIFIED as a supported workaround).

### 2. Which spelling the trust check reads on Windows  ·  Confidence: high
The 2.1.263 lookup is `projects?.[j1e(cwd)]` where `j1e` ends in `h$`, and on Windows `h$` is `t.replaceAll("\\","/")` and nothing else: no lowercasing, no realpath; `lt()` strips a trailing separator [^37]. So the key is `C:/Users/OWNER/...` with the drive letter as the process reports it. The backslash entries in the file were written by an older build [^38]; issues #72640 and #77837 document the same folder accumulating five keys (backslash, forward slash, segment case, drive-letter case) because matching is literal [^19][^20], and #3366 is the native-Windows "asks to trust every time" report [^21]. The transcript folder uses a different encoding again (`C--Users-OWNER`, every non-alphanumeric character replaced by `-`) [^4][^38].
Fix: keep `preflightPrompts()` writing both spellings (it costs nothing and covers older builds) [^40], but the one that matters for 2.1.263 and 2.1.278 is the forward-slash spelling with the drive letter uppercased exactly as `cd /d "C:\..."` reports it. The ancestor walk in `JF()` also trusts a subfolder when a parent inside the same repo root is trusted [^37].

### 3. Bypass-permissions acceptance dialog  ·  Confidence: high
The "WARNING: Claude Code running in Bypass Permissions mode / Yes, I accept" dialog [^17] is shown only when neither `skipDangerousModePermissionPrompt` (user, local, flag or policy settings) nor the legacy `.claude.json` field `bypassPermissionsModeAccepted` is true; accepting writes `skipDangerousModePermissionPrompt: true` to user settings, and a migration moves the legacy field into that setting [^37][^6][^18] (confirmed, high). Gev's `~/.claude/settings.json` already has `"skipDangerousModePermissionPrompt": true`, so this dialog is pre-answered on 2.1.263; the absence of `bypassPermissionsModeAccepted` in `.claude.json` is irrelevant [^38][^37]. `--bg` enforces the same check and refuses with "Run `claude --dangerously-skip-permissions` once interactively" [^37]. The #52501 report that `--permission-mode bypassPermissions` still prompts was filed at v2.1.117 [^17]; the 2.1.263 code reads the setting first [^37].
Fix: nothing tonight. Keep the key in `settings.json`; the relay's write of `bypassPermissionsModeAccepted` into `.claude.json` is harmless but redundant [^40]. `permissions.disableBypassPermissionsMode` (any file) would block the mode entirely; make sure no settings file sets it [^6].

### 4. claude.ai login expiry  ·  Confidence: high
Once the stored login expires and cannot be refreshed, every model request fails with `Login expired · Please run /login`; a Remote Control or background session that outlives the login "stops making progress ... and can't recover until you sign in again" [^7] (confirmed, high). A 3-day warning appears at startup (v2.1.203+) [^7]. `claude setup-token` gives a one-year `CLAUDE_CODE_OAUTH_TOKEN` but it "can only make model requests" and cannot open Remote Control sessions or fetch claude.ai connectors [^7][^47]. Headless runners hitting "OAuth session expired and could not be refreshed" with no recovery path are issues #79685, #38813, #42904 [^24][^25]. Credentials live at `%USERPROFILE%\.claude\.credentials.json`, not Credential Manager [^7].
Fix: at arm time read the expiry (the `/status` Login row, v2.1.210+, or the credential file's expiry field) and refuse to arm, with a toast, when the login expires before the wake fires [^7]. Nothing can answer this dialog unattended; renew `/login` before arming a relay that fires many hours later.

### 5. Two windows starting together can corrupt `~/.claude.json`  ·  Confidence: medium
`~/.claude.json` is written non-atomically; concurrent sessions on Windows have corrupted it to "JSON Parse error: Unexpected EOF", after which Claude Code "acts as if it's a first-time setup (re-auth, theme selection, etc)" [^22]. That is the one path by which the onboarding and theme screens (gated by `hasCompletedOnboarding`, default theme `"dark"`) can come back [^37]. There is no session lock file (#19364 is an open request) [^45]. Two `--resume` of the same id interleave into one transcript (community) [^42].
Fix: keep the two tasks staggered (9:02 and 9:05 is right); if one launcher must start several sessions, put `timeout /t 60 /nobreak >nul` between the `start` lines. Back up `~/.claude.json` in `wake.js` before the launch so a corruption can be reverted. Never resume the same id twice at once; use `--fork-session` for a second worker on the same conversation [^5].

### 6. Task Scheduler and the console window  ·  Confidence: high for the logon rule, low for the locked screen
A task with logon type `TASK_LOGON_INTERACTIVE_TOKEN` ("Run only when user is logged on") "will be run only in an existing interactive session", and only the interactive logon types display UI [^31] (confirmed, high); System-account and "whether user is logged on or not" tasks cannot show anything [^33]. Both relay tasks are Interactive, Limited, not hidden, so the window can appear; `Hidden` only hides the task in the Task Scheduler UI [^32]. `WakeToRun` restores power, not the logon state [^32]. What happens when the task fires with the screen locked is not documented on learn.microsoft.com; community reports say interactive tasks misbehave while locked (UNVERIFIED) [^44][^53]. `cmd.exe /d /c start ...` returns as soon as the window is spawned, so `LastResult=0x0` says nothing about the session, and whether `ExecutionTimeLimit=PT4H` reaches the detached window is UNVERIFIED [^32]. Do not make `wt.exe` the task program: it fails silently on build 26100 (#17981); when Windows Terminal is the default terminal, `start` opens it by design (#15887) [^30][^29]. Under a scheduler with no TTY the Ink UI throws "Raw mode is not supported on the current process.stdin" (#404) [^41]; a `start`-spawned console has a TTY, which is why the visible path exists.
Fix: keep `LogonType=Interactive`, `cmd.exe /d /c start`, and the launcher `.cmd`; require the machine to be logged on and unlocked at wake time (the plugin can check for a lock screen and defer, as it already checks presence) [^40]. Add `DISABLE_AUTOUPDATER=1` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` in the launcher to avoid an update running at launch [^10][^14].

### 7. Session id not found  ·  Confidence: high
With an id that matches nothing, Claude Code prints `No conversation found with session ID: <id>` and exits with code 1; the picker only opens for `--resume` with no argument [^4][^37] (confirmed, high). The cross-project search requires exactly one other project to hold a transcript "with messages" for the id [^4]. `--continue` is cwd-scoped and skips `-p` sessions and still-running background sessions [^5][^4].
Fix: the relay's `transcriptExists()` check plus the launcher's `pause >nul` on a non-zero exit already handle this [^40]. Keep the id form, never `--continue`, for a cross-directory wake.

### 8. MCP approval, plugin and marketplace prompts  ·  Confidence: high
Interactive sessions prompt before connecting `.mcp.json` servers; `-p`, SDK and `skipDangerousModePermissionPrompt` sessions do not [^8]. Pre-answer with `enableAllProjectMcpServers: true` or an `enabledMcpjsonServers` list; `disabledMcpjsonServers` always wins [^8]. claude.ai connectors that need OAuth show a startup notice (v2.1.193+) and do not block; `claude mcp login <name>` caches the token beforehand [^8]. `extraKnownMarketplaces` registers without a prompt once the folder is trusted and `enabledPlugins` needs no install confirmation [^9]; marketplace `autoUpdate: true` (two of Gev's) updates at startup without a documented prompt [^9]. `DISABLE_AUTOUPDATER=1` stops the background update check; `DISABLE_UPDATES` blocks all update paths [^10].
Fix: add `"enableAllProjectMcpServers": true` to `settings.json` if any project `.mcp.json` exists in the resume folder; otherwise nothing.

### 9. Onboarding, theme and release notes  ·  Confidence: medium
Onboarding runs only when `hasCompletedOnboarding` is false in `~/.claude.json` (it is true here); `theme` also lives in `~/.claude.json` with default `"dark"` [^37][^38][^15]. v2.1.277 fixed "a crash at launch when `~/.claude.json` holds a malformed `theme` value" [^15]; the relay's 2.1.263 predates that fix, so a bad `theme` value would crash it (none is present now). Logging in via the VS Code extension does not set `hasCompletedOnboarding` in a fresh `CLAUDE_CONFIG_DIR` (#67149) [^48]. No primary source documents a blocking release-notes screen; `/release-notes` is on demand [^15].
Fix: none needed; keep `.claude.json` uncorrupted (blocker 5).

### 10. Version split between the two binaries  ·  Confidence: medium
The session was written by 2.1.278 (VS Code) and is resumed by 2.1.263 (npm) [^39][^38]. `--permission-prompts none`, used by the headless fallback, requires v2.1.259+ [^3] (confirmed, high), so 2.1.263 accepts it. Whether a 2.1.278 transcript resumes cleanly under 2.1.263 is UNVERIFIED.
Fix: `npm install -g @anthropic-ai/claude-code@latest` before relying on the relay, or point the launcher at the VS Code binary path in `CLAUDE_CODE_EXECPATH`.

## Every prompt that can stall a launch, and its pre-answer

| Prompt | Shown when | Pre-answer | Source |
|---|---|---|---|
| Folder trust | interactive session in an untrusted cwd; always in `$HOME` | `projects["C:/path"].hasTrustDialogAccepted: true` (forward slashes); never possible for `$HOME`; `-p` skips it | [^1][^2][^3][^37] |
| Bypass Permissions acceptance | first interactive entry into `bypassPermissions` | `settings.json` `skipDangerousModePermissionPrompt: true` (already set); legacy `.claude.json` `bypassPermissionsModeAccepted` migrated | [^6][^37][^18] |
| Onboarding / theme / login method | `hasCompletedOnboarding` false or `.claude.json` corrupted | keep `hasCompletedOnboarding: true`; back up the file | [^37][^22] |
| Login expired | OAuth cannot refresh | none unattended; `/login` before arming; `CLAUDE_CODE_OAUTH_TOKEN` works for model calls only, not Remote Control | [^7] |
| Session picker | `--resume` with no argument | always pass the id; unknown id exits 1 | [^4][^37] |
| MCP server approval | project `.mcp.json` in interactive mode | `enableAllProjectMcpServers: true` / `enabledMcpjsonServers` | [^8] |
| MCP needs authentication | connector token missing | notice only, non-blocking; `claude mcp login <name>` | [^8] |
| Plugin install / marketplace | manual install only | `enabledPlugins`, `extraKnownMarketplaces` need no prompt | [^9] |
| Auto-update | background check | `DISABLE_AUTOUPDATER=1`; `DISABLE_UPDATES` | [^10] |
| Permission prompts during the run | tool needs approval | `--permission-mode bypassPermissions`; in `-p`, `--permission-prompts none` (v2.1.259+) | [^3][^5] |
| Git Bash missing (Windows) | bash.exe not found | `CLAUDE_CODE_GIT_BASH_PATH` in `env` | [^10][^37] |
| Raw mode not supported | no TTY (direct scheduler launch) | launch through `cmd /c start` so a console exists, or use `-p` | [^41] |

## How others run Claude Code unattended on Windows
Anthropic's own recommendation for unattended work is cloud Routines (`/schedule`, claude.ai/code/routines): they run on Anthropic infrastructure, clone the repo fresh, cannot touch local files or resume a local session, minimum interval one hour [^12][^13]. Desktop scheduled tasks and `/loop` run locally and need the machine on; `/loop` needs an open session and stops when the terminal closes [^13]. `-p` with `--permission-prompts none` is the documented shape for "a scheduled job" [^3]. Remote Control keeps the local process running and connects claude.ai/code and the phone; `--remote-control [name]`, `--rc`, `--remote-control-session-name-prefix` and `remoteControlAtStartup` (user or managed settings only) exist in 2.1.263 [^37][^11][^46]; reported limits are idle disconnects (#32982) and Windows auto-update restarts losing the bridge (#95296) [^51]. Community recipes on Windows: `smoo7h/spawn-session-skill` opens `wt.exe` tabs with `--dangerously-skip-permissions` and Remote Control from WSL, `Cepstral/claude-codex-resume` reopens sessions as Windows Terminal tabs with the right resume command (both community) [^42]. Windows scheduled-task reports in the tracker: bypass mode still prompting on a UNC share (#46224), prompts despite `defaultMode: bypassPermissions` fixed by one interactive "always allow" (#40470), and leaked headless `claude.exe --resume` workers blocking on stdin until OOM (#68626) [^26][^27][^23]. No NSSM or pm2 recipe for Claude Code was found (UNVERIFIED that any exists) [^43].

## Waking two or more sessions from one scheduler
Actions inside one task "are executed sequentially" [^34], but each `cmd.exe /d /c start "title" /D "dir" "launcher.cmd"` returns as soon as its window exists, so one task with several actions, or one `.cmd` with several `start` lines, launches every window within seconds [^36]. `wt.exe -w new-tab ... ; new-tab ...` can open several tabs in one call (semicolons must be escaped from PowerShell) but `wt.exe` must not be the task program itself [^35][^30]. Because simultaneous starts are the `.claude.json` corruption case [^22], stagger the starts by at least a minute; each window gets its own `/D` project folder (trusted, not `$HOME`), its own `--resume <id>`, and its own `--remote-control <name>` [^37][^11].

## Contradictions and open questions
- The exact code that refuses to persist `$HOME` trust was not located in the 2.1.263 strings: `qMn` turned out to be a restricted-workspace gate, not a home check [^37]. The behaviour is documented [^1][^2] and matches the local file [^38]; whether a hand-written `true` is ignored at read time or reset at write time is UNVERIFIED.
- `permissions` docs say trusting `/src/demo` does not trust `/src/demo/packages/api` "for settings purposes" [^2], while the binary's `JF()` walk trusts a subfolder when an ancestor up to the repo root is trusted [^37]. Both can be true (dialog vs settings scope); treat subfolder trust as unreliable and trust the exact launch folder.
- Locked-screen behaviour of an Interactive task and whether `ExecutionTimeLimit` reaches a `start`-detached window: no primary source found (UNVERIFIED) [^32][^44].
- Whether `-p` can carry `--remote-control` is not documented; the relay's own 2026-09-14 log says a headless run did not register [^40][^11].
- #90220 reports that in 2.1.241 `hasTrustDialogAccepted` can be `false` while hooks run, so the key no longer reliably reflects effective trust [^28]; for the relay this only matters as a diagnostic.
- `CLAUDE_CODE_SESSION_ID` appears in the binary [^37] but is not on the documented env-var page; feature requests to expose a session id to hooks are still open [^14].

## Verification
- Contradicted: none.
- Uncertain: none.
- Not verified (usage-cap trim from 36 voters to 8): blocker 5 (`.claude.json` corruption), blocker 6 locked-screen and time-limit details, the `h$` normalisation (code, not web-verifiable), `CLAUDE_CODE_SANDBOXED` as a workaround, community recipes.

## Sources
[^1]: [doc] Security - Trust verification and home directory - https://code.claude.com/docs/en/security
[^2]: [doc] Permissions - trusting a folder by hand, $HOME never persisted - https://code.claude.com/docs/en/permissions
[^3]: [doc] Run Claude Code programmatically (-p, --bare, --permission-prompts) - https://code.claude.com/docs/en/headless
[^4]: [doc] Manage sessions (--resume lookup, transcripts, not-found text) - https://code.claude.com/docs/en/sessions
[^5]: [doc] CLI reference - https://code.claude.com/docs/en/cli-reference
[^6]: [doc] Settings reference (skipDangerousModePermissionPrompt, disableBypassPermissionsMode) - https://code.claude.com/docs/en/settings-reference
[^7]: [doc] Authentication (login expiry, setup-token, credential file) - https://code.claude.com/docs/en/authentication
[^8]: [doc] MCP (approval prompts, enableAllProjectMcpServers, needs authentication) - https://code.claude.com/docs/en/mcp
[^9]: [doc] Plugin marketplaces (extraKnownMarketplaces, enabledPlugins, autoUpdate) - https://code.claude.com/docs/en/plugin-marketplaces
[^10]: [doc] Setup (DISABLE_AUTOUPDATER, DISABLE_UPDATES, CLAUDE_CODE_GIT_BASH_PATH) - https://code.claude.com/docs/en/setup
[^11]: [doc] Remote Control - https://code.claude.com/docs/en/remote-control
[^12]: [doc] Routines - https://code.claude.com/docs/en/routines
[^13]: [doc] Scheduled tasks and /loop - https://code.claude.com/docs/en/scheduled-tasks
[^14]: [doc] Environment variables - https://code.claude.com/docs/en/env-vars
[^15]: [github] CHANGELOG.md (v2.1.277 theme crash fix, v2.1.273 login errors) - https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md
[^16]: [github] #36403 Trust dialog acceptance not persisted - https://github.com/anthropics/claude-code/issues/36403
[^17]: [github] #52501 bypassPermissions confirmation dialog has no pre-accept flag - https://github.com/anthropics/claude-code/issues/52501
[^18]: [github] #26233 skipDangerousModePermissionPrompt semantics - https://github.com/anthropics/claude-code/issues/26233
[^19]: [github] #72640 Trust store literal path matching - https://github.com/anthropics/claude-code/issues/72640
[^20]: [github] #77837 CLI vs VS Code trust keys differ - https://github.com/anthropics/claude-code/issues/77837
[^21]: [github] #3366 native Windows repeatedly asks to trust folder - https://github.com/anthropics/claude-code/issues/3366
[^22]: [github] #28813, #28824, #29198, #29217, #29348 .claude.json corrupted by concurrent sessions on Windows - https://github.com/anthropics/claude-code/issues/28813
[^23]: [github] #68626 scheduled tasks leak headless claude.exe --resume processes - https://github.com/anthropics/claude-code/issues/68626
[^24]: [github] #79685 headless -p fails on expired OAuth - https://github.com/anthropics/claude-code/issues/79685
[^25]: [github] #38813 / #42904 OAuth tokens expire, breaking automation - https://github.com/anthropics/claude-code/issues/38813
[^26]: [github] #46224 scheduled task hangs on Write prompt (UNC share) - https://github.com/anthropics/claude-code/issues/46224
[^27]: [github] #40470 scheduled tasks prompt despite defaultMode bypassPermissions - https://github.com/anthropics/claude-code/issues/40470
[^28]: [github] #90220 hasTrustDialogAccepted no longer encodes trust - https://github.com/anthropics/claude-code/issues/90220
[^29]: [github] microsoft/terminal #15887 Windows Terminal opens for schtasks - https://github.com/microsoft/terminal/issues/15887
[^30]: [github] microsoft/terminal #17981 wt.exe cannot be launched as a scheduled task - https://github.com/microsoft/terminal/issues/17981
[^31]: [doc] Principal.LogonType (TASK_LOGON_INTERACTIVE_TOKEN) - https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype
[^32]: [doc] TaskSettings (Hidden, ExecutionTimeLimit, WakeToRun) - https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings
[^33]: [doc] schtasks create (/it, System account has no interactive rights) - https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create
[^34]: [doc] Task actions execute sequentially - https://learn.microsoft.com/en-us/windows/win32/taskschd/task-actions
[^35]: [doc] Windows Terminal command-line arguments - https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments
[^36]: [doc] start command - https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/start
[^37]: [code] claude.exe 2.1.263 strings (trust lookup j1e/h$/vde/JF at 365385-365405 and 364481; bypass gate KM at 364729, 378913, 392485; --permission-prompts 321603; not-found exit 378803) - C:\Users\OWNER\AppData\Local\Temp\claude\C--Users-OWNER\75e00934-2a8f-4f30-9bdd-1bba9858bb4e\scratchpad\research\claude-2.1.263-strings.txt
[^38]: [code] ~/.claude.json projects keys (lines 1135-1393) - C:\Users\OWNER\.claude.json
[^39]: [code] session transcript cwd "C:\\Users\\OWNER", version 2.1.278 - C:\Users\OWNER\.claude\projects\C--Users-OWNER\75e00934-2a8f-4f30-9bdd-1bba9858bb4e.jsonl
[^40]: [code] wake.js (launcherScript, visibleArgs, claudeArgs, openWindow), relay.js (arm, preflightPrompts, scheduleWindows), relay-wake .cmd - C:\Users\OWNER\Downloads\claude-code-usage-limits\skills\usage-limits\scripts\wake.js
[^41]: [github] #404 Raw mode is not supported on the current process.stdin - https://github.com/anthropics/claude-code/issues/404
[^42]: [github, community] smoo7h/spawn-session-skill; Cepstral/claude-codex-resume; codeongrass zombie-sessions note - https://github.com/smoo7h/spawn-session-skill
[^43]: [blog, community] Running Claude Code autonomously overnight - https://medium.com/@evekhm/running-claude-code-autonomously-overnight-what-breaks-and-how-to-fix-it-3bee3bd958b5
[^44]: [forum, community] Scheduled task does not work when Windows locked - https://www.tenforums.com/general-support/176556-scheduled-task-doesnt-work-when-windows-locked.html
[^45]: [github] #19364 feature: session lock file - https://github.com/anthropics/claude-code/issues/19364
[^46]: [github] #54527 remoteControlAtStartup scope - https://github.com/anthropics/claude-code/issues/54527
[^47]: [github] #33105 remote-control does not work with setup-token - https://github.com/anthropics/claude-code/issues/33105
[^48]: [github] #46259, #67149, #95217 onboarding state blocks CLI - https://github.com/anthropics/claude-code/issues/67149
[^49]: [community] gist: trust a workspace non-interactively - https://gist.github.com/YoraiLevi/40dc9ae6bfdeda3d9f4f83a99e0eaae0
[^50]: [github] #45298 feature request: flag to skip workspace trust dialog - https://github.com/anthropics/claude-code/issues/45298
[^51]: [github] #32982 Remote Control idle TTL; #95296 Windows auto-update loses Remote Control - https://github.com/anthropics/claude-code/issues/32982
[^52]: [github] #58150 root/sudo check is non-Windows only - https://github.com/anthropics/claude-code/issues/58150
[^53]: [forum, community] Microsoft Q&A on Run whether user is logged on or not - https://learn.microsoft.com/en-us/answers/questions/2188387/task-scheduler-does-not-work-with-the-option-run-w
