"use client";
import React from "react";
import { AudioRecorder } from "@/components/media/AudioRecorder";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NudgePopup, type NudgeType } from "@/components/nudge-popup";
import { ChatInterface, type ChatMessage } from "@/components/ui/chat-interface";
import { getAsrProvider } from "@/core/asr/factory";
import type { AsrProvider } from "@/core/asr/types";
import type { AsrTranscript } from "@/core/asr/types";
import { startSession, endSession, logSessionEvent } from "@/lib/session-client";
import type { AsrState } from "@/components/media/AudioRecorder";
import { useSessionTimer } from "@/hooks/useSessionTimer";
import { HeaderTimeDisplay } from "@/components/ui/header-time-display";
import { parseNovaTokenBreakdown } from "@/lib/token-parser";

// Toggle verbose client-side logging via NEXT_PUBLIC_DEBUG=1
const SHOULD_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';

type ConversationState = 'waiting_for_user' | 'user_speaking' | 'waiting_for_ai' | 'ai_responding';

interface ConversationMessagePayload {
  role: 'USER' | 'ASSISTANT';
  content: string;
  conversationState: ConversationState;
  confidence?: number;
  provider?: string;
  isInterrupted?: boolean;
  audioUrl?: string;
  audioMetadata?: {
    duration?: number;
    sampleRate?: number;
    size?: number;
  };
}

export default function PracticePage() {
  const [providerName, setProviderName] = React.useState<string>("loading…");
  const [sessionId, setSessionId] = React.useState<string | null>(null);

  // Restore sessionId from localStorage on mount
  React.useEffect(() => {
    const savedSessionId = localStorage.getItem('currentSessionId');
    if (savedSessionId) {
      setSessionId(savedSessionId);
      console.log('🔄 Restored session ID from localStorage:', savedSessionId);
    }
  }, []);
  const [nudge, setNudge] = React.useState<{ show: boolean; msg: string; type: NudgeType }>(
    { show: false, msg: "", type: "pace" }
  );
  const [liveText, setLiveText] = React.useState<string>("");
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  // Force conversation logging to always be enabled for analytics
  const [enableLogging, setEnableLogging] = React.useState<boolean>(true);
  
  // Debug: Log the enableLogging state on mount
  React.useEffect(() => {
    console.log('🔧 Conversation logging enabled:', enableLogging);
  }, [enableLogging]);
  const currentMessageIdRef = React.useRef<string | null>(null);
  const messageCounterRef = React.useRef<number>(0);
  const lastProcessedTextRef = React.useRef<string>('');
  const conversationStateRef = React.useRef<ConversationState>('waiting_for_user');
  const [recorderState, setRecorderState] = React.useState<AsrState>('idle');
  const [isAudioMuted, setIsAudioMuted] = React.useState<boolean>(false);
  const [isPaused, setIsPaused] = React.useState<boolean>(false);
  const [isProcessingLongResponse, setIsProcessingLongResponse] = React.useState<boolean>(false);
  const audioRecorderRef = React.useRef<{ start: () => void; stop: () => void } | null>(null);
  
  // Session timer hook
  const {
    cumulativeData,
    isLoadingCumulative,
    tokenData,
    previousTokenData,
    currentSessionSeconds,
    startTimer,
    stopTimer,
    resetTimer,
    loadCumulativeTime,
    loadTokenData,
  } = useSessionTimer();
  
  // Token tracking state
  const [currentSessionTokens, setCurrentSessionTokens] = React.useState({
    speechInput: 0,
    speechOutput: 0,
    textInput: 0,
    textOutput: 0,
    total: 0
  });
  const [accumulatedTokens, setAccumulatedTokens] = React.useState({
    speechInput: 0,
    speechOutput: 0,
    textInput: 0,
    textOutput: 0,
    total: 0
  });
  
  // AWS Nova Sonic Pricing (per 1K tokens)
  const PRICING = {
    speechInput: 0.0034,   // $0.0034 per 1K tokens
    speechOutput: 0.0136,  // $0.0136 per 1K tokens  
    textInput: 0.00006,    // $0.00006 per 1K tokens
    textOutput: 0.00024    // $0.00024 per 1K tokens
  };
  const expectingUserInputRef = React.useRef<boolean>(false);

  // Token calculation functions
  const calculateCost = React.useCallback((tokens: typeof currentSessionTokens) => {
    const speechInputCost = (tokens.speechInput / 1000) * PRICING.speechInput;
    const speechOutputCost = (tokens.speechOutput / 1000) * PRICING.speechOutput;
    const textInputCost = (tokens.textInput / 1000) * PRICING.textInput;
    const textOutputCost = (tokens.textOutput / 1000) * PRICING.textOutput;
    
    return {
      speechInput: speechInputCost,
      speechOutput: speechOutputCost,
      textInput: textInputCost,
      textOutput: textOutputCost,
      total: speechInputCost + speechOutputCost + textInputCost + textOutputCost
    };
  }, [PRICING.speechInput, PRICING.speechOutput, PRICING.textInput, PRICING.textOutput]);

  // Database save throttling
  const lastDbSaveRef = React.useRef<number>(0);
  const pendingDbSaveRef = React.useRef<NodeJS.Timeout | null>(null);
  const pendingTokenDataRef = React.useRef<{
    sessionId: string;
    speechInput: number;
    speechOutput: number;
    textInput: number;
    textOutput: number;
    totalTokens: number;
    totalCost: number;
  } | null>(null);
  const DB_SAVE_THROTTLE = 2000; // Save to DB every 2 seconds maximum

  // Update token counts
  const updateTokens = React.useCallback(async (tokenUpdate: {
    speechInput?: number;
    speechOutput?: number;
    textInput?: number;
    textOutput?: number;
    sessionId?: string | null;
    isCumulative?: boolean; // Flag to indicate if these are cumulative totals vs deltas
    forceDbSave?: boolean; // Force immediate DB save (for session end)
  }) => {
    const incomingTokens = {
      speechInput: tokenUpdate.speechInput || 0,
      speechOutput: tokenUpdate.speechOutput || 0,
      textInput: tokenUpdate.textInput || 0,
      textOutput: tokenUpdate.textOutput || 0,
    };
    
    // console.log('💾 updateTokens called with:', { 
    //   incomingTokens, 
    //   isCumulative: tokenUpdate.isCumulative,
    //   sessionId: tokenUpdate.sessionId 
    // });
    
    // CRITICAL FIX: Handle cumulative vs delta token updates
    let actualNewTokens = incomingTokens;
    
    if (tokenUpdate.isCumulative) {
      // Nova Sonic sends cumulative totals, so we need to calculate the delta
      // from the last known session totals
      actualNewTokens = {
        speechInput: Math.max(0, incomingTokens.speechInput - currentSessionTokens.speechInput),
        speechOutput: Math.max(0, incomingTokens.speechOutput - currentSessionTokens.speechOutput),
        textInput: Math.max(0, incomingTokens.textInput - currentSessionTokens.textInput),
        textOutput: Math.max(0, incomingTokens.textOutput - currentSessionTokens.textOutput),
      };
      
      // console.log('💾 Calculated delta from cumulative:', {
      //   previous: currentSessionTokens,
      //   incoming: incomingTokens,
      //   delta: actualNewTokens
      // });
    }
    
    const totalNewTokens = actualNewTokens.speechInput + actualNewTokens.speechOutput + actualNewTokens.textInput + actualNewTokens.textOutput;
    const newCost = calculateCost(actualNewTokens).total;
    
    // console.log('💾 Processing token update:', { 
    //   actualNewTokens, 
    //   totalNewTokens, 
    //   newCost,
    //   willSaveToDb: totalNewTokens > 0 && (tokenUpdate.sessionId || sessionId)
    // });
    
    // Only update state and save if we have actual new tokens
    if (totalNewTokens > 0) {
      // Update current session tokens (set to cumulative if available, otherwise add delta)
      setCurrentSessionTokens(prev => {
        let updated;
        if (tokenUpdate.isCumulative) {
          // Set to the cumulative totals from Nova Sonic
          updated = {
            speechInput: incomingTokens.speechInput,
            speechOutput: incomingTokens.speechOutput,
            textInput: incomingTokens.textInput,
            textOutput: incomingTokens.textOutput,
            total: 0 // Will be calculated
          };
        } else {
          // Add the delta to previous totals
          updated = {
            speechInput: prev.speechInput + actualNewTokens.speechInput,
            speechOutput: prev.speechOutput + actualNewTokens.speechOutput,
            textInput: prev.textInput + actualNewTokens.textInput,
            textOutput: prev.textOutput + actualNewTokens.textOutput,
            total: 0 // Will be calculated
          };
        }
        updated.total = updated.speechInput + updated.speechOutput + updated.textInput + updated.textOutput;
        
        // console.log('💾 Updated current session tokens:', { prev, updated });
        return updated;
      });
      
      // Update accumulated tokens (always add delta)
      setAccumulatedTokens(prev => {
        const updated = {
          speechInput: prev.speechInput + actualNewTokens.speechInput,
          speechOutput: prev.speechOutput + actualNewTokens.speechOutput,
          textInput: prev.textInput + actualNewTokens.textInput,
          textOutput: prev.textOutput + actualNewTokens.textOutput,
          total: 0 // Will be calculated
        };
        updated.total = updated.speechInput + updated.speechOutput + updated.textInput + updated.textOutput;
        
        // console.log('💾 Updated accumulated tokens:', { prev, updated, delta: actualNewTokens });
        return updated;
      });
      
      // Throttled database save logic
      const currentSessionId = tokenUpdate.sessionId || sessionId;
      if (currentSessionId) {
        const now = Date.now();
        const timeSinceLastSave = now - lastDbSaveRef.current;
        const shouldSaveNow = tokenUpdate.forceDbSave || timeSinceLastSave >= DB_SAVE_THROTTLE;
        
        if (shouldSaveNow) {
          // Clear any pending save since we're saving now
          if (pendingDbSaveRef.current) {
            clearTimeout(pendingDbSaveRef.current);
            pendingDbSaveRef.current = null;
          }
          
          try {
            const response = await fetch('/api/tokens', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: currentSessionId,
                speechInput: actualNewTokens.speechInput,
                speechOutput: actualNewTokens.speechOutput,
                textInput: actualNewTokens.textInput,
                textOutput: actualNewTokens.textOutput,
                totalTokens: totalNewTokens,
                totalCost: newCost
              })
            });
            
            if (response.ok) {
              lastDbSaveRef.current = now;
              // console.log('💾 ✅ Token usage saved to database (immediate):', { 
              //   sessionId: currentSessionId, 
              //   totalTokens: totalNewTokens, 
              //   cost: newCost,
              //   breakdown: actualNewTokens
              // });
            } else {
              console.error('💾 ❌ Failed to save token usage - HTTP', response.status, response.statusText);
            }
          } catch (error) {
            console.error('❌ Failed to save token usage to database:', error);
          }
        } else {
          // Store the latest token data for delayed save
          pendingTokenDataRef.current = {
            sessionId: currentSessionId,
            speechInput: actualNewTokens.speechInput,
            speechOutput: actualNewTokens.speechOutput,
            textInput: actualNewTokens.textInput,
            textOutput: actualNewTokens.textOutput,
            totalTokens: totalNewTokens,
            totalCost: newCost
          };
          
          // Schedule a delayed save if one isn't already pending
          if (!pendingDbSaveRef.current) {
            const delayUntilNextSave = DB_SAVE_THROTTLE - timeSinceLastSave;
            // console.log(`💾 ⏰ Scheduling delayed DB save in ${delayUntilNextSave}ms`);
            
            pendingDbSaveRef.current = setTimeout(async () => {
              const dataToSave = pendingTokenDataRef.current;
              if (!dataToSave) {
                // console.log('💾 ⚠️ No pending token data to save');
                pendingDbSaveRef.current = null;
                return;
              }
              
              try {
                const response = await fetch('/api/tokens', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(dataToSave)
                });
                
                if (response.ok) {
                  lastDbSaveRef.current = Date.now();
                  // console.log('💾 ✅ Token usage saved to database (delayed):', { 
                  //   sessionId: dataToSave.sessionId, 
                  //   totalTokens: dataToSave.totalTokens, 
                  //   cost: dataToSave.totalCost,
                  //   breakdown: {
                  //     speechInput: dataToSave.speechInput,
                  //     speechOutput: dataToSave.speechOutput,
                  //     textInput: dataToSave.textInput,
                  //     textOutput: dataToSave.textOutput
                  //   }
                  // });
                } else {
                  console.error('💾 ❌ Failed to save token usage (delayed) - HTTP', response.status, response.statusText);
                }
              } catch (error) {
                console.error('❌ Failed to save token usage to database (delayed):', error);
              } finally {
                pendingDbSaveRef.current = null;
                pendingTokenDataRef.current = null;
              }
            }, delayUntilNextSave);
          } else {
            // console.log('💾 ⏸️  DB save already scheduled, updating pending data with latest tokens');
          }
        }
      } else {
        // console.log('💾 ❌ NOT saving token usage because sessionId is null/undefined:', currentSessionId);
      }
    } else {
      // console.log('💾 ⏭️  Skipping token update - no new tokens to process');
    }
  }, [sessionId, calculateCost, currentSessionTokens]);

  // Load accumulated token usage on mount
  React.useEffect(() => {
    const loadAccumulatedTokens = async () => {
      try {
        const response = await fetch('/api/tokens');
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data.accumulated) {
            setAccumulatedTokens({
              speechInput: result.data.accumulated.speechInput,
              speechOutput: result.data.accumulated.speechOutput,
              textInput: result.data.accumulated.textInput,
              textOutput: result.data.accumulated.textOutput,
              total: result.data.accumulated.totalTokens
            });
            // console.log('💰 Loaded accumulated token usage:', result.data.accumulated);
          }
        }
      } catch (error) {
        console.error('❌ Failed to load accumulated token usage:', error);
      }
    };

    loadAccumulatedTokens();
  }, []);

  // Reset current session tokens when session changes
  React.useEffect(() => {
    setCurrentSessionTokens({
      speechInput: 0,
      speechOutput: 0,
      textInput: 0,
      textOutput: 0,
      total: 0
    });
  }, [sessionId]);

  // Ensure session is ended when user closes browser/tab
  React.useEffect(() => {
    const handleBeforeUnload = () => {
      if (sessionId) {
        // Use sendBeacon for reliable data sending during page unload
        const sessionData = JSON.stringify({
          id: sessionId,
          completedAt: new Date().toISOString()
        });
        
        navigator.sendBeacon('/api/sessions/end', sessionData);
        console.log('📡 Session data sent via beacon on page unload');
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && sessionId) {
        // Page is being hidden, save session data
        const sessionData = JSON.stringify({
          id: sessionId,
          completedAt: new Date().toISOString()
        });
        
        navigator.sendBeacon('/api/sessions/end', sessionData);
        console.log('📡 Session data sent via beacon on visibility change');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionId]);

  // Conversation logging function with enhanced debugging
  const logConversationMessage = React.useCallback(async (payload: ConversationMessagePayload) => {
    console.log('🔍 logConversationMessage called:', { 
      enableLogging, 
      sessionIdFromState: sessionId, 
      sessionIdFromLocalStorage: localStorage.getItem('currentSessionId'),
      role: payload.role, 
      contentLength: payload.content.length 
    });
    
    if (!enableLogging) {
      // console.log('📝 Database logging disabled - skipping message log');
      return;
    }
    
    // Check both React state and localStorage for session ID
    const currentSessionId = sessionId || localStorage.getItem('currentSessionId');
    
    if (!currentSessionId) {
      console.warn('⚠️ Cannot log conversation message - no active session', {
        sessionIdFromState: sessionId,
        sessionIdFromLocalStorage: localStorage.getItem('currentSessionId')
      });
      return;
    }

    try {
      const eventType = payload.role === 'USER' ? 'user_message' : 'ai_message';
      
      // console.log('📝 Attempting to log conversation message:', {
      //   sessionId: currentSessionId,
      //   type: eventType,
      //   contentPreview: payload.content.substring(0, 50) + (payload.content.length > 50 ? '...' : ''),
      // });
      
      await logSessionEvent(currentSessionId, eventType, {
        ...payload,
        timestamp: new Date().toISOString(),
        messageIndex: messageCounterRef.current,
      });
      
      // console.log(`📝 ✅ Successfully logged ${payload.role} message to database:`, {
      //   sessionId: currentSessionId,
      //   type: eventType,
      //   contentPreview: payload.content.substring(0, 50) + (payload.content.length > 50 ? '...' : ''),
      //   state: payload.conversationState
      // });
    } catch (error) {
      console.error('❌ Failed to log conversation message:', error);
      // Don't throw - logging failure shouldn't break the conversation flow
    }
  }, [sessionId, enableLogging]);
  
  const dismiss = () => setNudge((n) => ({ ...n, show: false }));
  const nudgeTimeout = React.useRef<number | null>(null);
  const lastCoachCallAt = React.useRef<number>(0);

  const showNudge = React.useCallback((msg: string, type: NudgeType) => {
    setNudge({ show: true, msg, type });
    if (nudgeTimeout.current) window.clearTimeout(nudgeTimeout.current);
    nudgeTimeout.current = window.setTimeout(() => setNudge((p) => ({ ...p, show: false })), 3000);
  }, []);

  const handleAmplitude = React.useCallback((level: number) => {
    // Simple heuristics: low volume → speak up; clipping unlikely here
    if (level < 0.02) showNudge("Speak a bit louder for clarity", "volume");
  }, [showNudge]);

  const toggleAudioMute = React.useCallback(() => {
    // Only allow mute/unmute if not paused (pause has its own mute logic)
    if (isPaused) return;
    
    const newMuteState = !isAudioMuted;
    setIsAudioMuted(newMuteState);
    
    // Apply mute state to the ASR provider if it exists
    if (asrRef.current && 'setAudioInputMuted' in asrRef.current) {
      (asrRef.current as AsrProvider & { setAudioInputMuted: (muted: boolean) => void }).setAudioInputMuted(newMuteState);
    }
    
    console.log(`🔇 Audio input ${newMuteState ? 'MUTED' : 'UNMUTED'} by user - ${newMuteState ? 'no audio will be sent' : 'audio transmission resumed'}`);
  }, [isAudioMuted, isPaused]);

  const handleStartRecording = React.useCallback(async () => {
    if (audioRecorderRef.current) {
      audioRecorderRef.current.start();
      setIsPaused(false);
      
      // Start the session timer
      startTimer();
      
      // Always start a new session for time and token tracking
      if (!sessionId) {
        try {
          const session = await startSession();
          setSessionId(session.id);
          // Save to localStorage for persistence across page refreshes
          localStorage.setItem('currentSessionId', session.id);
          console.log('🆕 Started new session for tracking:', session.id);
        } catch (error) {
          console.error('❌ Failed to start session:', error);
        }
      }
    }
  }, [sessionId, startTimer]);

  const handlePauseRecording = React.useCallback(() => {
    // Pause: Temporarily mute audio input but keep session alive
    setIsAudioMuted(true);
    setIsPaused(true);
    
    // Pause the session timer but don't reset it
    stopTimer();
    
    // Apply mute to ASR provider to pause input
    if (asrRef.current && 'setAudioInputMuted' in asrRef.current) {
      (asrRef.current as AsrProvider & { setAudioInputMuted: (muted: boolean) => void }).setAudioInputMuted(true);
    }
    
    console.log('⏸️ PAUSED: Audio input temporarily muted - conversation context preserved');
  }, [stopTimer]);

  const handleResumeRecording = React.useCallback(() => {
    // Resume: Unmute audio input and continue with preserved context
    setIsAudioMuted(false);
    setIsPaused(false);
    
    // Resume the session timer
    startTimer();
    
    // Remove mute from ASR provider to resume input
    if (asrRef.current && 'setAudioInputMuted' in asrRef.current) {
      (asrRef.current as AsrProvider & { setAudioInputMuted: (muted: boolean) => void }).setAudioInputMuted(false);
    }
    
    console.log('▶️ RESUMED: Audio input restored - continuing conversation with preserved context');
  }, [startTimer]);

  const handleStopRecording = React.useCallback(async () => {
    // Stop: Completely end the conversation session
    console.log('⏹️ STOPPING: Terminating entire conversation session...');
    
    // 1. Stop the session timer and get final duration
    stopTimer();
    
    // 2. Force final token save if there's pending data
    if (pendingTokenDataRef.current) {
      // console.log('💾 Forcing final token save before session end...');
      await updateTokens({
        ...pendingTokenDataRef.current,
        forceDbSave: true
      });
    }
    
    // 3. Always end the database session to save time and token data
    if (sessionId) {
      try {
        const sessionData = await endSession(sessionId, {
          completedAt: new Date().toISOString(),
          actualDuration: currentSessionSeconds // Pass the actual timer duration
        });
        // console.log('💾 Session ended with duration:', sessionData.duration, 'seconds');
        
        // Reload cumulative time and token data after ending session
        await loadCumulativeTime();
        await loadTokenData();
      } catch (error) {
        console.error('❌ Failed to end session:', error);
      }
    }
    
    // 3. Stop the audio recorder
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop();
    }
    
    // 4. Stop the ASR provider and Nova Sonic session
    if (asrRef.current && 'stop' in asrRef.current) {
      try {
        await (asrRef.current as AsrProvider & { stop: () => Promise<void> }).stop();
        console.log('🛑 Nova Sonic session terminated');
      } catch (error) {
        console.error('❌ Error stopping Nova Sonic session:', error);
      }
      // Clear the reference to prevent reuse
      asrRef.current = null;
    }
    
    // 5. Reset all UI states
    setIsPaused(false);
    setIsAudioMuted(false);
    setIsProcessingLongResponse(false);
    setLiveText('');
    
    // 6. Reset conversation state
    conversationStateRef.current = 'waiting_for_user';
    expectingUserInputRef.current = false;
    currentMessageIdRef.current = null;
    
    // 7. Clear ASR reference and initialization flag to force new session on next start
    asrRef.current = null;
    isInitializingAsrRef.current = false;
    
    // 8. Clear chat messages since context is lost
    setChatMessages([]);
    
    // 9. Reset session ID and timer, clear localStorage
    setSessionId(null);
    localStorage.removeItem('currentSessionId');
    localStorage.removeItem('currentSessionTimer');
    resetTimer();
    
    console.log('✅ CONVERSATION STOPPED: Session completely terminated - context and persistence cleared');
  }, [sessionId, stopTimer, loadCumulativeTime, loadTokenData, resetTimer]);

  React.useEffect(() => {
  fetch("/api/config/asr", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setProviderName(String(d?.provider || d?.asrWorkflow || "unknown")))
      .catch(() => setProviderName("unknown"));
  }, []);

  const handleTranscript = React.useCallback((text: string, meta?: AsrTranscript) => {
    
    // Skip duplicate texts to prevent message duplication
    if (text === lastProcessedTextRef.current && meta?.isFinal) {
      return;
    }
    
    // Update last processed text for final messages
    if (meta?.isFinal) {
      lastProcessedTextRef.current = text;
    }
    
      // CHATGPT APPROACH: Ignore Nova Sonic's built-in interruption signals
      // We handle barge-in purely on the client side, so Nova Sonic interruption signals are not needed
      const isJsonInterruptSignal = text.trim() === '{ "interrupted" : true }' || text.trim() === '{"interrupted": true}';
      
      if (isJsonInterruptSignal) {
        console.log(`🔇 📡 NOVA SONIC: Ignoring built-in interruption signal (ChatGPT approach handles barge-in client-side) at ${new Date().toLocaleTimeString()}.${Date.now() % 1000}`);
        return; // CRITICAL: Ignore Nova Sonic interruption signals in ChatGPT approach
      }
    
    // SERVER-DRIVEN message classification (following reference app approach)
    const serverRole = meta?.role; // 'USER' or 'ASSISTANT' from server
    
    // Handle USER messages - ACCUMULATE LIKE ASSISTANT MESSAGES
    if (serverRole === 'USER' && meta?.isFinal && text.trim()) {
      
      setChatMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        
        if (lastMessage && lastMessage.type === 'user') {
          // Check for duplicate content to prevent duplication
          const trimmedText = text.trim();
          const lastContent = lastMessage.content.trim();
          
          // If the new text is already contained in the last message, skip it
          if (lastContent.includes(trimmedText)) {
            return prev;
          }
          
          // Same role (USER), append to the last turn
          return prev.map((msg, index) => 
            index === prev.length - 1 
              ? { ...msg, content: msg.content + ' ' + text, timestamp: new Date() }
              : msg
          );
        } else {
          // Different role or first message, add a new turn
          messageCounterRef.current += 1;
          const userMessage: ChatMessage = {
            id: `user-${Date.now()}-${messageCounterRef.current}`,
            type: 'user',
            content: text,
            timestamp: new Date(),
          };
          return [...prev, userMessage];
        }
      });
      
      // Log user message to database
      logConversationMessage({
        role: 'USER',
        content: text,
        conversationState: conversationStateRef.current,
        confidence: meta?.confidence,
        provider: providerName
      });
      
      // Transition state to wait for AI response and prepare for AI message
      conversationStateRef.current = 'waiting_for_ai';
      const nextAiCounter = messageCounterRef.current + 1;
      currentMessageIdRef.current = `ai-${Date.now()}-${nextAiCounter}`;
      
      // Start long response detection timer
      setTimeout(() => {
        if (conversationStateRef.current === 'waiting_for_ai') {
          setIsProcessingLongResponse(true);
          console.log('⏳ Long response detected - showing processing indicator');
        }
      }, 3000); // Show indicator after 3 seconds of waiting
      
      return;
    }
    
      // Handle ASSISTANT messages - REFERENCE APP EXACT MATCH
      if (serverRole === 'ASSISTANT' && text.trim()) {
        
        setChatMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          
          if (lastMessage && lastMessage.type === 'assistant') {
            // Check for duplicate content to prevent Nova Sonic duplication
            const trimmedText = text.trim();
            const lastContent = lastMessage.content.trim();
            
            // If the new text is already contained in the last message, skip it
            if (lastContent.includes(trimmedText)) {
              return prev;
            }
            
            // Same role, append to the last turn (EXACT reference app logic)
            return prev.map((msg, index) => 
              index === prev.length - 1 
                ? { ...msg, content: msg.content + ' ' + text, timestamp: new Date() }
                : msg
            );
          } else {
            // Different role, add a new turn (EXACT reference app logic)
            messageCounterRef.current += 1;
            const messageId = `ai-${Date.now()}-${messageCounterRef.current}`;
            
            const aiMessage: ChatMessage = {
            id: messageId,
            type: 'assistant',
            content: text,
            timestamp: new Date(),
          };
          return [...prev, aiMessage];
        }
      });
      
      // Log only final AI messages to database
      if (meta?.isFinal) {
        logConversationMessage({
          role: 'ASSISTANT',
          content: text,
          conversationState: conversationStateRef.current,
          confidence: meta?.confidence,
          provider: providerName,
          isInterrupted: false
        });
        
        // AI turn is over, reset for next user input
        conversationStateRef.current = 'waiting_for_user';
      } else {
        // Ensure we are in the 'ai_responding' state for partial messages
        if (conversationStateRef.current === 'waiting_for_ai') {
          conversationStateRef.current = 'ai_responding';
          setIsProcessingLongResponse(false); // Clear processing indicator
          console.log(`🔄 State transition: -> ai_responding`);
        }
      }
      
      return;
    }
    
    // Fallback for messages without server role (backward compatibility) - ACCUMULATE LIKE OTHER MESSAGES
    if (!serverRole && meta?.isFinal && text.trim()) {
      const isFirstMessage = chatMessages.length === 0;
      if (conversationStateRef.current === 'waiting_for_user' || isFirstMessage) {
        console.log(`👤 USER message (fallback - no server role):`, { text });
        
        setChatMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          
          if (lastMessage && lastMessage.type === 'user') {
            // Check for duplicate content to prevent duplication
            const trimmedText = text.trim();
            const lastContent = lastMessage.content.trim();
            
            // If the new text is already contained in the last message, skip it
            if (lastContent.includes(trimmedText)) {
              return prev;
            }
            
            // Same role (USER), append to the last turn
            return prev.map((msg, index) => 
              index === prev.length - 1 
                ? { ...msg, content: msg.content + ' ' + text, timestamp: new Date() }
                : msg
            );
          } else {
            // Different role or first message, add a new turn
            messageCounterRef.current += 1;
            const userMessage: ChatMessage = {
              id: `user-${Date.now()}-${messageCounterRef.current}`,
              type: 'user',
              content: text,
              timestamp: new Date(),
            };
            return [...prev, userMessage];
          }
        });
        
        logConversationMessage({
          role: 'USER',
          content: text,
          conversationState: conversationStateRef.current,
          confidence: meta?.confidence,
          provider: providerName
        });
        
        conversationStateRef.current = 'waiting_for_ai';
        const nextAiCounter = messageCounterRef.current + 1;
        currentMessageIdRef.current = `ai-${Date.now()}-${nextAiCounter}`;
        
        return;
      } else {
        console.warn('⚠️ No server role provided for message, ignoring:', { text, meta });
        return;
      }
    }

    const lower = text.toLowerCase();
    const fillers = ["um", "uh", "like ", "you know", "basically", "actually"];
    if (fillers.some((f) => lower.includes(f))) {
      showNudge("Try reducing filler words", "filler");
      if (sessionId) logSessionEvent(sessionId, "nudge", { type: "filler", message: "Try reducing filler words" }).catch(() => {});
    }
    const words = lower.trim().split(/\s+/).filter(Boolean);
    // Very naive pace check: >150 wpm equivalent if >25 words in 10s chunk (not exact here)
    if (words.length > 25) {
      showNudge("Slow down a touch for clarity", "pace");
      if (sessionId) logSessionEvent(sessionId, "nudge", { type: "pace", message: "Slow down a touch for clarity" }).catch(() => {});
    }

    // ASR latency metric (approx): now minus provider event timestamp
    if (sessionId && meta?.timestamp) {
      const latency = Math.max(0, Date.now() - meta.timestamp);
      logSessionEvent(sessionId, "metric", { name: "asr_latency_ms", value: latency, isFinal: !!meta.isFinal }).catch(() => {});
    }

    // Call server coach for smarter nudges (throttled)
    const now = Date.now();
    if (now - lastCoachCallAt.current > 1500 && text.trim().length > 12) {
      lastCoachCallAt.current = now;
      // Estimate simple filler count in the snippet
      const fillerCount = fillers.reduce((acc, f) => acc + (lower.includes(f) ? 1 : 0), 0);
      const coachStart = Date.now();
      fetch("/api/coach/nudges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, fillerCount, timestamp: now }),
      })
        .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json())))
        .then((data) => {
          // Coach latency metric
          if (sessionId) {
            const coachLatency = Math.max(0, Date.now() - coachStart);
            logSessionEvent(sessionId, "metric", { name: "coach_latency_ms", value: coachLatency }).catch(() => {});
          }
          const first = data?.nudges?.[0];
          if (first?.message && first?.type) {
            showNudge(String(first.message), String(first.type) as NudgeType);
            if (sessionId) logSessionEvent(sessionId, "nudge", first).catch(() => {});
          }
        })
        .catch(() => {
          // silent fail for UX; consider logging later
        });
    }
  }, [showNudge, sessionId, chatMessages.length, logConversationMessage, providerName]);

  // Wire ASR provider to emit transcripts to our nudge logic
  const asrRef = React.useRef<AsrProvider | null>(null);
  const isInitializingAsrRef = React.useRef<boolean>(false);

  const ensureAsrStarted = React.useCallback(async (forceRestart = false) => {
    // Prevent concurrent initialization attempts
    if (isInitializingAsrRef.current) {
      console.log('⏳ ASR initialization already in progress, skipping');
      return;
    }
    
    // If we already have an ASR provider and don't need to force restart, just return
    if (asrRef.current && !forceRestart) {
      console.log('🔄 ASR provider already exists, skipping initialization');
      return;
    }
    
    isInitializingAsrRef.current = true;
    
    // If forcing restart, properly clean up the existing provider first
    if (forceRestart && asrRef.current) {
      console.log('🧹 Force restart requested - cleaning up existing ASR provider');
      
      // First try to reset for new turn (preferred for barge-in scenarios)
      if ('resetForNewTurn' in asrRef.current) {
        (asrRef.current as AsrProvider & { resetForNewTurn: () => void }).resetForNewTurn();
        console.log('🔄 ASR provider reset for new turn (barge-in)');
        isInitializingAsrRef.current = false;
        return;
      }
      
      // If resetForNewTurn is not available, stop the existing provider
      if ('stop' in asrRef.current) {
        try {
          await (asrRef.current as AsrProvider & { stop: () => Promise<void> }).stop();
          console.log('🛑 Existing ASR provider stopped for restart');
        } catch (error) {
          console.error('❌ Error stopping existing ASR provider:', error);
        }
      }
      asrRef.current = null;
    }
    
    // console.log('🚀 Creating new ASR provider instance');
    const asr = await getAsrProvider();
    
    // Set up transcript handlers
    asr.onPartial((t) => { setLiveText(t.text); handleTranscript(t.text, t); });
    asr.onFinal((t) => { setLiveText(t.text); handleTranscript(t.text, t); });
    
    // Set up token usage tracking callback - process all updates but throttle DB saves
    if ('onTokenUsage' in asr) {
      (asr as AsrProvider & { onTokenUsage: (callback: (tokenData: any) => void) => void }).onTokenUsage((tokenData: any) => {
        
          if (SHOULD_DEBUG) {
            // console.log('💰 Token usage update:', tokenData);
            // console.log('💰 Token details object:', tokenData.details);
            
            // Enhanced debugging for token inflation issues
            // console.log('💰 TOKEN BREAKDOWN ANALYSIS:');
            console.log(`   - totalInputTokens: ${tokenData.totalInputTokens}`);
            console.log(`   - totalOutputTokens: ${tokenData.totalOutputTokens}`);
            console.log(`   - totalTokens: ${tokenData.totalTokens}`);
            
            if (tokenData.details?.total) {
              const total = tokenData.details.total;
              // console.log('💰 DETAILED TOKEN ANALYSIS:');
              if (total.input) {
                console.log(`   - Input Speech: ${total.input.speechTokens || total.input.speech || 0}`);
                console.log(`   - Input Text: ${total.input.textTokens || total.input.text || 0}`);
              }
              if (total.output) {
                console.log(`   - Output Speech: ${total.output.speechTokens || total.output.speech || 0}`);
                console.log(`   - Output Text: ${total.output.textTokens || total.output.text || 0}`);
              }
            }
          }
        
        // CRITICAL FIX: Get current sessionId from localStorage instead of closure
        const currentSessionId = localStorage.getItem('currentSessionId');
        // if (SHOULD_DEBUG) console.log('💰 Current sessionId when token received:', currentSessionId);
        
        const { speechInput, speechOutput, textInput, textOutput } = parseNovaTokenBreakdown(tokenData, SHOULD_DEBUG);
        // if (SHOULD_DEBUG) console.log('💰 Final token breakdown:', { speechInput, speechOutput, textInput, textOutput });
        
        updateTokens({
          speechInput,
          speechOutput,
          textInput,
          textOutput,
          sessionId: currentSessionId,
          isCumulative: true // Nova Sonic sends cumulative totals, not deltas
        });
      });
    }
    
    // Apply current mute state to the ASR provider
    if ('setAudioInputMuted' in asr) {
      (asr as AsrProvider & { setAudioInputMuted: (muted: boolean) => void }).setAudioInputMuted(isAudioMuted);
    }
    
    // CRITICAL: Handle barge-in events for immediate state transition
    if (asr.onBargeIn) {
      asr.onBargeIn(() => {
        console.log(`🔔 BARGE-IN CALLBACK at ${new Date().toLocaleTimeString()}.${Date.now() % 1000}: Transitioning from ai_responding -> user_speaking`);
        conversationStateRef.current = 'user_speaking';
        setRecorderState('listening');
        
        // Clear any active AI message since it was interrupted
        currentMessageIdRef.current = null;
      });
    }
    
    try { 
      await asr.start();
      console.log('✅ ASR provider started successfully');
      asrRef.current = asr;
    } catch (err) { 
      console.error("❌ ASR failed to start:", (err as Error)?.message || err); 
    } finally {
      isInitializingAsrRef.current = false;
    }
  }, [handleTranscript, isAudioMuted, updateTokens]);

  // Link recorder state to our conversation state machine
  React.useEffect(() => {
    if (recorderState === 'listening') {
      const previousState = conversationStateRef.current;
      
      // BARGE-IN DETECTION: If user starts speaking while AI is responding
      if (previousState === 'ai_responding') {
        
        // Mark current AI message as interrupted
        if (currentMessageIdRef.current) {
          setChatMessages(prev => 
            prev.map(msg => 
              msg.id === currentMessageIdRef.current 
                ? { ...msg, isInterrupted: true }
                : msg
            )
          );
          console.log(`🔇 Marked message ${currentMessageIdRef.current} as interrupted`);
          
          // Log the barge-in interruption event
          logConversationMessage({
            role: 'ASSISTANT',
            content: '[INTERRUPTED BY BARGE-IN]',
            conversationState: previousState,
            provider: providerName,
            isInterrupted: true
          });
        }
        
        // Clear current AI message tracking
        currentMessageIdRef.current = null;
      }
      
      // Transition to user speaking (regardless of previous state)
      conversationStateRef.current = 'user_speaking';
      expectingUserInputRef.current = true; // User is about to speak
      
      // Start the ASR provider (Nova Sonic) when user starts speaking
      // Force restart during barge-in to ensure proper state transition
      const shouldForceRestart = previousState === 'ai_responding';
      ensureAsrStarted(shouldForceRestart).catch(err => {
        console.error('Failed to start ASR provider:', err);
      });
      
    } else if (recorderState === 'idle' && conversationStateRef.current === 'user_speaking') {
      // User has stopped talking, but we haven't received the final transcript yet.
      // The handleTranscript function will transition to 'waiting_for_ai'
      console.log(`🎤 Recorder is idle. Awaiting final transcript.`);
    }
  }, [recorderState, ensureAsrStarted, logConversationMessage, providerName, chatMessages.length]);

  // Cleanup ASR provider on component unmount to prevent memory leaks
  React.useEffect(() => {
    return () => {
      // Cleanup function runs when component unmounts
      if (asrRef.current && 'stop' in asrRef.current) {
        console.log('🧹 Component unmounting - cleaning up ASR provider');
        (asrRef.current as AsrProvider & { stop: () => Promise<void> }).stop()
          .catch(error => console.error('❌ Error during cleanup:', error));
        asrRef.current = null;
      }
    };
  }, []);

  // Removed unused stopAsr function - ASR lifecycle is now managed automatically

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <header className="mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold">Practice Session</h1>
            <p className="text-muted-foreground">Speak naturally. We&apos;ll listen and nudge you gently.</p>
          </div>
          <HeaderTimeDisplay
            cumulativeHours={cumulativeData?.totalHours || 0}
            currentSessionSeconds={currentSessionSeconds}
            isLoadingCumulative={isLoadingCumulative}
            totalTokens={tokenData?.totalTokens || 0}
            completedSessions={cumulativeData?.completedSessions || 0}
            currentSessionTokens={currentSessionTokens.total}
            previousSessionMinutes={cumulativeData?.previousSession?.minutes || 0}
            previousSessionTokens={previousTokenData?.totalTokens || 0}
            totalWords={cumulativeData?.totalWords || 0}
            totalChars={cumulativeData?.totalChars || 0}
            previousSessionWords={cumulativeData?.previousSession?.words || 0}
            previousSessionChars={cumulativeData?.previousSession?.chars || 0}
          />
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Microphone Controls */}
          <Card className="h-[600px]">
            <CardHeader>
              <CardTitle>Microphone</CardTitle>
              <CardDescription>
                <span className="inline-flex items-center gap-2 text-xs">
                  <span>ASR Provider</span>
                  <Badge variant="secondary">{providerName}</Badge>
                </span>
              </CardDescription>
              <div className="px-6 pb-2">
                <label className="inline-flex items-center gap-2 text-xs cursor-pointer text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={enableLogging}
                    onChange={(e) => setEnableLogging(e.target.checked)}
                    className="w-3 h-3 rounded border-gray-300"
                  />
                  <span>Enable conversation logging to database</span>
                </label>
              </div>
            </CardHeader>
            <CardContent className="h-full overflow-y-auto">
              <div className="flex flex-col items-center gap-6">
                
                {/* Main Control Buttons */}
                <div className="flex items-center gap-3">
                  {/* Start/Pause/Resume Button */}
                  <button
                    onClick={() => {
                      if (recorderState === "listening" && !isPaused) {
                        // Pause: Keep session alive, temporarily stop audio input
                        handlePauseRecording();
                      } else if (recorderState === "listening" && isPaused) {
                        // Resume: Continue with preserved context
                        handleResumeRecording();
                      } else if (recorderState === "idle") {
                        // Start: Begin new conversation
                        handleStartRecording();
                      }
                    }}
                    className={`h-11 px-4 rounded-lg text-sm font-medium text-white transition-all ${
                      recorderState === "listening" && isPaused
                        ? 'bg-green-500 hover:bg-green-600'  // Resume (green)
                        : recorderState === "listening" 
                        ? 'bg-yellow-500 hover:bg-yellow-600'  // Pause (yellow)
                        : 'bg-blue-500 hover:bg-blue-600'     // Start (blue)
                    }`}
                    disabled={recorderState === "starting"}
                  >
                    {recorderState === "listening" && isPaused ? "▶️ Resume" : 
                     recorderState === "listening" ? "⏸️ Pause" : 
                     recorderState === "starting" ? "⏳ Starting..." : 
                     "▶️ Start"}
                  </button>

                  {/* Stop Button */}
                  <button
                    onClick={handleStopRecording}
                    className="h-11 px-4 rounded-lg bg-red-500 hover:bg-red-600 text-sm font-medium text-white transition-all"
                    disabled={recorderState === "idle"}
                  >
                    ⏹️ Stop
                  </button>

                  {/* Mute/Unmute Button */}
                  <button
                    onClick={toggleAudioMute}
                    className={`h-11 px-4 rounded-lg text-sm font-medium text-white transition-all ${
                      isPaused || isAudioMuted 
                        ? 'bg-gray-500 hover:bg-gray-600' 
                        : 'bg-green-500 hover:bg-green-600'
                    }`}
                    disabled={isPaused}
                    title={
                      isPaused ? "Audio paused - use Resume to continue" :
                      isAudioMuted ? "Click to unmute microphone" : "Click to mute microphone"
                    }
                  >
                    {isPaused ? "⏸️ Paused" : isAudioMuted ? "🔇 Muted" : "🎤 Live"}
                  </button>
                </div>

                {/* Status Display */}
                <div className="text-center">
                  <div className="text-lg font-medium">
                    {recorderState === "stopping" ? "🛑 Stopping Session..." :
                     isProcessingLongResponse ? "🧠 Processing Long Response..." :
                     recorderState === "listening" && isPaused ? "⏸️ Paused - Context Preserved" : 
                     recorderState === "listening" ? "🎤 Listening..." : 
                     recorderState === "starting" ? "⏳ Starting..." : 
                     recorderState === "error" ? "❌ Error" : 
                     ""}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {recorderState === "stopping" ? "Terminating Nova Sonic session and cleaning up resources..." :
                     isProcessingLongResponse ? "AI is analyzing your detailed response - this may take a moment for complex answers" :
                     recorderState === "listening" && isPaused ? "Session active - Resume to continue conversation" :
                     isAudioMuted ? "Audio muted - no transmission" : 
                     recorderState === "idle" ? "" :
                     "Audio ready for transmission"}
                  </div>
                </div>

                {/* Token Usage & Cost Tracking */}
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 space-y-3">
                  <div className="text-sm font-medium text-foreground mb-2">💰 Token Usage & Cost</div>
                  
                  {/* Current Session */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-foreground">Current Session</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between">
                        <span>🎤 Speech In:</span>
                        <span>{currentSessionTokens.speechInput.toLocaleString()} tokens</span>
                      </div>
                      <div className="flex justify-between">
                        <span>🔊 Speech Out:</span>
                        <span>{currentSessionTokens.speechOutput.toLocaleString()} tokens</span>
                      </div>
                      <div className="flex justify-between">
                        <span>📝 Text In:</span>
                        <span>{currentSessionTokens.textInput.toLocaleString()} tokens</span>
                      </div>
                      <div className="flex justify-between">
                        <span>📄 Text Out:</span>
                        <span>{currentSessionTokens.textOutput.toLocaleString()} tokens</span>
                      </div>
                    </div>
                    <div className="border-t pt-1 flex justify-between text-xs font-medium">
                      <span>Session Total:</span>
                      <span>{currentSessionTokens.total.toLocaleString()} tokens (${calculateCost(currentSessionTokens).total.toFixed(4)})</span>
                    </div>
                  </div>

                  {/* Previous Session */}
                  {previousTokenData && (
                    <div className="space-y-2 border-t pt-2">
                      <div className="text-xs font-medium text-foreground">Previous Session</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex justify-between">
                          <span>🎤 Speech In:</span>
                          <span>{previousTokenData.speechInput.toLocaleString()} tokens</span>
                        </div>
                        <div className="flex justify-between">
                          <span>🔊 Speech Out:</span>
                          <span>{previousTokenData.speechOutput.toLocaleString()} tokens</span>
                        </div>
                        <div className="flex justify-between">
                          <span>📝 Text In:</span>
                          <span>{previousTokenData.textInput.toLocaleString()} tokens</span>
                        </div>
                        <div className="flex justify-between">
                          <span>📄 Text Out:</span>
                          <span>{previousTokenData.textOutput.toLocaleString()} tokens</span>
                        </div>
                      </div>
                      <div className="border-t pt-1 flex justify-between text-xs font-medium">
                        <span>Previous Total:</span>
                        <span>{previousTokenData.totalTokens.toLocaleString()} tokens (${previousTokenData.totalCost.toFixed(4)})</span>
                      </div>
                    </div>
                  )}

                  {/* Accumulated Usage */}
                  <div className="space-y-2 border-t pt-2">
                    <div className="text-xs font-medium text-foreground">Accumulated (All Sessions)</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between">
                        <span>🎤 Speech In:</span>
                        <span>{accumulatedTokens.speechInput.toLocaleString()} tokens</span>
                      </div>
                      <div className="flex justify-between">
                        <span>🔊 Speech Out:</span>
                        <span>{accumulatedTokens.speechOutput.toLocaleString()} tokens</span>
                      </div>
                      <div className="flex justify-between">
                        <span>📝 Text In:</span>
                        <span>{accumulatedTokens.textInput.toLocaleString()} tokens</span>
                      </div>
                      <div className="flex justify-between">
                        <span>📄 Text Out:</span>
                        <span>{accumulatedTokens.textOutput.toLocaleString()} tokens</span>
                      </div>
                    </div>
                    <div className="border-t pt-1 flex justify-between text-xs font-medium text-green-600 dark:text-green-400">
                      <span>Total Cost:</span>
                      <span>{accumulatedTokens.total.toLocaleString()} tokens (${calculateCost(accumulatedTokens).total.toFixed(4)})</span>
                    </div>
                  </div>
                </div>

                {/* Hidden AudioRecorder for functionality */}
                <div className="hidden">
                  <AudioRecorder
                    ref={audioRecorderRef}
                    autoStart={false}
                    useWebSpeechFallback={false}
                    onAmplitude={handleAmplitude}
                    onPartial={handleTranscript}
                    onFinal={handleTranscript}
                    onStateChange={setRecorderState}
                    recorderState={recorderState}
                  />
                </div>
                <div className="w-full text-sm text-muted-foreground max-w-xl">
                  <div className="font-medium mb-1 text-foreground">Live Transcript</div>
                  <div className="rounded-md border p-3 min-h-[48px] whitespace-pre-wrap break-words">{liveText || "…"}</div>
                </div>
                <p className="text-sm text-muted-foreground">Tip: Pause briefly after key points.</p>
              </div>
            </CardContent>
          </Card>

          {/* Right Column - Chat Interface */}
          <Card className="h-[600px]">
            <ChatInterface messages={chatMessages} className="h-full" />
          </Card>
        </div>
      </div>

      <NudgePopup show={nudge.show} message={nudge.msg} type={nudge.type} onDismiss={dismiss} />
    </div>
  );
}
