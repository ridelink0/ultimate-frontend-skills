// Gev's original synthesized cues. No audio files, downloads or dependencies.
export function createSoundFeedback({ Context = globalThis.AudioContext, document = globalThis.document, volume = 0.08 } = {}) {
  let context = null, enabled = false, generation = 0, last = -Infinity;
  const nodes = new Set();
  const gain = Math.max(0, Math.min(0.2, Number.isFinite(volume) ? volume : 0.08));
  return {
    get enabled() { return enabled; },
    async enable() {
      const version = ++generation;
      if (!Context) return false;
      try {
        context ||= new Context();
        if (context.state === 'suspended') await context.resume();
        if (generation !== version) return false;
        enabled = context.state === 'running';
      } catch { if (generation === version) enabled = false; }
      return enabled;
    },
    mute() { generation++; enabled = false; for (const node of nodes) { try { node.stop(); } catch {} } },
    play(kind = 'complete') {
      if (!enabled || !context || context.state !== 'running' || document?.hidden || nodes.size >= 2) return false;
      const now = context.currentTime;
      if (now - last < 0.12) return false;
      last = now;
      const oscillator = context.createOscillator(), envelope = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(kind === 'error' ? 220 : 660, now);
      envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(gain, now + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      oscillator.connect(envelope); envelope.connect(context.destination); nodes.add(oscillator);
      oscillator.onended = () => { nodes.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
      oscillator.start(now); oscillator.stop(now + 0.1); return true;
    },
    async dispose() {
      this.mute(); const closing = context; context = null; last = -Infinity;
      if (closing && closing.state !== 'closed') await closing.close();
      nodes.clear();
    },
  };
}
