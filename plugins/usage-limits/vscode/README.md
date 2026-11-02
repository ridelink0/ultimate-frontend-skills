# Claude Usage Limits for VS Code

The Claude Code extension only shows your usage limits when you ask with
`/usage`. This puts them where you can see them: a view that sits directly
under the Claude Code chat in the secondary side bar, and a status bar item.

Current session (the 5-hour window), current week, and the week for the model
in use when your plan caps that model on its own. Bars turn yellow at 80
percent and red at 90. While Claude is working the title shimmers; under
ultracode it goes rainbow. A Sessions list shows every Claude on the machine
and which of them are working.

The numbers are the ones Claude Code uses: the same call `/usage` makes, with
the login Claude Code already holds, plus the rate-limit headers on Claude's
own responses when the plugin's status line is installed. The token is read for
that one request and sent nowhere else; turn `claudeUsageLimits.fetch` off to
stay on the reading already on disk.

Part of [claude-usage-limits](https://github.com/ridelink0/claude-code-usage-limits),
the Claude Code plugin that puts the same numbers in front of Claude before
every prompt so it plans the work to fit.

## Install

Needs VS Code 1.106 (October 2025) or newer, the first release that lets an
extension put a view container in the right sidebar.

From the `.vsix` attached to each
[release](https://github.com/ridelink0/claude-code-usage-limits/releases)
(Marketplace publishing is pending; see the end of this page):

```
code --install-extension claude-usage-limits-<version>.vsix
```

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| `claudeUsageLimits.fetch` | true | Take live readings from Anthropic's usage endpoint. |
| `claudeUsageLimits.pollSeconds` | 60 | Seconds between readings. Never under 15. |
| `claudeUsageLimits.statusBar` | true | Show the percentages in the status bar. |

Respects `CLAUDE_CONFIG_DIR`, Claude Code's `timeFormat`, and reduced-motion.

## Building and publishing

```
cd vscode
npm run package          # builds lib/ from the plugin's scripts and makes the .vsix
```

To publish to the Visual Studio Marketplace: create a publisher named
`ridelink` at https://marketplace.visualstudio.com/manage, make an Azure DevOps
personal access token with the Marketplace (Manage) scope, then

```
npx @vscode/vsce login ridelink
npx @vscode/vsce publish --no-dependencies
```

For Open VSX (the registry VSCodium and Cursor read), make a token at
https://open-vsx.org/user-settings/tokens and run
`npx ovsx publish claude-usage-limits-<version>.vsix -p <token>`.

