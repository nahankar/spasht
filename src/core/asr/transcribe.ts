import type { AsrProvider, AsrState, AsrTranscript } from "./types";

export class TranscribeAsr implements AsrProvider {
  private state: AsrState = "idle";
  private onPartialCb: ((t: AsrTranscript) => void) | null = null;
  private onFinalCb: ((t: AsrTranscript) => void) | null = null;
  private onStateCb: ((s: AsrState) => void) | null = null;

  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readerCancel: (() => void) | null = null;

  onPartial(cb: (t: AsrTranscript) => void): void { this.onPartialCb = cb; }
  onFinal(cb: (t: AsrTranscript) => void): void { this.onFinalCb = cb; }
  onState(cb: (state: AsrState) => void): void { this.onStateCb = cb; }

  private setState(s: AsrState) {
    this.state = s;
    this.onStateCb?.(s);
  }

  async start(): Promise<void> {
    if (this.state === "listening" || this.state === "starting") return;
    this.setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      this.mediaStream = stream;

      const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      const audioCtx = new (AC as typeof AudioContext)();
      this.audioCtx = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      this.processor = processor;
      source.connect(processor);
      processor.connect(audioCtx.destination);

      const { readable, writable } = new TransformStream<Uint8Array>();
      this.writer = writable.getWriter();
      const resp = await fetch("/api/asr/transcribe", { method: "POST", body: readable });

      // Read server results (NDJSON)
      const reader = resp.body?.getReader();
      let cancelled = false;
      this.readerCancel = () => { cancelled = true; try { reader?.cancel(); } catch {} };
      (async () => {
        try {
          const decoder = new TextDecoder();
          let buffer = "";
          while (!cancelled && reader) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 1);
              if (!line) continue;
              try {
                const evt = JSON.parse(line) as { text: string; isFinal: boolean; startTs: number; endTs: number; confidence?: number };
                const t: AsrTranscript = { text: evt.text, isFinal: evt.isFinal, timestamp: evt.endTs, confidence: evt.confidence };
                if (evt.isFinal) this.onFinalCb?.(t); else this.onPartialCb?.(t);
              } catch { /* ignore */ }
            }
          }
        } catch {
          this.setState("error");
        }
      })();

      // Resample to 16k PCM and feed to writer
      const inputRate = audioCtx.sampleRate; // likely 44100/48000
      processor.onaudioprocess = (e) => {
        const inBuf = e.inputBuffer.getChannelData(0);
        const pcm16 = this.floatTo16BitPCM(this.downsample(inBuf, inputRate, 16000));
        if (this.writer) {
          try { this.writer.write(pcm16); } catch {}
        }
      };

      this.setState("listening");
    } catch {
      this.setState("error");
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.setState("stopping");
    try { this.readerCancel?.(); } catch {}
    this.readerCancel = null;
    try { await this.writer?.close(); } catch {}
    this.writer = null;
    try { this.processor?.disconnect(); } catch {}
    this.processor = null;
    try { this.audioCtx?.close(); } catch {}
    this.audioCtx = null;
    try { this.mediaStream?.getTracks().forEach((t) => t.stop()); } catch {}
    this.mediaStream = null;
    this.setState("idle");
  }

  private downsample(input: Float32Array, inputRate: number, targetRate: number): Float32Array {
    if (targetRate === inputRate) return input;
    const ratio = inputRate / targetRate;
    const outLen = Math.floor(input.length / ratio);
    const result = new Float32Array(outLen);
    let offsetResult = 0;
    let offsetInput = 0;
    while (offsetResult < outLen) {
      const nextOffsetInput = Math.floor((offsetResult + 1) * ratio);
      let acc = 0; let count = 0;
      for (let i = offsetInput; i < nextOffsetInput && i < input.length; i++) { acc += input[i]; count++; }
      result[offsetResult] = count > 0 ? acc / count : 0;
      offsetResult++; offsetInput = nextOffsetInput;
    }
    return result;
  }

  private floatTo16BitPCM(input: Float32Array): Uint8Array {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buffer);
  }
}
