"use client";
import React from "react";

export interface AudioRecorderProps {
  autoStart?: boolean;
  /** If true, uses the browser Web Speech API as a fallback recognizer. Defaults to false. */
  useWebSpeechFallback?: boolean;
  onAmplitude?: (level: number) => void;
  onTranscript?: (text: string) => void;
  onPartial?: (transcript: string, isFinal: boolean) => void;
  onFinal?: (transcript: string, isFinal: boolean) => void;
  onStateChange?: (state: "idle" | "listening" | "paused" | "error" | "starting") => void;
  recorderState?: "idle" | "listening" | "paused" | "error" | "starting";
  isInterviewActive?: boolean;
  className?: string;
}

export type AsrState = "idle" | "listening" | "paused" | "error" | "starting";

/**
 * Mobile-first audio recorder using MediaRecorder + Web Audio API.
 * Provides amplitude levels and optional browser STT transcript via Web Speech API (as a fallback before AWS Transcribe).
 */
export const AudioRecorder = React.forwardRef<
  { start: () => Promise<void>; stop: () => void },
  AudioRecorderProps
>(function AudioRecorder({ 
  autoStart = true, 
  useWebSpeechFallback = false, 
  onAmplitude, 
  onTranscript, 
  onPartial,
  onFinal,
  onStateChange, 
  recorderState,
  isInterviewActive = false,
  className 
}, ref) {
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const recognitionRef = React.useRef<SpeechRecognition | null>(null);
  const [state, setState] = React.useState<"idle" | "listening" | "paused" | "error" | "starting">("idle");
  const [errorText, setErrorText] = React.useState<string>("");
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState<string>("");
  const [micPermission, setMicPermission] = React.useState<"unknown" | "granted" | "denied" | "prompt">("unknown");

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
        // ignore errors; this is just a UX fallback
      };
      // Do NOT auto-restart onend; we manage lifecycle externally
      recognition.onend = null as unknown as () => void;
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // no-op
    }
  }, [onTranscript]);

  const stopRecognition = React.useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      // prevent internal auto-restarts
      rec.onend = null;
      try { rec.stop(); } catch {}
      recognitionRef.current = null;
    }
  }, []);

  const start = React.useCallback(async () => {
    // console.log("AudioRecorder: start() called, current state:", state);
    if (state === "listening" || state === "starting") {
      // console.log("AudioRecorder: already starting/listening, ignoring");
      return;
    }
    
    setState("starting");
    // console.log("AudioRecorder: state set to starting");
    
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
        video: false,
      };
      // console.log("AudioRecorder: requesting getUserMedia with constraints:", constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // console.log("AudioRecorder: getUserMedia success, stream active:", stream.active, "tracks:", stream.getTracks().length);
      
      if (!stream.active || stream.getTracks().length === 0) {
        throw new Error("MediaStream is not active or has no tracks");
      }
      
      mediaStreamRef.current = stream;

      const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      const audioCtx = new (AC as typeof AudioContext)();
      audioCtxRef.current = audioCtx;
      // console.log("AudioRecorder: AudioContext state:", audioCtx.state);
      
      // Some browsers require a user gesture to start/resume
      if (audioCtx.state === "suspended") {
        // console.log("AudioRecorder: resuming suspended AudioContext");
        await audioCtx.resume();
        // console.log("AudioRecorder: AudioContext resumed, new state:", audioCtx.state);
      }
      
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      source.connect(analyser);

      startMeters();
      if (useWebSpeechFallback) startRecognition();
      // console.log("AudioRecorder: setting state to 'listening'");
      setState("listening");
      setErrorText("");
      // console.log("AudioRecorder: calling onStateChange with 'listening'");
      onStateChange?.("listening");
      
  } catch (err) {
      // Surface detailed errors for debugging (NotAllowedError, NotFoundError, AbortError, SecurityError, etc.)
      const message = err instanceof Error ? `${err.name || "Error"}: ${err.message}` : "Microphone start failed";
      // eslint-disable-next-line no-console
      console.error("AudioRecorder start error", err);
      setErrorText(message);
      setState("error");
      onStateChange?.("error");
    }
  }, [selectedDeviceId, onStateChange, startMeters, startRecognition, useWebSpeechFallback, state]);

  const stop = React.useCallback(() => {
    stopMeters();
    stopRecognition();
    try { analyserRef.current?.disconnect(); } catch {}
    analyserRef.current = null;
    try { sourceRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    // Close AudioContext to release device resources fully
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    setState("idle");
    onStateChange?.("idle");
  }, [onStateChange, stopMeters, stopRecognition]);

  React.useEffect(() => {
    // Preload available audio input devices to handle NotFoundError or selection
    navigator.mediaDevices.enumerateDevices().then((list) => {
      const audioIns = list.filter((d) => d.kind === "audioinput");
      setDevices(audioIns);
      if (!selectedDeviceId && audioIns[0]?.deviceId) setSelectedDeviceId(audioIns[0].deviceId);
    }).catch(() => {});
    // Observe permission if supported
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyNavigator: any = navigator as any;
    if (anyNavigator?.permissions?.query) {
      anyNavigator.permissions.query({ name: "microphone" as PermissionName }).then((status: PermissionStatus) => {
        setMicPermission(status.state as typeof micPermission);
        status.onchange = () => setMicPermission(status.state as typeof micPermission);
      }).catch(() => {});
    }
  }, [selectedDeviceId]);

  // Expose start and stop methods via ref
  React.useImperativeHandle(ref, () => ({
    start,
    stop
  }), [start, stop]);

  React.useEffect(() => {
    if (autoStart) start();
    // Don't cleanup on re-render - only cleanup on unmount
    return () => {
      // console.log("AudioRecorder: component unmounting, cleaning up");
      stopMeters();
      stopRecognition();
      try { analyserRef.current?.disconnect(); } catch {}
      analyserRef.current = null;
      try { sourceRef.current?.disconnect(); } catch {}
      sourceRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      try { audioCtxRef.current?.close(); } catch {}
      audioCtxRef.current = null;
    };
  }, [autoStart]); // Remove start/stop from deps to avoid re-running

  return (
    <div className={className}>
      
      {/* Show start button only when interview is not active */}
      <div className="flex items-center justify-center gap-3">
        <span className="text-sm text-gray-600" aria-live="polite">
          {isInterviewActive && state === "listening" ? "Interview Active" : 
           state === "listening" ? "Listening…" : 
           state === "starting" ? "Starting…" : 
           state === "paused" ? "Paused" : 
           state === "error" ? `Mic error${errorText ? ": " + errorText : ""}` : 
           "Ready"}
        </span>
        
        {/* Only show start button when interview is not active */}
        {!isInterviewActive && (
          <button
            onClick={() => {
              // console.log("AudioRecorder: button clicked, current state:", state);
              if (state === "listening") {
                // console.log("AudioRecorder: calling stop()");
                stop();
              } else if (state === "idle") {
                // console.log("AudioRecorder: calling start()");
                start();
              } else {
                // console.log("AudioRecorder: ignoring click, state is:", state);
              }
            }}
            className="h-10 rounded-full px-4 text-sm font-medium text-white"
            style={{ background: "linear-gradient(90deg, #2563EB, #7C3AED)" }}
            aria-label={state === "listening" ? "Stop microphone" : "Start microphone"}
          >
            {state === "listening" ? "Stop" : state === "starting" ? "Starting..." : "Start"}
          </button>
        )}
      </div>
      {devices.length === 0 && (
        <div className="mt-2 text-xs text-gray-600 flex items-center justify-center gap-2">
          <span>No input devices visible.</span>
          <button
            className="border rounded px-2 py-0.5"
            onClick={async () => {
              try {
                const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                s.getTracks().forEach((t) => t.stop());
              } catch {}
              try {
                const list = await navigator.mediaDevices.enumerateDevices();
                setDevices(list.filter((d) => d.kind === "audioinput"));
              } catch {}
            }}
          >Grant access</button>
          <span>({micPermission})</span>
        </div>
      )}
      <div className="mt-2 flex items-center justify-center gap-2 text-xs">
        <label htmlFor="mic-device">Input</label>
        <select
          id="mic-device"
          className="border rounded px-1 py-0.5"
          value={selectedDeviceId}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
        <button
          className="border rounded px-2 py-0.5"
          onClick={() => navigator.mediaDevices.enumerateDevices().then((list) => setDevices(list.filter((d) => d.kind === "audioinput"))).catch(() => {})}
        >Refresh</button>
      </div>
    </div>
  );
});
