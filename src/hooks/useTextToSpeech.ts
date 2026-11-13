import { useState, useCallback, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/apiBase";
import { getToken } from "@/lib/authStorage";

// Available ElevenLabs voices
export const ELEVENLABS_VOICES = {
  urdu: { id: 'wdXhcCmAYpPsryFWCtn2', name: 'Urdu', description: 'Pakistani Urdu female voice' },
  george: { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Professional male voice' },
  sarah: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Friendly female voice' },
  roger: { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', description: 'Calm male voice' },
  laura: { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', description: 'Warm female voice' },
  charlie: { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', description: 'Casual male voice' },
  alice: { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', description: 'Clear female voice' },
  brian: { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', description: 'Authoritative male voice' },
  lily: { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Soft female voice' },
} as const;

export type VoiceId = keyof typeof ELEVENLABS_VOICES;

interface UseTextToSpeechOptions {
  voiceId?: string;
  streaming?: boolean;
}

export function useTextToSpeech(options: UseTextToSpeechOptions = {}) {
  const { voiceId = ELEVENLABS_VOICES.george.id, streaming = false } = options;
  
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const speak = useCallback(async (text: string, customVoiceId?: string) => {
    if (!text.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No text provided for speech synthesis',
      });
      return;
    }

    // Stop any currently playing audio
    stopAudio();

    setIsLoading(true);
    setError(null);

    try {
      const endpoint = streaming ? 'elevenlabs-tts-stream' : 'elevenlabs-tts';
      
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const t = getToken();
      if (t) headers.Authorization = `Bearer ${t}`;
      const response = await fetch(`${getApiBase()}/api/functions/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          voiceId: customVoiceId || voiceId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to generate speech: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => setIsPlaying(true);
      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setError('Failed to play audio');
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      await audio.play();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate speech';
      setError(message);
      toast({
        variant: 'destructive',
        title: 'Speech Error',
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [voiceId, streaming, stopAudio]);

  return {
    speak,
    stopAudio,
    isLoading,
    isPlaying,
    error,
    voices: ELEVENLABS_VOICES,
  };
}
