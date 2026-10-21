export type RingtoneId =
  | "classic-bell"
  | "crystal-chime"
  | "hotel-bell"
  | "marimba"
  | "digital-pulse"
  | "harmonic"
  | "urgent-alarm"
  | "fanfare"
  | "soft-ding"
  | "zen-gong";

export interface RingtoneOption {
  id: RingtoneId;
  label: string;
  description: string;
  category: "classic" | "modern" | "melody" | "urgent";
  icon: string;
}

export const RINGTONES: RingtoneOption[] = [
  {
    id: "classic-bell",
    label: "Classic Dinner Bell",
    description: "Traditional resonant counter bell strike with warm overtone",
    category: "classic",
    icon: "🔔",
  },
  {
    id: "crystal-chime",
    label: "Crystal Chime",
    description: "Bright, sparkling upward 3-tone chime for modern cafes",
    category: "modern",
    icon: "✨",
  },
  {
    id: "hotel-bell",
    label: "Hotel Service Bell",
    description: "Crisp double-tap concierge service desk bell",
    category: "classic",
    icon: "🛎️",
  },
  {
    id: "marimba",
    label: "Marimba Melody",
    description: "Upbeat acoustic wooden marimba chord sequence",
    category: "melody",
    icon: "🎶",
  },
  {
    id: "digital-pulse",
    label: "Digital Pulse",
    description: "Futuristic dual electronic tone, clean and minimal",
    category: "modern",
    icon: "📱",
  },
  {
    id: "harmonic",
    label: "Harmonic Bloom",
    description: "Rich, pleasant multi-layer harmonic chord bloom",
    category: "melody",
    icon: "🎵",
  },
  {
    id: "urgent-alarm",
    label: "Kitchen Urgent Buzz",
    description: "High-priority alerting pulses for busy rush hours",
    category: "urgent",
    icon: "⚡",
  },
  {
    id: "fanfare",
    label: "Royal Fanfare",
    description: "Joyful celebratory trumpet fanfare arpeggio",
    category: "melody",
    icon: "🎺",
  },
  {
    id: "soft-ding",
    label: "Minimal Soft Ding",
    description: "Subtle and gentle acoustic drop ding",
    category: "modern",
    icon: "💡",
  },
  {
    id: "zen-gong",
    label: "Zen Singing Bowl",
    description: "Deep calming gong with soothing long resonance",
    category: "classic",
    icon: "🍜",
  },
];

export interface NotificationPrefs {
  ringtone: RingtoneId;
  volume: number; // 0..1
  enabled: boolean;
  repeatUntilAcknowledged?: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  ringtone: "classic-bell",
  volume: 0.9,
  enabled: true,
  repeatUntilAcknowledged: true,
};

const STORAGE_KEY = "order_notification_prefs";

export function loadNotificationPrefs(restaurantId?: string | null): NotificationPrefs {
  try {
    const key = restaurantId ? `${STORAGE_KEY}_${restaurantId}` : STORAGE_KEY;
    let raw = localStorage.getItem(key);
    if (!raw && restaurantId) {
      raw = localStorage.getItem(STORAGE_KEY);
    }
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveNotificationPrefs(prefs: NotificationPrefs, restaurantId?: string | null) {
  try {
    const key = restaurantId ? `${STORAGE_KEY}_${restaurantId}` : STORAGE_KEY;
    localStorage.setItem(key, JSON.stringify(prefs));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(
      new CustomEvent("notification-prefs-changed", {
        detail: { ...prefs, restaurantId },
      })
    );
  } catch {
    // ignore
  }
}

/* ════════════════════════════════════════════════════════════
   WEB AUDIO API SOUND SYNTHESIS ENGINE (100% Reliable & Offline)
   ════════════════════════════════════════════════════════════ */
let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioCtx();
  }
  return sharedAudioContext;
}

/** Resume AudioContext; browsers mute until a user gesture + successful resume. */
export async function unlockNotificationAudio(): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return ctx.state === "running";
}

export function synthesizeRingtone(id: RingtoneId, volume = 0.9): () => void {
  const ctx = getAudioContext();
  if (!ctx) return () => {};

  const masterGain = ctx.createGain();
  const scaledVol = Math.max(0.01, Math.min(1, volume));
  masterGain.gain.setValueAtTime(scaledVol * 0.75, ctx.currentTime);
  masterGain.connect(ctx.destination);

  const now = ctx.currentTime;
  const activeNodes: (OscillatorNode | GainNode)[] = [];

  const playNote = (
    freq: number,
    startOffset: number,
    duration: number,
    type: OscillatorType = "sine",
    gainLevel = 0.5,
    exponential = true
  ) => {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);

      const startTime = now + startOffset;
      const endTime = startTime + duration;

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(gainLevel, startTime + 0.015);
      if (exponential) {
        gain.gain.exponentialRampToValueAtTime(0.0001, endTime);
      } else {
        gain.gain.linearRampToValueAtTime(0.0001, endTime);
      }

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(startTime);
      osc.stop(endTime);

      activeNodes.push(osc, gain);
    } catch {
      // ignore
    }
  };

  switch (id) {
    case "classic-bell": {
      // Classic metal service bell: two strikes with warm resonance
      playNote(987.77, 0, 1.2, "sine", 0.6); // B5
      playNote(1975.53, 0, 0.9, "sine", 0.35); // B6 harmonic
      playNote(3135.96, 0, 0.4, "triangle", 0.15); // G7 shimmer
      playNote(1174.66, 0.18, 1.4, "sine", 0.7); // D6
      playNote(2349.32, 0.18, 1.0, "sine", 0.4);
      playNote(3520.0, 0.18, 0.5, "triangle", 0.2);
      break;
    }
    case "crystal-chime": {
      // Sparkling upward arpeggio: C6 -> E6 -> G6 -> C7
      playNote(1046.5, 0.0, 0.7, "sine", 0.4); // C6
      playNote(1318.51, 0.12, 0.8, "sine", 0.45); // E6
      playNote(1567.98, 0.24, 0.9, "sine", 0.5); // G6
      playNote(2093.0, 0.36, 1.3, "sine", 0.6); // C7
      playNote(4186.01, 0.36, 0.6, "triangle", 0.2);
      break;
    }
    case "hotel-bell": {
      // Crisp rapid double tap concierge bell
      playNote(1760.0, 0.0, 0.5, "sine", 0.7); // A6
      playNote(3520.0, 0.0, 0.3, "triangle", 0.3);
      playNote(1760.0, 0.14, 0.9, "sine", 0.8);
      playNote(3520.0, 0.14, 0.6, "triangle", 0.35);
      break;
    }
    case "marimba": {
      // Acoustic marimba chord: F5 -> A5 -> C6 -> F6
      playNote(698.46, 0.0, 0.4, "triangle", 0.5);
      playNote(880.0, 0.09, 0.45, "triangle", 0.5);
      playNote(1046.5, 0.18, 0.5, "triangle", 0.55);
      playNote(1396.91, 0.27, 0.9, "sine", 0.6);
      break;
    }
    case "digital-pulse": {
      // Crisp tech dual-beep
      playNote(880.0, 0.0, 0.12, "sine", 0.5, false);
      playNote(1760.0, 0.14, 0.22, "sine", 0.6, false);
      break;
    }
    case "harmonic": {
      // Warm chord bloom: C5, G5, C6, E6
      playNote(523.25, 0.0, 1.6, "sine", 0.4);
      playNote(783.99, 0.05, 1.5, "sine", 0.35);
      playNote(1046.5, 0.1, 1.4, "sine", 0.45);
      playNote(1318.51, 0.15, 1.6, "sine", 0.5);
      break;
    }
    case "urgent-alarm": {
      // Fast pulsing warning tone
      playNote(987.77, 0.0, 0.12, "square", 0.25, false);
      playNote(1318.51, 0.13, 0.12, "square", 0.3, false);
      playNote(987.77, 0.28, 0.12, "square", 0.25, false);
      playNote(1318.51, 0.41, 0.25, "square", 0.35, false);
      break;
    }
    case "fanfare": {
      // Joyful brass fanfare
      playNote(523.25, 0.0, 0.18, "sawtooth", 0.22);
      playNote(659.25, 0.14, 0.18, "sawtooth", 0.26);
      playNote(783.99, 0.28, 0.22, "sawtooth", 0.32);
      playNote(1046.5, 0.45, 0.9, "sawtooth", 0.4);
      playNote(1046.5, 0.45, 1.1, "sine", 0.5);
      break;
    }
    case "soft-ding": {
      // Subtle single ding
      playNote(1318.51, 0.0, 1.0, "sine", 0.55);
      playNote(2637.02, 0.0, 0.4, "sine", 0.2);
      break;
    }
    case "zen-gong": {
      // Calming low resonance singing bowl
      playNote(329.63, 0.0, 2.4, "sine", 0.6);
      playNote(659.25, 0.0, 2.0, "sine", 0.35);
      playNote(987.77, 0.0, 1.2, "sine", 0.15);
      break;
    }
    default: {
      playNote(1046.5, 0, 1.0, "sine", 0.5);
    }
  }

  return () => {
    try {
      masterGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
    } catch {
      // ignore
    }
  };
}

let activeLoopInterval: number | null = null;
let stopCurrentTone: (() => void) | null = null;

export async function playNotificationSound(id: RingtoneId = "classic-bell", volume = 0.9) {
  await unlockNotificationAudio();
  if (stopCurrentTone) {
    stopCurrentTone();
    stopCurrentTone = null;
  }
  stopCurrentTone = synthesizeRingtone(id, volume);
}

export function startNotificationLoop(
  id: RingtoneId = "classic-bell",
  volume = 0.9,
  intervalMs = 2800
) {
  stopNotificationLoop();
  void playNotificationSound(id, volume);
  activeLoopInterval = window.setInterval(() => {
    void playNotificationSound(id, volume);
  }, intervalMs);
}

export function stopNotificationLoop() {
  if (activeLoopInterval !== null) {
    clearInterval(activeLoopInterval);
    activeLoopInterval = null;
  }
  if (stopCurrentTone) {
    stopCurrentTone();
    stopCurrentTone = null;
  }
}

// Backward compatibility helper
export function getRingtoneUrl(id: RingtoneId): string {
  return "";
}