#!/usr/bin/env tsx

import 'dotenv/config';

console.log('🚀 [LAUNCH_SCRIPT] Starting Nova Sonic WebSocket Server (v2)...');
console.log(`🚀 [LAUNCH_SCRIPT] Launch ID: ${new Date().toISOString()}`);
console.log('📋 Using proper event sequencing based on reference implementation');

// Import the v2 implementation
import '../src/lib/nova-websocket-server-v2';

// The nova-websocket-server-v2.ts file is self-contained and starts the server automatically
// This version implements proper event sequencing and unified response handling