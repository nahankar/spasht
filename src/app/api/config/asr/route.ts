import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-store";

export async function GET() {
  // Try DB-backed flags first
  try {
    const cfg = await prisma.featureConfig.findUnique({ where: { id: 1 } });
    if (cfg) {
      const provider = cfg.asrProvider; // "TRANSCRIBE" | "NOVA_REALTIME" | "WEBSPEECH_FALLBACK"
      const failover = cfg.failoverMode; // "FIXED" | "AUTO_SWITCH"
      const language = cfg.language;
      // Back-compat key for older client function
      const asrWorkflow = provider === "NOVA_REALTIME" ? "NOVA_SONIC" : "TRANSCRIBE";
      return NextResponse.json({ provider, failover, language, asrWorkflow });
    }
  } catch {
    // ignore and fallback
  }
  // Fallback to file store
  const { asrWorkflow } = loadSettings();
  const provider = asrWorkflow === "NOVA_SONIC" ? "NOVA_REALTIME" : "TRANSCRIBE";
  const failover = "FIXED" as const;
  const language = "en-US";
  return NextResponse.json({ provider, failover, language, asrWorkflow });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, failover, language } = body;
    
    // Validate input
    if (!provider || !['TRANSCRIBE', 'NOVA_REALTIME', 'WEBSPEECH_FALLBACK'].includes(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }
    
    if (!failover || !['FIXED', 'AUTO_SWITCH'].includes(failover)) {
      return NextResponse.json({ error: 'Invalid failover mode' }, { status: 400 });
    }
    
    // Try to save to database first
    try {
      await prisma.featureConfig.upsert({
        where: { id: 1 },
        update: {
          asrProvider: provider,
          failoverMode: failover,
          language: language || 'en-US'
        },
        create: {
          id: 1,
          asrProvider: provider,
          failoverMode: failover,
          language: language || 'en-US'
        }
      });
      
      return NextResponse.json({ success: true, message: 'Configuration saved to database' });
    } catch (dbError) {
      console.warn('Database save failed, falling back to file store:', dbError);
      
      // Fallback to file store
      const asrWorkflow = provider === 'NOVA_REALTIME' ? 'NOVA_SONIC' : 'TRANSCRIBE';
      saveSettings({ asrWorkflow });
      
      return NextResponse.json({ 
        success: true, 
        message: 'Configuration saved to file store (database unavailable)',
        fallback: true 
      });
    }
  } catch (error) {
    console.error('Error saving ASR config:', error);
    return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
  }
}
