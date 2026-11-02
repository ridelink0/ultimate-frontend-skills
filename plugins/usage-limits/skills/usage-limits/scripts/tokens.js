'use strict';
// Provider fields are different: Anthropic cache counters are separate input;
// OpenAI cached input is a subset. Missing values remain unknown at the UI.
const count = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function fromUsage(raw, provider) {
  const u = raw && typeof raw === 'object' ? raw : {};
  const input = count(u.input_tokens ?? u.prompt_tokens);
  const output = count(u.output_tokens ?? u.completion_tokens);
  const cacheRead = count(provider === 'openai'
    ? (u.cached_input_tokens ?? u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens)
    : u.cache_read_input_tokens);
  const creation = u.cache_creation || {};
  const short = count(creation.ephemeral_5m_input_tokens);
  const long = count(creation.ephemeral_1h_input_tokens);
  const cacheWrite = count(provider === 'openai' ? u.cache_write_input_tokens : u.cache_creation_input_tokens)
    ?? (short !== null && long !== null ? short + long : null);
  const totalInput = provider === 'openai' ? input
    : input !== null && cacheRead !== null && cacheWrite !== null ? input + cacheRead + cacheWrite : null;
  return { input: totalInput, output, uncachedInput: provider === 'openai'
    ? input !== null && cacheRead !== null && cacheRead <= input ? input - cacheRead : null : input,
    cacheRead, cacheWrite, reasoning: count(u.reasoning_output_tokens ?? u.output_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.thinking_tokens ?? u.completion_tokens_details?.reasoning_tokens) };
}
function fromStatusLine(input) {
  const context = input && input.context_window;
  if (!context || !context.current_usage) return null;
  const parts = fromUsage(context.current_usage, 'anthropic');
  return { ...parts, input: count(context.total_input_tokens) ?? parts.input,
    output: count(context.total_output_tokens) ?? parts.output };
}
function text(value) {
  if (!Number.isFinite(value)) return '?';
  return value >= 1000000 ? (value / 1000000).toFixed(1) + 'M'
    : value >= 1000 ? (value / 1000).toFixed(1) + 'k' : String(value);
}
function lines(tokens) {
  if (!tokens) return [];
  return ['Latest response', 'Input ' + text(tokens.input) + '  Output ' + text(tokens.output),
    'Cache read ' + text(tokens.cacheRead), 'Cache write ' + text(tokens.cacheWrite)];
}
module.exports = { count, fromUsage, fromStatusLine, text, lines };
