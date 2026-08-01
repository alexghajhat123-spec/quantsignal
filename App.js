import React, { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
} from 'react-native';

// =========================================================
// Quantitative Engine — helper math functions
// =========================================================

function sma(arr, period) {
  if (arr.length < period) return null;
  const slice = arr.slice(arr.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(arr, period) {
  if (arr.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(prev);
  for (let i = period; i < arr.length; i++) {
    const val = arr[i] * k + prev * (1 - k);
    out.push(val);
    prev = val;
  }
  return out; // aligned to arr[period-1 ...]
}

function lastEma(arr, period) {
  const s = emaSeries(arr, period);
  return s.length ? s[s.length - 1] : null;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macdHistogram(closes) {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  if (!ema12.length || !ema26.length) return null;
  const offset = ema12.length - ema26.length;
  const macdLine = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }
  if (macdLine.length < 9) return null;
  const signalSeries = emaSeries(macdLine, 9);
  if (!signalSeries.length) return null;
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalSeries[signalSeries.length - 1];
  return lastMacd - lastSignal;
}

function atr(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return null;
  const trs = [];
  for (let i = highs.length - period; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function supportResistance(highs, lows, lookback = 50) {
  const h = highs.slice(-lookback);
  const l = lows.slice(-lookback);
  return {
    resistance: Math.max(...h),
    support: Math.min(...l),
  };
}

function volumeMomentum(volumes) {
  if (volumes.length < 10) return 0;
  const recent = volumes.slice(-5);
  const prior = volumes.slice(-10, -5);
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgPrior = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (avgPrior === 0) return 0;
  return (avgRecent - avgPrior) / avgPrior; // % change
}

// =========================================================
// Aggregation Scoring System
// =========================================================

function analyzeSignal(klines, currentPrice) {
  const closes = klines.map((k) => parseFloat(k[4]));
  const highs = klines.map((k) => parseFloat(k[2]));
  const lows = klines.map((k) => parseFloat(k[3]));
  const volumes = klines.map((k) => parseFloat(k[5]));

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema12 = lastEma(closes, 12);
  const ema26 = lastEma(closes, 26);
  const rsiVal = rsi(closes, 14);
  const macdHist = macdHistogram(closes);
  const atrVal = atr(highs, lows, closes, 14);
  const { support, resistance } = supportResistance(highs, lows, 50);
  const volMomentum = volumeMomentum(volumes);

  let score = 0;
  const reasons = [];

  // 1. Trend vs SMA50
  if (sma50 !== null) {
    if (currentPrice > sma50) {
      score += 2;
      reasons.push('السعر أعلى من المتوسط المتحرك SMA50 (اتجاه صاعد عام)');
    } else {
      score -= 2;
      reasons.push('السعر أسفل المتوسط المتحرك SMA50 (اتجاه هابط عام)');
    }
  }

  // 2. EMA12 vs EMA26 crossover
  if (ema12 !== null && ema26 !== null) {
    if (ema12 > ema26) {
      score += 1.5;
      reasons.push('تقاطع إيجابي بين EMA12 وEMA26 (زخم شرائي)');
    } else {
      score -= 1.5;
      reasons.push('تقاطع سلبي بين EMA12 وEMA26 (زخم بيعي)');
    }
  }

  // 3. RSI
  if (rsiVal !== null) {
    if (rsiVal < 30) {
      score += 1.5;
      reasons.push(`مؤشر RSI في منطقة تشبع بيعي (${rsiVal.toFixed(1)}) — فرصة ارتداد`);
    } else if (rsiVal > 70) {
      score -= 1.5;
      reasons.push(`مؤشر RSI في منطقة تشبع شرائي (${rsiVal.toFixed(1)}) — احتمال تصحيح`);
    } else if (rsiVal >= 50) {
      score += 0.5;
    } else {
      score -= 0.5;
    }
  }

  // 4. MACD Histogram
  if (macdHist !== null) {
    if (macdHist > 0) {
      score += 1;
      reasons.push('هيستوجرام MACD إيجابي (زخم صاعد)');
    } else {
      score -= 1;
      reasons.push('هيستوجرام MACD سلبي (زخم هابط)');
    }
  }

  // 5. Volume momentum
  if (volMomentum > 0.1) {
    score += score >= 0 ? 1 : -1;
    reasons.push('ارتفاع ملحوظ في حجم السيولة يدعم الاتجاه الحالي');
  } else if (volMomentum < -0.1) {
    reasons.push('انخفاض في حجم السيولة (ضعف نسبي في قوة الحركة)');
  }

  // 6. Proximity to support / resistance (breakout logic)
  const distToResistance = (resistance - currentPrice) / currentPrice;
  const distToSupport = (currentPrice - support) / currentPrice;
  if (distToResistance < 0.01 && volMomentum > 0) {
    score += 1.5;
    reasons.push('السعر يقترب من كسر مستوى المقاومة بدعم من السيولة');
  }
  if (distToSupport < 0.01 && volMomentum > 0) {
    score -= 1.5;
    reasons.push('السعر يقترب من كسر مستوى الدعم بضغط بيعي مصحوب بسيولة');
  }

  const maxScore = 9.5;
  const confidence = Math.min(95, Math.max(50, 50 + (Math.abs(score) / maxScore) * 45));
  const direction = score >= 0 ? 'LONG' : 'SHORT';
  const isWeak = Math.abs(score) < 1.2;

  const volFactor = atrVal ? atrVal / currentPrice : 0.015;

  let entryLow, entryHigh, tp1, tp2, sl;
  if (direction === 'LONG') {
    entryLow = currentPrice * (1 - 0.002);
    entryHigh = currentPrice * (1 + 0.002);
    tp1 = currentPrice * (1 + volFactor * 1.5);
    tp2 = currentPrice * (1 + volFactor * 3);
    sl = Math.min(currentPrice * (1 - volFactor * 1.8), support * 0.998);
  } else {
    entryLow = currentPrice * (1 - 0.002);
    entryHigh = currentPrice * (1 + 0.002);
    tp1 = currentPrice * (1 - volFactor * 1.5);
    tp2 = currentPrice * (1 - volFactor * 3);
    sl = Math.max(currentPrice * (1 + volFactor * 1.8), resistance * 1.002);
  }

  let riskPercent = 3;
  if (confidence >= 80) riskPercent = 5;
  else if (confidence >= 65) riskPercent = 4;

  return {
    direction,
    confidence: confidence.toFixed(1),
    isWeak,
    entryLow,
    entryHigh,
    tp1,
    tp2,
    sl,
    riskPercent,
    reasons,
    support,
    resistance,
    rsiVal,
  };
}

// =========================================================
// UI
// =========================================================

export default function App() {
  const [symbol, setSymbol] = useState('BTC');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ticker, setTicker] = useState(null);
  const [signal, setSignal] = useState(null);

  const fmt = (n) => {
    if (n === null || n === undefined || isNaN(n)) return '-';
    if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (n >= 1) return n.toFixed(4);
    return n.toFixed(6);
  };

  const runAnalysis = async () => {
    setError(null);
    setSignal(null);
    setTicker(null);
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      setError('الرجاء إدخال رمز العملة (مثال: BTC)');
      return;
    }
    const pair = clean.endsWith('USDT') ? clean : `${clean}USDT`;
    setLoading(true);
    try {
      const [tickerRes, klinesRes] = await Promise.all([
        fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`),
        fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1h&limit=200`),
      ]);

      const tickerJson = await tickerRes.json();
      const klinesJson = await klinesRes.json();

      if (tickerJson.code || !Array.isArray(klinesJson)) {
        setError(`لم يتم العثور على الرمز "${pair}". تأكد من كتابته بشكل صحيح (مثال: BTC, ETH, SOL).`);
        setLoading(false);
        return;
      }

      const currentPrice = parseFloat(tickerJson.lastPrice);
      setTicker({
        pair,
        price: currentPrice,
        changePercent: parseFloat(tickerJson.priceChangePercent),
        volume: parseFloat(tickerJson.quoteVolume),
        high: parseFloat(tickerJson.highPrice),
        low: parseFloat(tickerJson.lowPrice),
      });

      const result = analyzeSignal(klinesJson, currentPrice);
      setSignal(result);
    } catch (e) {
      setError('حدث خطأ أثناء جلب البيانات. تحقق من اتصال الإنترنت وحاول مجدداً.');
    } finally {
      setLoading(false);
    }
  };

  const isLong = signal && signal.direction === 'LONG';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>محلل التداول الكمي</Text>
        <Text style={styles.subtitle}>Quantitative Crypto Signal Engine</Text>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={symbol}
            onChangeText={setSymbol}
            placeholder="مثال: BTC"
            placeholderTextColor="#8892a6"
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.button} onPress={runAnalysis} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>تحليل شامل</Text>
            )}
          </TouchableOpacity>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {ticker && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{ticker.pair}</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>السعر الحالي</Text>
                <Text style={styles.statValue}>${fmt(ticker.price)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>التغير 24س</Text>
                <Text
                  style={[
                    styles.statValue,
                    { color: ticker.changePercent >= 0 ? '#22c55e' : '#ef4444' },
                  ]}
                >
                  {ticker.changePercent >= 0 ? '+' : ''}
                  {ticker.changePercent.toFixed(2)}%
                </Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>أعلى 24س</Text>
                <Text style={styles.statValueSmall}>${fmt(ticker.high)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>أدنى 24س</Text>
                <Text style={styles.statValueSmall}>${fmt(ticker.low)}</Text>
              </View>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>حجم التداول (Quote Volume)</Text>
              <Text style={styles.statValueSmall}>${fmt(ticker.volume)}</Text>
            </View>
          </View>
        )}

        {signal && (
          <View
            style={[
              styles.signalCard,
              { borderColor: isLong ? '#22c55e' : '#ef4444' },
            ]}
          >
            <View style={styles.signalHeader}>
              <Text
                style={[
                  styles.signalDirection,
                  { color: isLong ? '#22c55e' : '#ef4444' },
                ]}
              >
                {isLong ? '📈 LONG / BUY' : '📉 SHORT / SELL'}
              </Text>
              <Text style={styles.confidenceText}>
                ثقة الإشارة: {signal.confidence}%
              </Text>
            </View>

            {signal.isWeak && (
              <Text style={styles.weakWarning}>
                ⚠️ إشارة ضعيفة نسبياً — يفضل الانتظار لتأكيد إضافي قبل الدخول
              </Text>
            )}

            <View style={styles.divider} />

            <Row label="منطقة الدخول (Entry Zone)" value={`$${fmt(signal.entryLow)} - $${fmt(signal.entryHigh)}`} />
            <Row label="🎯 الهدف الأول (TP1)" value={`$${fmt(signal.tp1)}`} valueColor="#22c55e" />
            <Row label="🎯🎯 الهدف الثاني (TP2)" value={`$${fmt(signal.tp2)}`} valueColor="#22c55e" />
            <Row label="🛑 وقف الخسارة (Stop Loss)" value={`$${fmt(signal.sl)}`} valueColor="#ef4444" />
            <Row label="نسبة رأس المال الموصى بها" value={`${signal.riskPercent}% من المحفظة`} />
            <Row label="الدعم / المقاومة" value={`$${fmt(signal.support)} / $${fmt(signal.resistance)}`} />
            {signal.rsiVal !== null && (
              <Row label="RSI (14)" value={signal.rsiVal.toFixed(1)} />
            )}

            <View style={styles.divider} />

            <Text style={styles.summaryTitle}>ملخص التقرير الفني</Text>
            {signal.reasons.map((r, idx) => (
              <Text key={idx} style={styles.reasonText}>
                • {r}
              </Text>
            ))}

            <Text style={styles.disclaimer}>
              ⚠️ هذا التقرير ناتج عن تحليل خوارزمي آلي لأغراض تعليمية فقط، وليس
              توصية استثمارية أو مالية. الأسواق الرقمية عالية المخاطرة، يرجى
              إجراء بحثكم الخاص (DYOR) وإدارة رأس المال بحذر.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, valueColor }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0f19' },
  container: { padding: 20, paddingBottom: 50 },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f5f6fa',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#8892a6',
    textAlign: 'center',
    marginBottom: 20,
  },
  inputRow: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1,
    backgroundColor: '#151b2b',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#f5f6fa',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#242c40',
  },
  button: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  errorText: {
    color: '#ef4444',
    marginTop: 14,
    textAlign: 'center',
    fontSize: 13,
  },
  card: {
    marginTop: 20,
    backgroundColor: '#151b2b',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#242c40',
  },
  cardTitle: {
    color: '#f5f6fa',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statBox: { flex: 1 },
  statLabel: { color: '#8892a6', fontSize: 12, marginBottom: 2 },
  statValue: { color: '#f5f6fa', fontSize: 18, fontWeight: '700' },
  statValueSmall: { color: '#f5f6fa', fontSize: 14, fontWeight: '600' },
  signalCard: {
    marginTop: 20,
    backgroundColor: '#151b2b',
    borderRadius: 16,
    padding: 18,
    borderWidth: 2,
  },
  signalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  signalDirection: { fontSize: 20, fontWeight: '800' },
  confidenceText: { color: '#f5f6fa', fontSize: 13, fontWeight: '600' },
  weakWarning: {
    color: '#fbbf24',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#242c40',
    marginVertical: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  rowLabel: { color: '#8892a6', fontSize: 13 },
  rowValue: { color: '#f5f6fa', fontSize: 13, fontWeight: '700' },
  summaryTitle: {
    color: '#f5f6fa',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  reasonText: {
    color: '#c3c9d9',
    fontSize: 12.5,
    lineHeight: 19,
    marginBottom: 3,
  },
  disclaimer: {
    color: '#6b7280',
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 14,
    textAlign: 'center',
  },
});
