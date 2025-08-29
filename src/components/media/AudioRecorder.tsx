"use client";
import React from "react";

export interface AudioRecorderProps {
  autoStart?: boolean;
  onAmplitude?: (level: number) => void;
  onTranscript?: (text: string) => void;
  onStateChange?: (state: "idle" | "listening" | "paused" | "error") => void;
  className?: string;
}

/**
 * Mobile-first audio recorder using MediaRecorder + Web Audio API.
 * Provides amplitude levels and optional browser STT transcript via Web Speech API (as a fallback before AWS Transcribe).
 */
export function AudioRecorder({ autoStart = true, onAmplitude, onTranscript, onStateChange, className }: AudioRecorderProps) {
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const [state, setState] = React.useState<"idle" | "listening" | "paused" | "error">("idle");

  const stopMeters = React.useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startMeters = React.useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);
      // Calculate a simple RMS-like amplitude from time domain data
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128; // normalize -1..1
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      onAmplitude?.(Number(rms.toFixed(3))); // 0..~0.7 typically
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [onAmplitude]);

  const startRecognition = React.useCallback(() => {
    try {
      const win = window as Window & { webkitSpeechRecognition?: new () => SpeechRecognition; SpeechRecognition?: new () => SpeechRecognition };
      const SR = win.SpeechRecognition ?? win.webkitSpeechRecognition;
      if (!SR) return; // silently skip if unsupported
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        onTranscript?.(transcript.trim());
      };
      recognition.onerror = () => {
        // ignore errors; this is just a UX fallback until AWS Transcribe is wired
      };
      recognition.onend = () => {
        // auto-restart to keep continuous
        try { recognition.start(); } catch {}
      };
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // no-op
    }
  }, [onTranscript]);

  const stopRecognition = React.useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try { rec.stop(); } catch {}
      recognitionRef.current = null;
    }
  }, []);

  const start = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      mediaStreamRef.current = stream;

  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  const audioCtx = new (AC as typeof AudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      source.connect(analyser);

      startMeters();
      startRecognition();
      setState("listening");
      onStateChange?.("listening");
  } catch {
      setState("error");
      onStateChange?.("error");
    }
  }, [onStateChange, startMeters, startRecognition]);

  const stop = React.useCallback(() => {
    stopMeters();
    stopRecognition();
    analyserRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setState("idle");
    onStateChange?.("idle");
  }, [onStateChange, stopMeters, stopRecognition]);

  React.useEffect(() => {
    if (autoStart) start();
    return () => stop();
  }, [autoStart, start, stop]);

  return (
    <div className={className}>
      {/* Minimal UI; auto-starts. Keep accessible controls for edge cases */}
      <div className="flex items-center justify-center gap-3">
        <span className="text-sm text-gray-600" aria-live="polite">
          {state === "listening" ? "Listening…" : state === "paused" ? "Paused" : state === "error" ? "Mic error" : "Ready"}
        </span>
        <button
          onClick={state === "listening" ? stop : start}
          className="h-10 rounded-full px-4 text-sm font-medium text-white"
          style={{ background: "linear-gradient(90deg, #2563EB, #7C3AED)" }}
          aria-label={state === "listening" ? "Stop microphone" : "Start microphone"}
        >
          {state === "listening" ? "Stop" : "Start"}
        </button>
      </div>
    </div>
  );
}
