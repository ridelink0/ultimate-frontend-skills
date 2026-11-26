# Usage Limits, directory edition

Plan work in Claude Code to fit inside the 5-hour and weekly usage limits:
size a job in turns, say plainly whether it fits before starting, order the
work so a cutoff costs little, and work cheaply when the budget is tight.

This edition is Markdown only: one skill and two commands, no hooks, no
scripts. It reads nothing outside your project and no credentials. Claude asks
you for the numbers that `/usage` shows instead of reading them itself, and it
prints no automatic cost line after each reply.

The full edition (https://github.com/ridelink0/claude-code-usage-limits) adds
the live reading, the measured pace and turns left, the cost of each reply and
session, low power, the status line and the relay that resumes work after a
reset. It works in Claude Code and Codex.

## Use

- `/usage-limits:check`: whether the work in hand fits.
- `/usage-limits:cheap`: work cheaply for the rest of the session.
- Or ask "do I have enough usage left for this?"

This folder is generated from the sources in the Ultimate
Frontend Skills repository; edit the sources, not these files.

## Licence

MIT. See LICENSE. Privacy: PRIVACY.md.

## Install

In Claude Code:

    /plugin install usage-limits --marketplace ridelink0/ultimate-frontend-skills
