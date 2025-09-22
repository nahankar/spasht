"use client";

import { Clock, Timer, Hash, Target, History } from "lucide-react";

interface HeaderTimeDisplayProps {
  cumulativeHours: number;
  currentSessionSeconds: number;
  isLoadingCumulative?: boolean;
  totalTokens?: number;
  completedSessions?: number;
  currentSessionTokens?: number;
  previousSessionMinutes?: number;
  previousSessionTokens?: number;
  // New: words and characters (raw counts)
  totalWords?: number;
  totalChars?: number;
  previousSessionWords?: number;
  previousSessionChars?: number;
}

export function HeaderTimeDisplay({ 
  cumulativeHours, 
  currentSessionSeconds,
  isLoadingCumulative = false,
  totalTokens = 0,
  completedSessions = 0,
  currentSessionTokens = 0,
  previousSessionMinutes = 0,
  previousSessionTokens = 0,
  totalWords = 0,
  totalChars = 0,
  previousSessionWords = 0,
  previousSessionChars = 0
}: HeaderTimeDisplayProps) {
  // Format current session time as MM:SS
  const formatCurrentSessionTime = () => {
    const minutes = Math.floor(currentSessionSeconds / 60);
    const seconds = currentSessionSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Format token counts for display
  const formatTokenCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const formatThousands = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  return (
    <div className="flex items-center gap-4 text-sm text-gray-600">
      {/* Current Session Time */}
      <div className="flex items-center gap-1">
        <Timer className="h-4 w-4 text-blue-600" />
        <span className="font-medium text-blue-600">
          {formatCurrentSessionTime()}
        </span>
      </div>
      
      {/* Previous Session Time */}
      {previousSessionMinutes > 0 && (
        <div className="flex items-center gap-1">
          <History className="h-4 w-4 text-amber-600" />
          <span className="font-medium text-amber-600">
            {previousSessionMinutes.toFixed(1)}m
          </span>
        </div>
      )}
      
      {/* Total Time */}
      <div className="flex items-center gap-1">
        <Clock className="h-4 w-4 text-purple-600" />
        <span className="font-medium text-purple-600">
          {isLoadingCumulative ? "..." : `${cumulativeHours.toFixed(1)}h`}
        </span>
      </div>

      {/* Current Session Tokens */}
      <div className="flex items-center gap-1">
        <Hash className="h-4 w-4 text-green-600" />
        <span className="font-medium text-green-600">
          {formatTokenCount(currentSessionTokens)}
        </span>
      </div>
      
      {/* Previous Session Tokens */}
      {previousSessionTokens > 0 && (
        <div className="flex items-center gap-1">
          <Hash className="h-4 w-4 text-yellow-600" />
          <span className="font-medium text-yellow-600">
            {formatTokenCount(previousSessionTokens)}
          </span>
        </div>
      )}
      
      {/* Total Tokens */}
      <div className="flex items-center gap-1">
        <Hash className="h-4 w-4 text-orange-600" />
        <span className="font-medium text-orange-600">
          {formatTokenCount(totalTokens)}
        </span>
      </div>

      {/* Total Words */}
      <div className="flex items-center gap-1">
        <Hash className="h-4 w-4 text-rose-600" />
        <span className="font-medium text-rose-600">
          {formatThousands(totalWords)}w
        </span>
      </div>

      {/* Total Characters */}
      <div className="flex items-center gap-1">
        <Hash className="h-4 w-4 text-teal-600" />
        <span className="font-medium text-teal-600">
          {formatThousands(totalChars)}c
        </span>
      </div>

      {/* Session Count */}
      <div className="flex items-center gap-1">
        <Target className="h-4 w-4 text-indigo-600" />
        <span className="font-medium text-indigo-600">
          {completedSessions}
        </span>
      </div>

      {/* Previous Session Words */}
      {previousSessionWords > 0 && (
        <div className="flex items-center gap-1">
          <History className="h-4 w-4 text-pink-600" />
          <span className="font-medium text-pink-600">
            {formatThousands(previousSessionWords)}w
          </span>
        </div>
      )}

      {/* Previous Session Characters */}
      {previousSessionChars > 0 && (
        <div className="flex items-center gap-1">
          <History className="h-4 w-4 text-cyan-600" />
          <span className="font-medium text-cyan-600">
            {formatThousands(previousSessionChars)}c
          </span>
        </div>
      )}
    </div>
  );
}
