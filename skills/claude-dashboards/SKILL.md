---
name: claude-dashboards
description: Build and verify Claude Dashboards with source queries, metric definitions, freshness, filters, partial failures and safe sharing. Distinguishes Anthropic's dashboard artifacts from custom dashboard libraries.
---

# Claude Dashboards

Claude Dashboards is Anthropic's artifact product, not a chart package. As
checked 2026-11-01 it is in beta on paid plans; organizational controls can
restrict access. Use the existing authenticated artifact/connector capabilities
when present. Do not enroll, grant data access, change admin settings or invent
a tool. If unavailable, say so and build a custom dashboard only when requested.

1. Define the decision, audience, source, metric, time zone, interval,
   denominator, null handling and permission boundary. Ask only missing details
   that materially change the query.
2. Inspect source schema and permission scope. Run bounded read-only queries.
   Keep secrets, raw personal data and tenant identifiers out of client code.
3. Show the query behind each metric, unit and last successful refresh time.
   Distinguish zero, unknown, loading, stale and failed. Keep a failed panel's
   old data labeled stale; one failed source must not pretend the whole refresh
   succeeded.
4. Validate filters against the same metric definitions, compare totals to the
   source and provide a readable data table. Never invent growth or trends.
5. Verify empty/partial/error states, keyboard controls, narrow widths,
   unauthorized records, stale responses after filter changes and refresh races.
   Sharing is a separate explicit action; inspect recipients before publishing.

For custom UI, read the main UFS `references/workflows.md`. Functional check
first, adversarial check second. Document any live connector or sharing check
that could not run.

Sources: [Anthropic guide](https://support.claude.com/en/articles/17454700-get-started-with-claude-dashboards),
[release announcement](https://claude.com/resources/articles/dashboards-and-motion).
