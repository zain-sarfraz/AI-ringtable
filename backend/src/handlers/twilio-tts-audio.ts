// @generated from supabase/functions/twilio-tts-audio — run: node backend/scripts/generate-handlers.mjs

// This endpoint serves TTS audio for Twilio to play during calls
// Twilio fetches this URL and plays the audio to the caller

export async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const text = url.searchParams.get("text");
    const voiceId = url.searchParams.get("voiceId") || "JBFqnCBsd6RMkjVDRZzb";

    if (!text) {
      return new Response("Text parameter required", { status: 400 });
    }

    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

    if (!ELEVENLABS_API_KEY) {
      console.error("ELEVENLABS_API_KEY not configured");
      return new Response("ElevenLabs not configured", { status: 500 });
    }

    console.log(`Generating TTS for Twilio: "${text.substring(0, 50)}..."`);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs error:", response.status, errorText);
      return new Response("TTS generation failed", { status: 500 });
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("TTS audio error:", error);
    return new Response("Internal error", { status: 500 });
  }
}
