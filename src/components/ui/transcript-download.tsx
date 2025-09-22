"use client";

interface TranscriptDownloadProps {
  sessionId: string;
  transcript: string;
  startedAt: Date | string;
}

export function TranscriptDownload({ sessionId, transcript, startedAt }: TranscriptDownloadProps) {
  const downloadTranscript = (sessionId: string, transcript: string, startedAt: Date | string) => {
    const date = new Date(startedAt);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD format
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS format
    
    // Clean up transcript and add metadata
    const header = `# Interview Session Transcript
Session ID: ${sessionId}
Date: ${date.toLocaleDateString()}
Time: ${date.toLocaleTimeString()}
Generated: ${new Date().toLocaleString()}

---

`;
    
    const cleanTranscript = transcript.replace(/\n\n+/g, '\n\n').trim();
    const fullContent = header + cleanTranscript;
    
    // Create and download file
    const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `interview-transcript-${dateStr}-${timeStr}-${sessionId.substring(0, 8)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!transcript) {
    return null;
  }

  return (
    <button
      onClick={() => downloadTranscript(sessionId, transcript, startedAt)}
      className="text-xs text-green-600 hover:text-green-800 underline"
      title="Download full transcript"
    >
      📄 Transcript
    </button>
  );
}
