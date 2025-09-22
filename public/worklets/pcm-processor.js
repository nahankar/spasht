// Minimal AudioWorkletProcessor that forwards mono Float32 chunks to the main thread
// for optional resampling/encoding. This removes ScriptProcessorNode usage.

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    // Copy to a transferable buffer to avoid structured clone overhead
    const out = new Float32Array(channel.length);
    out.set(channel);
    this.port.postMessage(out, [out.buffer]);
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);


