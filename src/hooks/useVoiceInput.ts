import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (not in lib.dom by default).
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionErrorEventLike = { error: string; message?: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const getRecognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export type UseVoiceInputOptions = {
  lang?: string;
  onFinal?: (transcript: string) => void;
  /**
   * Silence (ms) AFTER the last final speech segment before we consider the
   * user "done talking" and flush the buffered transcript to onFinal.
   * Default 1500 ms — long enough to think mid-sentence without triggering
   * a premature search.
   */
  silenceMs?: number;
};

/**
 * Voice input with a "wait until you actually stop talking" buffer.
 *
 * The Web Speech API fires final results aggressively after short pauses,
 * which would otherwise trigger searches mid-sentence. We instead:
 *
 *   1. Run the recognizer in `continuous` mode so it keeps listening
 *      across natural pauses.
 *   2. Accumulate every `isFinal` segment in a ref-buffer.
 *   3. After each segment, arm a silence timer (default 1.5 s). If new
 *      speech arrives the timer is reset; if silence holds, we flush the
 *      combined transcript to `onFinal` exactly once and stop the recognizer.
 *   4. If the engine ends spontaneously while we're still actively listening,
 *      we auto-restart it so a long sentence doesn't get clipped by Chrome's
 *      built-in 30-60 s end-of-speech timeout.
 *
 * Tapping the mic button again calls `stop()` which immediately flushes
 * whatever is buffered.
 */
export const useVoiceInput = ({
  lang = "en-US",
  onFinal,
  silenceMs = 1500,
}: UseVoiceInputOptions = {}) => {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  // Buffered final segments collected while the user is talking.
  const bufferRef = useRef<string>("");
  // Silence timer that fires after the user stops talking.
  const silenceTimerRef = useRef<number | null>(null);
  // True when the user has explicitly asked us to be listening. Drives
  // auto-restart after spontaneous engine "end" events.
  const userListeningRef = useRef<boolean>(false);
  // True while we are intentionally stopping (so we don't auto-restart).
  const flushingRef = useRef<boolean>(false);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const flush = useCallback(() => {
    clearSilenceTimer();
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    setInterim("");
    if (text) onFinalRef.current?.(text);
  }, []);

  const stop = useCallback(() => {
    flushingRef.current = true;
    userListeningRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    flush();
  }, [flush]);

  const start = useCallback(() => {
    setError(null);
    setInterim("");
    bufferRef.current = "";
    clearSilenceTimer();

    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition not supported in this browser.");
      return;
    }

    // Tear down any previous instance
    try {
      recRef.current?.abort();
    } catch {
      /* noop */
    }

    const rec = new Ctor();
    rec.lang = lang;
    // Keep listening across natural pauses — we decide when "done" via timer.
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    userListeningRef.current = true;
    flushingRef.current = false;

    rec.onstart = () => setListening(true);

    rec.onend = () => {
      // The engine stopped on its own. If the user is still actively
      // listening (i.e. they didn't tap stop), restart so long sentences
      // and pauses don't kill the session.
      if (userListeningRef.current && !flushingRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* fall through to fully ending */
        }
      }
      setListening(false);
      setInterim("");
    };

    rec.onerror = (e) => {
      // "no-speech" and "aborted" happen routinely during silence — don't
      // surface them as errors, just let onend handle restart logic.
      const code = e.error || "";
      if (code !== "no-speech" && code !== "aborted") {
        setError(code || "Speech recognition error");
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        userListeningRef.current = false;
        setListening(false);
      }
    };

    rec.onresult = (e) => {
      let newFinal = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? "";
        if (r.isFinal) newFinal += txt;
        else interimText += txt;
      }

      // Any new audio activity (interim OR final) means the user is still
      // talking — reset the silence timer.
      if (interimText || newFinal) {
        clearSilenceTimer();
      }

      if (interimText) {
        setInterim(interimText);
      }

      if (newFinal) {
        bufferRef.current = (bufferRef.current + " " + newFinal).trim();
        setInterim("");
      }

      // Re-arm the silence timer after every result event. When it fires
      // we consider the user done and flush whatever we have.
      silenceTimerRef.current = window.setTimeout(() => {
        flushingRef.current = true;
        userListeningRef.current = false;
        try {
          recRef.current?.stop();
        } catch {
          /* noop */
        }
        flush();
      }, silenceMs);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start recognition");
      userListeningRef.current = false;
      setListening(false);
    }
  }, [lang, silenceMs, flush]);

  useEffect(() => () => stop(), [stop]);

  // Speech-to-text only — text-to-speech intentionally removed so the app
  // never talks back to the user. Kept as a no-op to preserve the hook API.
  const speak = useCallback((_text: string, _speakLang?: string) => {
    // intentionally empty
  }, []);

  return { supported, listening, interim, error, start, stop, speak };
};
