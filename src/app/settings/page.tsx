"use client";
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type AsrProvider = "TRANSCRIBE" | "WEBSPEECH_FALLBACK" | "NOVA_REALTIME";
type FailoverMode = "FIXED" | "AUTO_SWITCH";

interface AsrConfig {
  provider: AsrProvider;
  failover: FailoverMode;
  language: string;
}

// Client-only component to avoid hydration mismatch
function BrowserSupport() {
  const [support, setSupport] = React.useState<string>("Checking...");
  
  React.useEffect(() => {
    const hasWebSpeech = "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
    setSupport(hasWebSpeech ? "✅ Web Speech" : "❌ Web Speech");
  }, []);
  
  return <span>{support}</span>;
}

export default function SettingsPage() {
  const [config, setConfig] = React.useState<AsrConfig>({
    provider: "TRANSCRIBE",
    failover: "AUTO_SWITCH",
    language: "en-US"
  });
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load current configuration
  React.useEffect(() => {
    fetch("/api/config/asr", { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        setConfig({
          provider: data.provider || "TRANSCRIBE",
          failover: data.failover || "AUTO_SWITCH",
          language: data.language || "en-US"
        });
      })
      .catch(() => {
        setMessage({ type: "error", text: "Failed to load current settings" });
      });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    
    try {
      const response = await fetch("/api/config/asr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });

      if (response.ok) {
        const result = await response.json();
        if (result.temporary) {
          setMessage({ type: "success", text: result.message + " (Changes will apply to current session)" });
        } else {
          setMessage({ type: "success", text: "Settings saved successfully!" });
        }
      } else {
        throw new Error("Failed to save settings");
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save settings. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const getProviderDescription = (provider: AsrProvider) => {
    switch (provider) {
      case "TRANSCRIBE":
        return "AWS Transcribe - High accuracy cloud transcription";
      case "NOVA_REALTIME":
        return "AWS Nova Realtime - Latest AI model (experimental)";
      case "WEBSPEECH_FALLBACK":
        return "Browser Web Speech API - Works offline, basic accuracy";
    }
  };

  const getFailoverDescription = (mode: FailoverMode) => {
    switch (mode) {
      case "FIXED":
        return "Use only the selected provider. Fail if unavailable.";
      case "AUTO_SWITCH":
        return "Try primary provider, fallback to Web Speech if it fails.";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground mt-2">Configure your speech recognition and system preferences</p>
        </header>

        <div className="grid gap-6">
          {/* ASR Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Speech Recognition (ASR)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Provider Selection */}
              <div className="space-y-3">
                <Label className="text-base font-medium">Primary Provider</Label>
                <div className="space-y-3">
                  {(["TRANSCRIBE", "NOVA_REALTIME", "WEBSPEECH_FALLBACK"] as AsrProvider[]).map((provider) => (
                    <label key={provider} className="flex items-start space-x-3 cursor-pointer">
                      <input
                        type="radio"
                        name="provider"
                        value={provider}
                        checked={config.provider === provider}
                        onChange={(e) => setConfig(prev => ({ ...prev, provider: e.target.value as AsrProvider }))}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-medium">
                          {provider === "TRANSCRIBE" && "AWS Transcribe"}
                          {provider === "NOVA_REALTIME" && "AWS Nova Realtime"}
                          {provider === "WEBSPEECH_FALLBACK" && "Web Speech API"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {getProviderDescription(provider)}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Failover Mode */}
              <div className="space-y-3">
                <Label className="text-base font-medium">Failover Strategy</Label>
                <div className="space-y-3">
                  {(["AUTO_SWITCH", "FIXED"] as FailoverMode[]).map((mode) => (
                    <label key={mode} className="flex items-start space-x-3 cursor-pointer">
                      <input
                        type="radio"
                        name="failover"
                        value={mode}
                        checked={config.failover === mode}
                        onChange={(e) => setConfig(prev => ({ ...prev, failover: e.target.value as FailoverMode }))}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-medium">
                          {mode === "AUTO_SWITCH" && "Auto Switch (Recommended)"}
                          {mode === "FIXED" && "Fixed Provider"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {getFailoverDescription(mode)}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Language Selection */}
              <div className="space-y-3">
                <Label htmlFor="language" className="text-base font-medium">Language</Label>
                <select
                  id="language"
                  value={config.language}
                  onChange={(e) => setConfig(prev => ({ ...prev, language: e.target.value }))}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background"
                >
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="es-ES">Spanish</option>
                  <option value="fr-FR">French</option>
                  <option value="de-DE">German</option>
                  <option value="it-IT">Italian</option>
                  <option value="pt-BR">Portuguese (Brazil)</option>
                  <option value="ja-JP">Japanese</option>
                  <option value="ko-KR">Korean</option>
                  <option value="zh-CN">Chinese (Simplified)</option>
                </select>
              </div>

              {/* Failover Chain Preview */}
              {config.failover === "AUTO_SWITCH" && (
                <div className="p-4 bg-muted rounded-lg">
                  <h4 className="font-medium mb-2">Failover Chain</h4>
                  <div className="text-sm text-muted-foreground">
                    <div className="flex items-center space-x-2">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">1</span>
                      <span>
                        {config.provider === "TRANSCRIBE" && "AWS Transcribe"}
                        {config.provider === "NOVA_REALTIME" && "AWS Nova Realtime"}
                        {config.provider === "WEBSPEECH_FALLBACK" && "Web Speech API"}
                      </span>
                    </div>
                    {config.provider !== "WEBSPEECH_FALLBACK" && (
                      <div className="flex items-center space-x-2 mt-2">
                        <span className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-xs">2</span>
                        <span>Web Speech API (fallback)</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Message */}
              {message && (
                <div className={`p-3 rounded-md ${message.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                  {message.text}
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </CardContent>
          </Card>

          {/* System Information */}
          <Card>
            <CardHeader>
              <CardTitle>System Information</CardTitle>
            </CardHeader>
            <CardContent>
              {message?.text?.includes("session only") && (
                <div className="mb-4 p-3 rounded-md bg-yellow-50 text-yellow-800 border border-yellow-200 text-sm">
                  <strong>Note:</strong> Database connection unavailable. Settings are applied to current session only and will reset on server restart.
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="font-medium">Current Provider</div>
                  <div className="text-muted-foreground">{config.provider}</div>
                </div>
                <div>
                  <div className="font-medium">Failover Mode</div>
                  <div className="text-muted-foreground">{config.failover}</div>
                </div>
                <div>
                  <div className="font-medium">Language</div>
                  <div className="text-muted-foreground">{config.language}</div>
                </div>
                <div>
                  <div className="font-medium">Browser Support</div>
                  <div className="text-muted-foreground">
                    <BrowserSupport />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
