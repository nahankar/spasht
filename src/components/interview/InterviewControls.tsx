"use client";

import { Pause, Play, Square } from 'lucide-react';

interface InterviewControlsProps {
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  isActive: boolean;
  isPaused: boolean;
  className?: string;
}

export default function InterviewControls({
  onPause,
  onResume,
  onStop,
  isActive,
  isPaused,
  className = ""
}: InterviewControlsProps) {
  // Only show controls when interview is active
  if (!isActive) {
    return null;
  }

  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      {/* Pause/Resume Button */}
      <button
        onClick={isPaused ? onResume : onPause}
        className={`flex items-center gap-2 px-3 py-2 h-10 rounded-full text-sm font-medium transition-colors ${
          isPaused 
            ? 'bg-green-600 hover:bg-green-700 text-white' 
            : 'bg-yellow-600 hover:bg-yellow-700 text-white'
        }`}
        title={isPaused ? 'Resume Interview' : 'Pause Interview'}
      >
        {isPaused ? (
          <>
            <Play className="w-4 h-4" />
            <span>Resume</span>
          </>
        ) : (
          <>
            <Pause className="w-4 h-4" />
            <span>Pause</span>
          </>
        )}
      </button>

      {/* Stop Button */}
      <button
        onClick={onStop}
        className="flex items-center gap-2 px-3 py-2 h-10 rounded-full text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
        title="Stop Interview"
      >
        <Square className="w-4 h-4" />
        <span>Stop</span>
      </button>
    </div>
  );
}
