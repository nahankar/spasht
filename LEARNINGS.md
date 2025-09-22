# Spasht Audio System - Critical Learnings

## 🎯 **Core Architecture Insights**

### **Nova Sonic Timing Issues**
- **CRITICAL**: Nova Sonic has a **7-15 second delay** in detecting user interruptions
- **Impact**: Users speak to interrupt AI, but AI continues talking for 7+ seconds
- **Solution**: Client-side instant barge-in detection is **MANDATORY** for good UX
- **Evidence**: Logs consistently show user barge-in at `XX:XX:XX` but Nova Sonic detection at `XX:XX:XX+7-15 seconds`

### **State Management Reality**
- **CRITICAL BUG**: `this.state` is **ALWAYS** `"listening"` even during AI audio playback
- **Wrong Assumption**: Checking `state !== "listening"` for barge-in monitoring
- **Correct Approach**: Check `audioWorkletNode && hasAudioStarted && isInConversation`
- **Why This Matters**: This bug causes instant barge-in detection to never run

## 🎤 **Instant Barge-In Detection**

### **Why Client-Side Detection is Required**
1. **Nova Sonic Delay**: 7-15 seconds to detect interruptions
2. **User Experience**: Users expect <1 second response to barge-in
3. **Reference App**: Even the reference app has this delay issue
4. **Hybrid Approach**: Use instant client detection + Nova Sonic confirmation

### **Correct Monitoring Conditions**
```javascript
// ❌ WRONG - state is always "listening"
const shouldMonitor = this.isInConversation && this.state !== "listening" && !this.bargeInTriggered;

// ✅ CORRECT - check actual audio playback state
const isAudioPlaying = this.audioWorkletNode && this.hasAudioStarted && this.isInConversation;
const shouldMonitor = isAudioPlaying && !this.bargeInTriggered;
```

### **Voice Detection Thresholds**
- **Production Threshold**: `0.08` (balanced to avoid false positives)
- **Dynamic Threshold**: `max(0.08, backgroundNoise * 3.0)` for adaptive detection
- **Confirmation Required**: 3 consecutive detections over 30ms to avoid false triggers
- **Background Noise Tracking**: Slow adaptation (5% learning rate) for baseline
- **Debug Logging**: Log volumes above `0.005` for troubleshooting
- **Detection Method**: Time domain analysis (`getByteTimeDomainData`) for speed
- **Monitoring Frequency**: `10ms` intervals (100Hz) for real-time response

### **False Positive Prevention**
- **Problem**: Thresholds too low (0.02) trigger on background noise/AI audio bleed
- **Solution**: Dynamic thresholds based on background noise + confirmation mechanism
- **Confirmation Logic**: Require 3 consecutive detections over 30ms to confirm real speech
- **Background Adaptation**: Track noise floor and adjust threshold accordingly
- **Hangover Period**: 250ms cooldown after barge-in to prevent multiple triggers
- **Echo Cancellation**: Essential microphone setting to prevent AI audio feedback

### **Production-Ready VAD Implementation**
- **Smart Confirmation Rule**: `3 consecutive frames over max(0.08, 3×noise_floor)`
- **Hangover Logic**: 250ms cooldown period after confirmed barge-in
- **Dynamic Thresholds**: Adaptive to environment noise with α=0.05 learning rate
- **Performance Metrics**: Track all timing stages for optimization
- **Echo Cancellation**: Mandatory `echoCancellation: true` in getUserMedia

### **Buffer Management Strategy**
- **Initial Buffer**: `9600 samples` (~200ms) for quick start
- **Stop Threshold**: `2400 samples` (~50ms) to prevent frequent pauses
- **Restart Threshold**: `7200 samples` (~150ms) for stable resumption
- **Why These Values**: Balance between responsiveness and stability

## 🔧 **Audio System Architecture**

### **AudioWorklet Configuration**
```javascript
// Buffer thresholds for stable playback
this.minBufferThreshold = 9600;  // ~200ms initial buffer
this.stopThreshold = 2400;       // ~50ms stop threshold  
this.restartThreshold = 7200;    // ~150ms restart threshold
```

### **Stream Management**
- **Auto-restart Delay**: `3000ms` (not 500ms) to allow audio completion
- **State Transition Delay**: `2000ms` before resetting conversation state
- **Barge-in Cooldown**: `3000ms` to prevent multiple triggers

### **Property Name Bug**
- **CRITICAL**: AudioWorklet expects `data` property, not `audioData`
- **Fix**: `postMessage({ type: "audio", data: audioData })` not `audioData: audioData`
- **Symptoms**: Audio plays for 1ms then stops immediately

## 🐛 **Common Debugging Patterns**

### **Audio Not Playing**
1. Check property name mismatch (`data` vs `audioData`)
2. Check buffer thresholds (too high = delayed start)
3. Check Nova Sonic stream errors ("Premature close")
4. Check AWS credentials configuration

### **Barge-In Not Working**
1. **First Check**: Is instant detection actually monitoring?
   - Look for: `🎤 ⚡ INSTANT: ACTIVELY MONITORING`
   - If missing: Check monitoring conditions (likely `state` issue)
2. **Second Check**: Is voice being detected?
   - Look for: `🎤 ⚡ INSTANT: Voice detected (volume: X.XXXX)`
   - If missing: Lower threshold or check microphone permissions
3. **Third Check**: Is threshold too high?
   - Normal speech: `0.02-0.05` range
   - Background noise: `0.001-0.01` range

### **Stream Premature Close Errors**
- **Cause**: Buffer underrun or network issues
- **Solution**: Increase buffer thresholds and add retry logic
- **Prevention**: Monitor buffer status and add silence filling

## 🏗️ **Reference App Comparison**

### **What Reference App Does Right**
- Lets Nova Sonic handle authoritative barge-in detection
- Simple audio buffer clearing on `INTERRUPTED` signal
- No complex client-side voice detection

### **What Reference App Does Wrong**
- **Same 7+ second delay** for barge-in detection
- No instant client-side detection for better UX
- Users must wait for Nova Sonic to detect interruption

### **Our Hybrid Approach**
- **Instant client detection**: <100ms response time
- **Nova Sonic confirmation**: Authoritative detection
- **Best of both**: Fast UX + reliable detection

## 📊 **Performance Metrics**

### **Target Timing**
- **Barge-in Detection**: <100ms from user speech
- **Audio Buffer Start**: <200ms from first audio data
- **Stream Recovery**: <300ms after buffer underrun
- **Nova Sonic Fallback**: 7-15 seconds (unavoidable)

### **Monitoring Intervals**
- **Voice Detection**: 10ms (100Hz)
- **Buffer Status**: 50ms (20Hz)  
- **Debug Logging**: 1000-2000ms (0.5-1Hz)

### **Implemented Performance Tracking**
- **First Voice Detected**: Timestamp when volume first exceeds threshold
- **Barge-in Confirmed**: Timestamp after 3 consecutive confirmations
- **Interrupt Request Sent**: Timestamp when signal sent to Nova Sonic
- **Nova Interrupted Received**: Timestamp when Nova confirms interruption
- **Comprehensive Metrics**: Total latency, local detection time, network RTT
- **Alert System**: Warn if Nova confirmation >5 seconds

## 🔄 **State Machine Insights**

### **Actual State Flow**
```
listening -> listening (during AI response) -> listening
```
**NOT** what we expected:
```
listening -> ai_responding -> listening
```

### **Reliable State Indicators**
- `isInConversation`: Reliable conversation state
- `hasAudioStarted`: Reliable audio playback state
- `audioWorkletNode`: Reliable audio system state
- `this.state`: **UNRELIABLE** - always "listening"

## 🚨 **Critical Gotchas**

1. **State is Always "listening"**: Never rely on `this.state` for audio playback detection
2. **Nova Sonic Delay**: Always 7+ seconds - client detection is mandatory
3. **Property Names Matter**: `data` not `audioData` in AudioWorklet messages
4. **Buffer Underruns**: Cause "Premature close" errors and stream restarts
5. **Threshold Sensitivity**: Too high = missed speech, too low = false positives
6. **Nova Sonic Timeouts**: Server can timeout with "ValidationException: Timed out waiting for input events"
7. **Missing Confirmation**: If Nova doesn't confirm interruption, conversation dies - need timeout recovery
8. **Session Disconnections**: Abrupt disconnects require proper cleanup and recovery

## 🔧 **Debugging Commands**

### **Check AWS Credentials**
```bash
ls -la ~/.aws/
cat ~/.aws/credentials | head -10
```

### **Check Server Status**
```bash
curl -s http://localhost:3000 | head -5
curl -s -H "Upgrade: websocket" http://localhost:8081
```

### **Monitor Logs**
- Look for: `🎤 ⚡ INSTANT: ACTIVELY MONITORING` (should appear every 2 seconds during AI speech)
- Look for: `🔇 ⚡ INSTANT BARGE-IN` (should appear <100ms after user speech)
- Avoid: `🔇 📡 NOVA SONIC BARGE-IN (instant detection missed)` (means our detection failed)

---

## 📝 **Update History**
- **2025-01-18**: Initial learnings capture
- **Last Updated**: When this file was created

**Note**: Always update this file when discovering new insights to avoid re-research!
