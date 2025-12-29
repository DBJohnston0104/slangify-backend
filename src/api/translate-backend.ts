/*
IMPORTANT NOTICE: DO NOT REMOVE
Client-side API client for the Slangify translation backend.
This file makes HTTP requests to the deployed serverless backend.
NO OpenAI API keys are stored or used in this file.

The backend endpoint URL should be configured in your environment.
*/

import { TranslationResult } from "../types/translation";
import * as Device from "expo-device";
import * as Application from "expo-application";
import { Platform } from "react-native";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Backend API endpoint URL
 * IMPORTANT: Set EXPO_PUBLIC_TRANSLATE_API_URL in your environment
 *
 * Examples:
 * - Vercel: https://your-app.vercel.app/api/translate
 * - Netlify: https://your-app.netlify.app/.netlify/functions/translate
 * - AWS: https://your-api-id.execute-api.region.amazonaws.com/prod/translate
 * - Custom: https://api.yourdomain.com/translate
 */
const BACKEND_URL = process.env.EXPO_PUBLIC_TRANSLATE_API_URL || "";

// Request timeout in milliseconds
const REQUEST_TIMEOUT_MS = 30000;

// ============================================================================
// ERROR TYPES
// ============================================================================

export type TranslateErrorCode =
  | "INPUT_TOO_LONG"
  | "TOO_MANY_WORDS"
  | "RATE_LIMITED"
  | "SERVICE_DISABLED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_INPUT"
  | "PARSE_ERROR";

export interface TranslateError {
  code: TranslateErrorCode;
  message: string;
  retryAfter?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a unique device identifier for rate limiting on the backend
 */
const getDeviceId = async (): Promise<string> => {
  try {
    if (Platform.OS === "ios") {
      const iosId = await Application.getIosIdForVendorAsync();
      if (iosId) return iosId;
    }
    // Fallback to device name + model combination
    const deviceInfo = `${Device.deviceName || "unknown"}-${Device.modelName || "unknown"}`;
    return deviceInfo;
  } catch {
    return "unknown-device";
  }
};

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

export interface TranslateRequest {
  text: string;
}

export interface TranslateResponse {
  success: boolean;
  output?: TranslationResult;
  error?: TranslateError;
  cached?: boolean;
}

// Backend response types
interface BackendSuccessResponse {
  output: TranslationResult;
  cached?: boolean;
}

interface BackendErrorResponse {
  error: string;
  code: string;
  retryAfter?: number;
}

// ============================================================================
// MAIN API CLIENT FUNCTION
// ============================================================================

/**
 * Call the backend translation API
 *
 * This function:
 * 1. Sends the text to the backend via HTTPS POST
 * 2. Handles success and error responses
 * 3. Parses JSON responses properly
 * 4. Falls back to text parsing on JSON errors (for debugging)
 *
 * @param request - The translation request with text
 * @returns Translation response with output or error
 */
export const translateViaBackend = async (request: TranslateRequest): Promise<TranslateResponse> => {
  const { text } = request;

  // Check if backend URL is configured
  if (!BACKEND_URL) {
    return {
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Translation service is not configured. Please set up the backend endpoint.",
      },
    };
  }

  // Client-side validation for quick feedback
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "Please enter some text to translate.",
      },
    };
  }

  try {
    // Get device ID for rate limiting on backend
    const deviceId = await getDeviceId();

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Make the request to the backend
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text.trim(),
        deviceId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Try to parse the response as JSON
    let responseData: BackendSuccessResponse | BackendErrorResponse;
    const responseText = await response.text();

    try {
      responseData = JSON.parse(responseText);
    } catch (parseError) {
      // JSON parsing failed - log for debugging (not shown to user)
      console.error("Failed to parse backend response as JSON:", responseText.substring(0, 500));

      return {
        success: false,
        error: {
          code: "PARSE_ERROR",
          message: "Unable to process server response. Please try again.",
        },
      };
    }

    // Handle error responses (non-2xx status codes)
    if (!response.ok) {
      const errorResponse = responseData as BackendErrorResponse;

      return {
        success: false,
        error: {
          code: (errorResponse.code as TranslateErrorCode) || "SERVER_ERROR",
          message: errorResponse.error || "Translation failed. Please try again.",
          retryAfter: errorResponse.retryAfter,
        },
      };
    }

    // Handle success responses
    const successResponse = responseData as BackendSuccessResponse;

    if (!successResponse.output) {
      return {
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "Invalid response from server. Please try again.",
        },
      };
    }

    return {
      success: true,
      output: successResponse.output,
      cached: successResponse.cached,
    };

  } catch (error) {
    // Handle network errors and timeouts
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          success: false,
          error: {
            code: "NETWORK_ERROR",
            message: "Request timed out. Please check your connection and try again.",
          },
        };
      }

      // Network errors (no internet, DNS failure, etc.)
      if (error.message.includes("Network") || error.message.includes("fetch")) {
        return {
          success: false,
          error: {
            code: "NETWORK_ERROR",
            message: "Connection error. Please check your internet and try again.",
          },
        };
      }

      console.error("Translation request error:", error.message);
    }

    return {
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Something went wrong. Please try again.",
      },
    };
  }
};

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Get the configured backend URL (for debugging)
 */
export const getBackendUrl = (): string => BACKEND_URL;
