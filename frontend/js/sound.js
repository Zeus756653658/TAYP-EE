// Web Audio Synthesizer for instant physical POS sound effects
const SoundEngine = {
  ctx: null,

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  },

  playTone(freq, type = 'sine', duration = 0.08, gainVal = 0.1) {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.warn("Audio play prevented:", e);
    }
  },

  // Barcode / Item Add Beep
  beep() {
    this.playTone(1760, 'sine', 0.06, 0.15); // High clean beep
  },

  // Payment Success Chime
  success() {
    this.init();
    setTimeout(() => this.playTone(523.25, 'triangle', 0.15, 0.15), 0);
    setTimeout(() => this.playTone(659.25, 'triangle', 0.15, 0.15), 100);
    setTimeout(() => this.playTone(783.99, 'triangle', 0.25, 0.15), 200);
    setTimeout(() => this.playTone(1046.50, 'sine', 0.4, 0.2), 320);
  },

  // Warning / Maintenance Alert
  alert() {
    this.init();
    this.playTone(440, 'sawtooth', 0.12, 0.2);
    setTimeout(() => this.playTone(440, 'sawtooth', 0.12, 0.2), 150);
  }
};
