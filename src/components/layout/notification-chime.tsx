'use client';

/**
 * Audio del sistema de notificaciones.
 *
 * Se mantiene separado del widget para que el transporte realtime y la UI no
 * conozcan detalles de Web Audio. No hay archivos de sonido ni dependencias.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  try {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

export function primeNotificationAudio(): void {
  getAudioContext();
}

function playNote(
  context: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  peak: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'triangle';
  oscillator.frequency.value = frequency;

  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

export function playChime(urgent = false): void {
  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime + 0.01;
  const peak = urgent ? 0.16 : 0.11;

  if (urgent) {
    playNote(context, 784, now, 0.1, peak);
    playNote(context, 988, now + 0.11, 0.1, peak);
    playNote(context, 1175, now + 0.22, 0.14, peak);
    return;
  }

  playNote(context, 659, now, 0.09, peak);
  playNote(context, 880, now + 0.1, 0.13, peak);
}
