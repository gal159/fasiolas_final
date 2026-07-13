// Web Audio SFX: trumpi sintezuoti garsai be audio failu.
// AudioContext kuriamas lazy po pirmo vartotojo gesto (autoplay policy).

export type SfxName = 'cardPlace' | 'cardFlip' | 'yourTurn' | 'warning' | 'fasiolas' | 'win' | 'lose'

const MUTE_KEY = 'fasiolas-muted'

let ctx: AudioContext | null = null
let muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1'

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) {
    return null
  }
  if (!ctx) {
    ctx = new AudioContext()
  }
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }
  return ctx
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => ensureCtx(), { once: true })
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(value: boolean): void {
  muted = value
  localStorage.setItem(MUTE_KEY, value ? '1' : '0')
}

// Viena nata: freq Hz, startas po delaySec, trukme durSec.
function tone(c: AudioContext, freq: number, delaySec: number, durSec: number, type: OscillatorType, peak: number): void {
  const t0 = c.currentTime + delaySec
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + durSec)
  osc.connect(gain).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + durSec + 0.02)
}

export function play(name: SfxName): void {
  if (muted) {
    return
  }
  const c = ensureCtx()
  if (!c || c.state !== 'running') {
    return
  }
  const g = 0.15
  switch (name) {
    case 'cardPlace':
      tone(c, 190, 0, 0.09, 'triangle', g)
      break
    case 'cardFlip':
      tone(c, 620, 0, 0.05, 'sine', g * 0.8)
      tone(c, 930, 0.04, 0.05, 'sine', g * 0.8)
      break
    case 'yourTurn':
      tone(c, 660, 0, 0.12, 'sine', g)
      tone(c, 880, 0.13, 0.16, 'sine', g)
      break
    case 'warning':
      tone(c, 240, 0, 0.18, 'sawtooth', g * 0.7)
      tone(c, 240, 0.24, 0.18, 'sawtooth', g * 0.7)
      break
    case 'fasiolas':
      tone(c, 520, 0, 0.14, 'square', g * 0.6)
      tone(c, 390, 0.14, 0.14, 'square', g * 0.6)
      tone(c, 300, 0.28, 0.22, 'square', g * 0.6)
      break
    case 'win':
      tone(c, 523, 0, 0.14, 'sine', g)
      tone(c, 659, 0.14, 0.14, 'sine', g)
      tone(c, 784, 0.28, 0.14, 'sine', g)
      tone(c, 1047, 0.42, 0.3, 'sine', g)
      break
    case 'lose':
      tone(c, 392, 0, 0.2, 'sine', g)
      tone(c, 294, 0.2, 0.2, 'sine', g)
      tone(c, 220, 0.4, 0.35, 'sine', g)
      break
  }
}
