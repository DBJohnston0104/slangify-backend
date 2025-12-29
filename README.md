# Slangify - Cross-Generational Slang Translator

A beautiful iOS-optimized mobile app that translates text between different generational slang styles (Gen Z, Millennial, Gen X, and Standard English) using OpenAI GPT-4o through a secure serverless backend.

## Overview

Slangify is a comprehensive slang translation app with a stunning dark neon-themed UI. Users can input text and get instant AI-powered translations across all generations, complete with slang definitions, random suggestions, and a daily slang word feature.

## Security Architecture

**IMPORTANT**: This app follows OpenAI best practices by NOT storing API keys in the mobile client. All OpenAI requests are routed through a separate serverless backend endpoint.

### Architecture Overview
```
┌─────────────────┐     HTTPS POST      ┌──────────────────────┐     API Call    ┌─────────────┐
│  Mobile App     │ ──────────────────▶ │  Serverless Backend  │ ─────────────▶  │  OpenAI API │
│  (No API Keys)  │ ◀────────────────── │  (Has API Key)       │ ◀─────────────  │             │
└─────────────────┘     JSON Response   └──────────────────────┘    Response     └─────────────┘
```

### Security Features
- **No Client-Side API Keys**: OpenAI API key is stored ONLY on the serverless backend
- **HTTPS Endpoint**: All requests use fully-qualified HTTPS URLs
- **Input Validation**: Server-side limits (80 characters, 20 words max)
- **Rate Limiting**: Per-device rate limiting (10 requests/hour)
- **Request Caching**: 24-hour cache for identical translations
- **Kill Switch**: Emergency disable for spending control
- **Token Limits**: Output capped at 50 tokens to control costs

## Backend Deployment

The backend must be deployed separately as a serverless function. The code is in `server/api/translate.ts`.

### Deployment Options

**Option 1: Vercel (Recommended)**
```bash
# In the server directory
vercel deploy
```
Set environment variable: `OPENAI_API_KEY`

**Option 2: Netlify Functions**
```bash
# Move translate.ts to netlify/functions/translate.ts
netlify deploy
```

**Option 3: AWS Lambda**
- Deploy as a Lambda function
- Configure API Gateway for the endpoint

**Option 4: Cloudflare Workers**
- Adapt the handler for Cloudflare Workers runtime

### Environment Variables (Backend)
```
OPENAI_API_KEY=sk-proj-...  # Your OpenAI API key (server-side only!)
```

### Client Configuration
Set the backend URL in your app environment:
```
EXPO_PUBLIC_TRANSLATE_API_URL=https://your-deployed-backend.vercel.app/api/translate
```

## Features

### Core Translation Features
- **AI-Powered Generation Detection**: Automatically detects which generation's slang the input uses
- **Multi-Generation Translation**: Translates to ALL other generational slang styles in one go
- **Interactive Slang Definitions**: Expandable dropdowns showing definitions for each slang word used
- **Copy to Clipboard**: Quick copy buttons for each translation

### Discovery Features
- **Random Suggestions**: Clickable slang phrase suggestions from different generations
- **Slang of the Day**: Dictionary-style entry with pronunciation, definition, and example usage

### User Experience
- **Beautiful Dark UI**: Neon purple, cyan, and pink accents with smooth animations and glowing effects
- **Mobile-Optimized**: Built specifically for iOS with proper keyboard handling and safe areas
- **Haptic Feedback**: Tactile responses for all user interactions
- **Smooth Animations**: Powered by react-native-reanimated for fluid transitions
- **Friendly Error Messages**: Clear, user-friendly error states for rate limits and server errors

## Tech Stack

- **Framework**: Expo SDK 53 + React Native 0.76.7
- **Language**: TypeScript
- **Styling**: NativeWind (TailwindCSS for React Native)
- **Animations**: react-native-reanimated v3
- **Navigation**: @react-navigation/native-stack
- **AI**: OpenAI GPT-4o (via secure serverless backend)
- **Backend**: Serverless function (Vercel/Netlify/AWS/Cloudflare)

## File Structure

```
/home/user/workspace/
├── App.tsx                          # Main entry point with navigation setup
├── server/
│   └── api/
│       └── translate.ts             # Serverless backend endpoint (deploy separately)
├── src/
│   ├── api/
│   │   ├── anthropic.ts             # Client translation interface
│   │   └── translate-backend.ts     # HTTPS client for backend calls
│   ├── screens/
│   │   └── SlangifyScreen.tsx       # Main Slangify interface
│   └── types/
│       └── translation.ts           # TypeScript types
└── README.md                        # This file
```

## API Endpoints

### POST /api/translate

**Request:**
```json
{
  "text": "This slaps fr fr",
  "deviceId": "optional-device-id-for-rate-limiting"
}
```

**Success Response (200):**
```json
{
  "output": {
    "detectedGeneration": "Gen Z",
    "originalText": "This slaps fr fr",
    "translations": [...]
  },
  "cached": false
}
```

**Error Response (4xx/5xx):**
```json
{
  "error": "You've made too many requests. Please wait 30 minutes.",
  "code": "RATE_LIMITED",
  "retryAfter": 1800
}
```

**Error Codes:**
- `INVALID_INPUT` (400) - Empty or invalid text
- `INPUT_TOO_LONG` (400) - Text exceeds 80 characters
- `TOO_MANY_WORDS` (400) - Text exceeds 20 words
- `RATE_LIMITED` (429) - Too many requests
- `SERVICE_DISABLED` (503) - Kill switch enabled
- `SERVER_ERROR` (500) - OpenAI or internal error

## Components

### 1. Serverless Backend (`server/api/translate.ts`)
Handles all OpenAI API calls with protections:

**Input Validation:**
- Maximum 80 characters
- Maximum 20 words
- Empty input rejection

**Rate Limiting:**
- 10 requests per hour per device
- In-memory store (use Redis in production)
- Graceful error messages with retry time

**Caching:**
- 24-hour cache TTL
- In-memory store (use Redis in production)
- Normalized text matching

**Kill Switch:**
- CONFIG.KILL_SWITCH_ENABLED flag
- Immediately disables all API calls

**Cost Control:**
- `max_output_tokens: 50`
- Use OpenAI project limits as additional safeguard

### 2. API Client (`src/api/translate-backend.ts`)
- Makes HTTPS POST requests to the backend
- Handles JSON parsing with fallback to text for debugging
- Timeout handling (30 seconds)
- Network error detection

### 3. Translation Interface (`src/api/anthropic.ts`)
- Clean interface for the app
- Custom `TranslationError` class
- No API keys or secrets

### 4. Main Screen (`src/screens/SlangifyScreen.tsx`)
Full-featured UI with animations, haptics, and error handling.

## Error Handling

The client properly handles all error cases:

1. **JSON Parse Errors**: Logs raw response for debugging, shows generic error to user
2. **HTTP Errors**: Parses `{error, code}` from response body
3. **Network Errors**: Detects timeouts, connection failures
4. **Rate Limits**: Shows retry time to user

## Mobile Optimization

- **Keyboard Handling**: Auto-dismissible keyboard with proper padding
- **Safe Areas**: Proper insets for notches and home indicators
- **Responsive Layout**: Works on all iOS screen sizes
- **Touch Targets**: All buttons and interactive elements sized for mobile
- **Scroll Support**: Full content scrollable with smooth performance
- **Performance**: Optimized animations with native driver

## Publishing to iOS

1. **Deploy the backend** to your serverless provider
2. **Set the environment variable** `EXPO_PUBLIC_TRANSLATE_API_URL` with your backend URL
3. Use the **Publish** flow in the Vibecode app
4. The app will be packaged as a native iOS application

## Kill Switch Usage

To immediately disable all OpenAI API calls if spending spikes:

**In the serverless backend (`server/api/translate.ts`):**
```typescript
const CONFIG = {
  KILL_SWITCH_ENABLED: true, // Set to true to disable all calls
  // ...
};
```

Re-deploy the backend to apply.

## OpenAI Dashboard Configuration

For additional spending protection:
1. **Project Limits**: Set monthly budget limits
2. **Rate Limits**: Configure API rate limits at the project level
3. **Usage Alerts**: Enable email alerts for spending thresholds

## Notes

- No user accounts or authentication needed
- All OpenAI processing happens on the serverless backend
- API keys are NEVER in the mobile app bundle
- Rate limiting and caching protect against abuse
- Production deployment requires Redis for persistent rate limiting/caching

---

**Built with Vibecode** - AI-powered app development platform
