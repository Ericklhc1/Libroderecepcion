'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { getUnreadCounts } from '@/server/actions/notifications';

/**
 * El aviso sonoro de las notificaciones.
 *
 * Existe porque un recordatorio que sólo cambia un número en la esquina no
 * avisa de nada: en el mesón nadie está mirando la campana. El sonido es lo
 * que convierte un contador en un aviso.
 *
 * **El tono se sintetiza, no es un archivo.** Dos notas cortas con Web Audio:
 * ni se descarga nada, ni hay un `.mp3` en el repositorio, ni el primer aviso
 * llega tarde porque el audio todavía se estaba bajando. Y permite que la
 * alerta suene distinto de la notificación sin duplicar assets.
 *
 * **Discreto pero que se note**, que es lo que se pidió: dos notas
 * ascendentes, ~90 ms cada una, con entrada y salida suaves para que no
 * chasquee, y volumen bajo. No es un pitido de error; es el sonido de algo que
 * acaba de llegar.
 */

/** Intervalo de consulta. 20 s: el mesón no necesita más, la base tampoco. */
const POLL_MS = 20_000;
const MUTE_KEY = 'libro.avisoSonoro.silenciado';

type Counts = { notifications: number; alerts: number };

/**
 * Un `AudioContext` por pestaña, creado al primer gesto.
 *
 * Los navegadores no dejan sonar nada antes de que la persona interactúe con
 * la página: un contexto creado al cargar nace suspendido. Se crea perezoso y
 * se intenta reanudar, y si el navegador se niega no pasa nada —el aviso
 * visual sigue estando—.
 */
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();
    return audioContext;
  } catch {
    // Sin audio disponible. El contador rojo sigue avisando.
    return null;
  }
}

/**
 * Una nota con envolvente suave.
 *
 * La envolvente no es un adorno: un oscilador que arranca y se corta en seco
 * produce un chasquido que suena a falla, no a aviso.
 */
function playNote(
  context: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  peak: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  // Triangular: tiene algo de cuerpo sin el filo de una cuadrada.
  oscillator.type = 'triangle';
  oscillator.frequency.value = frequency;

  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

/**
 * El aviso.
 *
 * `urgent` sube el tono y agrega una tercera nota: una alerta crítica y una
 * notificación cualquiera no pueden sonar igual, o deja de distinguirse lo que
 * hay que atender ya.
 */
export function playChime(urgent = false) {
  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime + 0.01;
  const peak = urgent ? 0.16 : 0.11;

  if (urgent) {
    playNote(context, 784, now, 0.1, peak); // G5
    playNote(context, 988, now + 0.11, 0.1, peak); // B5
    playNote(context, 1175, now + 0.22, 0.14, peak); // D6
  } else {
    playNote(context, 659, now, 0.09, peak); // E5
    playNote(context, 880, now + 0.1, 0.13, peak); // A5
  }
}

export function NotificationChime({
  initialNotifications,
  initialAlerts,
}: {
  initialNotifications: number;
  initialAlerts: number;
}) {
  /*
    Lo último que se VIO, no lo último que hay. El aviso suena cuando el número
    SUBE: si sonara con cualquier valor distinto de cero, sonaría en cada
    consulta mientras quedara algo sin leer, que es la forma más rápida de que
    alguien apague el sonido para siempre.
  */
  const seen = useRef<Counts>({
    notifications: initialNotifications,
    alerts: initialAlerts,
  });
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);

  // La preferencia se lee en el cliente: en el servidor no existe.
  useEffect(() => {
    try {
      setMuted(window.localStorage.getItem(MUTE_KEY) === '1');
    } catch {
      // Navegación privada o almacenamiento bloqueado: suena, que es el defecto.
    }
    setReady(true);
  }, []);

  /*
    El navegador exige un gesto antes de permitir audio. Se prepara el contexto
    con el primer clic o tecla de la sesión, de modo que el primer aviso de
    verdad ya encuentre el audio listo en lugar de perderse.
  */
  useEffect(() => {
    const prime = () => getAudioContext();
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  const check = useCallback(async () => {
    try {
      const counts = await getUnreadCounts();
      const previous = seen.current;

      const newNotifications = counts.notifications > previous.notifications;
      const newAlerts = counts.alerts > previous.alerts;

      /*
        Se actualiza SIEMPRE, incluso en silencio: si sólo se actualizara al
        sonar, al quitar el silencio sonaría de golpe por todo lo acumulado.
      */
      seen.current = counts;

      if (muted) return;
      if (newAlerts) playChime(true);
      else if (newNotifications) playChime(false);
    } catch {
      /*
        Una consulta fallida no hace nada: el aviso sonoro es una comodidad, y
        no puede ensuciar la consola del mesón ni romper la pantalla. El
        intervalo sigue vivo y el siguiente intento puede funcionar.
      */
    }
  }, [muted]);

  useEffect(() => {
    const id = window.setInterval(check, POLL_MS);
    /*
      Al volver a la pestaña se comprueba de inmediato: es justo el momento en
      que alguien vuelve al mesón y quiere saber si pasó algo.
    */
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  const toggle = () => {
    const next = !muted;
    setMuted(next);
    try {
      window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    } catch {
      // Si no se puede guardar, al menos vale para esta sesión.
    }
    // Al activarlo suena una vez: así se sabe qué se acaba de activar y
    // además queda el gesto que el navegador exige para permitir audio.
    if (!next) playChime(false);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      // Hasta leer la preferencia no se pinta el estado, para no mostrar
      // "activado" un instante y cambiar a "silenciado" al hidratar.
      className={`rounded-lg p-2 transition-colors ${
        ready && muted
          ? 'text-slate-400 hover:bg-slate-100'
          : 'text-petrol-700 hover:bg-petrol-50'
      }`}
      aria-label={
        muted ? 'Aviso sonoro silenciado. Activarlo' : 'Aviso sonoro activo. Silenciarlo'
      }
      title={
        muted
          ? 'El aviso sonoro está silenciado'
          : 'Suena al llegar una notificación o una alerta'
      }
    >
      {/* Altavoz y no campana: al lado de la campana de notificaciones, dos
          campanas no dirían cuál es cuál. */}
      {ready && muted ? (
        <VolumeX className="h-5 w-5" aria-hidden="true" />
      ) : (
        <Volume2 className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}
