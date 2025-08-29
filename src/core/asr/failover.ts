import type { AsrProvider, AsrState, AsrTranscript } from "./types";

export type ProviderFactory = () => Promise<AsrProvider>;

export class FailoverAsr implements AsrProvider {
  private current: AsrProvider | null = null;
  private onPartialCb: ((t: AsrTranscript) => void) | null = null;
  private onFinalCb: ((t: AsrTranscript) => void) | null = null;
  private onStateCb: ((s: AsrState) => void) | null = null;

  constructor(private factories: ProviderFactory[]) {}

  onPartial(cb: (t: AsrTranscript) => void): void { this.onPartialCb = cb; if (this.current) this.current.onPartial(cb); }
  onFinal(cb: (t: AsrTranscript) => void): void { this.onFinalCb = cb; if (this.current) this.current.onFinal(cb); }
  onState(cb: (state: AsrState) => void): void { this.onStateCb = cb; if (this.current) this.current.onState(cb); }

  private wire(p: AsrProvider) {
    if (this.onPartialCb) p.onPartial(this.onPartialCb);
    if (this.onFinalCb) p.onFinal(this.onFinalCb);
    if (this.onStateCb) p.onState(this.onStateCb);
  }

  private async startWithNextFactory(startIndex: number): Promise<void> {
    if (startIndex >= this.factories.length) throw new Error("No ASR providers available");
    const factory = this.factories[startIndex];
    const prov = await factory();
    this.current = prov;
    this.wire(prov);
    try {
      await prov.start();
    } catch {
      // Try next provider
      await this.startWithNextFactory(startIndex + 1);
    }
  }

  async start(): Promise<void> {
    await this.startWithNextFactory(0);
  }

  async stop(): Promise<void> {
    try { await this.current?.stop(); } catch {}
    this.current = null;
  }
}
