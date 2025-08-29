"use client";
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, PauseCircle, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type NudgeType = "pace" | "confidence" | "filler" | "volume" | "clarity";

export interface NudgePopupProps {
  show: boolean;
  message: string;
  type?: NudgeType;
  onDismiss?: () => void;
  className?: string;
}

const typeStyles: Record<NudgeType, string> = {
  pace: "border-orange-400",
  confidence: "border-purple-400",
  filler: "border-blue-400",
  volume: "border-green-400",
  clarity: "border-amber-400",
};

const typeIcon: Record<NudgeType, React.ReactElement> = {
  pace: <PauseCircle className="h-4 w-4 text-orange-500" />,
  confidence: <AlertTriangle className="h-4 w-4 text-purple-500" />,
  filler: <AlertTriangle className="h-4 w-4 text-blue-500" />,
  volume: <Volume2 className="h-4 w-4 text-green-600" />,
  clarity: <AlertTriangle className="h-4 w-4 text-amber-500" />,
};

export function NudgePopup({ show, message, type = "pace", onDismiss, className }: NudgePopupProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className={cn(
            "fixed right-4 top-4 z-50 max-w-xs rounded-lg border-l-4 bg-white/95 p-4 shadow-xl backdrop-blur-sm",
            typeStyles[type],
            className
          )}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5" aria-hidden>
              {typeIcon[type]}
            </div>
            <p className="text-sm font-medium text-gray-800">{message}</p>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="ml-auto text-gray-400 hover:text-gray-600"
                aria-label="Dismiss nudge"
              >
                ×
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
