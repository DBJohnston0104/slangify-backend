import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
  Keyboard,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeInDown,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { translateWithOpenAI, TranslationError } from "../api/anthropic";
import { TranslationResult, SlangSuggestion, SlangOfTheDay } from "../types/translation";

// Generation date ranges (birth years)
const GENERATION_DATES: Record<string, string> = {
  "Gen Alpha": "2010 - Current",
  "Gen Z": "1997 - 2009",
  "Millennials": "1981 - 1996",
  "Gen X": "1965 - 1980",
  "Baby Boomers": "1946 - 1964",
  "Classic": "1950s - 1970s",
};

// Generation order (youngest to oldest)
const GENERATION_ORDER = ["Gen Alpha", "Gen Z", "Millennials", "Gen X", "Baby Boomers", "Classic"];

// Mock data for suggestions - matching the design
const SUGGESTIONS: SlangSuggestion[] = [
  { phrase: "This slaps fr fr", generation: "Gen Z" },
  { phrase: "That's fire no cap", generation: "Gen Z" },
  { phrase: "That's so fetch", generation: "Millennial" },
  { phrase: "That's groovy man", generation: "Boomer" },
  { phrase: "Big yikes energy", generation: "Gen Z" },
];

// Slang of the Day database - rotates daily
const SLANG_DATABASE: SlangOfTheDay[] = [
  {
    word: "Rizz",
    pronunciation: "riz",
    partOfSpeech: "noun",
    definition: "Charisma or charm, especially in romantic contexts",
    example: "He's got mad rizz with the way he talks to people.",
    generation: "Gen Z",
  },
  {
    word: "Slay",
    pronunciation: "slay",
    partOfSpeech: "verb",
    definition: "To do something exceptionally well; to look amazing or dominate",
    example: "You absolutely slayed that presentation today!",
    generation: "Gen Z",
  },
  {
    word: "Bet",
    pronunciation: "bet",
    partOfSpeech: "interjection",
    definition: "An expression of agreement or confirmation; means 'okay' or 'sounds good'",
    example: "Want to grab lunch at noon? Bet.",
    generation: "Gen Z",
  },
  {
    word: "No Cap",
    pronunciation: "noh kap",
    partOfSpeech: "phrase",
    definition: "No lie; for real; being completely honest",
    example: "No cap, that was the best pizza I've ever had.",
    generation: "Gen Z",
  },
  {
    word: "Bussin",
    pronunciation: "buh-sin",
    partOfSpeech: "adjective",
    definition: "Extremely good, especially when describing food",
    example: "This mac and cheese is bussin!",
    generation: "Gen Z",
  },
  {
    word: "GOAT",
    pronunciation: "goht",
    partOfSpeech: "noun",
    definition: "Greatest Of All Time; used to describe someone who is the best at what they do",
    example: "Michael Jordan is the GOAT of basketball.",
    generation: "Millennials",
  },
  {
    word: "Lowkey",
    pronunciation: "loh-kee",
    partOfSpeech: "adverb",
    definition: "Secretly; somewhat; a little bit; not openly",
    example: "I lowkey want to skip the party tonight.",
    generation: "Gen Z",
  },
  {
    word: "Highkey",
    pronunciation: "hy-kee",
    partOfSpeech: "adverb",
    definition: "Openly; obviously; very much; the opposite of lowkey",
    example: "I highkey love this song, it's so good!",
    generation: "Gen Z",
  },
  {
    word: "Vibe",
    pronunciation: "vyb",
    partOfSpeech: "noun/verb",
    definition: "The atmosphere or energy of a place/situation; to chill or relax",
    example: "This coffee shop has such a good vibe.",
    generation: "Millennials",
  },
  {
    word: "Ghost",
    pronunciation: "gohst",
    partOfSpeech: "verb",
    definition: "To suddenly stop responding to messages without explanation",
    example: "He ghosted me after our second date.",
    generation: "Millennials",
  },
  {
    word: "Snatched",
    pronunciation: "snacht",
    partOfSpeech: "adjective",
    definition: "Looking really good; on point; flawless appearance",
    example: "Your eyebrows are snatched today!",
    generation: "Gen Z",
  },
  {
    word: "Tea",
    pronunciation: "tee",
    partOfSpeech: "noun",
    definition: "Gossip; the truth; juicy information",
    example: "Spill the tea! What happened at the party?",
    generation: "Millennials",
  },
  {
    word: "Flex",
    pronunciation: "fleks",
    partOfSpeech: "verb/noun",
    definition: "To show off or brag; something to brag about",
    example: "Nice car, but you don't have to flex so hard.",
    generation: "Millennials",
  },
  {
    word: "Lit",
    pronunciation: "lit",
    partOfSpeech: "adjective",
    definition: "Amazing; exciting; fun; used to describe something great",
    example: "That concert last night was so lit!",
    generation: "Gen Z",
  },
  {
    word: "Salty",
    pronunciation: "sawl-tee",
    partOfSpeech: "adjective",
    definition: "Bitter or upset, usually over something minor",
    example: "Why are you so salty about losing the game?",
    generation: "Millennials",
  },
  {
    word: "Stan",
    pronunciation: "stan",
    partOfSpeech: "verb/noun",
    definition: "To be an extremely devoted fan of someone or something",
    example: "I stan Taylor Swift, I've been to all her concerts.",
    generation: "Millennials",
  },
  {
    word: "Shade",
    pronunciation: "shayd",
    partOfSpeech: "noun",
    definition: "Subtle disrespect or criticism; a sneaky insult",
    example: "Did she just throw shade at my outfit?",
    generation: "Millennials",
  },
  {
    word: "Glow Up",
    pronunciation: "gloh uhp",
    partOfSpeech: "noun/verb",
    definition: "A major positive transformation, especially in appearance or life",
    example: "She had such a glow up after high school!",
    generation: "Millennials",
  },
  {
    word: "Fire",
    pronunciation: "fy-er",
    partOfSpeech: "adjective",
    definition: "Really cool; amazing; excellent",
    example: "Your new sneakers are fire!",
    generation: "Gen Z",
  },
  {
    word: "Periodt",
    pronunciation: "peer-ee-udt",
    partOfSpeech: "interjection",
    definition: "Used to emphasize the end of a statement; end of discussion",
    example: "That's the best movie ever made, periodt.",
    generation: "Gen Z",
  },
  {
    word: "Simp",
    pronunciation: "simp",
    partOfSpeech: "noun/verb",
    definition: "Someone who does way too much for someone they like",
    example: "He bought her flowers every day, he's such a simp.",
    generation: "Gen Z",
  },
  {
    word: "Cap",
    pronunciation: "kap",
    partOfSpeech: "noun/verb",
    definition: "A lie; to lie; not telling the truth",
    example: "That's cap, you weren't even there!",
    generation: "Gen Z",
  },
  {
    word: "Drip",
    pronunciation: "drip",
    partOfSpeech: "noun",
    definition: "Style; fashionable clothing or accessories",
    example: "Check out his drip, that outfit is expensive.",
    generation: "Gen Z",
  },
  {
    word: "Fam",
    pronunciation: "fam",
    partOfSpeech: "noun",
    definition: "Close friends; people you consider family",
    example: "What's up, fam? Ready for the party?",
    generation: "Millennials",
  },
  {
    word: "Sus",
    pronunciation: "suhs",
    partOfSpeech: "adjective",
    definition: "Suspicious; shady; questionable behavior",
    example: "The way he's acting is kinda sus.",
    generation: "Gen Z",
  },
  {
    word: "Bruh",
    pronunciation: "bruh",
    partOfSpeech: "interjection",
    definition: "Expression of disbelief, frustration, or acknowledgment",
    example: "Bruh, I can't believe you just said that.",
    generation: "Gen Z",
  },
  {
    word: "Sic",
    pronunciation: "sik",
    partOfSpeech: "adjective",
    definition: "Cool; awesome; impressive (classic 90s slang)",
    example: "That skateboard trick was totally sick!",
    generation: "Gen X",
  },
  {
    word: "Rad",
    pronunciation: "rad",
    partOfSpeech: "adjective",
    definition: "Really cool; awesome; excellent",
    example: "That concert was totally rad!",
    generation: "Gen X",
  },
  {
    word: "Gnarly",
    pronunciation: "nar-lee",
    partOfSpeech: "adjective",
    definition: "Extreme; intense; can be good or bad depending on context",
    example: "That wave was gnarly, dude!",
    generation: "Gen X",
  },
  {
    word: "Groovy",
    pronunciation: "groo-vee",
    partOfSpeech: "adjective",
    definition: "Cool; excellent; fashionable",
    example: "That's a groovy shirt you're wearing!",
    generation: "Baby Boomers",
  },
  {
    word: "Far Out",
    pronunciation: "far owt",
    partOfSpeech: "interjection",
    definition: "Amazing; incredible; mind-blowing",
    example: "Far out, man! That sunset is beautiful.",
    generation: "Baby Boomers",
  },
];

// Get today's Slang of the Day based on the date
const getTodaysSlang = (): SlangOfTheDay => {
  const today = new Date();
  // Create a consistent index based on the date (year + day of year)
  const startOfYear = new Date(today.getFullYear(), 0, 0);
  const diff = today.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  const index = (today.getFullYear() * 365 + dayOfYear) % SLANG_DATABASE.length;
  return SLANG_DATABASE[index];
};

export default function SlangifyScreen() {
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState("");
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedDefinitions, setExpandedDefinitions] = useState<{ [key: string]: boolean }>({});
  const [slangOfDayExpanded, setSlangOfDayExpanded] = useState(false);
  const lastTranslatedTextRef = useRef<string>("");
  const scrollViewRef = useRef<ScrollView>(null);
  const inputCardRef = useRef<View>(null);

  const randomPlaceholder = useMemo(() => {
    return "ex. " + SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)].phrase;
  }, []);

  // Get today's slang - memoized so it stays consistent during the session
  const slangOfDay = useMemo(() => getTodaysSlang(), []);

  const glowAnimation = useSharedValue(0);

  React.useEffect(() => {
    glowAnimation.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const logoGlowStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(glowAnimation.value, [0, 1], [0.95, 1]),
      transform: [{ scale: interpolate(glowAnimation.value, [0, 1], [1, 1.01]) }],
    };
  });

  const performTranslation = useCallback(async (text: string) => {
    if (!text.trim() || text.trim() === lastTranslatedTextRef.current) {
      return;
    }

    lastTranslatedTextRef.current = text.trim();
    setIsLoading(true);
    setError("");

    try {
      const result = await translateWithOpenAI(text.trim());
      setTranslationResult(result);
      setExpandedDefinitions({});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      let errorMessage = "Translation failed. Please try again.";

      if (err instanceof TranslationError) {
        // Use the user-friendly message from the backend
        errorMessage = err.message;

        // Add retry info for rate limiting
        if (err.code === "RATE_LIMITED" && err.retryAfter) {
          const minutes = Math.ceil(err.retryAfter / 60);
          if (minutes > 0) {
            errorMessage = `${errorMessage}`;
          }
        }
      } else if (err instanceof Error) {
        // Fallback for unexpected errors
        if (err.message.includes("network") || err.message.includes("fetch")) {
          errorMessage = "Connection error. Please check your internet and try again.";
        } else {
          errorMessage = err.message;
        }
      }

      setError(errorMessage);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleTranslate = useCallback(() => {
    if (inputText.trim()) {
      performTranslation(inputText);
    }
  }, [inputText, performTranslation]);

  const handleClear = useCallback(() => {
    setInputText("");
    setTranslationResult(null);
    setError("");
    lastTranslatedTextRef.current = "";
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleCopyToClipboard = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const toggleDefinition = useCallback((key: string) => {
    setExpandedDefinitions((prev) => ({ ...prev, [key]: !prev[key] }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleSuggestionPress = useCallback((phrase: string) => {
    setInputText(phrase);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleInputFocus = useCallback(() => {
    // Scroll to show the input card when keyboard opens
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 200, animated: true });
    }, 100);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={["#0F1724", "#1A2332", "#0D1620"]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + 6,
            paddingBottom: insets.bottom + 120,
            paddingHorizontal: 20,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
        >
          {/* Logo Section */}
          <Animated.View entering={FadeInDown.delay(0).duration(600)} className="items-center mb-3">
            <Animated.View style={logoGlowStyle}>
              <Image
                source={require("../../assets/Gemini_Generated_Image_cirqj6cirqj6cirq-1766503245648-0.png")}
                style={{
                  width: 464,
                  height: 232,
                  resizeMode: "contain",
                }}
              />
            </Animated.View>
          </Animated.View>

          {/* Description Text */}
          <Animated.View entering={FadeInDown.delay(150).duration(600)} className="mb-6">
            <Text
              style={{
                color: "#BFFF00",
                fontSize: 20,
                textAlign: "center",
                lineHeight: 30,
                fontWeight: "bold",
                fontStyle: "italic",
              }}
            >
              Drop slang below… We&apos;ll tell you who says it, and what it means
            </Text>
          </Animated.View>

          {/* Input Card */}
          <Animated.View entering={FadeInDown.delay(300).duration(600)}>
            <View
              style={{
                borderRadius: 20,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: "rgba(91, 141, 239, 0.2)",
              }}
            >
              <BlurView
                intensity={40}
                tint="dark"
                style={{
                  padding: 16,
                }}
              >
                {/* Text Input */}
                <View
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    borderRadius: 14,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: "rgba(255, 255, 255, 0.1)",
                  }}
                >
                  <TextInput
                    className="text-white text-base"
                    placeholder={randomPlaceholder}
                    placeholderTextColor="rgba(255, 255, 255, 0.4)"
                    value={inputText}
                    onChangeText={setInputText}
                    onFocus={handleInputFocus}
                    multiline
                    textAlignVertical="top"
                    style={{
                      minHeight: 80,
                      outlineStyle: "none",
                    } as any}
                  />
                </View>

                {/* Loading Indicator */}
                {isLoading && (
                  <View className="flex-row items-center justify-center py-3">
                    <ActivityIndicator color="#5B8DEF" size="small" />
                    <Text className="text-blue-400 text-sm ml-2">
                      Translating...
                    </Text>
                  </View>
                )}

                {/* Buttons - Side by Side Inside Card */}
                <View className="flex-row w-full mt-4" style={{ gap: 10 }}>
                  <Pressable
                    onPress={handleTranslate}
                    disabled={isLoading || !inputText.trim()}
                    className="flex-1"
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.8 : (!inputText.trim() ? 0.5 : 1),
                    })}
                  >
                    <LinearGradient
                      colors={["#5B8DEF", "#4A7DE0"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{
                        height: 56,
                        borderRadius: 14,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "600" }}>
                        {isLoading ? "..." : "Translate"}
                      </Text>
                    </LinearGradient>
                  </Pressable>
                  <Pressable
                    onPress={handleClear}
                    className="flex-1"
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <View
                      style={{
                        height: 56,
                        borderRadius: 14,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "rgba(255, 255, 255, 0.08)",
                        borderWidth: 1,
                        borderColor: "rgba(255, 255, 255, 0.15)",
                      }}
                    >
                      <Text style={{ color: "rgba(255, 255, 255, 0.7)", fontSize: 16, fontWeight: "500" }}>Clear</Text>
                    </View>
                  </Pressable>
                </View>
              </BlurView>
            </View>
          </Animated.View>

          {/* Quick Suggestions */}
          <Animated.View entering={FadeInDown.delay(400).duration(600)} className="mt-2 mb-1">
            <View className="flex-row justify-center" style={{ gap: 8 }}>
              {SUGGESTIONS.slice(0, 3).map((suggestion, index) => (
                <Pressable
                  key={index}
                  onPress={() => handleSuggestionPress(suggestion.phrase)}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.6 : 1,
                    flex: 1,
                  })}
                >
                  <View
                    style={{
                      backgroundColor: "rgba(255, 255, 255, 0.06)",
                      borderRadius: 20,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderWidth: 1,
                      borderColor: "rgba(255, 255, 255, 0.1)",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: 1,
                    }}
                  >
                    <Text
                      style={{
                        color: "rgba(255, 255, 255, 0.5)",
                        fontSize: 11,
                        textAlign: "center",
                      }}
                      numberOfLines={1}
                    >
                      {suggestion.phrase}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </Animated.View>

          {/* Error State */}
          {error && (
            <Animated.View
              entering={FadeIn.duration(400)}
              className="mt-4 bg-red-900/30 border border-red-500/50 rounded-xl p-4"
            >
              <View className="flex-row items-center">
                <Ionicons name="alert-circle" size={20} color="#EF4444" />
                <Text className="text-red-400 text-sm ml-2 flex-1">{error}</Text>
              </View>
            </Animated.View>
          )}

          {/* Results Section */}
          {translationResult && (
            <Animated.View entering={FadeInDown.delay(100).duration(600)} className="mt-4">
              {/* Detected Generation */}
              <View
                style={{
                  borderRadius: 18,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: "rgba(91, 141, 239, 0.4)",
                  marginBottom: 12,
                }}
              >
                <BlurView
                  intensity={35}
                  tint="dark"
                  style={{
                    padding: 16,
                  }}
                >
                  <View className="flex-row items-center justify-between">
                    <View>
                      <Text style={{ color: "#5B8DEF", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                        Detected Generation
                      </Text>
                      <View className="flex-row items-baseline">
                        <Text className="text-white text-xl font-bold">
                          {translationResult.detectedGeneration}
                        </Text>
                        {GENERATION_DATES[translationResult.detectedGeneration] && (
                          <Text style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 14, marginLeft: 8 }}>
                            {GENERATION_DATES[translationResult.detectedGeneration]}
                          </Text>
                        )}
                      </View>
                    </View>
                    <Ionicons name="checkmark-circle" size={28} color="#5B8DEF" />
                  </View>
                </BlurView>
              </View>

              {/* Translations */}
              <Text style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Translations
              </Text>
              {translationResult.translations
                .filter((translation) => translation.generation !== translationResult.detectedGeneration)
                .sort((a, b) => GENERATION_ORDER.indexOf(a.generation) - GENERATION_ORDER.indexOf(b.generation))
                .map((translation, index) => (
                <View
                  key={index}
                  style={{
                    borderRadius: 18,
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: "rgba(255, 255, 255, 0.1)",
                    marginBottom: 12,
                  }}
                >
                  <BlurView
                    intensity={30}
                    tint="dark"
                    style={{
                      padding: 16,
                    }}
                  >
                    {/* Translation Header */}
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-baseline">
                        <Text style={{ color: "#5B8DEF", fontSize: 14, fontWeight: "600" }}>
                          {translation.generation}
                        </Text>
                        {GENERATION_DATES[translation.generation] && (
                          <Text style={{ color: "rgba(255, 255, 255, 0.4)", fontSize: 12, marginLeft: 8 }}>
                            {GENERATION_DATES[translation.generation]}
                          </Text>
                        )}
                      </View>
                      <Pressable
                        onPress={() => handleCopyToClipboard(translation.text)}
                        style={({ pressed }) => ({
                          opacity: pressed ? 0.6 : 1,
                          padding: 6,
                          borderRadius: 8,
                          backgroundColor: "rgba(255, 255, 255, 0.1)",
                        })}
                      >
                        <Ionicons name="copy-outline" size={14} color="#5B8DEF" />
                      </Pressable>
                    </View>

                    {/* Translation Text */}
                    <Text className="text-white text-base leading-6 mb-2">
                      {translation.text}
                    </Text>

                    {/* Slang Definitions Dropdown */}
                    {translation.slangWords && translation.slangWords.length > 0 && (
                      <View>
                        <Pressable
                          onPress={() => toggleDefinition(`${index}`)}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              paddingVertical: 8,
                              paddingHorizontal: 12,
                              backgroundColor: "rgba(255, 255, 255, 0.05)",
                              borderRadius: 10,
                            }}
                          >
                            <Text style={{ color: "#93C5FD", fontSize: 12, fontWeight: "500" }}>
                              View slang definitions ({translation.slangWords.length})
                            </Text>
                            <Ionicons
                              name={expandedDefinitions[`${index}`] ? "chevron-up" : "chevron-down"}
                              size={14}
                              color="#93C5FD"
                            />
                          </View>
                        </Pressable>

                        {expandedDefinitions[`${index}`] && (
                          <View className="mt-2">
                            {translation.slangWords.map((slang, slangIndex) => (
                              <View
                                key={slangIndex}
                                style={{
                                  backgroundColor: "rgba(255, 255, 255, 0.03)",
                                  borderRadius: 10,
                                  padding: 12,
                                  borderLeftWidth: 2,
                                  borderLeftColor: "#5B8DEF",
                                  marginBottom: 8,
                                }}
                              >
                                <Text style={{ color: "#93C5FD", fontSize: 14, fontWeight: "600", marginBottom: 4 }}>
                                  {slang.word}
                                </Text>
                                <Text style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: 12, lineHeight: 18 }}>
                                  {slang.definition}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    )}
                  </BlurView>
                </View>
              ))}
            </Animated.View>
          )}

          {/* Slang of the Day */}
          <Animated.View
            entering={FadeInDown.delay(600).duration(600)}
            className="mt-24 mb-4"
          >
            {/* Header */}
            <View className="flex-row items-center mb-3">
              <Ionicons name="sparkles" size={20} color="#5B8DEF" />
              <Text
                style={{
                  color: "#5B8DEF",
                  fontSize: 20,
                  fontWeight: "bold",
                  marginLeft: 8,
                  fontStyle: "italic",
                }}
              >
                Slang of the Day
              </Text>
            </View>

            {/* Word, Generation, and Definition in a row */}
            <View className="flex-row flex-wrap items-baseline">
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: "bold",
                  color: "#FFFFFF",
                }}
              >
                {slangOfDay.word}
              </Text>
              <Text
                style={{
                  color: "#5B8DEF",
                  fontSize: 14,
                  fontStyle: "italic",
                  marginLeft: 8,
                }}
              >
                ({slangOfDay.generation})
              </Text>
              <Text
                style={{
                  color: "rgba(255, 255, 255, 0.6)",
                  fontSize: 15,
                  lineHeight: 22,
                  marginLeft: 8,
                }}
              >
                — {slangOfDay.definition}
              </Text>
            </View>

            {/* Collapsable Section */}
            {slangOfDayExpanded && (
              <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255, 255, 255, 0.1)" }}>
                {/* Example Quote */}
                <View
                  style={{
                    borderLeftWidth: 3,
                    borderLeftColor: "#5B8DEF",
                    paddingLeft: 12,
                    marginBottom: 12,
                  }}
                >
                  <Text
                    style={{
                      color: "rgba(255, 255, 255, 0.7)",
                      fontSize: 14,
                      fontStyle: "italic",
                      lineHeight: 22,
                    }}
                  >
                    &ldquo;{slangOfDay.example}&rdquo;
                  </Text>
                </View>
                {slangOfDay.pronunciation && (
                  <Text style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 14, fontStyle: "italic", marginBottom: 8 }}>
                    Pronunciation: /{slangOfDay.pronunciation}/
                  </Text>
                )}
                <Text style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 14, fontStyle: "italic" }}>
                  Part of speech: {slangOfDay.partOfSpeech}
                </Text>
              </View>
            )}

            <Pressable
              onPress={() => {
                setSlangOfDayExpanded(!slangOfDayExpanded);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                marginTop: 12,
              })}
            >
              <View className="flex-row items-center justify-center py-2">
                <Text style={{ color: "#5B8DEF", fontSize: 12, fontWeight: "500", marginRight: 4 }}>
                  {slangOfDayExpanded ? "Show less" : "Show more"}
                </Text>
                <Ionicons
                  name={slangOfDayExpanded ? "chevron-up" : "chevron-down"}
                  size={14}
                  color="#5B8DEF"
                />
              </View>
            </Pressable>
          </Animated.View>

          {/* Bottom Spacer */}
          <View className="h-4" />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
