export type AsrState = "idle" | "starting" | "listening" | "stopping" | "error";

export interface AsrTranscript {
  text: string;
  isFinal: boolean;
  timestamp: number; // ms epoch
  confidence?: number;
}

export interface AsrProvider {
  start(): Promise<void>;
  stop(): Promise<void>;
  onPartial(cb: (t: AsrTranscript) => void): void;
  onFinal(cb: (t: AsrTranscript) => void): void;
  onState(cb: (state: AsrState) => void): void;
}

export interface AsrFactoryOptions {
  provider: "webspeech" | "transcribe" | "nova";
}
