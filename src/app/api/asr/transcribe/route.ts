import { NextRequest } from "next/server";
import { transcribeClient } from "@/lib/aws-client";
import {
  StartStreamTranscriptionCommand,
  type StartStreamTranscriptionCommandInput,
  type AudioStream,
} from "@aws-sdk/client-transcribe-streaming";

function webStreamToAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncIterable<AudioStream> {
  const reader = stream.getReader();
  return {
    async *[Symbol.asyncIterator]() {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield { AudioEvent: { AudioChunk: value } } as AudioStream;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export async function POST(req: NextRequest) {
  if (!req.body) return new Response("Missing body", { status: 400 });
  // Build response stream for NDJSON output
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      const input: StartStreamTranscriptionCommandInput = {
        LanguageCode: "en-US",
        MediaEncoding: "pcm",
        MediaSampleRateHertz: 16000,
  AudioStream: webStreamToAsyncIterable(req.body as ReadableStream<Uint8Array>),
        EnablePartialResultsStabilization: true,
        PartialResultsStability: "medium",
      } as const;

      const command = new StartStreamTranscriptionCommand(input);
      const resp = await transcribeClient.send(command);

      for await (const event of resp.TranscriptResultStream ?? []) {
        // Each event may contain results
        const anyEvent = event as unknown as { TranscriptEvent?: { Transcript?: { Results?: Array<{
          Alternatives?: Array<{ Transcript?: string; Items?: Array<{ StartTime?: number; EndTime?: number; Confidence?: number }> }>;
          IsPartial?: boolean;
        }>; } } };
        const te = anyEvent.TranscriptEvent?.Transcript?.Results ?? [];
        for (const r of te) {
          const text = r.Alternatives?.[0]?.Transcript ?? "";
          const items = r.Alternatives?.[0]?.Items ?? [];
          const startTs = items[0]?.StartTime ? Math.round((items[0]?.StartTime || 0) * 1000) : Date.now();
          const endTs = items[items.length - 1]?.EndTime ? Math.round((items[items.length - 1]?.EndTime || 0) * 1000) : Date.now();
          const confidence = items.length > 0 ? (items.reduce((acc, it) => acc + (it.Confidence || 0), 0) / items.length) : undefined;
          const payload = {
            type: r.IsPartial ? "partial" : "final",
            text,
            isFinal: !r.IsPartial,
            startTs,
            endTs,
            confidence,
          };
          await writer.write(new TextEncoder().encode(JSON.stringify(payload) + "\n"));
        }
      }
    } catch {
      // swallow; client can handle disconnect
    } finally {
      try { await writer.close(); } catch {}
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
