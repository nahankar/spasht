// Enhanced Audio Player Processor with better barge-in handling
// Based on ChatGPT's suggestions for immediate audio buffer clearing

// Keep worklet logs minimal (cannot read env here); set to true only for deep debugging
const DEBUG = false;

class ExpandableBuffer {
    constructor(initialLength = 32768) {
        this.buffer = new Float32Array(initialLength);
        this.writeIndex = 0;
        this.readIndex = 0;
        this.underflowedSamples = 0;
        this.lastBufferWriteTime = Date.now();
        this.isCleared = false; // Track if buffer was cleared for barge-in
        this.clearedSamples = 0; // Number of samples to ignore after a clear (GPT-5 fix)
    }

    write(data) {
        this.lastBufferWriteTime = Date.now();

        // GPT-5 FIX: If we're in the cleared cooldown, decrement clearedSamples and ignore writes
        if (this.clearedSamples > 0) {
            this.clearedSamples = Math.max(0, this.clearedSamples - data.length);
            // If still in cleared window, ignore this write entirely
            if (this.clearedSamples > 0) {
                if (DEBUG) console.log('🔇 Ignoring write during cleared cooldown');
                return;
            }
            // if we've just expired the cooldown, fallthrough and accept writes
        }
        
        // Legacy cleared flag check (keeping for compatibility)
        if (this.isCleared && this.clearedSamples === 0) {
            if (DEBUG) console.log('🔇 Ignoring audio write - buffer cleared for barge-in');
            return;
        }
        
        const requiredLength = this.writeIndex + data.length;
        if (requiredLength > this.buffer.length) {
            const newLength = Math.max(requiredLength, this.buffer.length * 2);
            const newBuffer = new Float32Array(newLength);
            newBuffer.set(this.buffer);
            this.buffer = newBuffer;
        }
        
        this.buffer.set(data, this.writeIndex);
        this.writeIndex += data.length;
        
        // Log significant buffer writes to understand AWS audio pattern
        if (DEBUG && data.length > 1000) {
            console.log(`🎵 Large audio chunk received: ${data.length} samples, total buffered: ${this.writeIndex - this.readIndex}`);
        }
    }

    read(requestedSamples) {
        // GPT-5 FIX: Handle cleared cooldown period
        if (this.clearedSamples > 0) {
            const toConsume = Math.min(requestedSamples, this.clearedSamples);
            this.clearedSamples = Math.max(0, this.clearedSamples - toConsume);
            if (this.clearedSamples === 0) this.isCleared = false;
            return new Float32Array(requestedSamples); // return silence for this frame
        }
        
        const availableSamples = this.writeIndex - this.readIndex;
        
        // Legacy cleared flag check (keeping for compatibility)
        if (this.isCleared) {
            return new Float32Array(requestedSamples); // Return silence
        }
        
        if (availableSamples === 0) {
            this.underflowedSamples += requestedSamples;
            return new Float32Array(requestedSamples);
        }

        const samplesToRead = Math.min(requestedSamples, availableSamples);
        const result = this.buffer.subarray(this.readIndex, this.readIndex + samplesToRead);
        this.readIndex += samplesToRead;

        if (this.readIndex >= this.writeIndex) {
            this.readIndex = 0;
            this.writeIndex = 0;
        }

        if (samplesToRead < requestedSamples) {
            const paddedResult = new Float32Array(requestedSamples);
            paddedResult.set(result, 0);
            this.underflowedSamples += requestedSamples - samplesToRead;
            return paddedResult;
        }

        return result;
    }

    // GPT-5 ENHANCED: Buffer clearing with cooldown to prevent race conditions
    clearBuffer(durationMs = 250) {
        const hadData = this.writeIndex > this.readIndex;
        if (DEBUG) console.log(`🔇 ENHANCED: Buffer cleared immediately - had ${hadData ? 'data' : 'no data'}`);

        // Zero buffer and reset indices
        this.buffer.fill(0);
        this.writeIndex = 0;
        this.readIndex = 0;
        this.underflowedSamples = 0;

        // GPT-5 FIX: Set cooldown in samples (use global sampleRate available in worklet)
        const ms = Math.max(50, durationMs); // minimum 50ms safety
        this.clearedSamples = Math.ceil((typeof sampleRate !== 'undefined' ? sampleRate : 48000) * (ms / 1000));

        // mark flag so read() returns silence while clearedSamples > 0
        this.isCleared = true;
        if (DEBUG) console.log('🔇 ENHANCED: Buffer cleared immediately - had no data');
        
        return hadData;
    }

    getStatus() {
        return {
            buffered: this.writeIndex - this.readIndex,
            underflowed: this.underflowedSamples,
            lastWrite: Date.now() - this.lastBufferWriteTime,
            isCleared: this.isCleared
        };
    }
}

class AudioPlayerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.audioBuffer = new ExpandableBuffer();
        this.isPlaying = false;
        this.minBufferThreshold = 7200; // ~150ms at 48kHz for more stable start
        this.stopThreshold = 960; // Only stop if buffer drops below ~20ms (very aggressive)
        this.restartThreshold = 1920; // Restart when we have ~40ms buffered (faster recovery)
        this.hasNotifiedEmpty = false; // Track if we've notified about empty buffer
        
        this.port.onmessage = (event) => {
            const { type, data } = event.data;
            
            switch (type) {
                case "audio":
                    const audioData = new Float32Array(data);
            // Only log significant audio data chunks to reduce spam
            if (DEBUG && (audioData.length > 3000 || Date.now() % 10000 < 50)) {
                console.log(`🎵 Worklet received audio data: ${audioData.length} samples`);
            }
                    this.audioBuffer.write(audioData);
                    
                    // Smart buffering: different thresholds for starting vs restarting
                    const currentBuffered = this.audioBuffer.getStatus().buffered;
            // Only log buffer status occasionally to reduce spam
            if (DEBUG && Date.now() % 8000 < 50) {
                console.log(`🔍 DEBUG: isPlaying=${this.isPlaying}, buffered=${currentBuffered}, minThreshold=${this.minBufferThreshold}, restartThreshold=${this.restartThreshold}`);
            }
                    
                    if (!this.isPlaying && currentBuffered >= this.minBufferThreshold) {
                        this.isPlaying = true;
                        if (DEBUG) console.log(`🎵 Audio playback started (buffered: ${currentBuffered} samples, threshold: ${this.minBufferThreshold})`);
                    } else if (!this.isPlaying && currentBuffered >= this.restartThreshold) {
                        // Restart with lower threshold if we were playing before
                        this.isPlaying = true;
                        if (DEBUG) console.log(`🎵 Audio playback restarted (buffered: ${currentBuffered} samples, restart threshold: ${this.restartThreshold})`);
                    } else if (!this.isPlaying && currentBuffered > 0) {
            // Only log buffering occasionally to reduce spam
            if (DEBUG && Date.now() % 8000 < 50) {
                console.log(`🎵 Buffering audio... (${currentBuffered}/${this.minBufferThreshold} samples)`);
            }
                    }
                    break;
                    
                case "barge-in":
                case "clear": // Handle both message types
                    if (DEBUG) console.log(`🔇 ENHANCED: ${type} message received - clearing buffer with cooldown`);
                    const durationMs = event.data.durationMs || 250; // GPT-5: Accept cooldown duration
                    const hadData = this.audioBuffer.clearBuffer(durationMs);
                    this.isPlaying = false;
                    
                    // Notify main thread of successful clearing
                    this.port.postMessage({
                        type: "buffer-cleared",
                        hadData: hadData,
                        timestamp: Date.now()
                    });
                    break;
                    
                case "stop":
                    if (DEBUG) console.log('🛑 Stop message received');
                    this.audioBuffer.clearBuffer();
                    this.isPlaying = false;
                    break;
                    
                case "status":
                    this.port.postMessage({
                        type: "status-response",
                        status: this.audioBuffer.getStatus()
                    });
                    break;
                    
                default:
                    if (DEBUG) console.warn(`⚠️ Unknown message type: ${type}`);
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const outputChannel = output[0];

        if (this.isPlaying && outputChannel) {
            const bufferStatus = this.audioBuffer.getStatus();
            const audioData = this.audioBuffer.read(outputChannel.length);
            outputChannel.set(audioData);
            
            // Debug: Log buffer status periodically
            if (DEBUG && Math.random() < 0.001) { // Very rare logging to avoid spam
                console.log(`🔍 PROCESS DEBUG: buffered=${bufferStatus.buffered}, reading=${outputChannel.length}, isPlaying=${this.isPlaying}`);
            }
            
            // Only stop if buffer drops below stop threshold to prevent frequent interruptions
            if (bufferStatus.buffered <= this.stopThreshold && this.isPlaying) {
                this.isPlaying = false;
                if (DEBUG) console.log(`🎵 Audio playback paused - buffer low (buffered: ${bufferStatus.buffered} samples, stop threshold: ${this.stopThreshold})`);
                
                // Notify main thread that audio playback has paused due to low buffer
                this.port.postMessage({
                    type: "playback-paused",
                    reason: "low-buffer",
                    buffered: bufferStatus.buffered,
                    threshold: this.stopThreshold,
                    timestamp: Date.now()
                });
            }
            
            // Notify when buffer is completely empty (audio truly finished)
            if (bufferStatus.buffered === 0 && !this.isPlaying) {
                // Only notify once when buffer becomes empty
                if (!this.hasNotifiedEmpty) {
                    if (DEBUG) console.log(`🎵 Audio buffer completely empty - playback finished`);
                    this.port.postMessage({
                        type: "playback-finished",
                        timestamp: Date.now()
                    });
                    this.hasNotifiedEmpty = true;
                }
            } else if (bufferStatus.buffered > 0) {
                this.hasNotifiedEmpty = false;
            }
        } else if (!this.isPlaying && outputChannel) {
            // Fill with silence when not playing
            outputChannel.fill(0);
        }

        return true;
    }
}

registerProcessor("audio-player-processor", AudioPlayerProcessor);
