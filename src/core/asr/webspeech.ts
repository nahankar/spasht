"use client";
import { AsrProvider, AsrState, AsrTranscript } from "./types";

export class WebSpeechAsr implements AsrProvider {
  private recognition: SpeechRecognition | null = null;
  private partialCb: ((t: AsrTranscript) => void) | null = null;
  private finalCb: ((t: AsrTranscript) => void) | null = null;
  private stateCb: ((s: AsrState) => void) | null = null;

  onPartial(cb: (t: AsrTranscript) => void) { this.partialCb = cb; }
  onFinal(cb: (t: AsrTranscript) => void) { this.finalCb = cb; }
  onState(cb: (s: AsrState) => void) { this.stateCb = cb; }

  async start(): Promise<void> {
    const win = window as Window & { webkitSpeechRecognition?: new () => SpeechRecognition; SpeechRecognition?: new () => SpeechRecognition };
    const SR = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!SR) { this.stateCb?.("error"); return; }

    this.stateCb?.("starting");
    this.recognition = new SR();
    this.recognition.lang = "en-US";
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const ts = Date.now();
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const alt = event.results[i][0];
        const payload: AsrTranscript = {
          text: alt.transcript.trim(),
          isFinal: event.results[i].isFinal,
          timestamp: ts,
          confidence: alt.confidence,
        };
        if (payload.isFinal) this.finalCb?.(payload);
        else this.partialCb?.(payload);
      }
    };
    this.recognition.onerror = () => this.stateCb?.("error");
    this.recognition.onend = () => {
      // auto-restart to maintain continuous mode
      try { this.recognition?.start(); } catch {}
    };

    this.recognition.start();
    this.stateCb?.("listening");
  }

  async stop(): Promise<void> {
    this.stateCb?.("stopping");
    try { this.recognition?.stop(); } catch {}
    this.recognition = null;
    this.stateCb?.("idle");
  }
}
