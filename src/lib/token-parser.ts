export interface TokenBreakdown {
  speechInput: number;
  speechOutput: number;
  textInput: number;
  textOutput: number;
}

/**
 * Parse Nova Sonic token usage payload into a speech/text input/output breakdown.
 * Falls back to a reasonable estimate when detailed structure is missing.
 */
export function parseNovaTokenBreakdown(tokenData: any, debug: boolean = false): TokenBreakdown {
  const inputTokens: number = tokenData?.totalInputTokens || 0;
  const outputTokens: number = tokenData?.totalOutputTokens || 0;

  let speechInput = 0;
  let textInput = 0;
  let speechOutput = 0;
  let textOutput = 0;

  const details = tokenData?.details;
  if (details) {
    if (debug) {
      try {
        // Avoid throwing if details is not serializable
        // eslint-disable-next-line no-console
        console.log('💰 [parser] details keys:', Object.keys(details));
      } catch {
        /* noop */
      }
    }

    const total = details.total as any | undefined;
    if (total) {
      const input = total.input as any | undefined;
      const output = total.output as any | undefined;

      if (input) {
        speechInput = (input.speech as number) || (input.speechTokens as number) || 0;
        textInput = (input.text as number) || (input.textTokens as number) || 0;
        if (speechInput === 0 && textInput === 0 && typeof input === 'object') {
          const modality = (input as any).modalityTokens as any | undefined;
          if (modality) {
            speechInput = (modality.speech as number) || 0;
            textInput = (modality.text as number) || 0;
          }
        }
      }

      if (output) {
        speechOutput = (output.speech as number) || (output.speechTokens as number) || 0;
        textOutput = (output.text as number) || (output.textTokens as number) || 0;
        if (speechOutput === 0 && textOutput === 0 && typeof output === 'object') {
          const modality = (output as any).modalityTokens as any | undefined;
          if (modality) {
            speechOutput = (modality.speech as number) || 0;
            textOutput = (modality.text as number) || 0;
          }
        }
      }
    }

    // As a secondary source, check deltas if totals didn't include a breakdown
    if (
      details.delta &&
      speechInput === 0 &&
      speechOutput === 0 &&
      textInput === 0 &&
      textOutput === 0
    ) {
      const delta = details.delta as any;
      if (delta.input) {
        speechInput = (delta.input.speech as number) || (delta.input.speechTokens as number) || 0;
        textInput = (delta.input.text as number) || (delta.input.textTokens as number) || 0;
      }
      if (delta.output) {
        speechOutput = (delta.output.speech as number) || (delta.output.speechTokens as number) || 0;
        textOutput = (delta.output.text as number) || (delta.output.textTokens as number) || 0;
      }
    }
  }

  // Fallback: estimate using observed AWS console ratios if structure missing
  if (
    speechInput === 0 &&
    speechOutput === 0 &&
    textInput === 0 &&
    textOutput === 0
  ) {
    // Input: ~55% speech, 45% text; Output: ~80% speech, 20% text
    speechInput = Math.round(inputTokens * 0.55);
    textInput = Math.max(0, inputTokens - speechInput);
    speechOutput = Math.round(outputTokens * 0.8);
    textOutput = Math.max(0, outputTokens - speechOutput);
  }

  return { speechInput, speechOutput, textInput, textOutput };
}


