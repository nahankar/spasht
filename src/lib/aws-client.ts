// AWS SDK Configuration
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { TranscribeStreamingClient } from "@aws-sdk/client-transcribe-streaming";
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { PollyClient } from "@aws-sdk/client-polly";
import { S3Client } from "@aws-sdk/client-s3";

// AWS Configuration
const awsConfig = {
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
} as const;

// Initialize AWS Clients
export const bedrockClient = new BedrockRuntimeClient(awsConfig);
export const transcribeClient = new TranscribeStreamingClient(awsConfig);
export const rekognitionClient = new RekognitionClient(awsConfig);
export const pollyClient = new PollyClient(awsConfig);
export const s3Client = new S3Client(awsConfig);

// AWS Service Configuration
export const AWS_CONFIG = {
  BEDROCK_MODEL_ID: "amazon.nova-micro-v1:0", // Latest Nova model
  S3_BUCKET: process.env.AWS_S3_BUCKET_NAME || "spasht-app-uploads",
  TRANSCRIBE_LANGUAGE: "en-US",
  POLLY_VOICE_ID: "Joanna", // Professional female voice
  REGION: awsConfig.region,
} as const;

// Type definitions for AWS responses
export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  timestamp: number;
}

export interface BedrockResponse {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface AudioAnalysis {
  fillerWords: string[];
  speakingPace: number; // words per minute
  confidence: number;
  clarity: number;
  suggestions: string[];
}
