export type NudgeType =
  | "pace"
  | "clarity"
  | "filler"
  | "energy"
  | "brevity"
  | "pauses";

export interface Nudge {
  id: string;
  type: NudgeType;
  message: string;
  severity?: "info" | "warn" | "critical";
  timestamp: number; // ms since epoch
}

export interface CoachScores {
  fluency: number; // 0-100
  clarity: number; // 0-100
  confidence: number; // 0-100
  fillerRate: number; // fillers per minute
  paceWpm: number; // words per minute
}

export interface CoachReport {
  summary: string;
  strengths: string[];
  improvements: string[];
  scores: CoachScores;
  tips: string[];
}

export interface PartialUtterance {
  text: string;
  // Optional live features from audio analytics if available
  paceWpm?: number;
  fillerCount?: number;
  energyLevel?: number; // 0-1
  timestamp: number;
}

export interface CoachProvider {
  // Process a live partial transcript and return 0+ nudges to display now
  getNudgesForPartial(input: PartialUtterance): Promise<Nudge[]>;
  // Build a report for the full session transcript
  getSessionReport(fullTranscript: string): Promise<CoachReport>;
}
