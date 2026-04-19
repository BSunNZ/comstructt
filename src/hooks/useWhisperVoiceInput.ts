/**
 * useWhisperVoiceInput
 * ----------------------------------------------------------------------------
 * Drop-in replacement for `useVoiceInput` that records microphone audio with
 * MediaRecorder and transcribes it through the `transcribe-audio` Supabase
 * Edge Function (OpenAI Whisper, German + construction vocabulary primed).
 *
 * Public API mirrors `useVoiceInput` exactly:
 *   { supported, listening, interim, error, start, stop, speak }
 *
 * That means existing callers (today only `OrderSearch.tsx`) can swap the
 * import without changing any other code.
 *
 * Behaviour:
 *   - `start()` requests mic permission, opens a MediaRecorder, and begins
 *     monitoring audio levels with the Web Audio API to detect end of speech.
 *   - While recording, `listening` is true and `interim` shows a placeholder
 *     "Sprich jetzt…" so the existing UI keeps animating.
 *   - When silence is detected for `silenceMs` ms after the user has actually
 *     spoken, OR the user taps the mic again, recording stops, the audio is
 *     posted to the edge function, and the final transcript is delivered via
 *     `onFinal`.
 *   - During the network round-trip, `interim` becomes "Transkribiere…" so
 *     the input field shows the loading state.
 *
 * Why MediaRecorder over Web Speech API:
 *   - Web Speech API is Chrome-only on desktop and unreliable in noisy
 *     environments. Whisper handles construction-site noise and German
 *     vocabulary far better.
 *   - Works on iOS Safari (the demo target) where Web Speech API does not.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type UseWhisperVoiceInputOptions = {
  /** ISO-639-1 language hint passed to Whisper. Defaults to "de". */
  lang?: string;
  /** Called once with the final transcript. */
  onFinal?: (transcript: string) => void;
  /**
   * Silence (ms) after the user stops speaking before we auto-stop and
   * transcribe. Default 1500 ms.
   */
  silenceMs?: number;
  /**
   * Hard cap on a single recording (safety net). Default 30 s — long
   * enough for "Bestell 200 Schrauben 4x40 und 50 Dübel und Lieferung
   * Baustelle Mannheim" with thinking pauses.
   */
  maxRecordingMs?: number;
};

// MediaRecorder is widely supported but not on every legacy browser. We
// also need getUserMedia. If either is missing we fall back to "unsupported"
// so callers can hide the mic button gracefully.
const detectSupport = (): boolean => {
  if (typeof window === "undefined") return false;
  const hasGetUserMedia = !!navigator.mediaDevices?.getUserMedia;
  const hasMediaRecorder = typeof window.MediaRecorder !== "undefined";
  return hasGetUserMedia && hasMediaRecorder && isSupabaseConfigured;
};

// Pick a MIME type that this browser can actually record. Order matters:
// webm/opus is the most common, then mp4 for iOS Safari, then a sane default.
const pickMimeType = (): string => {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
};

// Convert a Blob to a base64 string (without the data: prefix). We chunk
// through FileReader to avoid blocking the main thread on large blobs.
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:audio/webm;base64,XXXX" — strip the prefix.
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });

export const useWhisperVoiceInput = ({
  lang = "de",
  onFinal,
  silenceMs = 1500,
  maxRecordingMs = 30_000,
}: UseWhisperVoiceInputOptions = {}) => {
  const [supported] = useState(detectSupport);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Refs survive re-renders without retriggering effects.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");

  // Audio-level analysis for end-of-speech detection.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  // Timers + flags driving the silence-detection state machine.
  const silenceTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const hasSpokenRef = useRef<boolean>(false); // true once the user has crossed the speech threshold
  const stoppingRef = useRef<boolean>(false); // set when we've initiated stop, prevents double-fire
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  // Single source of truth for cleanup. Always safe to call.
  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    try {
      analyserRef.current?.disconnect();
    } catch {
      /* noop */
    }
    analyserRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {
        /* noop */
      });
    }
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /**
   * Stop recording and ship the audio off to Whisper. Safe to call multiple
   * times — `stoppingRef` guards against double-transcription.
   */
  const stop = useCallback(() => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    const recorder = recorderRef.current;
    if (!recorder) {
      cleanup();
      setListening(false);
      return;
    }

    if (recorder.state === "recording") {
      try {
        recorder.stop();
      } catch (e) {
        console.error("[useWhisperVoiceInput] recorder.stop failed", e);
      }
    } else {
      // Already stopped/inactive — nothing to do, the onstop handler
      // (registered in start()) will fire the transcription.
    }
  }, [cleanup]);

  const start = useCallback(async () => {
    if (!supported) {
      setError("Voice input not supported in this browser.");
      return;
    }
    if (listening) return; // already running

    setError(null);
    setInterim("Sprich jetzt…");
    chunksRef.current = [];
    hasSpokenRef.current = false;
    stoppingRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Browser-side noise tricks help Whisper a lot on construction sites.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Microphone permission denied";
      setError(msg);
      setInterim("");
      return;
    }
    streamRef.current = stream;

    const mime = pickMimeType();
    mimeRef.current = mime;
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start recorder";
      setError(msg);
      setInterim("");
      cleanup();
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onerror = (ev) => {
      console.error("[useWhisperVoiceInput] recorder error", ev);
      setError("Recording error");
    };

    recorder.onstop = async () => {
      // Switch UI to "transcribing".
      setInterim("Transkribiere…");
      const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
      chunksRef.current = [];
      cleanup();
      setListening(false);

      // Empty / silent recording → bail without calling Whisper.
      if (blob.size < 1500 || !hasSpokenRef.current) {
        setInterim("");
        return;
      }

      try {
        const base64 = await blobToBase64(blob);
        const { data, error: fnError } = await supabase.functions.invoke("transcribe-audio", {
          body: { audio: base64, mimeType: mimeRef.current, language: lang },
        });
        if (fnError) throw fnError;
        const text = (data as { text?: string } | null)?.text?.trim() ?? "";
        setInterim("");
        if (text) onFinalRef.current?.(text);
      } catch (e) {
        console.error("[useWhisperVoiceInput] transcription failed", e);
        const msg = e instanceof Error ? e.message : "Transcription failed";
        setError(msg);
        setInterim("");
      }
    };

    // ---- Audio-level monitoring for silence detection ------------------
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyserRef.current = analyser;

        const buffer = new Uint8Array(analyser.frequencyBinCount);
        const SPEECH_THRESHOLD = 18; // RMS in 0–128 range; calibrated for typical mic gain
        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(buffer);
          // Compute RMS amplitude around the 128 mid-line.
          let sum = 0;
          for (let i = 0; i < buffer.length; i++) {
            const v = buffer[i] - 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buffer.length);

          if (rms > SPEECH_THRESHOLD) {
            hasSpokenRef.current = true;
            // Speech detected → cancel any pending silence-stop.
            if (silenceTimerRef.current !== null) {
              window.clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          } else if (hasSpokenRef.current && silenceTimerRef.current === null && !stoppingRef.current) {
            // Silence after speech → arm the auto-stop timer.
            silenceTimerRef.current = window.setTimeout(() => {
              silenceTimerRef.current = null;
              stop();
            }, silenceMs);
          }

          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    } catch (e) {
      // Audio analysis is best-effort. If it fails we still record fine,
      // we just won't auto-stop on silence — the user can tap stop manually.
      console.warn("[useWhisperVoiceInput] audio analysis unavailable", e);
    }

    // Hard timeout so a forgotten mic doesn't record forever.
    maxTimerRef.current = window.setTimeout(() => {
      maxTimerRef.current = null;
      stop();
    }, maxRecordingMs);

    try {
      recorder.start(250); // collect chunks every 250 ms
      setListening(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start recording";
      setError(msg);
      setInterim("");
      cleanup();
    }
  }, [supported, listening, lang, silenceMs, maxRecordingMs, cleanup, stop]);

  // Cleanup on unmount.
  useEffect(
    () => () => {
      stoppingRef.current = true;
      try {
        recorderRef.current?.stop();
      } catch {
        /* noop */
      }
      cleanup();
    },
    [cleanup],
  );

  // No-op speak() to preserve the old hook's API surface.
  const speak = useCallback((_text: string, _speakLang?: string) => {
    /* intentionally empty */
  }, []);

  return { supported, listening, interim, error, start, stop, speak };
};
