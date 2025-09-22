import type { AsrProvider, AsrState, AsrTranscript } from "./types";

// Protocol version for compatibility
const PROTOCOL_VERSION = "1.0.0";

// Barge-in focused debugging
const BARGE_IN_DEBUG = process.env.NEXT_PUBLIC_BARGE_IN_DEBUG === "1";
const bargeLog = (message: string, ...args: any[]) => {
  if (BARGE_IN_DEBUG) console.log(message, ...args);
};
interface ClientMessage {
  version: string; // Protocol version for compatibility
  type: 'start' | 'audioStart' | 'audio' | 'stop' | 'pause' | 'resume' | 'ping' | 'cancel_current_turn';
  timestamp: number; // For latency tracking and debugging
  systemPrompt?: string;
  conversationHistory?: Array<{role: 'USER' | 'ASSISTANT', content: string}>;
  data?: string; // For audio data
  sampleRate?: number;
  sequenceId?: number; // For message ordering and deduplication
  reason?: string; // For cancel_current_turn
}

interface ServerMessage {
  version?: string; // Protocol version for compatibility
  type: 'started' | 'promptStartReady' | 'promptReady' | 'partial' | 'final' | 'audio' | 'error' | 'stopped' | 'contentEnd' | 'contentStart' | 'pong' | 'streamComplete' | 'streamReady' | 'paused' | 'resumed' | 'textOutput' | 'userTranscription' | 'tokenUsage';
  timestamp?: number;
  message?: string;
  text?: string;
  audio?: string; // base64 encoded audio response
  confidence?: number;
  error?: string;
  stopReason?: string;
  data?: any; // For contentStart data or tokenUsage data
  role?: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  content?: string;
  latency?: number; // Round-trip time for pings
}

// CHATGPT APPROACH: Cancel Current Turn, Keep Session Alive
// Toggle verbose logging via NEXT_PUBLIC_DEBUG=1
const SHOULD_DEBUG = (typeof window !== 'undefined' && (window as any).NEXT_PUBLIC_DEBUG === '1') ||
                     (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_DEBUG === '1');

export class NovaWebSocketAsr implements AsrProvider {
  private state: AsrState = "idle";
  private onPartialCb: ((t: AsrTranscript) => void) | null = null;
  private onFinalCb: ((t: AsrTranscript) => void) | null = null;
  private onStateCb: ((s: AsrState) => void) | null = null;
  private onBargeInCb: (() => void) | null = null;
  private onTokenUsageCb: ((tokenData: any) => void) | null = null;

  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private ws: WebSocket | null = null;
  private audioOutputQueue: AudioBuffer[] = [];
  private audioOutputContext: AudioContext | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private inactivityDelay: number = 5000; // CHATGPT FIX: Increased from 1.5s to 5s to allow more time after barge-in
  
  // Timing tracking for debugging
  private questionStartTime: number = 0;
  private responseStartTime: number = 0;
  private interruptionTime: number = 0;
  
  // Barge-in volume tracking for logging
  private bargeInVolume: number = 0;
  
  // Audio start notification tracking
  private hasAudioStartNotified: boolean = false;
  
  // Text buffering for synchronized text/audio presentation
  private bufferedTextResponse: AsrTranscript | null = null;
  private hasAudioStarted: boolean = false;
  private audioStartTime: number = 0; // Track when audio playback starts

  // FIXED: Track initialization state
  private isSessionStarted = false;
  private isPromptStartReady = false;
  private isNovaReady = false;
  private isAudioStarted = false;
  
  // Barge-in support - track if we're in conversation mode
  private isInConversation: boolean = false;
  
  // CHATGPT APPROACH: Simplified barge-in without stream restarts
  private independentMicStream: MediaStream | null = null;
  private independentAudioContext: AudioContext | null = null;
  private independentAnalyzer: AnalyserNode | null = null;
  private independentMicMonitorActive = false;
  private bargeInMuted = false; // NEW: Mute flag to disable barge-in detection
  private audioInputMuted = false; // NEW: Complete audio input mute (like real calls)
  private independentVoiceThreshold = 0.25; // Increased to prevent false positives from AI audio bleed
  private backgroundNoiseLevel = 0.0;
  private consecutiveVoiceDetections = 0;
  private consecutiveSilenceDetections = 0; // Track silence after barge-in
  private bargeInTriggered = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  
  // Step 1: Hangover period to prevent multiple triggers
  private bargeInHangover = false;
  private hangoverTimeout: NodeJS.Timeout | null = null;
  
  // Step 3: Performance metrics
  private vadMetrics = {
    firstVoiceDetectedAt: 0,
    bargeInConfirmedAt: 0,
    cancelSentAt: 0,
    turnCancelledAt: 0
  };
  
  // CHATGPT APPROACH: Track current turn state
  private currentTurnCancelled = false;
  private isPostBargeIn = false; // CHATGPT FIX: Disable inactivity timer after barge-in
  
  // CRITICAL FIX: Global role tracking like reference app
  private currentRole: 'USER' | 'ASSISTANT' | null = null;
  private shouldContinueListening: boolean = false;
  
  // Reconnection and reliability features
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval = 30000;
  private lastPingTime = 0;
  private sequenceCounter = 0;
  private isReconnecting = false;

  onPartial(cb: (t: AsrTranscript) => void): void { 
    this.onPartialCb = cb; 
  }
  
  onFinal(cb: (t: AsrTranscript) => void): void { 
    this.onFinalCb = cb; 
  }
  
  onState(cb: (state: AsrState) => void): void { 
    this.onStateCb = cb; 
  }

  onTokenUsage(cb: (tokenData: any) => void): void {
    this.onTokenUsageCb = cb;
  }

  // Add callback for barge-in events
  onBargeIn(cb: () => void): void {
    this.onBargeInCb = cb;
  }

  private setState(s: AsrState) {
    this.state = s;
    
    // Reset audioStart flag when transitioning to listening state for new conversation turn
    if (s === "listening") {
      this.hasAudioStartNotified = false;
    }
    
    this.onStateCb?.(s);
  }

  async start(conversationHistory?: Array<{role: 'USER' | 'ASSISTANT', content: string}>): Promise<void> {
    if (this.state === "listening" || this.state === "starting") {
      return;
    }
    
    // Start timing for user question
    this.questionStartTime = Date.now();

    // Reset text buffering state for new conversation
    this.hasAudioStarted = false;
    this.bufferedTextResponse = null;
    this.hasAudioStartNotified = false;
    this.isPostBargeIn = false; // CHATGPT FIX: Reset post-barge-in state for new conversation
    
    this.setState("starting");
    
    try {
      // Connect to Nova WebSocket server
      await this.connectWebSocket();
      
      // Set up audio capture
      await this.setupAudioCapture();
      
      // FIXED: Start proper initialization sequence with conversation history
      await this.initializeSession(conversationHistory);
      
      this.setState("listening");

    } catch (error) {
      console.error('Failed to start Nova Sonic ASR:', error);
      this.setState("error");
      throw error;
    }
  }

  resetForNewTurn(): void {
    this.hasAudioStartNotified = false;
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket('ws://localhost:8081');
        
        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          this.handleServerMessage(event.data);
        };
        
        this.ws.onerror = (error) => {
          console.error('Nova WebSocket error:', error);
          reject(new Error('Failed to connect to Nova WebSocket server'));
        };
        
        this.ws.onclose = (event) => {
          console.log('🔌 WebSocket connection closed:', event.code, event.reason);
          this.clearHeartbeatTimer();
          
          if (this.state !== "idle" && this.state !== "stopping" && !this.isReconnecting) {
            console.log('🔄 Unexpected disconnect - attempting reconnection');
            this.handleReconnection();
          }
          if (this.state === "listening") {
            this.setState("error");
          }
        };
        
      } catch (error) {
        reject(error);
      }
    });
  }

  private async initializeSession(conversationHistory?: Array<{role: 'USER' | 'ASSISTANT', content: string}>): Promise<void> {
    
    // Build system prompt with conversation history if available
    let systemPrompt = 'You are a helpful and friendly assistant.';
    
    if (conversationHistory && conversationHistory.length > 0) {
      console.log(`📜 Including ${conversationHistory.length} previous messages in context`);
      const contextSummary = conversationHistory
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
      
      systemPrompt = `You are a helpful and friendly assistant. Here is our previous conversation context:\n\n${contextSummary}\n\nPlease continue our conversation naturally, remembering the context above.`;
    }
    
    // CHATGPT APPROACH: Simple initialization
    this.sendMessage({ 
      type: 'start',
      systemPrompt: systemPrompt
    });
    
    // Wait for session to be started and ready
    await this.waitForSessionStarted();
    
  }

  private async waitForSessionStarted(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isSessionStarted) {
        resolve();
        return;
      }
      
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for session to start'));
      }, 10000);
      
      const checkInterval = setInterval(() => {
        if (this.isSessionStarted) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  private async setupAudioCapture(): Promise<void> {
    // console.log('🎤 setupAudioCapture called');
    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true,
          sampleRate: 16000,
          channelCount: 1
        }, 
        video: false 
      });
      
      // console.log('🎤 Got media stream:', stream.active, 'tracks:', stream.getTracks().length);
      
      this.mediaStream = stream;

      // Set up audio processing
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new (AudioContextClass as typeof AudioContext)({ sampleRate: 16000 });
      
      // Resume audio context if needed
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      
      const source = this.audioCtx.createMediaStreamSource(stream);
      
      // Load AudioWorklet processor
      await this.audioCtx.audioWorklet.addModule('/worklets/transcribe-processor.js');
      
      const workletNode = new AudioWorkletNode(this.audioCtx, 'transcribe-processor');
      this.workletNode = workletNode;
      source.connect(workletNode);
      
      // Handle audio data from the worklet
      workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audiodata') {
          const inputData = event.data.buffer;
          
          // CHATGPT APPROACH: Simplified audio sending logic
          const wsReady = this.ws && this.ws.readyState === WebSocket.OPEN;
          const isListeningOrConversation = (this.state === "listening" || (this.isInConversation && this.shouldContinueListening));
          const shouldSendAudio = wsReady && this.isNovaReady && this.isAudioStarted && isListeningOrConversation && !this.currentTurnCancelled && !this.audioInputMuted;
          
              
          if (shouldSendAudio) {
            
            // 🎤 SEND AUDIO START MESSAGE - Notify server that user is speaking
            if (!this.hasAudioStartNotified) {
              // console.log(`🎤 Sending audio_start_signal to server`);
              if (this.state === "listening" || (this.isInConversation && this.shouldContinueListening)) {
                console.log('✅ CONDITIONS MET: Sending audio_start_signal message');
                this.sendMessage({ type: 'audioStart' });
                this.hasAudioStartNotified = true;
                
            // CHATGPT FIX: User started speaking, exit post-barge-in state and reset cancellation
            if (this.isPostBargeIn || this.currentTurnCancelled) {
              this.isPostBargeIn = false;
              this.currentTurnCancelled = false; // CRITICAL: Reset cancellation so audio is processed
              console.log('🎯 CHATGPT: User started speaking - exiting post-barge-in state and reset turn cancellation, inactivity timer re-enabled');
            }
              } else {
                console.log('❌ CONDITIONS NOT MET: Not sending audio_start_signal');
              }
            }
            
            // Reset inactivity timer only if actively listening (not during AI responses, post-barge-in, cancelled turns, or when muted)
            // Reduced logging frequency for inactivity timer checks - only log every 5 seconds
            const shouldLogTimer = Date.now() % 5000 < 50;
            if (shouldLogTimer) {
              console.log(`🔍 INACTIVITY TIMER CHECK: state=${this.state}, isPostBargeIn=${this.isPostBargeIn}, currentTurnCancelled=${this.currentTurnCancelled}, audioMuted=${this.audioInputMuted}`);
            }
            
            if (this.state === "listening" && !this.isPostBargeIn && !this.currentTurnCancelled && !this.audioInputMuted) {
              if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
              this.inactivityTimer = setTimeout(() => {
                console.log(`🔍 INACTIVITY TIMER TRIGGERED: state=${this.state}, isPostBargeIn=${this.isPostBargeIn}, currentTurnCancelled=${this.currentTurnCancelled}`);
                console.log('Inactivity detected, stopping audio stream.');
                this.stop();
              }, this.inactivityDelay);
              if (shouldLogTimer) {
                console.log('🔍 INACTIVITY TIMER SET: Will trigger in', this.inactivityDelay, 'ms');
              }
            } else if (this.isPostBargeIn || this.currentTurnCancelled || this.audioInputMuted) {
              // CHATGPT FIX: Clear any existing inactivity timer after barge-in
              if (this.inactivityTimer) {
                clearTimeout(this.inactivityTimer);
                this.inactivityTimer = null;
                if (shouldLogTimer) {
                  console.log('🔍 INACTIVITY TIMER CLEARED: Due to post-barge-in or cancelled turn');
                }
              }
              if (shouldLogTimer) {
                const reason = this.audioInputMuted ? 'audio muted' : (this.isPostBargeIn ? 'post-barge-in' : 'cancelled turn');
                console.log(`🎯 INACTIVITY TIMER DISABLED: ${reason} - user has unlimited time`);
              }
            } else {
              if (shouldLogTimer) {
                console.log(`🔍 INACTIVITY TIMER SKIPPED: Conditions not met for timer reset`);
              }
            }
            
            // Convert to 16-bit PCM and send to Nova
            const pcmData = this.floatToPCM16(inputData);
            const base64Data = this.arrayBufferToBase64(pcmData.buffer as ArrayBuffer);
            
            this.sendMessage({
              type: 'audio',
              data: base64Data,
              sampleRate: 16000
            });
          } else {
            // Audio is blocked - log the reason (only occasionally to avoid spam)
            if (Date.now() % 2000 < 50) { // Log every 2 seconds
              const reasons = [];
              if (!wsReady) reasons.push('websocket not ready');
              if (!this.isNovaReady) reasons.push('Nova not ready');
              if (!this.isAudioStarted) reasons.push('audio not started');
              if (!isListeningOrConversation) reasons.push('not in listening state');
              if (this.currentTurnCancelled) reasons.push('turn cancelled');
              if (this.audioInputMuted) reasons.push('🔇 AUDIO MUTED');
              
              console.log(`🚫 Audio blocked: ${reasons.join(', ')}`);
            }
          }
        }
      };
      
      // Set up audio output context for Nova responses (24kHz for Nova Sonic)
      this.audioOutputContext = new (AudioContextClass as typeof AudioContext)({
        sampleRate: 24000
      });

      // Initialize AudioWorklet for buffered audio playback
      await this.setupAudioWorklet();
      
    } catch (error) {
      console.error('Failed to setup audio capture:', error);
      throw error;
    }
  }

  private async setupAudioWorklet(): Promise<void> {
    if (!this.audioOutputContext) {
      throw new Error('Audio output context not initialized');
    }

    try {
      // Load the ENHANCED audio worklet processor with better barge-in handling
      await this.audioOutputContext.audioWorklet.addModule('/worklets/audio-player-processor-enhanced.js');
      
      // Create the worklet node
      this.audioWorkletNode = new AudioWorkletNode(this.audioOutputContext, 'audio-player-processor');
      
      // Connect to destination
      this.audioWorkletNode.connect(this.audioOutputContext.destination);
      
      // Listen for audio worklet events
      this.audioWorkletNode.port.onmessage = (event) => {
        const { type, reason, buffered, timestamp } = event.data;
        
        switch (type) {
          case 'playback-paused':
            console.log(`🎵 Audio worklet: Playback paused (${reason}) - buffered: ${buffered} samples`);
            break;
            
          case 'playback-finished':
            console.log(`🎵 Audio worklet: Audio playback completely finished at ${new Date(timestamp).toLocaleTimeString()}`);
            // Audio is truly finished, safe to proceed with next steps
            break;
            
          case 'buffer-cleared':
            console.log(`🔇 Audio worklet: Buffer cleared for barge-in`);
            break;
            
          case 'stop-complete':
            console.log(`🛑 Audio worklet: Stop completed - all audio sources stopped`);
            break;
            
          default:
            console.log(`🎵 Audio worklet event: ${type}`, event.data);
        }
      };
      
      // console.log('🎵 AudioWorklet initialized successfully');
    } catch (error) {
      console.error('❌ Failed to setup AudioWorklet:', error);
      throw error;
    }
  }

  private getMessageInfo(message: ServerMessage): string {
    switch (message.type) {
      case 'final':
        return ` - "${message.text?.substring(0, 50) || ''}${message.text && message.text.length > 50 ? '...' : ''}"`;
      case 'audio':
        return ` - ${message.audio?.length || 0} bytes`;
      case 'error':
        return ` - ${message.error || 'unknown error'}`;
      case 'contentEnd':
        return ` - ${message.stopReason || 'END_TURN'}`;
      case 'started':
      case 'promptStartReady':
      case 'promptReady':
      case 'stopped':
      case 'streamComplete':
      case 'streamReady':
      case 'info':
        return ` - ${message.message || ''}`;
      default:
        return '';
    }
  }

  private handleServerMessage(data: string) {
    try {
      const message: ServerMessage = JSON.parse(data);
      
      switch (message.type) {
        case 'started':
          this.isSessionStarted = true;
          this.isNovaReady = true;
          this.isAudioStarted = true;
          // console.log('🔄 Stream started - ready for audio');
          break;
          
        case 'promptStartReady':
          this.isPromptStartReady = true;
          break;
          
        case 'promptReady':
          this.isNovaReady = true;
          this.isAudioStarted = true;
          break;
          
        case 'contentStart':
          if (message.data) {
            // console.log('🏷️ Client received contentStart:', message.data);
            
            if (message.data.type === 'TEXT' && message.data.role) {
              this.currentRole = message.data.role;
              // console.log(`🏷️ SET GLOBAL ROLE: ${this.currentRole} for ${message.data.type} content`);
              
              // GPT-5 FIX: Reset cancelled turn when AI starts new response after barge-in
              if (this.currentRole === 'ASSISTANT' && this.currentTurnCancelled && this.isPostBargeIn) {
                console.log('🎯 GPT-5 FIX: New AI turn starting - resetting cancelled state from barge-in');
                this.currentTurnCancelled = false;
                this.isPostBargeIn = false;
              }
            } else if (message.data.type === 'AUDIO') {
              // Reset audio sync flags when new audio content starts
              this.hasAudioStarted = false;
              console.log(`🎵 Reset audio sync flags for new audio content`);
            }
          }
          break;
          
        case 'partial':
          if (message.text && this.onPartialCb && !this.currentTurnCancelled) {
            const partialRole = this.currentRole || (message as any).role || undefined;
            console.log(`🏷️ USING ROLE FOR PARTIAL MESSAGE: ${partialRole}`);
            
            if (this.hasAudioStarted) {
              setTimeout(() => {
                if (this.onPartialCb && !this.currentTurnCancelled) {
                  this.onPartialCb({
                    text: message.text,
                    confidence: message.confidence || 0.9,
                    isFinal: false,
                    timestamp: Date.now(),
                    role: partialRole
                  });
                }
              }, 200);
            } else {
              this.onPartialCb({
                text: message.text,
                confidence: message.confidence || 0.9,
                isFinal: false,
                timestamp: Date.now(),
                role: partialRole
              });
            }
          }
          break;
          
        case 'final':
          const textTime = Date.now();
          const textDelay = textTime - this.questionStartTime;
          
          if (message.text && !this.currentTurnCancelled) {
            const finalRole = this.currentRole || (message as any).role || undefined;
            console.log(`🏷️ USING ROLE FOR FINAL MESSAGE: ${finalRole}`);
            
            const transcript: AsrTranscript = {
              text: message.text,
              confidence: message.confidence || 1.0,
              isFinal: true,
              timestamp: Date.now(),
              role: finalRole
            };
            
            if (this.hasAudioStarted && this.onFinalCb) {
              this.onFinalCb(transcript);
            } else {
              this.bufferedTextResponse = transcript;
            }
          }
          break;
          
        case 'audio':
          // Track first audio response timing
          if (this.responseStartTime === 0) {
            this.responseStartTime = Date.now();
          }
          
          // CHATGPT APPROACH: Only play audio if turn not cancelled
          if (!this.currentTurnCancelled) {
            // Mark audio as started and release any buffered text with sync delay
            if (!this.hasAudioStarted) {
              this.hasAudioStarted = true;
              this.audioStartTime = Date.now();
              console.log(`🎤 🕒 AUDIO START TIME SET: ${this.audioStartTime} (${new Date().toLocaleTimeString()})`);
              
              // Enter conversation mode for barge-in support
              this.isInConversation = true;
              this.shouldContinueListening = true;
              
              // Reset barge-in flag for new conversation
              this.bargeInTriggered = false;
              
              // Start instant barge-in detection
              this.setupInstantBargeInDetection();
              
              // Release buffered text response with sync delay
              if (this.bufferedTextResponse && this.onFinalCb) {
                if (SHOULD_DEBUG) console.log('📝 Scheduling text release to sync with audio playback...');
                setTimeout(() => {
                  if (this.bufferedTextResponse && this.onFinalCb && !this.currentTurnCancelled) {
                    if (SHOULD_DEBUG) console.log('📝 Releasing buffered text response (synced):', this.bufferedTextResponse);
                    this.onFinalCb(this.bufferedTextResponse);
                    this.bufferedTextResponse = null;
                  }
                }, 400);
              }
            }
            
            if (message.audio) {
              this.playAudioResponse(message.audio);
            } else {
              console.warn('⚠️ Audio message received but no audio data');
            }
          } else {
            console.log('🎯 CHATGPT: Ignoring audio - current turn was cancelled');
          }
          break;

        case 'textOutput':
          if (message.content && this.onFinalCb && !this.currentTurnCancelled) {
            const transcript: AsrTranscript = {
              text: message.content,
              confidence: 1.0,
              isFinal: true,
              timestamp: Date.now(),
              role: message.role || this.currentRole || 'ASSISTANT'
            };
            this.onFinalCb(transcript);
          }
          break;
          
        case 'userTranscription':
          // RED console log for user speech with barge-in volume
          const volumeInfo = this.bargeInVolume > 0 ? ` (volume: ${this.bargeInVolume.toFixed(4)})` : '';
          console.log(`%c📥 USER SAID: "${message.text}" at ${new Date().toLocaleTimeString()}.${Date.now() % 1000}${volumeInfo}`, 'color: red; font-weight: bold; font-size: 14px; background: lightblue;');
          // console.log('📥 User transcription received from Nova Sonic:', message.text);
          if (message.text && this.onFinalCb) {
            const transcript: AsrTranscript = {
              text: message.text,
              confidence: message.confidence || 1.0,
              isFinal: true,
              timestamp: Date.now(),
              role: 'USER'
            };
            
            // console.log('📝 Sending userTranscription to transcript handler:', transcript.text);
            this.onFinalCb(transcript);
          }
          break;

        case 'contentEnd':
          if (message.stopReason) {
            if (!['END_TURN', 'PARTIAL_TURN'].includes(message.stopReason)) {
              console.log(`🔚 Content end: ${message.stopReason}`);
            }
            
            // CRITICAL FIX: Reset audio flags when AI turn ends to stop barge-in monitoring
            if (message.stopReason === 'END_TURN' || message.stopReason === 'INTERRUPTED') {
              console.log('🎯 CHATGPT: AI turn ended - resetting audio flags and disabling barge-in monitoring');
              this.hasAudioStarted = false;
              this.audioStartTime = 0;
              this.independentMicMonitorActive = false;
            }
            
            // CHATGPT APPROACH: Handle both END_TURN and INTERRUPTED to ensure proper state reset
            if (message.stopReason === 'END_TURN') {
              // Normal end of AI response - ready for next turn
              this.currentTurnCancelled = false;
              console.log('🎯 CHATGPT: AI turn completed normally - ready for next turn');
            } else if (message.stopReason === 'INTERRUPTED') {
              // CRITICAL FIX: Reset state after Nova Sonic interruption to ensure we can receive new input
              this.currentTurnCancelled = false;
              this.isPostBargeIn = false;
              
              // GPT-5 SYNC: Treat AWS INTERRUPTED as local barge-in confirmation if we hadn't confirmed
              if (!this.bargeInTriggered) {
                console.log('🤝 GPT-5 SYNC: AWS reported INTERRUPTED - handling as local barge-in confirmation');
                this.triggerBargeIn();
              }

              // CRITICAL: Clear any existing inactivity timer after interruption
              if (this.inactivityTimer) {
                clearTimeout(this.inactivityTimer);
                this.inactivityTimer = null;
                console.log('🔍 INACTIVITY TIMER CLEARED: Due to Nova Sonic interruption - preventing premature timeout');
              }
              
              this.setState("listening");
              console.log('🎯 CHATGPT: AI turn interrupted by Nova Sonic - resetting to listening state for new input');
            }
          }
          break;

        case 'stopped':
          console.log(`📊 [${new Date().toLocaleTimeString()}] 🔚 CONVERSATION ENDED`);
          console.log('🔍 DEBUG: Stopped message details:', message.message);
          console.log('🔍 DEBUG: Current state before cleanup - isInConversation:', this.isInConversation, 'hasAudioStarted:', this.hasAudioStarted, 'currentTurnCancelled:', this.currentTurnCancelled);
          
          // Reset timing variables for next conversation
          this.questionStartTime = 0;
          this.responseStartTime = 0;
          this.interruptionTime = 0;
          
          // Reset text buffering state
          this.hasAudioStarted = false;
          this.bufferedTextResponse = null;
          
          this.cleanup();
          this.setState("idle");
          break;

        case 'error':
          console.error('Nova Sonic error:', message.error);
          
          // Check if this is a recoverable AWS stream error or restart error
          if (message.error?.includes('response stream') || 
              message.error?.includes('model stream') ||
              message.error?.includes('ModelStreamErrorException') ||
              message.error?.includes('unexpected error during processing') ||
              message.error?.includes('The first event must be a SessionStart event') ||
              message.error?.includes('Stream processing error') ||
              message.error?.includes('ValidationException')) {
            console.log('🔄 Detected recoverable AWS error - maintaining session...');
            console.log('💡 This is a temporary AWS service issue, not a code problem');
            
            // Clear any inactivity timer to prevent automatic stop
            if (this.inactivityTimer) {
              clearTimeout(this.inactivityTimer);
              this.inactivityTimer = null;
              console.log('🔍 INACTIVITY TIMER CLEARED: Due to AWS service error');
            }
            
            // Reset conversation state but keep session alive
            this.isInConversation = false;
            this.hasAudioStarted = false;
            this.bufferedTextResponse = null;
            this.currentTurnCancelled = false;
            
            // For ValidationException errors, request immediate server restart
            if (message.error?.includes('ValidationException') || message.error?.includes('The first event must be a SessionStart event')) {
              console.log('🔄 ValidationException detected - requesting immediate server restart...');
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                  type: 'force_restart',
                  reason: 'ValidationException recovery'
                }));
              }
            }
            
            // Stay in listening state to allow recovery
            this.setState("listening");
            console.log('🔄 AWS error handled - staying in listening state for recovery');
            
            // GPT-5 SYNC: If we had voice detections during ModelStreamError, treat as barge-in
            if (message.error?.includes('ModelStreamErrorException') && !this.bargeInTriggered && this.consecutiveVoiceDetections > 0) {
              console.log('🤝 GPT-5 SYNC: ModelStreamError during voice detection - confirming barge-in');
              this.triggerBargeIn();
            }
          } else {
            this.setState("error");
          }
          break;
          
        case 'streamComplete':
          console.log('🎯 Stream completed normally:', message.message);
          
          setTimeout(() => {
            console.log('🔄 Audio playback should be complete, resetting conversation state...');
            
            this.isInConversation = false;
            this.bufferedTextResponse = null;
            this.currentRole = null;
            this.currentTurnCancelled = false;
            
            this.isNovaReady = false;
            this.isAudioStarted = false;
            
            this.setState("listening");
          }, 2000);
          
          break;
          
        case 'paused':
          this.setState("paused");
          break;
          
        case 'resumed':
          this.setState("listening");
          break;
          
        case 'streamReady':
          if (SHOULD_DEBUG) console.log('🎯 Stream ready - waiting for any remaining audio to complete...');
          
          setTimeout(() => {
            if (SHOULD_DEBUG) console.log('🔄 Setting state to listening after stream ready...');
            this.setState("listening");
            
            setTimeout(() => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isSessionStarted) {
                if (SHOULD_DEBUG) console.log('🎤 Re-activating audio input for new question...');
                this.sendMessage({ type: 'audioStart' });
              }
            }, 100);
          }, 1000);
          break;
          
        case 'info':
          break;
          
        case 'pong':
          this.handlePong(message);
          break;
          
        case 'tokenUsage':
          if (message.data && this.onTokenUsageCb) {
            console.log('💰 Token usage received:', message.data);
            this.onTokenUsageCb(message.data);
          }
          break;
      }
      
    } catch (error) {
      console.error('Error handling server message:', error);
    }
  }

  private async playAudioResponse(base64Audio: string) {
    try {
      if (!this.audioWorkletNode) {
        console.error('❌ No audioWorkletNode available for playback');
        return;
      }
      
      // GPT-5 FIX: Only skip audio for the SAME cancelled turn, not new AI responses
      // Reset currentTurnCancelled when AI starts a new response after barge-in
      if (this.currentTurnCancelled && this.isPostBargeIn) {
        console.log('🎯 GPT-5 FIX: Resetting cancelled turn for new AI response after barge-in');
        this.currentTurnCancelled = false;
        this.isPostBargeIn = false;
      }
      
      // Now check if current turn is still cancelled (shouldn't be after reset)
      if (this.currentTurnCancelled) {
        console.log('🎯 CHATGPT: Skipping audio playback - turn was cancelled');
        return;
      }
      
      // Convert base64 to Float32Array like the reference implementation
      const audioData = this.base64ToFloat32Array(base64Audio);
      
      // Send audio data to the worklet for buffered playback
      this.audioWorkletNode.port.postMessage({
        type: "audio",
        data: audioData,
      });
      
    } catch (error) {
      console.error('❌ Error playing audio response:', error);
    }
  }

  private sendMessage(messageData: Partial<ClientMessage>) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const message: ClientMessage = {
          version: PROTOCOL_VERSION,
          timestamp: Date.now(),
          sequenceId: ++this.sequenceCounter,
          ...messageData,
          type: messageData.type as ClientMessage['type']
        };
        
        this.ws.send(JSON.stringify(message));
      } else {
        console.warn('⚠️ WebSocket not ready, cannot send message:', messageData.type);
        if (!this.isReconnecting && this.state !== "idle") {
          this.handleReconnection();
        }
      }
    } catch (error) {
      console.error('❌ Error sending message:', error);
    }
  }

  private floatToPCM16(float32Array: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return pcm16;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private base64ToFloat32Array(base64String: string): Float32Array {
    try {
      const binaryString = window.atob(base64String);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      return float32Array;
    } catch (error) {
      console.error('Error in base64ToFloat32Array:', error);
      throw error;
    }
  }

  pause() {
    console.log('Pausing Nova Sonic interview session');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendMessage({ type: 'pause' });
    }
  }

  async resume(conversationHistory?: Array<{role: 'USER' | 'ASSISTANT', content: string}>) {
    console.log('Resuming Nova Sonic interview session with conversation history');
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('🔄 WebSocket closed after pause, restarting entire Nova Sonic session...');
      
      this.isSessionStarted = false;
      this.isNovaReady = false;
      this.isAudioStarted = false;
      
      await this.start(conversationHistory);
      console.log('✅ Nova Sonic session restarted successfully after resume with context');
    } else {
      this.sendMessage({ 
        type: 'resume',
        conversationHistory: conversationHistory 
      });
    }
  }

  // NEW: Complete audio input mute (like real calls)
  setAudioInputMuted(muted: boolean): void {
    this.audioInputMuted = muted;
    this.bargeInMuted = muted; // Also disable barge-in when audio is muted
    
    // CRITICAL FIX: Clear inactivity timer when muting to prevent session termination
    if (muted && this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
      console.log('🔍 INACTIVITY TIMER CLEARED: Due to audio muting - session preserved');
    }
    
    console.log(`🔇 Audio input ${muted ? 'MUTED' : 'UNMUTED'} - ${muted ? 'no audio will be sent to server' : 'audio transmission resumed'}`);
  }
  
  isAudioInputMuted(): boolean {
    return this.audioInputMuted;
  }
  
  // Legacy method for backward compatibility
  setBargeInMuted(muted: boolean): void {
    this.setAudioInputMuted(muted);
  }
  
  isBargeInMuted(): boolean {
    return this.audioInputMuted;
  }

  async stop(): Promise<void> {
    console.log('🛑 STOP() METHOD CALLED - terminating entire conversation session');
    console.trace('🔍 STOP() CALL STACK:');
    this.setState("stopping");
    
    // Clear all timers
    this.clearReconnectionTimer();
    this.clearHeartbeatTimer();
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    
    // Stop barge-in monitoring
    this.stopIndependentMicMonitoring();
    
    // Stop TTS
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      console.log('🔇 Stopped all TTS speech');
    }
    
    // Send stop message to server and close WebSocket
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: 'stop' });
        // Give server a moment to process the stop message
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Force close WebSocket connection
      this.ws.close(1000, 'User initiated stop');
      this.ws = null;
      console.log('🔌 WebSocket connection closed');
    }
    
    // Clean up audio resources
    this.cleanup();
    
    // Reset all flags
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.isInConversation = false;
    this.isSessionStarted = false;
    this.isPromptStartReady = false;
    this.isNovaReady = false;
    this.isAudioStarted = false;
    this.currentTurnCancelled = false;
    this.isPostBargeIn = false;
    this.bargeInTriggered = false;
    
    // Set final state
    this.setState("idle");
    console.log('✅ CONVERSATION SESSION COMPLETELY TERMINATED');
  }

  enableConversationMode(): void {
    console.log('🔄 Conversation mode enabled externally');
    this.isInConversation = true;
    this.shouldContinueListening = true;
  }

  disableConversationMode(): void {
    console.log('🔄 Conversation mode disabled externally');
    this.isInConversation = false;
    this.shouldContinueListening = false;
  }

  isInConversationMode(): boolean {
    return this.isInConversation;
  }

  private async setupInstantBargeInDetection(): Promise<void> {
    try {
      console.log('🎤 ⚡ Setting up INSTANT barge-in detection (ChatGPT approach)...');
      
      this.independentMicStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        } 
      });
      
      console.log('🎤 ✅ Microphone configured with echo cancellation and noise suppression');
      
      this.independentAudioContext = new AudioContext();
      const source = this.independentAudioContext.createMediaStreamSource(this.independentMicStream);
      
      this.independentAnalyzer = this.independentAudioContext.createAnalyser();
      this.independentAnalyzer.fftSize = 512;
      this.independentAnalyzer.smoothingTimeConstant = 0.3;
      source.connect(this.independentAnalyzer);
      
      this.independentMicMonitorActive = true;
      this.backgroundNoiseLevel = 0.01;
      this.consecutiveVoiceDetections = 0;
      
      this.vadMetrics = {
        firstVoiceDetectedAt: 0,
        bargeInConfirmedAt: 0,
        cancelSentAt: 0,
        turnCancelledAt: 0
      };
      
      this.startInstantVoiceDetection();
      
      console.log('✅ INSTANT barge-in detection active (ChatGPT approach)');
      bargeLog(`🎤 📊 INSTANT: Initial state - inConversation:${this.isInConversation}, state:${this.state}, bargeTriggered:${this.bargeInTriggered}`);
    } catch (error) {
      console.error('❌ Failed to setup instant barge-in detection:', error);
    }
  }
  
  private startInstantVoiceDetection(): void {
    if (!this.independentAnalyzer || !this.independentMicMonitorActive) return;
    
    const bufferLength = this.independentAnalyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    this.monitorInterval = setInterval(() => {
      if (!this.independentMicMonitorActive || !this.independentAnalyzer || this.bargeInMuted) {
        if (this.monitorInterval) {
          clearInterval(this.monitorInterval);
          this.monitorInterval = null;
        }
        return;
      }
      
      const isAudioPlaying = this.audioWorkletNode && this.hasAudioStarted && this.isInConversation;
      const timeSinceAudioStart = this.hasAudioStarted ? Date.now() - (this.audioStartTime || 0) : 0;
      const isInitialPeriod = timeSinceAudioStart < 200; // Reduced to 200ms for faster barge-in response
      
      // DEBUG: Log initial period calculation when it should be changing
      if (this.hasAudioStarted && isInitialPeriod && timeSinceAudioStart > 100) {
        console.log(`🎤 ⏰ INITIAL PERIOD DEBUG: timeSince=${timeSinceAudioStart}ms, audioStartTime=${this.audioStartTime}, now=${Date.now()}, isInitial=${isInitialPeriod}`);
      }
      // Monitor during AI audio playback for barge-in detection
      // OR continue monitoring after barge-in to detect when user finishes speaking
      const shouldMonitorForBargeIn = isAudioPlaying && !this.bargeInTriggered && !this.bargeInHangover && !isInitialPeriod && !this.currentTurnCancelled;
      const shouldMonitorPostBargeIn = this.bargeInTriggered && !this.bargeInHangover && this.currentTurnCancelled;
      const shouldMonitor = shouldMonitorForBargeIn || shouldMonitorPostBargeIn;
      
      if (!shouldMonitor) {
        // Reduced log frequency - only log every 10 seconds instead of every second
        if (Date.now() % 10000 < 50) {
          bargeLog(`🎤 📊 INSTANT: Not monitoring - audioPlaying:${!!isAudioPlaying}, inConversation:${this.isInConversation}, hasAudioStarted:${this.hasAudioStarted}, bargeTriggered:${this.bargeInTriggered}, hangover:${this.bargeInHangover}, initialPeriod:${isInitialPeriod}, turnCancelled:${this.currentTurnCancelled}, muted:${this.bargeInMuted}`);
        }
        return;
      }
      
      // Reduced log frequency for active monitoring - only log every 15 seconds
      if (Date.now() % 15000 < 50) {
        if (shouldMonitorForBargeIn) {
          bargeLog(`🎤 ⚡ INSTANT: ACTIVELY MONITORING for barge-in during AI audio playback!`);
        } else if (shouldMonitorPostBargeIn) {
          bargeLog(`🎤 ⚡ POST-BARGE-IN: MONITORING user speech completion after barge-in`);
        }
      }
      
      this.independentAnalyzer.getByteTimeDomainData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const amplitude = (dataArray[i] - 128) / 128.0;
        sum += amplitude * amplitude;
      }
      const rms = Math.sqrt(sum / bufferLength);
      
            // Only log very significant voice activity to prevent log spam
            if (rms > this.independentVoiceThreshold * 1.5) {
              console.log(`🎤 ⚡ INSTANT: Strong voice detected (volume: ${rms.toFixed(4)}, threshold: ${this.independentVoiceThreshold})`);
            }
      
      if (rms < this.independentVoiceThreshold * 0.5) {
        this.backgroundNoiseLevel = this.backgroundNoiseLevel * 0.95 + rms * 0.05;
      }
      
      const dynamicThreshold = Math.max(
        this.independentVoiceThreshold,
        this.backgroundNoiseLevel * 4.0
      );
      
      if (shouldMonitorForBargeIn) {
        // PRE-BARGE-IN: Monitor for voice to trigger barge-in
        if (rms > dynamicThreshold) {
          // CRITICAL: Additional validation to prevent false positives from AI audio bleed
          // If volume is extremely high (>0.5), it's likely AI audio bleed, not user voice
          if (rms > 0.5) {
            // RED console log for rejection
            console.log(`%c🚫 BARGE-IN REJECTED at ${new Date().toLocaleTimeString()}.${Date.now() % 1000} - Volume too high (${rms.toFixed(4)}) - likely AI audio bleed`, 'color: red; font-weight: bold; font-size: 14px;');
            bargeLog(`🚫 INSTANT: Rejecting very high volume (${rms.toFixed(4)}) - likely AI audio bleed, not user voice`);
            this.consecutiveVoiceDetections = 0; // Reset to prevent false accumulation
            return;
          }
          
          this.consecutiveVoiceDetections++;
          this.consecutiveSilenceDetections = 0; // Reset silence counter when voice detected
          
          if (this.consecutiveVoiceDetections === 1) {
            if (this.vadMetrics.firstVoiceDetectedAt === 0) {
              this.vadMetrics.firstVoiceDetectedAt = Date.now();
            }
            console.log(`📊 METRICS: First voice detected at ${new Date().toLocaleTimeString()}.${Date.now() % 1000} (volume: ${rms.toFixed(4)}, threshold: ${dynamicThreshold.toFixed(4)})`);
          }
          
          // Only log every 2nd confirmation to reduce spam
          if (this.consecutiveVoiceDetections % 2 === 0) {
            bargeLog(`🎤 🔍 INSTANT: Voice above threshold (${this.consecutiveVoiceDetections}/2 confirmations, volume: ${rms.toFixed(4)}, threshold: ${dynamicThreshold.toFixed(4)})`);
          }
          
          // GPT-5 TUNE: Confirm after 2 frames to reduce missed barges
          if (this.consecutiveVoiceDetections >= 2) {
            const timestamp = new Date().toLocaleTimeString() + '.' + (Date.now() % 1000);
            
            this.vadMetrics.bargeInConfirmedAt = Date.now();
            console.log(`📊 METRICS: Barge-in confirmed at ${timestamp} (${this.vadMetrics.bargeInConfirmedAt - this.vadMetrics.firstVoiceDetectedAt}ms after first detection)`);
            
            bargeLog(`🔇 ⚡ INSTANT BARGE-IN CONFIRMED at ${timestamp} (volume: ${rms.toFixed(4)}, threshold: ${dynamicThreshold.toFixed(4)}) - CHATGPT APPROACH!`);
          
            this.bargeInTriggered = true;
            this.interruptionTime = Date.now();
            this.bargeInVolume = rms; // Store the volume that triggered barge-in
            
            this.startBargeInHangover();
            
            // CRITICAL FIX: DO NOT disable microphone monitoring after barge-in
            // The user needs to continue speaking, so monitoring must remain active
            // this.independentMicMonitorActive = false; // REMOVED - was causing voice reception to stop
            
            console.log(`🎤 ✅ BARGE-IN: Microphone monitoring remains ACTIVE for continued user speech`);
            
            // CHATGPT APPROACH: Just trigger barge-in without stream restart
            this.triggerBargeIn();
            
            this.vadMetrics.cancelSentAt = Date.now();
            console.log(`📊 METRICS: Barge-in completed at ${new Date().toLocaleTimeString()}.${Date.now() % 1000}`);
            
            // CHATGPT APPROACH: Simple cancellation, no stream restart
            console.log('🎯 CHATGPT APPROACH: Barge-in completed - AI turn cancelled, session remains active');
            // The triggerBargeIn() already handled the UI state transition
            // No need to send any server messages - just let the user speak
          }
        } else {
          // CRITICAL FIX: Add grace period before resetting voice detection counter
          // Don't immediately reset on single low-volume frame - allow brief dips in user speech
          this.consecutiveSilenceDetections = (this.consecutiveSilenceDetections || 0) + 1;
          
          // Only reset voice detection after 3 consecutive low-volume frames (30ms grace period)
          if (this.consecutiveSilenceDetections >= 3) {
            if (this.consecutiveVoiceDetections > 0) {
              console.log(`🎤 🔄 GRACE PERIOD EXPIRED: Resetting voice detection after ${this.consecutiveSilenceDetections} silent frames`);
            }
            this.consecutiveVoiceDetections = 0;
            this.consecutiveSilenceDetections = 0;
          }
        }
      } else if (shouldMonitorPostBargeIn) {
        // POST-BARGE-IN: Monitor for silence to know when user finished speaking
        if (rms < dynamicThreshold * 0.3) { // Much lower threshold for detecting silence
          this.consecutiveSilenceDetections = (this.consecutiveSilenceDetections || 0) + 1;
          
          if (this.consecutiveSilenceDetections >= 10) { // 100ms of silence (10 * 10ms)
            console.log(`🎤 🔇 POST-BARGE-IN: User finished speaking - transitioning back to listening mode`);
            
            // Reset flags to allow normal conversation flow
            this.bargeInTriggered = false;
            this.currentTurnCancelled = false;
            this.isPostBargeIn = false;
            
            // Transition to listening state
            this.setState("listening");
            
            this.consecutiveSilenceDetections = 0;
            console.log('✅ POST-BARGE-IN: Ready for user input or AI response');
          }
        } else {
          this.consecutiveSilenceDetections = 0;
          // Only log if volume is very high to avoid spam
          if (rms > dynamicThreshold * 2.0) {
            console.log(`🎤 ⚡ POST-BARGE-IN: User speaking loudly (volume: ${rms.toFixed(4)})`);
          }
        }
      }
    }, 10);
  }
  
  private startBargeInHangover(): void {
    this.bargeInHangover = true;
    console.log('🔇 ⏰ Starting barge-in hangover period (250ms) to prevent multiple triggers');
    
    if (this.hangoverTimeout) {
      clearTimeout(this.hangoverTimeout);
    }
    
    this.hangoverTimeout = setTimeout(() => {
      this.bargeInHangover = false;
      this.hangoverTimeout = null;
      console.log('✅ Barge-in hangover period ended - ready for new detections');
    }, 250);
  }

  private stopIndependentMicMonitoring(): void {
    console.log('🎤 ⚡ Stopping instant barge-in detection...');
    console.trace('🔍 WHO CALLED stopIndependentMicMonitoring():');
    
    this.independentMicMonitorActive = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    if (this.hangoverTimeout) {
      clearTimeout(this.hangoverTimeout);
      this.hangoverTimeout = null;
      this.bargeInHangover = false;
    }
    
    if (this.independentMicStream) {
      this.independentMicStream.getTracks().forEach(track => track.stop());
      this.independentMicStream = null;
    }
    
    if (this.independentAudioContext) {
      this.independentAudioContext.close();
      this.independentAudioContext = null;
    }
    
    this.independentAnalyzer = null;
    console.log('✅ Instant barge-in detection stopped');
  }

  private cleanup() {
    this.stopIndependentMicMonitoring();
    
    this.isSessionStarted = false;
    this.isPromptStartReady = false;
    this.isNovaReady = false;
    this.isAudioStarted = false;
    
    this.isInConversation = false;
    this.shouldContinueListening = false;
    this.currentTurnCancelled = false;
    this.isPostBargeIn = false; // CHATGPT FIX: Reset post-barge-in state

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
    
    if (this.audioOutputContext) {
      this.audioOutputContext.close();
      this.audioOutputContext = null;
    }
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
  }

  private handleReconnection(): void {
    if (this.isReconnecting || this.state === "idle") {
      return;
    }
    
    this.isReconnecting = true;
    this.clearHeartbeatTimer();
    
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    console.log(`🔄 Attempting reconnection ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(async () => {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('❌ Max reconnection attempts reached, giving up');
        this.setState("idle");
        this.isReconnecting = false;
        return;
      }
      
      this.reconnectAttempts++;
      
      try {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        
        this.isSessionStarted = false;
        this.isNovaReady = false;
        this.isAudioStarted = false;
        
        await this.connectWebSocket();
        await this.initializeSession();
        
        console.log('✅ Reconnection successful');
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.startHeartbeat();
        
      } catch (error) {
        console.error('❌ Reconnection failed:', error);
        this.isReconnecting = false;
        this.handleReconnection();
      }
    }, delay);
  }
  
  private clearReconnectionTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  
  private startHeartbeat(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, this.heartbeatInterval);
  }
  
  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  private sendPing(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.lastPingTime = Date.now();
      this.sendMessage({ type: 'ping' });
    } else {
      console.warn('⚠️ Cannot send ping - WebSocket not ready');
      this.handleReconnection();
    }
  }
  
  private handlePong(message: ServerMessage): void {
    if (this.lastPingTime > 0) {
      const latency = Date.now() - this.lastPingTime;
      if (latency > 1000) {
        console.log(`🏓 High latency detected: ${latency}ms`);
      }
      this.lastPingTime = 0;
    }
  }

  // GPT-5 ENHANCEMENT: Comprehensive TTS stopping for reliable barge-in
  private stopAllTTSSources(): void {
    try {
      // 1. Stop browser speechSynthesis (if used)
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
        console.log('🔇 Stopped speechSynthesis TTS');
      }
      
      // 2. Stop AudioWorkletNode audio playback
      if (this.audioWorkletNode) {
        // Send stop message to worklet for immediate audio source stopping
        this.audioWorkletNode.port.postMessage({ type: 'stop' });
        console.log('🔇 Sent stop message to AudioWorklet');
      }
      
      // 3. Clear audio output queue to prevent future playback
      if (this.audioOutputQueue && this.audioOutputQueue.length > 0) {
        const queueSize = this.audioOutputQueue.length;
        this.audioOutputQueue = [];
        console.log(`🔇 Cleared audio output queue (${queueSize} items)`);
      }
      
      // 4. Stop any active AudioContext sources (if we have them)
      if (this.audioOutputContext && this.audioOutputContext.state === 'running') {
        // Note: We don't suspend the context as we need it for future audio
        console.log('🔇 AudioContext remains active for future audio');
      }
      
      console.log('✅ All TTS sources stopped successfully');
      
    } catch (error) {
      console.warn('⚠️ Error stopping TTS sources:', error);
    }
  }

  private triggerBargeIn(): void {
    const bargeInTime = Date.now();
    // RED console log for successful barge-in
    console.log(`%c🔇 BARGE-IN TRIGGERED at ${new Date().toLocaleTimeString()}.${Date.now() % 1000} - USER INTERRUPTED AI!`, 'color: red; font-weight: bold; font-size: 16px; background: yellow;');
    console.log(`🔇 BARGE-IN TRIGGERED at ${new Date().toLocaleTimeString()}.${Date.now() % 1000}`);
    
    // GPT-5 APPROACH: Complete 3-step barge-in handling
    // Step 1: Stop ALL TTS sources immediately (comprehensive)
    this.stopAllTTSSources();
    
    // Step 2: Clear AudioWorklet buffer with cooldown (already done in stopAllTTSSources, but ensure it's done)
    if (this.audioWorkletNode) {
      // GPT-5 FIX: Clear the audio buffer with cooldown to prevent race conditions
      this.audioWorkletNode.port.postMessage({
        type: "barge-in",
        durationMs: 250  // GPT-5: 250ms cooldown to prevent audio race conditions
      });
      console.log('🔇 ✅ Step 2: Audio buffer cleared with 250ms cooldown');
    } else {
      console.warn('⚠️ Cannot trigger barge-in - no audio worklet node available');
    }

    // Step 3: Mark turn as cancelled and transition to user_speaking state
    // CHATGPT APPROACH: Mark current turn as cancelled, keep session alive
    this.currentTurnCancelled = true;
    this.isPostBargeIn = true; // CHATGPT FIX: Disable inactivity timer
    this.vadMetrics.turnCancelledAt = Date.now();
    console.log('🎯 CHATGPT: Current AI turn marked as cancelled - session remains alive');
    console.log('🎯 CHATGPT: Post-barge-in state activated - inactivity timer disabled');
    
    // CRITICAL: Clear any existing inactivity timer immediately
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
      console.log('🎯 CHATGPT: Cleared existing inactivity timer during barge-in');
    }
    
    // CRITICAL: Tell server to cancel current turn and stop generating audio
    this.sendMessage({
      type: 'cancel_current_turn',
      reason: 'User barge-in detected'
    });
    console.log('📤 CHATGPT: Sent cancel_current_turn to server - should stop audio generation');
    
    // CRITICAL: Notify the main application about the barge-in event
    // This will trigger the state transition from 'ai_responding' to 'user_speaking'
    if (this.onBargeInCb) {
      this.onBargeInCb();
      console.log('🔔 Barge-in callback triggered - notifying main app');
    }
    
    // CHATGPT FIX: Reset conversation flags so user can speak
    this.resetForNewTurn();
    this.hasAudioStartNotified = false;
    console.log('🎯 CHATGPT: Reset audio flags - user can now speak');
    
    // CRITICAL FIX: Transition ASR state back to listening so user can speak
    this.setState("listening");
    console.log('🎯 CHATGPT: ASR state set to listening - ready for user input');
    
    const bargeInCompleteTime = Date.now();
    const bargeInDuration = bargeInCompleteTime - bargeInTime;
    console.log(`📊 Barge-in completed in: ${bargeInDuration}ms`);
    console.log('🎯 CHATGPT APPROACH: No stream restart needed - ready for user input!');
  }
}