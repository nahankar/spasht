// 🔥 LOADING NOVA WEBSOCKET SERVER V2 WITH UNIFIED RESPONSES 🔥
console.log('🔥🔥🔥 NOVA-WEBSOCKET-SERVER-V2.TS FILE IS BEING LOADED! 🔥🔥🔥');
console.log('🚀🚀🚀 THIS IS THE UPDATED FILE WITH UNIFIED RESPONSE SYSTEM! 🚀🚀🚀');
console.log('⚡⚡⚡ IF YOU SEE THIS, THE CORRECT FILE IS LOADING! ⚡⚡⚡');

import { WebSocketServer, WebSocket } from 'ws';
import { 
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand 
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { v4 as uuidv4 } from 'uuid';
import { Subject } from 'rxjs';

// Import session logging function - FIXED: Server-side logging disabled to prevent URL errors
async function logSessionEvent(sessionId: string, type: string, payload?: unknown): Promise<void> {
  // SERVER-SIDE: Skip fetch-based logging to prevent "Failed to parse URL" errors
  // Session events are logged client-side via the practice page
  if (process.env.NODE_ENV === 'development') {
    console.log(`📝 SESSION EVENT: ${type} for session ${sessionId}`, payload ? JSON.stringify(payload).slice(0, 100) : '');
  }
}

/**
 * FIXED Nova Sonic WebSocket Server
 * Implements proper event sequencing based on sample-nova-sonic-mcp-main
 */

// Protocol version for compatibility
const SERVER_PROTOCOL_VERSION = "1.0.0";

interface ClientMessage {
  version?: string; // Protocol version for compatibility
  type: 'start' | 'promptStart' | 'systemPrompt' | 'audioStart' | 'audio' | 'stop' | 'interrupt_request' | 'cancel_current_turn' | 'force_restart' | 'pause' | 'resume' | 'ping';
  timestamp?: number;
  sequenceId?: number;
  language?: string;
  data?: string;
  sampleRate?: number;
  systemPrompt?: string;
  conversationHistory?: Array<{role: 'USER' | 'ASSISTANT', content: string}>;
}

interface ServerMessage {
  version: string; // Protocol version for compatibility
  type: 'started' | 'promptStartReady' | 'promptReady' | 'partial' | 'final' | 'audio' | 'error' | 'stopped' | 'contentEnd' | 'pong' | 'streamComplete' | 'streamReady' | 'paused' | 'resumed' | 'textOutput';
  timestamp: number;
  message?: string;
  text?: string;
  audio?: string;
  confidence?: number;
  role?: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  content?: string;
  error?: string;
  stopReason?: string;
  latency?: number; // Round-trip time for pings
  sequenceId?: number; // Echo back sequence ID for tracking
}

interface SessionData {
  queue: Record<string, unknown>[];
  queueSignal: Subject<void>;
  closeSignal: Subject<void>;
  responseSubject: Subject<Record<string, unknown>>;
  promptName: string;
  contentName: string; 
  isActive: boolean;
  isPromptStartSent: boolean;
  isSystemPromptSent: boolean;
  isAudioContentStartSent: boolean;
  isReadyForAudio: boolean; // NEW: Track if Nova is ready
}

class NovaSDKHandler {
  private ws: WebSocket;
  private sessionId: string;
  private bedrockClient: BedrockRuntimeClient;
  private session: SessionData | null = null;
  private region: string;
  private textEncoder = new TextEncoder();
  private textDecoder = new TextDecoder('utf-8');
  private streamRestartCount = 0;
  private maxRestartAttempts = 3;
  private readinessTimeout: NodeJS.Timeout | null = null;
  private streamStartTime = 0;
  private currentStream: any = null; // Track current AWS stream for proper cleanup
  private isRestarting = false; // CRITICAL FIX: Prevent concurrent stream restarts
  private lastActivityTime = 0;
  private static sessionCleanupInProgress = new Set<string>();
  private static activeSessions = new Map<string, NovaSDKHandler>();
  
  // Audio batching for smoother delivery
  private audioBatchBuffer: string[] = [];
  private audioBatchTimer: NodeJS.Timeout | null = null;
  private readonly audioBatchDelay = 50; // 50ms batching window for more stable streaming
  
  // Response accumulation tracking (UNIFIED RESPONSES)
  private currentResponseText: string = '';
  private lastSentResponse: string = '';
  private responseInProgress: boolean = false;
  
  // Conversation context preservation
  private conversationHistory: Array<{role: 'USER' | 'ASSISTANT', content: string}> = [];
  private currentMessageRole: string = 'ASSISTANT'; // Track role from contentStart events
  private accumulatedAssistantText: string = ''; // UNIFIED: Accumulate all assistant text in one turn
  private accumulatedUserText: string = ''; // Accumulate user text to prevent loss during stream restarts
  private assistantTurnActive: boolean = false; // Track if we're in an assistant turn
  private userTurnActive: boolean = false; // Track if we're in a user turn
  private assistantTurnTimeout: NodeJS.Timeout | null = null; // Timeout to finalize assistant responses

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.sessionId = this.generateSessionId();
    this.region = process.env.AWS_REGION || 'us-east-1';
    
    // 🔥 UNIFIED RESPONSE VERSION LOADED - v2.0 🔥
    console.log('🔥🔥🔥 NOVA WEBSOCKET SERVER V2 WITH UNIFIED RESPONSES LOADED! 🔥🔥🔥');
    
    // FIXED: Use HTTP/2 handler like reference implementation
    const nodeHttp2Handler = new NodeHttp2Handler({
      requestTimeout: 300000,
      sessionTimeout: 600000,
      disableConcurrentStreams: false,
      maxConcurrentStreams: 20,
    });
    
    // Initialize AWS Bedrock client with HTTP/2 handler
    this.bedrockClient = new BedrockRuntimeClient({
      region: this.region,
      credentials: fromNodeProviderChain(),
      requestHandler: nodeHttp2Handler, // FIXED: Add HTTP/2 handler
    });

    // Initialize session
    this.session = {
      queue: [],
      queueSignal: new Subject<void>(),
      closeSignal: new Subject<void>(),
      responseSubject: new Subject<Record<string, unknown>>(),
      promptName: uuidv4(),
      contentName: uuidv4(),
      sessionId: this.sessionId, // CRITICAL FIX: Add missing sessionId property
      isActive: true,
      isPromptStartSent: false,
      isSystemPromptSent: false,
      isAudioContentStartSent: false,
      isReadyForAudio: false, // FIXED: Initialize ready state
    };
    
    // Track this session globally like reference app
    NovaSDKHandler.activeSessions.set(this.sessionId, this);
    this.updateActivity();
    
    // Start keep-alive mechanism for long interviews
    this.keepSessionAlive();

    console.log(`Nova SDK Handler - Session: ${this.sessionId}`);
  }

  private generateSessionId(): string {
    return `nova-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Update activity timestamp like reference app
  private updateActivity(): void {
    this.lastActivityTime = Date.now();
  }
  
  // Handle heartbeat ping from client
  private handlePing(pingMessage: ClientMessage): void {
    const latency = pingMessage.timestamp ? Date.now() - pingMessage.timestamp : 0;
    console.log(`🏓 Ping received from client - responding with pong (latency: ${latency}ms)`);
    
    this.sendMessage({
      type: 'pong',
      latency: latency,
      sequenceId: pingMessage.sequenceId // Echo back sequence ID
    });
    
    // Update activity tracking
    this.updateActivity();
  }

  // Keep session alive during interviews by updating activity
  private keepSessionAlive(): void {
    if (this.session?.isActive) {
      this.updateActivity();
      console.log('🔄 Keeping interview session alive...');
      // Schedule next keep-alive (less frequent for long interviews)
      setTimeout(() => this.keepSessionAlive(), 5 * 60 * 1000); // Every 5 minutes
    }
  }

  // Pause session - stop processing but keep connection alive
  async pauseSession(): Promise<void> {
    if (!this.session) {
      console.log('⏸️ No session to pause');
      return;
    }

    console.log('⏸️ Pausing interview session...');
    
    // Set session to paused state but keep it alive
    if (this.session.isActive) {
      // Stop current audio processing but don't end session
      this.sendMessage({
        type: 'paused',
        message: 'Interview paused - ready to resume anytime'
      });
      
      console.log('⏸️ Interview session paused successfully');
    }
  }

  // Resume session - restart audio processing with conversation context
  async resumeSession(conversationHistory?: Array<{role: 'USER' | 'ASSISTANT', content: string}>): Promise<void> {
    if (!this.session) {
      console.log('▶️ No session to resume');
      return;
    }

    console.log('▶️ Resuming interview session...');
    
    if (this.session.isActive) {
      // Build system prompt with conversation history if available
      let systemPrompt = 'You are a helpful and friendly assistant.';
      
      if (conversationHistory && conversationHistory.length > 0) {
        console.log(`📜 Resuming with ${conversationHistory.length} previous messages in context`);
        const contextSummary = conversationHistory
          .map(msg => `${msg.role}: ${msg.content}`)
          .join('\n');
        
        systemPrompt = `You are a helpful and friendly assistant. Here is our previous conversation context:\n\n${contextSummary}\n\nPlease continue our conversation naturally, remembering the context above.`;
      }
      
      // Restart stream for continued conversation with context
      this.sendMessage({
        type: 'resumed',
        message: 'Interview resumed - ready for questions with context'
      });
      
      // Restart the stream to ensure it's ready with conversation context
      await this.attemptStreamRestart(systemPrompt);
      
      console.log('▶️ Interview session resumed successfully with context');
    }
  }

  // Static methods for session management like reference app
  public static getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  public static getLastActivityTime(sessionId: string): number {
    const handler = this.activeSessions.get(sessionId);
    return handler?.lastActivityTime || 0;
  }

  public static isSessionActive(sessionId: string): boolean {
    const handler = this.activeSessions.get(sessionId);
    return !!handler && !!handler.session?.isActive;
  }

  public static isCleanupInProgress(sessionId: string): boolean {
    return this.sessionCleanupInProgress.has(sessionId);
  }

  // Force close session like reference app
  public static forceCloseSession(sessionId: string): void {
    if (this.sessionCleanupInProgress.has(sessionId) || !this.activeSessions.has(sessionId)) {
      console.log(`Session ${sessionId} already being cleaned up or not active`);
      return;
    }

    this.sessionCleanupInProgress.add(sessionId);
    try {
      const handler = this.activeSessions.get(sessionId);
      if (!handler || !handler.session) return;

      console.log(`Force closing session ${sessionId}`);
      
      handler.session.isActive = false;
      handler.session.closeSignal.next();
      handler.session.closeSignal.complete();
      
      this.activeSessions.delete(sessionId);
      console.log(`Session ${sessionId} forcibly closed`);
    } finally {
      this.sessionCleanupInProgress.delete(sessionId);
    }
  }

  private getEventType(textResponse: string): string {
    try {
      const jsonResponse = JSON.parse(textResponse);
      
      // Check for event wrapper
      if (jsonResponse.event) {
        const event = jsonResponse.event;
        if (event.contentStart) return `contentStart(${event.contentStart.type || 'unknown'})`;
        if (event.contentEnd) return `contentEnd(${event.contentEnd.stopReason || 'END_TURN'})`;
        if (event.textOutput) return `textOutput(${event.textOutput.content?.substring(0, 50) || ''}...)`;
        if (event.audioOutput) return `audioOutput(${event.audioOutput.content?.length || 0} bytes)`;
        if (event.usageEvent) return `usageEvent(${event.usageEvent.totalTokens || 0} tokens)`;
        if (event.completionEnd) return `completionEnd(${event.completionEnd.stopReason || 'END_TURN'})`;
        return `event(${Object.keys(event)[0] || 'unknown'})`;
      }
      
      // Direct event types
      if (jsonResponse.contentStart) return `contentStart(${jsonResponse.contentStart.type || 'unknown'})`;
      if (jsonResponse.contentEnd) return `contentEnd(${jsonResponse.contentEnd.stopReason || 'END_TURN'})`;
      if (jsonResponse.textOutput) return `textOutput(${jsonResponse.textOutput.content?.substring(0, 50) || ''}...)`;
      if (jsonResponse.audioOutput) return `audioOutput(${jsonResponse.audioOutput.content?.length || 0} bytes)`;
      
      return `unknown(${Object.keys(jsonResponse)[0] || 'empty'})`;
    } catch {
      return `parse-error(${textResponse.substring(0, 50)}...)`;
    }
  }

  private getEventTypeFromObject(event: Record<string, unknown>): string {
    if (event.event && typeof event.event === 'object') {
      const innerEvent = event.event as Record<string, unknown>;
      if (innerEvent.sessionStart) return 'sessionStart';
      if (innerEvent.promptStart) return 'promptStart';
      if (innerEvent.contentStart) {
        const cs = innerEvent.contentStart as { type?: string, role?: string };
        return `contentStart(${cs.type || 'unknown'}, ${cs.role || 'unknown'})`;
      }
      if (innerEvent.textInput) return 'textInput';
      if (innerEvent.audioInput) return 'audioInput';
      if (innerEvent.contentEnd) return 'contentEnd';
      if (innerEvent.promptEnd) return 'promptEnd';
      if (innerEvent.sessionEnd) return 'sessionEnd';
      return `event(${Object.keys(innerEvent)[0] || 'unknown'})`;
    }
    return `direct(${Object.keys(event)[0] || 'unknown'})`;
  }

  private sendMessage(messageData: Partial<ServerMessage>) {
    if (this.ws.readyState === WebSocket.OPEN) {
      // Add protocol version and timestamp to all messages
      const message: ServerMessage = {
        version: SERVER_PROTOCOL_VERSION,
        timestamp: Date.now(),
        ...messageData,
        type: messageData.type as ServerMessage['type'] // Type assertion for required field
      };
      
      const messageStr = JSON.stringify(message);
      // Reduced logging: only log important message types
      if (['started', 'stopped', 'error', 'paused', 'resumed'].includes(message.type)) {
        console.log(`📤 Sending ${message.type} to client`);
      }
      this.ws.send(messageStr);
    } else {
      console.warn(`⚠️ Cannot send message, WebSocket state: ${this.ws.readyState}`);
    }
  }

  async handleMessage(message: string) {
    try {
      const data: ClientMessage = JSON.parse(message.toString());
      
      if (data.type !== 'audio') {
        console.log(`📥 SERVER RECEIVED MESSAGE: ${data.type}`);
      }

      switch (data.type) {
        case 'start':
          // The previous check was flawed. A session object exists on connection,
          // so we should immediately try to initialize the stream on 'start'.
          await this.initializeBidirectionalStreamWithAllEvents(data.systemPrompt);
          break;
        case 'audioStart':
          this.handleAudioStart();
          break;
        case 'audio':
          if (data.data && data.data.length > 0) {
            await this.processAudioChunk(data.data, data.sampleRate);
          }
          break;
        case 'interrupt_request':
          console.log('🔇 ⚡ Interrupt request received from client - forcing immediate interruption');
          
          // Log interruption-triggered disconnection event
          logSessionEvent(this.sessionId, 'disconnection', {
            reason: 'INTERRUPTION_RESTART',
            errorMessage: 'Stream restart triggered by user interruption',
            timestamp: new Date().toISOString(),
            restartAttempt: this.streamRestartCount + 1
          }).catch(console.warn);
          // Force immediate interruption by sending a strong audio signal to Nova
          await this.forceInterruption();
          // CRITICAL FIX: Restart stream immediately after interruption (Nova Sonic gets confused by post-interruption events)
          console.log('🔄 Post-interruption: Restarting stream to ensure clean state...');
          
          // CRITICAL FIX: Save any accumulated text to conversation history before restart
          if (this.accumulatedAssistantText.trim().length > 0) {
            console.log(`📜 MEMORY: Saving accumulated assistant text before interruption restart: "${this.accumulatedAssistantText.trim().substring(0, 100)}..."`);
            this.conversationHistory.push({
              role: 'ASSISTANT',
              content: this.accumulatedAssistantText.trim()
            });
            console.log(`📜 MEMORY: Preserved assistant response in conversation history (${this.conversationHistory.length} total messages)`);
            
            // Reset the accumulated text since it's now saved
            this.accumulatedAssistantText = '';
            this.assistantTurnActive = false;
          }
          
          if (this.accumulatedUserText.trim().length > 0) {
            console.log(`📜 MEMORY: Saving accumulated user text before interruption restart: "${this.accumulatedUserText.trim().substring(0, 100)}..."`);
            this.conversationHistory.push({
              role: 'USER',
              content: this.accumulatedUserText.trim()
            });
            console.log(`📜 MEMORY: Preserved user message in conversation history (${this.conversationHistory.length} total messages)`);
            
            // Reset the accumulated text since it's now saved
            this.accumulatedUserText = '';
            this.userTurnActive = false;
          }
          
          await this.attemptStreamRestart();
          break;
          
        case 'force_restart':
          console.log('🔄 Force restart request received from client:', data.reason);
          
          // Log forced disconnection event
          logSessionEvent(this.sessionId, 'disconnection', {
            reason: 'FORCE_RESTART',
            errorMessage: data.reason || 'Client requested force restart',
            timestamp: new Date().toISOString(),
            restartAttempt: this.streamRestartCount + 1
          }).catch(console.warn);
          
          // Save any accumulated text to conversation history before forced restart
          if (this.accumulatedAssistantText.trim().length > 0) {
            console.log(`📜 MEMORY: Saving accumulated assistant text before forced restart: "${this.accumulatedAssistantText.trim().substring(0, 100)}..."`);
            this.conversationHistory.push({
              role: 'ASSISTANT',
              content: this.accumulatedAssistantText.trim()
            });
            console.log(`📜 MEMORY: Preserved assistant response in conversation history (${this.conversationHistory.length} total messages)`);
            this.accumulatedAssistantText = '';
            this.assistantTurnActive = false;
          }
          
          if (this.accumulatedUserText.trim().length > 0) {
            console.log(`📜 MEMORY: Saving accumulated user text before forced restart: "${this.accumulatedUserText.trim().substring(0, 100)}..."`);
            this.conversationHistory.push({
              role: 'USER',
              content: this.accumulatedUserText.trim()
            });
            console.log(`📜 MEMORY: Preserved user message in conversation history (${this.conversationHistory.length} total messages)`);
            this.accumulatedUserText = '';
            this.userTurnActive = false;
          }
          
          // Force restart regardless of current state
          console.log('🔄 Forcing stream restart due to client request...');
          await this.attemptStreamRestart();
          break;
          
        case 'cancel_current_turn':
          console.log('🔇 ⚡ Cancel current turn request received from client - graceful interruption');
          
          // Forward an INTERRUPTED to Nova to end current assistant/ongoing turn immediately
          // Do this BEFORE mutating assistantTurnActive so it always fires
          if (this.session) {
            // Debounce multiple cancels within a short window
            // @ts-ignore - attach ephemeral field on instance for debounce tracking
            this._lastInterruptAt = this._lastInterruptAt || 0;
            // @ts-ignore
            const now = Date.now();
            // @ts-ignore
            if (now - this._lastInterruptAt > 200) {
              const interruptEvent = {
                event: {
                  contentEnd: {
                    // IMPORTANT: include promptName/contentName to satisfy AWS schema
                    promptName: this.session.promptName,
                    contentName: this.session.contentName,
                    stopReason: 'INTERRUPTED'
                  }
                }
              };
              this.addEventToQueue(interruptEvent);
              console.log('🔇 ⚡ Forwarded INTERRUPTED contentEnd to Nova to stop assistant turn');
              // @ts-ignore
              this._lastInterruptAt = now;
            } else {
              console.log('⏱️ Skipping duplicate INTERRUPTED within debounce window');
            }
          }

          // Save any accumulated text to conversation history after signalling interruption
          if (this.accumulatedAssistantText.trim().length > 0) {
            console.log(`📜 MEMORY: Saving accumulated assistant text before turn cancellation: "${this.accumulatedAssistantText.trim().substring(0, 100)}..."`); 
            this.conversationHistory.push({
              role: 'ASSISTANT',
              content: this.accumulatedAssistantText.trim()
            });
            console.log(`📜 MEMORY: Preserved assistant response in conversation history (${this.conversationHistory.length} total messages)`);
            this.accumulatedAssistantText = '';
          }
          // Mark assistant/user turn closed locally
          this.assistantTurnActive = false;
          
          // Gate audio readiness until Nova re-acknowledges
          if (this.session) {
            this.session.isReadyForAudio = false;
            console.log('🔒 Gated isReadyForAudio=false after cancel; will re-enable on usageEvent or contentStart(AUDIO)');
          }
          
          // Transition to listening for user input
          console.log('🔇 ⚡ Graceful barge-in - ready for user input without forcing stream interruption');
          
          // No custom server message (to keep ServerMessage type strict)
          break;
          
        case 'pause':
          console.log('⏸️ Pause request received from client');
          await this.pauseSession();
          break;
        case 'resume':
          console.log('▶️ Resume request received from client');
          await this.resumeSession(data.conversationHistory);
          break;
        case 'ping':
          // Handle heartbeat ping - respond with pong
          this.handlePing(data);
          break;
        case 'stop':
          console.log('🛑 Stop request received from client - ending interview');
          await this.stopBidirectionalStream();
          break;
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      this.sendMessage({
        type: 'error',
        error: `Message handling error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }


  // FIXED: Initialize stream with all required events to prevent timeout
  async initializeBidirectionalStreamWithAllEvents(systemPrompt?: string) {
    if (!this.session) {
      console.error('Session not initialized');
      return;
    }

    try {
      console.log(`Initializing Nova Sonic bidirectional stream for session ${this.sessionId}...`);
      
      // FIXED: Send all required events upfront to prevent AWS timeout
      this.setupSessionStartEvent();
      this.setupPromptStartEvent();
      this.setupSystemPromptEvents(systemPrompt || 'You are a helpful assistant.');
      this.setupAudioContentStartEvent();

      const asyncIterable = this.createSessionAsyncIterable();
      
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: 'amazon.nova-sonic-v1:0',
        body: asyncIterable,
      });

      const response = await this.bedrockClient.send(command);

      // Track the stream for proper cleanup
      this.currentStream = response;

      console.log(`Session ${this.sessionId} stream established successfully`);
      this.sendMessage({ type: 'started', message: 'Nova Sonic bidirectional stream started' });

      // Mark events as sent, but not ready for audio until Nova acknowledges contentStart(AUDIO)
      this.session.isPromptStartSent = true;
      this.session.isSystemPromptSent = true;
      this.session.isAudioContentStartSent = true;
      // isReadyForAudio will be set to true when Nova acknowledges contentStart(AUDIO)

      await this.processResponseStream(response);
    } catch (error: unknown) {
      console.error(`Failed to start Nova Sonic bidirectional stream: ${error}`);
      this.sendMessage({
        type: 'error',
        error: `Failed to start stream: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  // REMOVED: Duplicate method - using setupPromptStartEvent() instead

  // REMOVED: Duplicate method - using setupSystemPromptEvents() instead

  // CLAUDE SONNET STATE DISCIPLINE: Strict turn/ack gating for audioStart
  async handleAudioStart() {
    if (!this.session) {
      console.warn('❌ AudioStart rejected - no session');
      return;
    }

    // GATING: Only allow if Nova is ready for audio
    if (!this.session.isReadyForAudio) {
      console.log('⏳ AudioStart queued - waiting for Nova readiness...');
      return;
    }

    // CLAUDE FIX: Prevent duplicate audioStart during same turn
    if (this.conversationState === 'user_speaking') {
      console.warn('⚠️ AudioStart rejected - user already speaking (prevents race condition)');
      console.log(`🔍 Current state: ${this.conversationState} - ignoring duplicate audioStart`);
      return;
    }

    // CLAUDE FIX: Only allow audioStart from valid previous states
    if (this.conversationState !== 'waiting_for_user' && this.conversationState !== 'ai_responding') {
      console.warn(`⚠️ AudioStart rejected - invalid transition from '${this.conversationState}'`);
      return;
    }

    // Valid transition - update conversation state
    console.log(`🎤 VALID audioStart: '${this.conversationState}' → 'user_speaking'`);
    this.conversationState = 'user_speaking';
    
    // The audio content start event was already sent during initialization
    // This audioStart message just signals that the user is now speaking
  }

  private setupSessionStartEvent() {
    if (!this.session) return;

    const sessionStartEvent = {
      event: {
        sessionStart: {
          inferenceConfiguration: {
            maxTokens: 2000,
            temperature: 0.7,
            topP: 0.9
          }
        }
      }
    };

    this.addEventToQueue(sessionStartEvent);
  }

  private setupPromptStartEvent() {
    if (!this.session) return;

    const promptStartEvent = {
      event: {
        promptStart: {
          promptName: this.session.promptName,
          textOutputConfiguration: {
            mediaType: "text/plain",
          },
          audioOutputConfiguration: {
            audioType: "SPEECH",
            encoding: "base64",
            mediaType: "audio/lpcm",
            sampleRateHertz: 24000,
            sampleSizeBits: 16,
            channelCount: 1,
            voiceId: "tiffany"
          },
          toolUseOutputConfiguration: {
            mediaType: "application/json"
          },
          toolConfiguration: {
            tools: [],
          }
        }
      }
    };

    this.addEventToQueue(promptStartEvent);
    console.log(`Prompt start event sent for session ${this.sessionId}`);
  }

  private setupSystemPromptEvents(systemPromptContent: string) {
    if (!this.session) return;

    const contentName = `system-prompt-${this.session.promptName}`;

    const events = [
      {
        event: {
          contentStart: {
            promptName: this.session.promptName,
            contentName: contentName,
            type: 'TEXT',
            interactive: true,
            role: 'SYSTEM',
            textInputConfiguration: {
              mediaType: 'text/plain',
            },
          },
        },
      },
      {
        event: {
          textInput: {
            promptName: this.session.promptName,
            contentName: contentName,
            content: systemPromptContent,
          },
        },
      },
      {
        event: {
          contentEnd: {
            promptName: this.session.promptName,
            contentName: contentName,
          },
        },
      },
    ];

    events.forEach(event => this.addEventToQueue(event));
    console.log(`System prompt events sent for session ${this.sessionId}`);
  }

  private setupAudioContentStartEvent() {
    if (!this.session) return;

    const contentStartEvent = {
      event: {
        contentStart: {
          promptName: this.session.promptName,
          contentName: this.session.contentName,
          type: 'AUDIO',
          interactive: true,
          role: 'USER',
          audioInputConfiguration: {
            audioType: 'SPEECH',
            encoding: 'base64',
            mediaType: 'audio/lpcm',
            sampleRateHertz: 16000,
            sampleSizeBits: 16,
            channelCount: 1,
          },
        },
      },
    };

    this.addEventToQueue(contentStartEvent);
    console.log(`Content start (AUDIO) event sent for session ${this.sessionId}`);
  }

  addEventToQueue(event: Record<string, unknown>) {
    if (!this.session) {
      console.error('Cannot add event to queue: session not initialized');
      return;
    }
    const eventType = this.getEventTypeFromObject(event);
    console.log(`🔄 Sending to AWS: ${eventType}`);
    this.session.queue.push(event);
    this.session.queueSignal.next();
  }

  private createSessionAsyncIterable(): AsyncIterable<{ chunk: { bytes: Uint8Array } }> {
    if (!this.session) {
      throw new Error('Session not initialized');
    }

    const session = this.session;
    const getEventType = this.getEventTypeFromObject.bind(this);

    return {
      [Symbol.asyncIterator]: async function* () {
        console.log('🔄 Starting async iterator for Nova Sonic events...');
        
        while (session.isActive) {
          while (session.queue.length > 0 && session.isActive) {
            const nextEvent = session.queue.shift();
            if (nextEvent) {
              const eventType = getEventType(nextEvent);
              // Only log non-audio events to reduce spam
              if (eventType !== 'audioInput') {
                console.log(`🔄 ASYNC ITERATOR: Yielding ${eventType} event to AWS`);
              }
              yield {
                chunk: {
                  bytes: new TextEncoder().encode(JSON.stringify(nextEvent)),
                },
              };
            }
          }

          if (!session.isActive) break;

          await new Promise(resolve => {
            const timeout = setTimeout(() => {
              resolve(undefined);
            }, 100);
            
            const originalNext = session.queueSignal.next;
            session.queueSignal.next = () => {
              clearTimeout(timeout);
              session.queueSignal.next = originalNext;
              resolve(undefined);
            };
          });
        }
        console.log('🔚 Queue is empty or session not active, ending iterator');
      },
    };
  }

  private lastIgnoreTime: number = 0; // Track when we started ignoring chunks

  async processAudioChunk(base64Data: string | undefined, _sampleRate: number | undefined) {
    if (!this.session || !this.session.isActive || !this.session.isReadyForAudio) {
      console.warn('Session not ready for audio, ignoring audio chunk');
      
      // EMERGENCY RECOVERY: If we've been ignoring chunks for too long, force readiness
      if (!this.lastIgnoreTime) {
        this.lastIgnoreTime = Date.now();
      } else if (Date.now() - this.lastIgnoreTime > 10000) { // 10 seconds of ignoring
        console.warn('⚠️ EMERGENCY: Been ignoring audio chunks for 10+ seconds - FORCING READINESS');
        if (this.session) {
          this.session.isReadyForAudio = true;
          this.lastIgnoreTime = 0;
          this.sendMessage({ 
            type: 'promptReady', 
            message: 'Emergency recovery - audio ready after prolonged ignore period' 
          });
          console.log('✅ EMERGENCY RECOVERY: Forced audio readiness');
          // Don't return - process this chunk now that we're ready
        } else {
          return;
        }
      } else {
        return;
      }
    } else {
      // Reset ignore timer when ready
      this.lastIgnoreTime = 0;
    }

    if (!base64Data) {
      console.warn('No audio data provided');
      return;
    }

    try {
      const audioInputEvent = {
        event: {
          audioInput: {
            promptName: this.session.promptName,
            contentName: this.session.contentName,
            content: base64Data
          }
        }
      };

      this.session.queue.push(audioInputEvent);
      this.session.queueSignal.next();

    } catch (error) {
      console.error('Error processing audio chunk:', error);
      this.sendMessage({
        type: 'error',
        error: `Error processing audio: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  private async processResponseStream(response: { body?: AsyncIterable<{ chunk?: { bytes?: Uint8Array }; modelStreamErrorException?: unknown; internalServerException?: unknown }> }): Promise<void> {
    if (!this.session) return;

    let eventCount = 0;
    // REMOVED: Artificial idle timeout - AWS manages its own stream lifecycle
    // This was causing legitimate long responses to be killed unnecessarily

    try {
      console.log('🔄 Processing Nova Sonic response stream...');
      this.streamStartTime = Date.now();
      
      if (!response.body) {
        console.error('No response body from Nova Sonic');
        return;
      }

      try {
        for await (const event of response.body) {
          // Check if session is still active
          if (!this.session?.isActive) {
            console.log('🛑 Session no longer active, stopping stream processing');
            break;
          }

          // Activity tracking removed - let AWS handle stream lifecycle
          this.updateActivity(); // Track activity like reference app
          eventCount++;

          // Log event count for monitoring (removed artificial limit)
          if (eventCount % 100 === 0 && eventCount > 0) {
            // console.log(`📊 Processed ${eventCount} events - conversation continuing`);
          }

          if (event.chunk?.bytes) {
            try {
              const textResponse = this.textDecoder.decode(event.chunk.bytes);
              // Parse and log only essential event info
              const eventType = this.getEventType(textResponse);
              
              // Reduce logging for audio events to prevent spam
              if (eventType.includes('audioOutput')) {
                // Log first few audio frames per turn to confirm delivery
                if (eventCount <= 3) { 
                  console.log(`📨 Nova Sonic event: ${eventType} (frame ${eventCount})`);
                }
              } else if (eventType.includes('usageEvent')) {
                // Comment out usageEvent logs - too frequent for barge-in debugging
                // console.log(`📨 Nova Sonic event: ${eventType}`);
              } else {
                console.log(`📨 Nova Sonic event: ${eventType}`);
              }
              
              const jsonResponse = JSON.parse(textResponse);
              await this.handleResponseEvent(jsonResponse);
            } catch (e: unknown) {
              console.error(`Error processing response chunk for session ${this.sessionId}:`, e);
              // Don't break on individual chunk errors, continue processing
            }
          } else if (event.modelStreamErrorException) {
            console.error(`Model stream error for session ${this.sessionId}:`, event.modelStreamErrorException);
            this.sendMessage({ type: 'error', error: 'An error occurred with the model stream.' });
            break;
          } else if (event.internalServerException) {
            console.error(`Internal server exception for session ${this.sessionId}:`, event.internalServerException);
            this.sendMessage({ type: 'error', error: 'An internal server error occurred.' });
            break;
          }
        }
      } finally {
        // Stream processing cleanup (timeout monitoring removed)
      }

      // If stream ran successfully for more than 30 seconds, reset restart counter
      const streamDuration = Date.now() - this.streamStartTime;
      if (streamDuration > 30000) {
        console.log(`✅ Stream ran successfully for ${Math.round(streamDuration/1000)}s - resetting restart counter`);
        this.streamRestartCount = 0;
      }
      
      console.log(`✅ Stream processing completed normally. Processed ${eventCount} events.`);
      
        // Send streamComplete event like reference app
        this.sendMessage({
          type: 'streamComplete',
          message: 'Stream completed normally',
          timestamp: new Date().toISOString()
        });
        
        // DISABLED: Auto-restart was causing isReadyForAudio to be reset, breaking audio processing
        console.log('🔄 INTERVIEW MODE: Stream ended normally - keeping session active for next question');
        console.log('💡 Session remains ready for next question without restart');
        
        // Signal client that session is ready for next question (no restart needed)
        this.sendMessage({
          type: 'streamReady', 
          message: 'Ready for next question - no restart needed'
        });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error processing response stream for session ${this.sessionId}:`, error);
      
      // Differentiate between different types of errors
      if (errorMessage.includes('PREMATURE_CLOSE') || errorMessage.includes('Premature close')) {
        console.log('🔄 Stream closed prematurely by AWS - attempting restart');
        
        // Log disconnection event
        logSessionEvent(this.sessionId, 'disconnection', {
          reason: 'PREMATURE_CLOSE',
          errorMessage: errorMessage.substring(0, 200),
          timestamp: new Date().toISOString(),
          restartAttempt: this.streamRestartCount + 1
        }).catch(console.warn);
        
        this.sendMessage({ 
          type: 'info', 
          message: 'Stream interrupted, attempting to reconnect...' 
        });
        // Only restart on premature closure
        if (this.streamRestartCount < this.maxRestartAttempts && this.session.isActive) {
          console.log(`💡 Attempting stream restart (${this.streamRestartCount + 1}/${this.maxRestartAttempts})`);
          
          // CRITICAL FIX: Save any accumulated text to conversation history before restart
          if (this.accumulatedAssistantText.trim().length > 0) {
            console.log(`📜 MEMORY: Saving accumulated assistant text before premature closure restart: "${this.accumulatedAssistantText.trim().substring(0, 100)}..."`);
            this.conversationHistory.push({
              role: 'ASSISTANT',
              content: this.accumulatedAssistantText.trim()
            });
            console.log(`📜 MEMORY: Preserved assistant response in conversation history (${this.conversationHistory.length} total messages)`);
            
            // Reset the accumulated text since it's now saved
            this.accumulatedAssistantText = '';
            this.assistantTurnActive = false;
          }
          
          if (this.accumulatedUserText.trim().length > 0) {
            console.log(`📜 MEMORY: Saving accumulated user text before premature closure restart: "${this.accumulatedUserText.trim().substring(0, 100)}..."`);
            this.conversationHistory.push({
              role: 'USER',
              content: this.accumulatedUserText.trim()
            });
            console.log(`📜 MEMORY: Preserved user message in conversation history (${this.conversationHistory.length} total messages)`);
            
            // Reset the accumulated text since it's now saved
            this.accumulatedUserText = '';
            this.userTurnActive = false;
          }
          
          await this.attemptStreamRestart();
        }
      } else if (errorMessage.includes('ECONNRESET') || errorMessage.includes('ENOTFOUND')) {
        console.error('🌐 Network connectivity issue detected');
        
        // Log network disconnection event
        logSessionEvent(this.sessionId, 'disconnection', {
          reason: 'NETWORK_ERROR',
          errorMessage: errorMessage.substring(0, 200),
          timestamp: new Date().toISOString(),
          restartAttempt: this.streamRestartCount + 1
        }).catch(console.warn);
        
        this.sendMessage({ 
          type: 'error', 
          error: 'Network connection lost. Please check your internet connection.' 
        });
        // Don't restart on network issues
      } else {
        console.error('❌ Unexpected stream error:', error);
        
        // Log unexpected disconnection event
        logSessionEvent(this.sessionId, 'disconnection', {
          reason: 'UNEXPECTED_ERROR',
          errorMessage: errorMessage.substring(0, 200),
          timestamp: new Date().toISOString(),
          restartAttempt: this.streamRestartCount + 1
        }).catch(console.warn);
        
        // Enhanced debugging for restart conditions
        console.log(`🔍 RESTART DEBUG: streamRestartCount=${this.streamRestartCount}, maxRestartAttempts=${this.maxRestartAttempts}, session.isActive=${this.session?.isActive}`);
        
        this.sendMessage({ 
          type: 'error', 
          error: `Stream processing error: ${errorMessage}` 
        });
        
        // Only restart on unexpected errors
        if (this.streamRestartCount < this.maxRestartAttempts && this.session?.isActive) {
          console.log(`💡 Attempting stream restart for error (${this.streamRestartCount + 1}/${this.maxRestartAttempts})`);
          
          // CRITICAL FIX: Save any accumulated text to conversation history before restart
          if (this.accumulatedAssistantText.trim().length > 0) {
            console.log(`📜 MEMORY: Saving accumulated assistant text before restart: "${this.accumulatedAssistantText.trim().substring(0, 100)}..."`);
            this.conversationHistory.push({
              role: 'ASSISTANT',
              content: this.accumulatedAssistantText.trim()
            });
            console.log(`📜 MEMORY: Preserved assistant response in conversation history (${this.conversationHistory.length} total messages)`);
            
            // Reset the accumulated text since it's now saved
            this.accumulatedAssistantText = '';
            this.assistantTurnActive = false;
          }
          
          if (this.accumulatedUserText.trim().length > 0) {
            console.log(`📜 MEMORY: Saving accumulated user text before restart: "${this.accumulatedUserText.trim().substring(0, 100)}..."`);
            this.conversationHistory.push({
              role: 'USER',
              content: this.accumulatedUserText.trim()
            });
            console.log(`📜 MEMORY: Preserved user message in conversation history (${this.conversationHistory.length} total messages)`);
            
            // Reset the accumulated text since it's now saved
            this.accumulatedUserText = '';
            this.userTurnActive = false;
          }
          
          await this.attemptStreamRestart();
        } else {
          console.log(`❌ RESTART BLOCKED: streamRestartCount=${this.streamRestartCount}/${this.maxRestartAttempts}, session.isActive=${this.session?.isActive}`);
          
          // If we can't restart normally, try to force a session recovery
          if (this.session?.isActive && errorMessage.includes('ValidationException')) {
            console.log('🔄 FORCE RECOVERY: Attempting ValidationException recovery restart...');
            
            // Save context before forced restart
            if (this.accumulatedAssistantText.trim().length > 0) {
              this.conversationHistory.push({
                role: 'ASSISTANT',
                content: this.accumulatedAssistantText.trim()
              });
              this.accumulatedAssistantText = '';
              this.assistantTurnActive = false;
            }
            
            if (this.accumulatedUserText.trim().length > 0) {
              this.conversationHistory.push({
                role: 'USER',
                content: this.accumulatedUserText.trim()
              });
              this.accumulatedUserText = '';
              this.userTurnActive = false;
            }
            
            // Force restart regardless of restart count for ValidationException
            await this.attemptStreamRestart();
          }
        }
      }
    } finally {
      console.log(`🔚 Response stream processing finished. Total events: ${eventCount}`);
      if (this.session) {
        // Don't automatically restart on normal completion - let client decide
        console.log('💡 Stream ended - session remains active for potential manual restart');
      }
    }
  }

  private async attemptStreamRestart(systemPrompt?: string): Promise<void> {
    if (!this.session || !this.session.isActive) {
      console.log('❌ Cannot restart stream - session not active or already cleaned up');
      return;
    }

    // CRITICAL FIX: Prevent concurrent restart attempts
    if (this.isRestarting) {
      console.log('⚠️ Stream restart already in progress - skipping duplicate attempt');
      return;
    }

    try {
      this.isRestarting = true;
      this.streamRestartCount++;
      console.log(`🔄 Restarting Nova Sonic stream (attempt ${this.streamRestartCount}/${this.maxRestartAttempts})`);
      
      // CRITICAL FIX: Terminate any existing stream and stop its async iterator
      if (this.currentStream) {
        try {
          console.log('🔄 Terminating existing stream before restart...');
          
          // CRITICAL: Stop the old async iterator by deactivating the session temporarily
          const wasActive = this.session.isActive;
          this.session.isActive = false;
          console.log('🔄 Deactivated session to stop old async iterator');
          
          // Try multiple termination methods
          if (this.currentStream.destroy) {
            this.currentStream.destroy();
          }
          if (this.currentStream.end) {
            this.currentStream.end();
          }
          if (this.currentStream.abort) {
            this.currentStream.abort();
          }
          
          this.currentStream = null;
          
          // Wait a moment for the old iterator to fully stop
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Reactivate the session for the new stream
          this.session.isActive = wasActive;
          console.log('✅ Existing stream terminated and async iterator stopped');
        } catch (error) {
          console.log('⚠️ Error terminating existing stream (continuing):', error);
          // Ensure session is reactivated even if termination fails
          if (this.session) {
            this.session.isActive = true;
          }
        }
      }
      
      // CRITICAL FIX: Longer pause to allow AWS cleanup and prevent ValidationException
      console.log('🔄 Waiting 2 seconds for AWS to clean up previous session...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check again if session is still active after delay
      if (!this.session || !this.session.isActive) {
        console.log('❌ Session became inactive during restart delay');
        return;
      }
      
      // For stream restart, we need to re-send the essential session setup events
      console.log('🔄 Re-initializing session events for stream restart...');
      
      // CRITICAL FIX: Clear the event queue to prevent old events from interfering
      console.log(`🔄 Clearing event queue (had ${this.session.queue.length} stale events)`);
      this.session.queue = [];
      
      // CRITICAL FIX: Generate completely new session identifiers FIRST (before setting up events)
      const oldPromptName = this.session.promptName;
      const oldSessionId = this.session.sessionId;
      const newSessionId = `nova-session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      // Update BOTH session identifiers to ensure consistency
      this.session.promptName = uuidv4();
      this.session.contentName = uuidv4();
      this.session.sessionId = newSessionId;
      this.sessionId = newSessionId; // Also update class property
      
      console.log(`🔄 Generated new identifiers for restart:`);
      console.log(`   - promptName: ${oldPromptName} → ${this.session.promptName}`);
      console.log(`   - sessionId: ${oldSessionId} → ${newSessionId}`);
      
      // Reset session flags to allow re-sending setup events
      this.session.isPromptStartSent = false;
      this.session.isSystemPromptSent = false;
      this.session.isAudioContentStartSent = false;
      this.session.isReadyForAudio = false;

      // Re-setup the essential events with NEW identifiers (CRITICAL: sessionStart must be first)
      console.log('🔄 Setting up events with new session identifiers...');
      
      // CRITICAL FIX: Create async iterable FIRST, then add events in correct order
      const asyncIterable = this.createSessionAsyncIterable();
      
      // Add events to queue in the correct order AFTER async iterator is ready
      console.log('🔄 Adding sessionStart to queue');
      this.setupSessionStartEvent();
      console.log('🔄 Adding promptStart to queue');
      this.setupPromptStartEvent();
      console.log('🔄 Adding system prompt events to queue');
      
      // Build enhanced system prompt with conversation history
      let enhancedSystemPrompt = systemPrompt || 'You are a helpful assistant.';
      
      if (this.conversationHistory.length > 0) {
        // Keep only the last 10 messages to prevent system prompt from becoming too long
        const recentHistory = this.conversationHistory.slice(-10);
        console.log(`📜 MEMORY: Including ${recentHistory.length} recent messages (of ${this.conversationHistory.length} total) in system prompt for context preservation`);
        console.log(`📜 MEMORY: Recent conversation:`, recentHistory.map(m => `${m.role}: ${m.content.substring(0, 50)}...`));
        
        const conversationContext = recentHistory
          .map(msg => `${msg.role}: ${msg.content}`)
          .join('\n');
        
        enhancedSystemPrompt = `${enhancedSystemPrompt}\n\nIMPORTANT: Here is our recent conversation history that you should remember and continue naturally:\n\n${conversationContext}\n\nPlease continue our conversation naturally, remembering everything we discussed above. Do not mention that this is a "restart" or "reconnection" - just continue as if the conversation never stopped.`;
      }
      
      this.setupSystemPromptEvents(enhancedSystemPrompt);
      console.log('🔄 Adding contentStart(AUDIO, USER) to queue');
      this.setupAudioContentStartEvent();
      
      // Brief delay to ensure events are properly queued before stream starts
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: 'amazon.nova-sonic-v1:0',
        body: asyncIterable,
      });

      const response = await this.bedrockClient.send(command);
      
      // Track the new stream for proper cleanup
      this.currentStream = response;
      
      console.log(`✅ Stream restarted successfully (attempt ${this.streamRestartCount})`);
        // Log successful reconnection event
        logSessionEvent(this.sessionId, 'reconnection', {
          reason: 'RESTART_SUCCESS',
          timestamp: new Date().toISOString(),
          restartAttempt: this.streamRestartCount,
          conversationContextPreserved: this.conversationHistory.length > 0
        }).catch(console.warn);
        
        this.sendMessage({
          type: 'info', 
          message: `Stream reconnected (attempt ${this.streamRestartCount})` 
        });

      // GROK-4 RESILIENCE: Enhanced readiness recovery with exponential backoff - ALWAYS SET
      const backoffDelay = Math.min(5000 * Math.pow(1.5, this.streamRestartCount - 1), 15000);
      console.log(`🔄 CRITICAL: Setting readiness timeout: ${backoffDelay}ms (attempt ${this.streamRestartCount})`);
      
      // Clear any existing timeout first
      if (this.readinessTimeout) {
        clearTimeout(this.readinessTimeout);
        this.readinessTimeout = null;
      }
      
      this.readinessTimeout = setTimeout(() => {
        console.log(`⚠️ TIMEOUT TRIGGERED: Checking readiness after ${backoffDelay}ms...`);
        if (this.session && !this.session.isReadyForAudio) {
          console.log(`⚠️ Nova Sonic readiness timeout after ${backoffDelay}ms - FORCING RECOVERY`);
          this.session.isReadyForAudio = true;
          this.sendMessage({ 
            type: 'promptReady', 
            message: `Audio ready after timeout (attempt ${this.streamRestartCount})` 
          });
          console.log('✅ FORCED audio readiness - conversation should resume');
        } else {
          console.log('✅ Nova Sonic responded normally - no timeout intervention needed');
        }
      }, backoffDelay);

      await this.processResponseStream(response);
    } catch (error) {
      console.error(`❌ Stream restart failed (attempt ${this.streamRestartCount}):`, error);
      
      if (this.streamRestartCount >= this.maxRestartAttempts) {
        console.log('❌ Maximum restart attempts reached');
        this.sendMessage({ 
          type: 'error', 
          error: 'Stream connection lost and could not be restored. Please refresh the page.' 
        });
        if (this.session) {
          this.session.isActive = false;
        }
      }
    } finally {
      // CRITICAL FIX: Always reset restart flag
      this.isRestarting = false;
    }
  }

  // FIXED: Properly handle responses from Nova including usageEvent
  private async handleResponseEvent(jsonResponse: Record<string, unknown>) {
    try {
      // GROK-4 ENHANCED LOGGING: Track all events to debug restart readiness
      const timeSinceRestart = this.streamStartTime ? Date.now() - this.streamStartTime : 0;
      const eventTypes = Object.keys(jsonResponse);
      // console.log(`🔍 GROK-4 EVENT LOG: ${eventTypes.join(', ')} received ${timeSinceRestart}ms after restart`);
      // GROK-4 ENHANCED LOGGING: Track all events after restart to debug readiness issues
      if (jsonResponse.contentStart && typeof jsonResponse.contentStart === 'object') {
        const contentStart = jsonResponse.contentStart as { type?: string; role?: string };
        const timeSinceRestart = this.streamStartTime ? Date.now() - this.streamStartTime : 0;
        
        // console.log(`🔍 GROK-4 LOG: contentStart received ${timeSinceRestart}ms after restart:`, contentStart);
        
        if (contentStart.type === 'AUDIO') {
          console.log('✅ Received contentStart (AUDIO) acknowledgement from Nova Sonic - NOW READY FOR AUDIO!');
          console.log(`📊 GROK-4 METRICS: Audio readiness achieved ${timeSinceRestart}ms after restart`);
          
          if (this.session) {
            this.session.isReadyForAudio = true;
            // Clear readiness timeout since Nova responded
            if (this.readinessTimeout) {
              clearTimeout(this.readinessTimeout);
              this.readinessTimeout = null;
              console.log('⏰ GROK-4 LOG: Readiness timeout cleared - Nova responded normally');
            }
            this.sendMessage({ type: 'promptReady', message: 'Nova Sonic is ready for audio input' });
          }
        } else if (contentStart.type === 'TEXT') {
          // console.log(`🔍 GROK-4 LOG: TEXT contentStart received (not audio-ready) ${timeSinceRestart}ms after restart`);
          // CRITICAL FIX: Extract role from contentStart event (like reference app)
          if (contentStart.role) {
            this.currentMessageRole = contentStart.role;
            console.log(`🏷️ Nova Sonic provided role: ${contentStart.role} for TEXT content`);
            
            // UNIFIED RESPONSES: Start accumulating assistant text on first contentStart
            console.log(`🔍 DEBUG: contentStart.role=${contentStart.role}, assistantTurnActive=${this.assistantTurnActive}`);
            if (contentStart.role === 'ASSISTANT' && !this.assistantTurnActive) {
              console.log('🔄 Starting new UNIFIED assistant turn - will accumulate all text');
              this.assistantTurnActive = true;
              this.accumulatedAssistantText = '';
              
              // Send contentStart to client only once per assistant turn
              this.sendMessage({
                type: 'contentStart',
                data: contentStart
              });
            } else if (contentStart.role === 'ASSISTANT' && this.assistantTurnActive) {
              console.log('🔄 Continuing UNIFIED assistant turn - accumulating more text');
              // Don't send another contentStart, just continue accumulating
            } else if (contentStart.role === 'USER') {
              console.log('🔄 Starting user turn - will accumulate user text');
              this.userTurnActive = true;
              this.accumulatedUserText = '';
              
              // User messages are handled normally
              this.sendMessage({
                type: 'contentStart',
                data: contentStart
              });
            }
          }
          
          // Only reset deduplication state if we're not already in a response
          if (!this.responseInProgress) {
            // console.log('🔄 Starting new response - resetting deduplication state');
            this.currentResponseText = '';
            this.lastSentResponse = '';
            this.responseInProgress = true;
          }
        }
      }

      // FIXED: Handle usageEvent - this indicates Nova has processed our setup and is ready
      if (jsonResponse.event && typeof jsonResponse.event === 'object') {
        const event = jsonResponse.event as Record<string, unknown>;
        if (event.usageEvent && typeof event.usageEvent === 'object') {
          const usageEvent = event.usageEvent as { 
            totalInputTokens?: number; 
            totalOutputTokens?: number; 
            totalTokens?: number;
            details?: {
              delta?: { input?: any; output?: any };
              total?: { input?: any; output?: any };
            };
          };
          const timeSinceRestart = this.streamStartTime ? Date.now() - this.streamStartTime : 0;
          
          // console.log(`🔍 GROK-4 LOG: usageEvent received ${timeSinceRestart}ms after restart:`, usageEvent);
          
          // Forward token usage to client for tracking
          this.sendMessage({
            type: 'tokenUsage',
            data: {
              totalInputTokens: usageEvent.totalInputTokens || 0,
              totalOutputTokens: usageEvent.totalOutputTokens || 0,
              totalTokens: usageEvent.totalTokens || 0,
              details: usageEvent.details
            }
          });
          
          // If we have input tokens, Nova has processed our system prompt and is ready for audio
          if (usageEvent.totalInputTokens && usageEvent.totalInputTokens > 0 && this.session && !this.session.isReadyForAudio) {
            console.log('✅ Nova Sonic processed system prompt - NOW READY FOR AUDIO!');
            console.log(`📊 GROK-4 METRICS: System prompt processed ${timeSinceRestart}ms after restart (${usageEvent.totalInputTokens} tokens)`);
            this.session.isReadyForAudio = true;
            // Clear readiness timeout since Nova responded
            if (this.readinessTimeout) {
              clearTimeout(this.readinessTimeout);
              this.readinessTimeout = null;
              console.log('⏰ GROK-4 LOG: Readiness timeout cleared - Nova responded with usageEvent');
            }
            this.sendMessage({ type: 'promptReady', message: 'Nova Sonic is ready for audio input' });
          } else if (usageEvent.totalInputTokens && usageEvent.totalInputTokens > 0) {
            // console.log(`🔍 GROK-4 LOG: usageEvent with ${usageEvent.totalInputTokens} tokens but already ready or no session`);
          }
        }
      }

      // FIXED: Handle Nova Sonic event structure - responses come wrapped in "event"
      if (jsonResponse.event && typeof jsonResponse.event === 'object') {
        const event = jsonResponse.event as Record<string, unknown>;
        
        // CRITICAL FIX: Handle contentStart events wrapped in "event" (like reference app)
        if (event.contentStart && typeof event.contentStart === 'object') {
          const contentStart = event.contentStart as { type?: string; role?: string };
          if (contentStart.type === 'TEXT' && contentStart.role) {
            this.currentMessageRole = contentStart.role;
            console.log(`🏷️ Nova Sonic provided role: ${contentStart.role} for TEXT content (wrapped event)`);
            
            // UNIFIED RESPONSES: Start accumulating assistant text on first contentStart (WRAPPED EVENTS)
            // console.log(`🔍 DEBUG WRAPPED: contentStart.role=${contentStart.role}, assistantTurnActive=${this.assistantTurnActive}`);
            if (contentStart.role === 'ASSISTANT' && !this.assistantTurnActive) {
              console.log('🔄 Starting new UNIFIED assistant turn - will accumulate all text (WRAPPED)');
              this.assistantTurnActive = true;
              this.accumulatedAssistantText = '';
              
              // Send contentStart to client only once per assistant turn
              this.sendMessage({
                type: 'contentStart',
                data: contentStart
              });
            } else if (contentStart.role === 'ASSISTANT' && this.assistantTurnActive) {
              console.log('🔄 Continuing UNIFIED assistant turn - accumulating more text (WRAPPED)');
              // Don't send another contentStart, just continue accumulating
            } else if (contentStart.role === 'USER') {
              console.log('🔄 Starting user turn - will accumulate user text (WRAPPED)');
              this.userTurnActive = true;
              this.accumulatedUserText = '';
              
              // User messages are handled normally
              this.sendMessage({
                type: 'contentStart',
                data: contentStart
              });
            } else {
              // Fallback for other cases
              this.sendMessage({
                type: 'contentStart',
                data: contentStart
              });
            }
            
            // Reset deduplication state for new content
            if (!this.responseInProgress) {
              // console.log('🔄 Starting new response - resetting deduplication state');
              this.currentResponseText = '';
              this.lastSentResponse = '';
              this.responseInProgress = true;
            }
          }
        }
        
        // Handle text output with UNIFIED accumulation for assistant responses
        if (event.textOutput && typeof event.textOutput === 'object') {
          const textOutput = event.textOutput as { content?: string };
          if (textOutput.content) {
            console.log(`🔍 DEBUG textOutput: role=${this.currentMessageRole}, assistantTurnActive=${this.assistantTurnActive}`);
            
            // CRITICAL FIX: Handle USER textOutput separately (post-barge-in transcription)
            if (this.currentMessageRole === 'USER') {
              console.log('📥 User speech transcribed - accumulating user text');
              
              // Accumulate user text for potential stream restart preservation
              this.accumulatedUserText += textOutput.content;
              console.log(`📜 MEMORY: Accumulated user text: "${this.accumulatedUserText.substring(0, 100)}..."`);
              
              this.sendMessage({
                type: 'userTranscription',
                text: textOutput.content,
                role: 'USER',
                source: 'Nova Sonic user transcription'
              });
              return; // Don't wrap into unified AI response
            }
            
            // REFERENCE APP EXACT MATCH: Send textOutput events just like reference server
            // console.log('🔍 REF APP EXACT: Sending textOutput event to client:', { 
            //   text: textOutput.content.substring(0, 50) + '...', 
            //   role: this.currentMessageRole,
            //   source: 'Nova Sonic textOutput event'
            // });
            
            // Track assistant message in conversation history (accumulate for full response)
            if (this.currentMessageRole === 'ASSISTANT') {
              this.accumulatedAssistantText += textOutput.content;
            }
            
            this.sendMessage({
              type: 'textOutput',
              content: textOutput.content,
              role: this.currentMessageRole
            });
          }
        }

        // Handle audio output with batching for smoother streaming
        if (event.audioOutput && typeof event.audioOutput === 'object') {
          const audioOutput = event.audioOutput as { content?: string };
          if (audioOutput.content) {
            this.batchAudioOutput(audioOutput.content);
          } else {
            console.log('⚠️ Audio output received but no content');
          }
        }

        // UNIFIED RESPONSES: Handle contentEnd events wrapped in "event" 
        if (event.contentEnd && typeof event.contentEnd === 'object') {
          const contentEnd = event.contentEnd as { stopReason?: string };
          console.log('📝 Content generation completed (WRAPPED):', contentEnd);
          
          // REFERENCE APP APPROACH: Simple contentEnd forwarding, no complex accumulation
          console.log('🔍 REF APP: Forwarding contentEnd to client:', contentEnd.stopReason);
          
          // CRITICAL FIX: Reset unified state on END_TURN/INTERRUPTED to prevent extra generation
          if (contentEnd.stopReason === 'END_TURN' || contentEnd.stopReason === 'INTERRUPTED') {
            console.log(`🔄 RESETTING unified turn state on ${contentEnd.stopReason} (wrapped event)`);
            
            // Add complete assistant response to conversation history
            if (this.accumulatedAssistantText.trim().length > 0) {
              this.conversationHistory.push({
                role: 'ASSISTANT',
                content: this.accumulatedAssistantText.trim()
              });
              console.log(`📜 MEMORY: Added assistant response to history (${this.conversationHistory.length} total messages)`);
              console.log(`📜 MEMORY: Assistant said: "${this.accumulatedAssistantText.trim().substring(0, 100)}..."`);
            }
            
            // Add complete user message to conversation history if accumulated
            if (this.accumulatedUserText.trim().length > 0) {
              this.conversationHistory.push({
                role: 'USER',
                content: this.accumulatedUserText.trim()
              });
              console.log(`📜 MEMORY: Added user message to history (${this.conversationHistory.length} total messages)`);
              console.log(`📜 MEMORY: User said: "${this.accumulatedUserText.trim().substring(0, 100)}..."`);
            }
            
            this.assistantTurnActive = false;
            this.userTurnActive = false;
            this.accumulatedAssistantText = '';
            this.accumulatedUserText = '';
            this.conversationState = 'waiting_for_user';
          }
          
          // Send contentEnd to client
          this.sendMessage({
            type: 'contentEnd',
            stopReason: contentEnd.stopReason || 'END_TURN',
            message: 'Content generation completed (wrapped)'
          });
        }
      }

      // LEGACY SECTION DISABLED: This was causing duplicate messages and breaking unified responses
      // The new unified logic above handles all textOutput properly
      // console.log('🚫 Legacy textOutput section disabled - using unified response system instead');

      if (jsonResponse.audioOutput && typeof jsonResponse.audioOutput === 'object') {
        const audioOutput = jsonResponse.audioOutput as { content?: string };
        if (audioOutput.content) {
          this.batchAudioOutput(audioOutput.content);
        } else {
          console.log('⚠️ Audio output received but no content');
        }
      }

      if (jsonResponse.contentEnd) {
        console.log('📝 Content generation completed:', jsonResponse.contentEnd);
        
        // UNIFIED RESPONSES: Send final accumulated assistant text on END_TURN
        if (this.assistantTurnActive && this.accumulatedAssistantText.trim().length > 0) {
          if (jsonResponse.contentEnd.stopReason === 'END_TURN') {
            console.log('🔄 UNIFIED: Sending final accumulated assistant response, length:', this.accumulatedAssistantText.length);
            this.sendMessage({
              type: 'final',
              text: this.accumulatedAssistantText,
              confidence: 1.0,
              role: 'ASSISTANT'
            });
            
            // Reset accumulation state after sending final response
            this.assistantTurnActive = false;
            this.accumulatedAssistantText = '';
          } else if (jsonResponse.contentEnd.stopReason === 'PARTIAL_TURN') {
            console.log('🔄 UNIFIED: Partial turn ended, continuing to accumulate');
            // Don't reset on PARTIAL_TURN, continue accumulating
          }
        }
        
        // Finalize response deduplication state ONLY on END_TURN, not PARTIAL_TURN
        if (jsonResponse.contentEnd.stopReason === 'END_TURN') {
          console.log('🔄 Resetting response state after END_TURN');
          this.responseInProgress = false;
          this.currentResponseText = '';
          this.lastSentResponse = '';
        }
        
        // Check if this was an interruption (INTERRUPTED or PARTIAL_TURN can indicate interruption)
        if (jsonResponse.contentEnd.stopReason === 'INTERRUPTED' || 
            jsonResponse.contentEnd.stopReason === 'PARTIAL_TURN') {
          console.log(`🔇 User interrupted the response (${jsonResponse.contentEnd.stopReason})`);
          this.sendMessage({
            type: 'contentEnd',
            stopReason: jsonResponse.contentEnd.stopReason,
            message: `Response interrupted by user (${jsonResponse.contentEnd.stopReason})`
          });
        } else {
          this.sendMessage({
            type: 'contentEnd',
            stopReason: jsonResponse.contentEnd.stopReason || 'END_TURN',
            message: 'Content generation completed'
          });
        }
      }

      if (jsonResponse.streamComplete) {
        console.log('✅ Stream completed - Nova Sonic signaled stream completion');
        console.log('🔍 DEBUG: Stream completion context - assistantTurnActive:', this.assistantTurnActive, 'conversationState:', this.conversationState);
        this.sendMessage({
          type: 'stopped',
          message: 'Stream completed'
        });
      }
    } catch (error) {
      console.error('Error handling response event:', error);
    }
  }

  async forceInterruption() {
    if (!this.session) {
      console.warn('⚠️ Cannot force interruption - no active session');
      return;
    }

    try {
      // Send a burst of audio to force Nova to detect interruption immediately
      const silentAudio = Buffer.alloc(3200); // 100ms of silence at 16kHz
      const loudAudio = Buffer.alloc(3200);
      
      // Fill with a brief audio signal to trigger interruption detection
      for (let i = 0; i < loudAudio.length; i += 2) {
        const sample = Math.sin(2 * Math.PI * 440 * i / 32000) * 0.1; // 440Hz tone at low volume
        const intSample = Math.floor(sample * 32767);
        loudAudio.writeInt16LE(intSample, i);
      }
      
      // Send the interruption signal (convert to base64 like normal audio input)
      const base64Audio = loudAudio.toString('base64');
      this.addEventToQueue({
        event: {
          audioInput: {
            promptName: this.session.promptName,
            contentName: this.session.contentName,
            content: base64Audio
          }
        }
      });
      
      console.log('🔇 ⚡ Sent forced interruption signal to Nova Sonic');
      
    } catch (error) {
      console.error('Error forcing interruption:', error);
    }
  }


  // Determine if a message is from USER or ASSISTANT based on content patterns
  private conversationState: 'waiting_for_user' | 'user_speaking' | 'waiting_for_assistant' | 'assistant_responding' = 'waiting_for_user';
  
  private determineMessageRole(content: string): 'USER' | 'ASSISTANT' {
    // State-based role determination - NO pattern matching!
    console.log(`🏷️ determineMessageRole: current state='${this.conversationState}', content="${content.substring(0, 30)}..."`);
    
    // Simple heuristic: if content looks like a question or command, it's likely USER
    const isUserLikeContent = content.toLowerCase().startsWith('what ') || 
                             content.toLowerCase().startsWith('how ') || 
                             content.toLowerCase().startsWith('why ') ||
                             content.toLowerCase().startsWith('where ') ||
                             content.toLowerCase().startsWith('when ') ||
                             content.toLowerCase().startsWith('who ') ||
                             content.length < 50; // Short messages are often user queries
    
    // If we're in user speaking phase OR content looks like user input, this is a USER message
    if (this.conversationState === 'user_speaking' || 
        this.conversationState === 'waiting_for_assistant' ||
        isUserLikeContent) {
      console.log(`🏷️ Classifying as USER (state: ${this.conversationState}, isUserLike: ${isUserLikeContent})`);
      // Transition to assistant responding
      this.conversationState = 'assistant_responding';
      return 'USER';
    }
    
    // Otherwise, this is an ASSISTANT message
    console.log(`🏷️ Classifying as ASSISTANT (state: ${this.conversationState})`);
    // Transition back to waiting for user
    this.conversationState = 'waiting_for_user';
    return 'ASSISTANT';
  }

  async stopBidirectionalStream() {
    if (!this.session) {
      return;
    }

    // Use cleanup tracking like reference app
    if (NovaSDKHandler.sessionCleanupInProgress.has(this.sessionId)) {
      console.log(`Session ${this.sessionId} cleanup is in progress, skipping`);
      return;
    }

    NovaSDKHandler.sessionCleanupInProgress.add(this.sessionId);
    
    try {
      if (this.session.isActive) {
        console.log(`Gracefully stopping Nova Sonic stream for session ${this.sessionId}...`);

        // REFERENCE APP PATTERN: Proper shutdown sequence with delays
        
        // 1. End the audio content
        this.addEventToQueue({
          event: {
            contentEnd: {
              promptName: this.session.promptName,
              contentName: this.session.contentName,
            },
          },
        });
        await new Promise(resolve => setTimeout(resolve, 300)); // Reference app delay

        // 2. End the prompt
        this.addEventToQueue({
          event: {
            promptEnd: {
              promptName: this.session.promptName,
            },
          },
        });
        await new Promise(resolve => setTimeout(resolve, 300)); // Reference app delay
        
        // 3. End the session
        this.addEventToQueue({
          event: {
            sessionEnd: {},
          },
        });
        await new Promise(resolve => setTimeout(resolve, 300)); // Reference app delay
        
        this.session.isActive = false;
        this.session.closeSignal.next();
        this.session.closeSignal.complete();
      }
      
      // Clean up all timeouts
      if (this.readinessTimeout) {
        clearTimeout(this.readinessTimeout);
        this.readinessTimeout = null;
      }
      
      // Remove from global tracking
      NovaSDKHandler.activeSessions.delete(this.sessionId);
      this.session = null;

      this.sendMessage({
        type: 'stopped',
        message: 'Nova Sonic stream stopped gracefully'
      });

      console.log(`✅ Nova Sonic stream stopped for session ${this.sessionId}`);
    } catch (error) {
      console.error(`Session ${this.sessionId} closing sequence error:`, error);
      
      // Force cleanup on error
      if (this.session) {
        this.session.isActive = false;
        NovaSDKHandler.activeSessions.delete(this.sessionId);
        this.session = null;
      }
    } finally {
      NovaSDKHandler.sessionCleanupInProgress.delete(this.sessionId);
    }
  }

  /**
   * Batch audio output to reduce WebSocket message frequency and improve streaming smoothness
   */
  private batchAudioOutput(audioContent: string) {
    this.audioBatchBuffer.push(audioContent);
    
    // If this is the first audio chunk in the batch, start the timer
    if (this.audioBatchTimer === null) {
      this.audioBatchTimer = setTimeout(() => {
        this.flushAudioBatch();
      }, this.audioBatchDelay);
    }
    
    // If buffer gets too large, flush immediately to prevent memory issues
    if (this.audioBatchBuffer.length >= 15) {
      this.flushAudioBatch();
    }
  }

  /**
   * Send all batched audio chunks as a single message
   */
  private flushAudioBatch() {
    if (this.audioBatchBuffer.length === 0) return;
    
    // Concatenate all audio chunks
    const combinedAudio = this.audioBatchBuffer.join('');
    const totalLength = this.audioBatchBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    
    // console.log(`🎵 Sending batched audio output to client: ${this.audioBatchBuffer.length} chunks, ${totalLength} total length`);
    
    this.sendMessage({
      type: 'audio',
      audio: combinedAudio,
    });
    
    // Clear the batch
    this.audioBatchBuffer = [];
    if (this.audioBatchTimer) {
      clearTimeout(this.audioBatchTimer);
      this.audioBatchTimer = null;
    }
  }
}

// Create and start the WebSocket server
const PORT = 8081;
const wss = new WebSocketServer({ port: PORT });

// REFERENCE APP PATTERN: Periodically check for and close inactive sessions
setInterval(() => {
  console.log('Session cleanup check');
  const now = Date.now();
  
  NovaSDKHandler.getActiveSessions().forEach((sessionId) => {
    const lastActivity = NovaSDKHandler.getLastActivityTime(sessionId);
    
    // Only close sessions after 30 minutes of complete inactivity (user abandoned)
    // This allows for long interviews (10 mins, 30 mins, 100 mins, etc.)
    if (now - lastActivity > 30 * 60 * 1000) {
      console.log(`Closing abandoned session ${sessionId} after 30 minutes of inactivity`);
      try {
        NovaSDKHandler.forceCloseSession(sessionId);
      } catch (error) {
        console.error(`Error force closing inactive session ${sessionId}:`, error);
      }
    }
  });
}, 5 * 60 * 1000); // Check every 5 minutes (less frequent)

console.log(`🎤 FIXED Nova Sonic WebSocket server started on ws://localhost:${PORT}`);
console.log('🚀 Using proper event sequencing based on reference implementation');
console.log(`📡 Connect to: ws://localhost:${PORT}`);
console.log('🔧 Press Ctrl+C to stop');

wss.on('connection', (ws) => {
  console.log('🔗 New Nova Sonic WebSocket connection established');
  
  try {
    const handler = new NovaSDKHandler(ws);

    ws.on('message', async (data) => {
      try {
        await handler.handleMessage(data.toString());
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: `Message handling error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }));
      }
    });

    ws.on('close', () => {
      console.log('Nova Sonic WebSocket connection closed');
      handler.stopBidirectionalStream();
    });

    ws.on('error', (error) => {
      console.error('Nova Sonic WebSocket error:', error);
      handler.stopBidirectionalStream();
    });

  } catch (error) {
    console.error('Error creating Nova SDK handler:', error);
    ws.send(JSON.stringify({
      type: 'error',
      error: `Handler creation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }));
    ws.close();
  }
});

// Graceful shutdown like reference app
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down Nova Sonic WebSocket server...');

  const forceExitTimer = setTimeout(() => {
    console.error('Forcing server shutdown after timeout');
    process.exit(1);
  }, 5000);

  try {
    // First close WebSocket server
    await new Promise((resolve) => wss.close(resolve));
    console.log('WebSocket server closed');

    // Then close all active sessions
    const activeSessions = NovaSDKHandler.getActiveSessions();
    console.log(`Closing ${activeSessions.length} active sessions...`);

    await Promise.all(
      activeSessions.map(async (sessionId) => {
        try {
          const handler = NovaSDKHandler.activeSessions.get(sessionId);
          if (handler) {
            await handler.stopBidirectionalStream();
            console.log(`Closed session ${sessionId} during shutdown`);
          }
        } catch (error) {
          console.error(`Error closing session ${sessionId} during shutdown:`, error);
          NovaSDKHandler.forceCloseSession(sessionId);
        }
      })
    );

    clearTimeout(forceExitTimer);
    console.log('✅ Nova Sonic WebSocket server stopped');
    process.exit(0);
  } catch (error) {
    console.error('Error during server shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down Nova Sonic WebSocket server...');
  wss.close(() => {
    console.log('✅ Nova Sonic WebSocket server stopped');
    process.exit(0);
  });
});
