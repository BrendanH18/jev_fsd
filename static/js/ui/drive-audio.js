// Small procedural soundscape: no audio downloads and no sound until the user enables it.
export class DriveAudio {
  constructor(button) {
    this.button = button; this.enabled = false; this.context = null;
    button.addEventListener("click", () => this.toggle());
  }

  create() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error("Audio is unavailable in this browser");
    const c = this.context = new Context(), master = this.master = c.createGain();
    master.gain.value = 0; master.connect(c.destination);
    const makeTone = (type, frequency, gain) => {
      const oscillator = c.createOscillator(), level = c.createGain();
      oscillator.type = type; oscillator.frequency.value = frequency; level.gain.value = gain;
      oscillator.connect(level); level.connect(master); oscillator.start(); return { oscillator, level };
    };
    this.motor = makeTone("sine", 65, 0.12); this.harmonic = makeTone("triangle", 130, 0.035);
    const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource(); noise.buffer = buffer; noise.loop = true;
    const filtered = (type, frequency) => {
      const filter = c.createBiquadFilter(), level = c.createGain(); filter.type = type; filter.frequency.value = frequency;
      level.gain.value = 0; noise.connect(filter); filter.connect(level); level.connect(master); return { filter, level };
    };
    this.road = filtered("lowpass", 700); this.rain = filtered("highpass", 1800); this.tires = filtered("bandpass", 1600);
    noise.start();
  }

  async toggle() {
    this.button.disabled = true;
    try {
      if (!this.context) this.create();
      if (this.context.state !== "running") await this.context.resume();
      this.enabled = !this.enabled;
      this.button.textContent = this.enabled ? "Sound on" : "Sound off";
      this.button.setAttribute("aria-pressed", String(this.enabled));
      this.master.gain.setTargetAtTime(this.enabled ? 0.4 : 0, this.context.currentTime, 0.15);
    } catch (err) { this.button.textContent = "Sound unavailable"; this.button.title = err.message; }
    finally { this.button.disabled = false; }
  }

  update(ego, weather, paused, hood) {
    if (!this.context || !this.enabled) return;
    const t = this.context.currentTime, speed = Math.abs(ego.v), wet = weather === "rain" ? 1 : weather === "fog" ? 0.3 : 0;
    const set = (param, value) => param.setTargetAtTime(value, t, 0.08);
    set(this.master.gain, paused ? 0 : 0.4);
    set(this.motor.oscillator.frequency, 55 + speed * 6 + Math.max(0, ego.ax || 0) * 8);
    set(this.harmonic.oscillator.frequency, 110 + speed * 12);
    set(this.motor.level.gain, 0.08 + Math.min(speed / 100, 0.15));
    set(this.road.level.gain, Math.min(0.3, speed * 0.008) * (1 + wet * 0.5));
    set(this.road.filter.frequency, 350 + speed * 35);
    set(this.rain.level.gain, wet * (hood ? 0.11 : 0.07));
    set(this.tires.level.gain, Math.min(0.16, Math.max(0, Math.abs(ego.latAccel || 0) - 4) * 0.02));
  }

  tick() { this.beep([850], 0.045, 0.025); }
  horn() { this.beep([350, 440], 0.32, 0.14); }
  beep(frequencies, duration, volume) {
    if (!this.enabled || this.context?.state !== "running") return;
    const c = this.context, t = c.currentTime;
    for (const frequency of frequencies) {
      const oscillator = c.createOscillator(), level = c.createGain(); oscillator.frequency.value = frequency;
      level.gain.setValueAtTime(0, t); level.gain.linearRampToValueAtTime(volume, t + 0.01); level.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      oscillator.connect(level); level.connect(this.master); oscillator.start(t); oscillator.stop(t + duration);
      oscillator.onended = () => { oscillator.disconnect(); level.disconnect(); };
    }
  }
}
