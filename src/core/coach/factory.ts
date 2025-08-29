import type { CoachProvider } from "./types";
import { BedrockNovaCoach } from "./bedrockNova";

let singleton: CoachProvider | null = null;

export function getCoachProvider(): CoachProvider {
  if (!singleton) singleton = new BedrockNovaCoach();
  return singleton;
}
