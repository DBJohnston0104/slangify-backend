/*
IMPORTANT NOTICE: DO NOT REMOVE
./src/api/anthropic.ts
Slangify translation service - routes all requests through secure backend
NO direct OpenAI API calls from client (security best practice)
*/

import { TranslationResult } from "../types/translation";
import { translateViaBackend, TranslateError } from "./translate-backend";

/**
 * Custom error class for translation errors with user-friendly messages
 */
export class TranslationError extends Error {
  code: string;
  retryAfter?: number;

  constructor(error: TranslateError) {
    super(error.message);
    this.name = "TranslationError";
    this.code = error.code;
    this.retryAfter = error.retryAfter;
  }
}

/**
 * Main translation function using secure backend endpoint
 * All OpenAI calls are routed through the backend to protect API keys
 *
 * @param userText - The text to translate
 * @returns Structured translation result with generation and translations
 * @throws TranslationError with user-friendly message
 */
export const translateWithOpenAI = async (userText: string): Promise<TranslationResult> => {
  const response = await translateViaBackend({ text: userText });

  if (!response.success || !response.output) {
    throw new TranslationError(
      response.error || {
        code: "SERVER_ERROR",
        message: "Translation failed. Please try again.",
      }
    );
  }

  return response.output;
};
