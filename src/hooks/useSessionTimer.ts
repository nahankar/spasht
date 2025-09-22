import { useState, useEffect, useRef } from 'react';

interface SessionTimeData {
  totalHours: number;
  totalSeconds: number;
  completedSessions: number;
  totalSessions: number;
  totalWords?: number;
  totalChars?: number;
  previousSession?: {
    duration: number;
    hours: number;
    minutes: number;
    startedAt: string;
    completedAt: string;
    words?: number;
    chars?: number;
  } | null;
}

interface TokenData {
  totalTokens: number;
  speechInput: number;
  speechOutput: number;
  textInput: number;
  textOutput: number;
}

interface PreviousSessionData {
  totalTokens: number;
  speechInput: number;
  speechOutput: number;
  textInput: number;
  textOutput: number;
  totalCost: number;
}

interface UseSessionTimerReturn {
  // Cumulative time data
  cumulativeData: SessionTimeData | null;
  isLoadingCumulative: boolean;
  
  // Token data
  tokenData: TokenData | null;
  previousTokenData: PreviousSessionData | null;
  isLoadingTokens: boolean;
  
  // Current session time
  currentSessionMinutes: number;
  currentSessionSeconds: number;
  
  // Control functions
  startTimer: () => void;
  stopTimer: () => void;
  resetTimer: () => void;
  
  // Loading functions
  loadCumulativeTime: () => Promise<void>;
  loadTokenData: () => Promise<void>;
}

export function useSessionTimer(): UseSessionTimerReturn {
  const [cumulativeData, setCumulativeData] = useState<SessionTimeData | null>(null);
  const [isLoadingCumulative, setIsLoadingCumulative] = useState(false);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [previousTokenData, setPreviousTokenData] = useState<PreviousSessionData | null>(null);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [currentSessionSeconds, setCurrentSessionSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Restore session timer state from localStorage on mount
  useEffect(() => {
    const savedSessionData = localStorage.getItem('currentSessionTimer');
    if (savedSessionData) {
      try {
        const { startTime, wasRunning } = JSON.parse(savedSessionData);
        if (startTime && wasRunning) {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          setCurrentSessionSeconds(elapsed);
          startTimeRef.current = startTime;
          
          // Resume the timer if it was running
          setIsRunning(true);
          intervalRef.current = setInterval(() => {
            const newElapsed = Math.floor((Date.now() - startTime) / 1000);
            setCurrentSessionSeconds(newElapsed);
          }, 1000);
          
          console.log('🔄 Restored session timer from localStorage:', elapsed, 'seconds');
        }
      } catch (error) {
        console.error('Failed to restore session timer:', error);
        localStorage.removeItem('currentSessionTimer');
      }
    }
  }, []);

  // Load cumulative time data from API
  const loadCumulativeTime = async () => {
    setIsLoadingCumulative(true);
    try {
      const response = await fetch('/api/sessions/time');
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setCumulativeData(result.data);
        }
      }
    } catch (error) {
      console.error('Failed to load cumulative time:', error);
    } finally {
      setIsLoadingCumulative(false);
    }
  };

  // Start the current session timer
  const startTimer = () => {
    if (!isRunning) {
      setIsRunning(true);
      startTimeRef.current = Date.now() - (currentSessionSeconds * 1000);
      
      // Save to localStorage for persistence across page refreshes
      localStorage.setItem('currentSessionTimer', JSON.stringify({
        startTime: startTimeRef.current,
        wasRunning: true
      }));
      
      intervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setCurrentSessionSeconds(elapsed);
        }
      }, 1000);
    }
  };

  // Stop the current session timer
  const stopTimer = () => {
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // Update localStorage to reflect stopped state
    const savedSessionData = localStorage.getItem('currentSessionTimer');
    if (savedSessionData) {
      try {
        const data = JSON.parse(savedSessionData);
        localStorage.setItem('currentSessionTimer', JSON.stringify({
          ...data,
          wasRunning: false
        }));
      } catch (error) {
        console.error('Failed to update session timer state:', error);
      }
    }
  };

  // Reset the current session timer
  const resetTimer = () => {
    stopTimer();
    setCurrentSessionSeconds(0);
    startTimeRef.current = null;
    
    // Clear localStorage when resetting
    localStorage.removeItem('currentSessionTimer');
  };

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Load token data from API
  const loadTokenData = async () => {
    setIsLoadingTokens(true);
    try {
      const response = await fetch('/api/tokens');
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          if (result.data.accumulated) {
            setTokenData(result.data.accumulated);
          }
          if (result.data.previous) {
            setPreviousTokenData(result.data.previous);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load token data:', error);
    } finally {
      setIsLoadingTokens(false);
    }
  };

  // Load cumulative data on mount
  useEffect(() => {
    loadCumulativeTime();
    loadTokenData();
  }, []);

  const currentSessionMinutes = Math.floor(currentSessionSeconds / 60);

  return {
    cumulativeData,
    isLoadingCumulative,
    tokenData,
    previousTokenData,
    isLoadingTokens,
    currentSessionMinutes,
    currentSessionSeconds,
    startTimer,
    stopTimer,
    resetTimer,
    loadCumulativeTime,
    loadTokenData,
  };
}
