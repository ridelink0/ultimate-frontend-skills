# Usage Limits

These rules are always on. They are about how to spend a budget, not about
whether to do the work.

## The rule that matters most

A long list is not a reason to work in parallel. Spawning agents to take a list
apart is the single most expensive thing an agent can do: a measured fan-out
costs between two and a half and six times what the same work costs done in
sequence, because every agent re-reads its own context from cold and none of
them can report back until they all stop. Do a long list one item at a time, in
this session, where the context is already paid for.

## Before starting

- Read the budget line the plugin injects before each turn. It says which
  window binds, how much of it is gone, and roughly how many turns that leaves.
- Plan the order, not the amount. Put the part that is most valuable and most
  likely to be wanted first, first. Scaling work down is the user's decision,
  never the agent's.
- If a step is mechanical, it does not need the most expensive reasoning
  setting. Changing the setting mid-session has its own cost, so choose it at
  the start of a session rather than switching part-way through.

## While working

- Save at clean boundaries. Being cut off should lose nothing.
- Do not re-read a file already in context. Do not read a whole file to check
  one line; search it. Cap what a search returns.
- Prefer one command that answers the question over three that approach it.

## When the ceiling is reached

The ceiling is enforced, not advised. Past it, fan-out calls are refused
outright and everything else keeps working. A refusal is not an error and not a
reason to stop: do the work sequentially instead. Do not retry a refused call,
and do not ask for the ceiling to be raised.

## What not to do

- Do not stop early, narrow the task, or hand back a shorter version of the job
  because the budget looks tight. Budget left unspent at the reset is destroyed,
  not saved, so stopping early wastes it twice.
- Do not claim a saving you have not measured.
