import { NextRequest, NextResponse } from "next/server";
import { bedrockClient } from "@/lib/aws-client";
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Nova Sonic doesn't have real-time streaming like Transcribe
// Instead, we'll process audio chunks and return transcription results
export async function POST(req: NextRequest) {
  if (!req.body) {
    return NextResponse.json({ error: "Missing audio data" }, { status: 400 });
  }

  try {
    // Read the audio data
    const audioBuffer = await req.arrayBuffer();
    const audioData = new Uint8Array(audioBuffer);

    // Convert audio to base64 for Nova Sonic
    const base64Audio = Buffer.from(audioData).toString('base64');

    // Prepare Nova Sonic request
    const payload = {
      input: {
        audio: {
          format: "pcm", // PCM format for raw audio
          source: {
            bytes: base64Audio
          }
        }
      },
      inferenceConfig: {
        maxTokens: 1000,
        temperature: 0.1
      }
    };

    // Call Nova Sonic via Bedrock
    const command = new InvokeModelCommand({
      modelId: "amazon.nova-sonic-v1:0", // Nova Sonic model ID
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(payload)
    });

    const response = await bedrockClient.send(command);
    
    if (!response.body) {
      throw new Error("No response body from Nova Sonic");
    }

    // Parse the response
    const responseText = new TextDecoder().decode(response.body);
    const result = JSON.parse(responseText);
    
    // Extract transcription text
    const transcription = result.output?.text || result.outputText || "";
    
    // Return in a format compatible with our ASR interface
    return NextResponse.json({
      type: "final",
      text: transcription,
      isFinal: true,
      confidence: 0.9, // Nova Sonic doesn't provide confidence scores
      timestamp: Date.now()
    });

  } catch (error) {
    console.error("Nova Sonic error:", error);
    
    // Provide helpful error message
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    if (errorMessage.includes("credentials") || errorMessage.includes("Resolved credential object is not valid")) {
      return NextResponse.json({ 
        error: "AWS credentials not configured properly",
        details: "Please check your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables"
      }, { status: 401 });
    }
    
    if (errorMessage.includes("not authorized") || errorMessage.includes("AccessDenied")) {
      return NextResponse.json({ 
        error: "Not authorized to access Nova Sonic",
        details: "Please ensure your AWS credentials have permission to access Bedrock Nova Sonic model"
      }, { status: 403 });
    }
    
    return NextResponse.json({ 
      error: "Nova Sonic transcription failed",
      details: errorMessage
    }, { status: 500 });
  }
}
