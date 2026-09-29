'use client';

import type { ChatNotificationTone } from '@/domain/chat';

let audioContext: AudioContext | null = null;
let notificationBus: GainNode | null = null;

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

function getNotificationBus(context: AudioContext): AudioNode {
  if (notificationBus) return notificationBus;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 16;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;

  notificationBus = context.createGain();
  notificationBus.gain.value = 1.35;
  notificationBus.connect(compressor).connect(context.destination);
  return notificationBus;
}

export function primeNotificationAudio(): void {
  const context = getAudioContext();
  if (context) getNotificationBus(context);
}

function playNote(
  context: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  peak: number,
  waveform: OscillatorType = 'triangle',
  output?: AudioNode,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = waveform;
  oscillator.frequency.value = frequency;

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain).connect(output ?? context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}

type TonePattern = Array<{
  frequency: number;
  offset: number;
  duration: number;
  waveform?: OscillatorType;
}>;

function patternFor(tone: ChatNotificationTone, urgent: boolean): TonePattern {
  if (urgent) {
    return [
      { frequency: 880, offset: 0, duration: 0.13, waveform: 'square' },
      { frequency: 1175, offset: 0.14, duration: 0.14, waveform: 'square' },
      { frequency: 880, offset: 0.31, duration: 0.13, waveform: 'square' },
      { frequency: 1318, offset: 0.46, duration: 0.2, waveform: 'triangle' },
    ];
  }

  switch (tone) {
    case 'ping':
      return [
        { frequency: 1175, offset: 0, duration: 0.16, waveform: 'sine' },
        { frequency: 1568, offset: 0.13, duration: 0.19, waveform: 'sine' },
      ];
    case 'pop':
      return [
        { frequency: 523, offset: 0, duration: 0.08, waveform: 'square' },
        { frequency: 784, offset: 0.08, duration: 0.12, waveform: 'triangle' },
        { frequency: 1047, offset: 0.18, duration: 0.14, waveform: 'triangle' },
      ];
    case 'bell':
      return [
        { frequency: 784, offset: 0, duration: 0.28, waveform: 'sine' },
        { frequency: 1568, offset: 0.01, duration: 0.31, waveform: 'sine' },
        { frequency: 1175, offset: 0.18, duration: 0.28, waveform: 'sine' },
      ];
    case 'bamboo':
      return [
        { frequency: 659, offset: 0, duration: 0.1, waveform: 'square' },
        { frequency: 988, offset: 0.12, duration: 0.1, waveform: 'square' },
        { frequency: 1318, offset: 0.24, duration: 0.16, waveform: 'triangle' },
      ];
    case 'chime':
    default:
      return [
        { frequency: 659, offset: 0, duration: 0.13, waveform: 'triangle' },
        { frequency: 880, offset: 0.13, duration: 0.15, waveform: 'triangle' },
        { frequency: 1175, offset: 0.28, duration: 0.2, waveform: 'triangle' },
      ];
  }
}

/**
 * Tono de operación: recepción es un ambiente con conversación, teléfonos y
 * movimiento. Se usa compresión + capa armónica para aprovechar mejor el nivel
 * disponible del navegador sin intentar sobrepasar el volumen físico del equipo.
 */
export function playChime(
  urgent = false,
  tone: ChatNotificationTone = 'chime',
): void {
  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime + 0.01;
  const peak = urgent ? 0.86 : 0.68;
  const output = getNotificationBus(context);

  for (const note of patternFor(tone, urgent)) {
    playNote(
      context,
      note.frequency,
      now + note.offset,
      note.duration,
      peak,
      note.waveform ?? 'triangle',
      output,
    );

    // Una capa armónica corta aumenta presencia en parlantes pequeños de
    // notebook/teléfono sin depender de subir artificialmente el volumen del SO.
    playNote(
      context,
      note.frequency * 2,
      now + note.offset + 0.006,
      Math.max(0.08, note.duration * 0.82),
      peak * 0.28,
      'sine',
      output,
    );
  }
}
