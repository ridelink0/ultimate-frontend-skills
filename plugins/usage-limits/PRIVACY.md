# Usage Limits privacy

Usage Limits runs locally. It has no author-operated account service, analytics
endpoint or telemetry collector. It reads local host configuration, account
identity and usage snapshots, and token/turn metadata from local session logs
to estimate remaining allowance. Local logs can contain sensitive information;
the plugin is not a sandbox around those files.

When live readings are enabled, the plugin uses the signed-in host credentials
to request usage information from that host's provider. Credentials are not
included in the report or sent to the plugin author. A hook places the usage
report in the current model session, where the selected provider's terms and
privacy practices apply. Optional relay commands use the selected host's own
continuation mechanisms and keep its native permission boundary.

Learned estimates, account boundaries, cached readings and relay state remain
in the configured local host directories. There is no author-controlled
retention service. Remove local plugin state explicitly when it is no longer
needed; uninstalling a plugin need not erase the host's own transcripts.

The plugin does not grant project trust, accept bypass prompts, select bypass
permission modes or disable another plugin. Existing user-granted settings are
not silently revoked or changed. Optional adapters must defer ordinary tool
permission decisions to their host.

Questions: [Gev's issue tracker](https://github.com/ridelink0/ultimate-frontend-skills/issues).
