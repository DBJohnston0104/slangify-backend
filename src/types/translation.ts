export interface SlangDefinition {
  word: string;
  definition: string;
}

export interface GenerationTranslation {
  generation: string;
  text: string;
  slangWords: SlangDefinition[];
}

export interface TranslationResult {
  detectedGeneration: string;
  originalText: string;
  translations: GenerationTranslation[];
}

export interface SlangSuggestion {
  phrase: string;
  generation: string;
}

export interface SlangOfTheDay {
  word: string;
  pronunciation?: string;
  partOfSpeech: string;
  definition: string;
  example: string;
  generation: string;
}
