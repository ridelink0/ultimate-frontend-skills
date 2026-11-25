# Terminal reference catalog

Primary sources checked 2026-11-01. Read source before adopting an API; a link
is not a claim that its framework was installed or its full suite passed here.

| Source | What to study |
|---|---|
| [CLI guidelines](https://clig.dev/) | help, stdout/stderr, pipes, errors, signals |
| [Bubble Tea](https://github.com/charmbracelet/bubbletea) | Go model/update/view, commands, resize |
| [Bubbles](https://github.com/charmbracelet/bubbles) | list, table, viewport, text input |
| [Lip Gloss](https://github.com/charmbracelet/lipgloss) | terminal cell composition |
| [Ink](https://github.com/vadimdemedes/ink) | React terminal layout and input |
| [Textual](https://github.com/Textualize/textual) | Python widgets, reactive state and test pilot |
| [Rich](https://github.com/Textualize/rich) | tables, tracebacks and noninteractive output |
| [Ratatui](https://github.com/ratatui/ratatui) | Rust buffers, layout and rendering |
| [Crossterm](https://github.com/crossterm-rs/crossterm) | raw mode, events and terminal restoration |
| [fzf](https://github.com/junegunn/fzf) | incremental search and keyboard discoverability |
| [lazygit](https://github.com/jesseduffield/lazygit) | pane focus and command preview |
| [btop](https://github.com/aristocratos/btop) | dense metrics and refresh controls |
| [Yazi](https://github.com/sxyazi/yazi) | file navigation and asynchronous previews |
| [Zellij](https://github.com/zellij-org/zellij) | pane context and keyboard modes |
| [xterm.js](https://github.com/xtermjs/xterm.js) | embedding a terminal; not a command sandbox |

## Build and verify

1. Specify command inputs, output schema and exit codes before the layout.
2. Pick append-only CLI, prompt, or full-screen TUI to match the task. Do not
   enter raw/alternate-screen mode for a simple report.
3. Use a single state owner for active pane, selection, loading and errors.
   Cancel old requests; late results must not replace the current selection.
4. Let the chosen framework handle Unicode display widths and input sequences.
   Escape untrusted OSC/CSI and hyperlink sequences before rendering.
5. Restore cursor/raw mode on normal exit, exceptions and signals. Avoid
   overwriting meaningful output when stdout is redirected.
6. Test paste, repeated keys, no results, 10,000 rows, resize during loading,
   EOF/non-TTY stdin, interrupted work, screen reader output and no color.

Use bounded refresh and diff rendering. Do not draw one spinner per concurrent
task or repaint the whole screen for every token. A browser terminal does not
authorize server-side shell access: keep authentication, authorization and
approval checks outside the rendering widget.
