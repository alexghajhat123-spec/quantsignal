import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

type Kline = [string, string, string, string, string, ...unknown[]];

type Ticker = {
  pair: string;
  price: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
};

type Signal = {
  direction: 'LONG' | 'SHORT';
  confidence: string;
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number;
  sl: number;
  reasons: string[];
  indicators: {
    sma50: number | null;
    ema12: number | null;
    ema26: number | null;
    rsi: number | null;
  };
};

function sma(arr: number[], period: number) {
  if (arr.length < period) return null;
  return arr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function emaSeries(arr: number[], period: number) {
  if (arr.length < period) return [];

  const k = 2 / (period + 1);
  const out: number[] = [];

  let prev = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(prev);

  for (let i = period; i < arr.length; i += 1) {
    const val = arr[i] * k + prev * (1 - k);
    out.push(val);
    prev = val;
  }

  return out;
}

function lastEma(arr: number[], period: number) {
  const series = emaSeries(arr, period);
  return series.length ? series[series.length - 1] : null;
}

function rsi(closes: number[], period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];

    if (diff >= 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  return 100 - 100 / (1 + avgGain / avgLoss);
}

function analyzeSignal(klines: Kline[], currentPrice: number): Signal {
  const closes = klines.map((k) => Number(k[4]));
  const highs = klines.map((k) => Number(k[2]));
  const lows = klines.map((k) => Number(k[3]));

  const sma50 = sma(closes, 50);
  const ema12 = lastEma(closes, 12);
  const ema26 = lastEma(closes, 26);
  const rsiVal = rsi(closes, 14);

  const recentLows = lows.slice(-50);
  const recentHighs = highs.slice(-50);

  const support = Math.min(...recentLows);
  const resistance = Math.max(...recentHighs);

  let score = 0;
  const reasons: string[] = [];

  if (sma50 !== null) {
    if (currentPrice > sma50) {
      score += 2;
      reasons.push('السعر أعلى من SMA50 — الاتجاه العام صاعد');
    } else {
      score -= 2;
      reasons.push('السعر أسفل من SMA50 — الاتجاه العام هابط');
    }
  }

  if (ema12 !== null && ema26 !== null) {
    if (ema12 > ema26) {
      score += 1.5;
      reasons.push('تقاطع إيجابي بين EMA12 و EMA26');
    } else {
      score -= 1.5;
      reasons.push('تقاطع سلبي بين EMA12 و EMA26');
    }
  }

  if (rsiVal !== null) {
    if (rsiVal < 30) {
      score += 1.5;
      reasons.push(`RSI في تشبع بيعي (${rsiVal.toFixed(1)})`);
    } else if (rsiVal > 70) {
      score -= 1.5;
      reasons.push(`RSI في تشبع شرائي (${rsiVal.toFixed(1)})`);
    } else {
      reasons.push(`RSI متوازن عند ${rsiVal.toFixed(1)}`);
    }
  }

  const confidence = Math.min(
    95,
    Math.max(50, 50 + (Math.abs(score) / 9.5) * 45),
  );

  const direction = score >= 0 ? 'LONG' : 'SHORT';
  const volFactor = 0.015;

  const entryLow = currentPrice * 0.998;
  const entryHigh = currentPrice * 1.002;

  const tp1 =
    direction === 'LONG'
      ? currentPrice * (1 + volFactor * 1.5)
      : currentPrice * (1 - volFactor * 1.5);

  const tp2 =
    direction === 'LONG'
      ? currentPrice * (1 + volFactor * 3)
      : currentPrice * (1 - volFactor * 3);

  const sl =
    direction === 'LONG'
      ? Math.min(currentPrice * (1 - volFactor * 1.8), support * 0.998)
      : Math.max(currentPrice * (1 + volFactor * 1.8), resistance * 1.002);

  return {
    direction,
    confidence: confidence.toFixed(1),
    entryLow,
    entryHigh,
    tp1,
    tp2,
    sl,
    reasons,
    indicators: {
      sma50,
      ema12,
      ema26,
      rsi: rsiVal,
    },
  };
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }

  if (value >= 1000) {
    return value.toLocaleString('en-US', {
      maximumFractionDigits: 2,
    });
  }

  if (value >= 1) {
    return value.toFixed(3);
  }

  return value.toFixed(6);
}

function formatCompact(value: number) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }

  return value.toFixed(0);
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  const colors = useColors();

  return (
    <View style={styles.metric}>
      <Text
        style={[
          styles.metricValue,
          tone ? { color: tone } : { color: colors.foreground },
        ]}
      >
        {value}
      </Text>

      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [symbol, setSymbol] = useState('BTC');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const quickSymbols = ['BTC', 'ETH', 'SOL', 'BNB'];
  const isLong = signal?.direction === 'LONG';
  const accent = isLong ? colors.positive : colors.negative;
  const maxContentWidth = Platform.OS === 'web' ? 520 : undefined;

  const statusText = useMemo(() => {
    if (loading) {
      return 'جاري قراءة السوق...';
    }

    if (ticker) {
      return `آخر تحديث · ${ticker.pair}`;
    }

    return 'تحليل فني مباشر من Binance';
  }, [loading, ticker]);

  const runAnalysis = async (requestedSymbol = symbol) => {
    setError(null);
    setSignal(null);
    setTicker(null);
    setHasAnalyzed(true);

    const clean = requestedSymbol.trim().toUpperCase();

    if (!clean) {
      setError('أدخل رمز العملة أولاً');
      return;
    }

    const pair = clean.endsWith('USDT') ? clean : `${clean}USDT`;

    setSymbol(clean.replace(/USDT$/, ''));
    setLoading(true);

    try {
      const [tickerRes, klinesRes] = await Promise.all([
        fetch(
          `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${pair}`,
        ),
        fetch(
          `https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=1h&limit=200`,
        ),
      ]);

      const tickerJson = await tickerRes.json();
      const klinesJson = await klinesRes.json();

      if (!tickerRes.ok || !klinesRes.ok || !Array.isArray(klinesJson)) {
        throw new Error('Market data request failed');
      }

      const currentPrice = Number(tickerJson.lastPrice);

      if (!Number.isFinite(currentPrice) || klinesJson.length < 50) {
        throw new Error('Insufficient market data');
      }

      setTicker({
        pair,
        price: currentPrice,
        changePercent: Number(tickerJson.priceChangePercent),
        high: Number(tickerJson.highPrice),
        low: Number(tickerJson.lowPrice),
        volume: Number(tickerJson.quoteVolume),
      });

      setSignal(analyzeSignal(klinesJson as Kline[], currentPrice));
    } catch {
      setError('تعذر جلب البيانات. تأكد من الرمز وحاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <StatusBar barStyle="light-content" />

      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 67 : 16),
            paddingBottom: Math.max(
              insets.bottom + 24,
              Platform.OS === 'web' ? 34 : 24,
            ),
            maxWidth: maxContentWidth,
            alignSelf: Platform.OS === 'web' ? 'center' : undefined,
            width: Platform.OS === 'web' ? '100%' : undefined,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <Image
              source={require('./assets/images/icon.png')}
              style={styles.logo}
            />

            <View>
              <Text
                style={[
                  styles.brandName,
                  { color: colors.foreground },
                ]}
              >
                QuantSignal
              </Text>

              <Text style={styles.brandCaption}>
                تحليل كمي للعملات الرقمية
              </Text>
            </View>
          </View>

          <View style={styles.livePill}>
            <View style={styles.liveDot} />

            <Text style={styles.liveText}>مباشر</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>MARKET INTELLIGENCE</Text>

          <Text
            style={[
              styles.title,
              { color: colors.foreground },
            ]}
          >
            اقرأ حركة السوق{'\n'}قبل أن تتحرك.
          </Text>

          <Text style={styles.subtitle}>
            أدخل رمز العملة للحصول على إشارة مبنية على الاتجاه، الزخم، ومناطق
            السعر.
          </Text>
        </View>

        <View
          style={[
            styles.searchShell,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.searchInputWrap}>
            <Feather
              name="search"
              size={18}
              color={colors.mutedForeground}
            />

            <TextInput
              testID="symbol-input"
              style={[
                styles.input,
                { color: colors.foreground },
              ]}
              value={symbol}
              onChangeText={setSymbol}
              onSubmitEditing={() => void runAnalysis()}
              placeholder="رمز العملة"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              textAlign="left"
            />

            <Text style={styles.quote}>/ USDT</Text>
          </View>

          <Pressable
            testID="analyze-button"
            accessibilityRole="button"
            onPress={() => void runAnalysis()}
            disabled={loading}
            style={({ pressed }) => [
              styles.analyzeButton,
              {
                backgroundColor: colors.primary,
                opacity: loading ? 0.65 : pressed ? 0.82 : 1,
              },
            ]}
          >
            {loading ? (
              <ActivityIndicator
                color={colors.primaryForeground}
                size="small"
              />
            ) : (
              <Feather
                name="arrow-up-left"
                size={19}
                color={colors.primaryForeground}
              />
            )}

            <Text
              style={[
                styles.analyzeText,
                { color: colors.primaryForeground },
              ]}
            >
              حلّل
            </Text>
          </Pressable>
        </View>

        <View style={styles.quickRow}>
          <Text style={styles.quickLabel}>الأكثر متابعة</Text>

          {quickSymbols.map((item) => (
            <Pressable
              key={item}
              onPress={() => {
                setSymbol(item);
                void runAnalysis(item);
              }}
              style={({ pressed }) => [
                styles.quickChip,
                {
                  backgroundColor:
                    symbol === item
                      ? colors.accent
                      : colors.secondary,
                  borderColor:
                    symbol === item
                      ? colors.primary
                      : colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.quickText,
                  {
                    color:
                      symbol === item
                        ? colors.accentForeground
                        : colors.mutedForeground,
                  },
                ]}
              >
                {item}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.statusText}>{statusText}</Text>

        {error && (
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.destructive,
              },
            ]}
          >
            <View
              style={[
                styles.errorIcon,
                {
                  backgroundColor: `${colors.destructive}20`,
                },
              ]}
            >
              <Feather
                name="alert-triangle"
                size={17}
                color={colors.destructive}
              />
            </View>

            <View style={styles.errorCopy}>
              <Text
                style={[
                  styles.errorTitle,
                  { color: colors.foreground },
                ]}
              >
                لم نتمكن من التحليل
              </Text>

              <Text style={styles.errorText}>{error}</Text>
            </View>

            <Pressable
              onPress={() => void runAnalysis()}
              hitSlop={10}
            >
              <Text
                style={[
                  styles.retryText,
                  { color: colors.primary },
                ]}
              >
                إعادة
              </Text>
            </Pressable>
          </View>
        )}

        {!hasAnalyzed && !loading && (
          <View
            style={[
              styles.emptyCard,
              {
                borderColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
          >
            <View
              style={[
                styles.emptyIcon,
                { backgroundColor: colors.accent },
              ]}
            >
              <Feather
                name="activity"
                size={23}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.emptyTitle,
                { color: colors.foreground },
              ]}
            >
              جاهز لتحليل السوق
            </Text>

            <Text style={styles.emptyText}>
              ابدأ بـ BTC أو اختر أي عملة مدعومة على Binance.
            </Text>
          </View>
        )}

        {loading && (
          <View
            style={[
              styles.loadingCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <ActivityIndicator color={colors.primary} />

            <Text
              style={[
                styles.loadingTitle,
                { color: colors.foreground },
              ]}
            >
              نحسب الإشارة الآن
            </Text>

            <Text style={styles.loadingText}>
              نقارن 200 شمعة على إطار الساعة.
            </Text>
          </View>
        )}

        {ticker && signal && !loading && (
          <>
            <View
              style={[
                styles.marketCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.marketHeader}>
                <View>
                  <Text style={styles.marketOverline}>
                    السوق الفوري
                  </Text>

                  <Text
                    style={[
                      styles.pair,
                      { color: colors.foreground },
                    ]}
                  >
                    {ticker.pair}
                  </Text>
                </View>

                <View
                  style={[
                    styles.changeBadge,
                    {
                      backgroundColor:
                        ticker.changePercent >= 0
                          ? `${colors.positive}18`
                          : `${colors.negative}18`,
                    },
                  ]}
                >
                  <Feather
                    name={
                      ticker.changePercent >= 0
                        ? 'trending-up'
                        : 'trending-down'
                    }
                    size={13}
                    color={
                      ticker.changePercent >= 0
                        ? colors.positive
                        : colors.negative
                    }
                  />

                  <Text
                    style={{
                      color:
                        ticker.changePercent >= 0
                          ? colors.positive
                          : colors.negative,
                      fontWeight: '700',
                    }}
                  >
                    {ticker.changePercent >= 0 ? '+' : ''}
                    {ticker.changePercent.toFixed(2)}%
                  </Text>
                </View>
              </View>

              <Text
                style={[
                  styles.price,
                  { color: colors.foreground },
                ]}
              >
                ${formatPrice(ticker.price)}
              </Text>

              <View style={styles.metricsRow}>
                <Metric
                  label="أعلى 24س"
                  value={`$${formatPrice(ticker.high)}`}
                />

                <Metric
                  label="أدنى 24س"
                  value={`$${formatPrice(ticker.low)}`}
                />

                <Metric
                  label="حجم التداول"
                  value={formatCompact(ticker.volume)}
                />
              </View>
            </View>

            <View
              style={[
                styles.signalCard,
                {
                  backgroundColor: colors.card,
                  borderColor: accent,
                },
              ]}
            >
              <View style={styles.signalHeader}>
                <View>
                  <Text style={styles.signalOverline}>
                    إشارة QuantSignal
                  </Text>

                  <View style={styles.directionRow}>
                    <Feather
                      name={
                        isLong
                          ? 'arrow-up-right'
                          : 'arrow-down-right'
                      }
                      size={28}
                      color={accent}
                    />

                    <Text
                      style={[
                        styles.direction,
                        { color: accent },
                      ]}
                    >
                      {signal.direction === 'LONG' ? 'LONG / BUY' : 'SHORT / SELL'}
                    </Text>
                  </View>
                </View>

                <View style={styles.confidenceBadge}>
                  <Feather name="shield" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.confidenceText, { color: colors.foreground }]}>
                    ثقة الإشارة: {signal.confidence}%
                  </Text>
                </View>
              </View>

              <View style={styles.gridBox}>
                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>منطقة الدخول (Entry Zone)</Text>
                  <Text style={[styles.gridVal, { color: colors.foreground }]}>
                    ${formatPrice(signal.entryLow)} - ${formatPrice(signal.entryHigh)}
                  </Text>
                </View>

                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>الهدف الأول (TP1)</Text>
                  <Text style={[styles.gridVal, { color: colors.positive }]}>
                    ${formatPrice(signal.tp1)}
                  </Text>
                </View>

                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>الهدف الثاني (TP2)</Text>
                  <Text style={[styles.gridVal, { color: colors.positive }]}>
                    ${formatPrice(signal.tp2)}
                  </Text>
                </View>

                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>وقف الخسارة (Stop Loss)</Text>
                  <Text style={[styles.gridVal, { color: colors.negative }]}>
                    ${formatPrice(signal.sl)}
                  </Text>
                </View>

                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>نسبة رأس المال الموصى بها</Text>
                  <Text style={[styles.gridVal, { color: colors.foreground }]}>3% من المحفظة</Text>
                </View>

                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>الدعم / المقاومة</Text>
                  <Text style={[styles.gridVal, { color: colors.foreground }]}>
                    ${formatPrice(ticker.low)} / ${formatPrice(ticker.high)}
                  </Text>
                </View>

                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>RSI (14)</Text>
                  <Text style={[styles.gridVal, { color: colors.foreground }]}>
                    {signal.indicators.rsi !== null ? signal.indicators.rsi.toFixed(1) : '—'}
                  </Text>
                </View>
              </View>

              <View style={styles.reasonsBox}>
                <Text style={[styles.reasonsTitle, { color: colors.foreground }]}>
                  ملخص التقرير الفني
                </Text>

                {signal.reasons.map((reason, idx) => (
                  <View key={idx} style={styles.reasonRow}>
                    <Text style={[styles.bullet, { color: colors.primary }]}>•</Text>
                    <Text style={[styles.reasonText, { color: colors.mutedForeground }]}>
                      {reason}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.disclaimerBox}>
                <Feather name="alert-circle" size={14} color={colors.mutedForeground} />
                <Text style={styles.disclaimerText}>
                  هذا التقرير ناتج عن تحليل خوارزمي آلي لأغراض تعليمية فقط، وليس توصية استثمارية أو مالية. الأسواق الرقمية عالية المخاطرة، يرجى إجراء البحث الخاص (DYOR) وإدارة رأس المال بحذر.
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { paddingHorizontal: 20 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 40, height: 40, borderRadius: 10 },
  brandName: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  brandCaption: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#10b981' },
  liveText: { fontSize: 11, fontWeight: '700', color: '#10b981' },
  hero: { marginBottom: 24 },
  eyebrow: { fontSize: 11, fontWeight: '700', color: '#38bdf8', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '900', lineHeight: 36, letterSpacing: -0.5, marginBottom: 10 },
  subtitle: { fontSize: 14, color: '#94a3b8', lineHeight: 22 },
  searchShell: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 8 },
  input: { flex: 1, fontSize: 16, fontWeight: '700', paddingVertical: 8 },
  quote: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  analyzeText: { fontSize: 14, fontWeight: '700' },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  quickLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginRight: 4 },
  quickChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  quickText: { fontSize: 12, fontWeight: '700' },
  statusText: { fontSize: 12, color: '#64748b', marginBottom: 20, textAlign: 'center' },
  errorCard: { borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  errorIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  errorCopy: { flex: 1 },
  errorTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  errorText: { fontSize: 12, color: '#94a3b8' },
  retryText: { fontSize: 13, fontWeight: '700' },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: 32, alignItems: 'center', marginBottom: 20 },
  emptyIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  emptyText: { fontSize: 13, color: '#94a3b8', textAlign: 'center' },
  loadingCard: { borderWidth: 1, borderRadius: 16, padding: 32, alignItems: 'center', marginBottom: 20, gap: 10 },
  loadingTitle: { fontSize: 15, fontWeight: '800' },
  loadingText: { fontSize: 12, color: '#94a3b8' },
  marketCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 16 },
  marketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  marketOverline: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 4 },
  pair: { fontSize: 20, fontWeight: '900' },
  changeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  price: { fontSize: 32, fontWeight: '900', marginBottom: 16 },
  metricsRow: { flexDirection: 'row', gap: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 12 },
  metric: { flex: 1 },
  metricValue: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  metricLabel: { fontSize: 11, color: '#64748b' },
  signalCard: { borderWidth: 2, borderRadius: 16, padding: 16, marginBottom: 16 },
  signalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  signalOverline: { fontSize: 11, fontWeight: '700', color: '#64748b', marginBottom: 6 },
  directionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  direction: { fontSize: 20, fontWeight: '900' },
  confidenceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  confidenceText: { fontSize: 12, fontWeight: '700' },
  gridBox: { gap: 12, marginBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingBottom: 16 },
  gridRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gridLabel: { fontSize: 13, color: '#94a3b8' },
  gridVal: { fontSize: 14, fontWeight: '800' },
  reasonsBox: { gap: 8, marginBottom: 16 },
  reasonsTitle: { fontSize: 14, fontWeight: '800', marginBottom: 4 },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bullet: { fontSize: 14, lineHeight: 18 },
  reasonText: { fontSize: 13, flex: 1, lineHeight: 18 },
  disclaimerBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 10 },
  disclaimerText: { fontSize: 10, color: '#64748b', flex: 1, lineHeight: 15 },
});
