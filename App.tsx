/**
 * SMS Guard — pendeteksi link berbahaya pada SMS.
 *
 * UI & logika ditulis dalam JavaScript/React Native.
 * Penangkapan SMS asli ditangani modul native Java (SmsReceiver) yang bekerja
 * otomatis & real-time, bahkan saat aplikasi tertutup. Layar ini menampilkan
 * hasilnya dan menyediakan pemeriksaan link manual.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const {SmsModule} = NativeModules;

const THRESHOLD = 0.5119020229513724;
const DEFAULT_API = 'http://10.0.2.2:8000'; // 10.0.2.2 = localhost laptop dari emulator

/* ------------------------------------------------------------------ tema */
const C = {
  red: '#E60012',
  redDark: '#B00010',
  redDeep: '#7A0009',
  amber: '#E8820A',
  green: '#0A9D44',
  ink: '#15171C',
  sub: '#6B7280',
  faint: '#9AA0AA',
  line: '#EAECEF',
  bg: '#F3F4F6',
  card: '#FFFFFF',
  safeBg: '#E8F7EE',
  warnBg: '#FFF4E5',
  badBg: '#FDEAEC',
};

const STATUS_H = (Platform.OS === 'android' ? StatusBar.currentHeight : 0) || 0;

/* -------------------------------------------------------------- helpers */
const URL_RE = /((https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/[^\s]*)?)/gi;

function extractUrls(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    const u = m[1];
    const host = u.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0];
    const dot = host.lastIndexOf('.');
    if (dot < 0) continue;
    const tld = host.slice(dot + 1);
    if (!/[a-z]/i.test(tld)) continue; // buang angka spt "175.000.000"
    out.push(u.replace(/[.,)]+$/, ''));
  }
  return Array.from(new Set(out));
}

type Tier = {key: 'safe' | 'warn' | 'bad' | 'unknown'; label: string; color: string; bg: string; icon: string};

function tierOf(prob: number): Tier {
  if (prob < 0) return {key: 'unknown', label: 'Tidak terperiksa', color: C.faint, bg: C.bg, icon: '–'};
  if (prob >= THRESHOLD) return {key: 'bad', label: 'Berbahaya', color: C.red, bg: C.badBg, icon: '⚠'};
  if (prob >= 0.25) return {key: 'warn', label: 'Waspada', color: C.amber, bg: C.warnBg, icon: '!'};
  return {key: 'safe', label: 'Aman', color: C.green, bg: C.safeBg, icon: '✓'};
}

function pct(prob: number): number {
  return Math.max(0, Math.min(100, Math.round(prob * 100)));
}

function timeNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function initialOf(sender: string): string {
  const c = (sender || '?').trim()[0];
  return /[a-z0-9]/i.test(c) ? c.toUpperCase() : '#';
}

/* ---------------------------------------------------------------- types */
type Entry = {
  id: number;
  sender: string;
  body: string;
  url: string | null;
  prob: number;
  bad: boolean;
  pending: boolean;
  time: string;
};

let counter = 1;

/* ====================================================== komponen kecil */

function Header() {
  return (
    <View style={styles.header}>
      <View style={styles.logo}>
        <Text style={{fontSize: 22}}>🛡️</Text>
      </View>
      <View style={{flex: 1}}>
        <Text style={styles.title}>SMS Guard</Text>
        <Text style={styles.subtitle}>Perlindungan dari link penipuan</Text>
      </View>
      <View style={styles.statusPill}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>Aktif</Text>
      </View>
    </View>
  );
}

function HeroCard({checked, blocked}: {checked: number; blocked: number}) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.heroShield}>
          <Text style={{fontSize: 26}}>🛡️</Text>
        </View>
        <View style={{flex: 1}}>
          <Text style={styles.heroTitle}>Perlindungan aktif</Text>
          <Text style={styles.heroSub}>
            SMS masuk diperiksa otomatis oleh model AI secara real-time.
          </Text>
        </View>
      </View>
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{checked}</Text>
          <Text style={styles.statLbl}>Diperiksa</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, {color: C.red}]}>{blocked}</Text>
          <Text style={styles.statLbl}>Diblokir</Text>
        </View>
      </View>
    </View>
  );
}

function RiskMeter({prob}: {prob: number}) {
  const t = tierOf(prob);
  const p = pct(prob);
  return (
    <View style={[styles.meter, {backgroundColor: t.bg}]}>
      <View style={styles.meterHead}>
        <Text style={[styles.meterPct, {color: t.color}]}>{p}%</Text>
        <View style={[styles.meterChip, {backgroundColor: t.color}]}>
          <Text style={styles.meterChipText}>
            {t.icon} {t.label}
          </Text>
        </View>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, {width: `${p}%`, backgroundColor: t.color}]} />
      </View>
      <Text style={styles.meterNote}>Tingkat risiko menurut model LightGBM</Text>
    </View>
  );
}

function SmsCard({e}: {e: Entry}) {
  const t = tierOf(e.prob);
  const showVerdict = !e.pending && !!e.url && e.prob >= 0;
  const onPress =
    showVerdict && e.bad
      ? () =>
          Alert.alert(
            '⚠️ Link Berbahaya Diblokir',
            `Link ini terindikasi PENIPUAN (risiko ${pct(e.prob)}%):\n\n${e.url}\n\n` +
              'Membukanya dapat mencuri data atau uang Anda.',
            [{text: 'Mengerti, lindungi saya'}],
          )
      : undefined;

  return (
    <View style={styles.smsRow}>
      <View
        style={[
          styles.accent,
          {backgroundColor: e.pending ? C.line : t.color},
        ]}
      />
      <View style={styles.smsCard}>
        <View style={styles.smsHead}>
          <View
            style={[
              styles.avatar,
              {backgroundColor: e.pending ? C.faint : t.color},
            ]}>
            <Text style={styles.avatarText}>{initialOf(e.sender)}</Text>
          </View>
          <Text style={styles.smsSender} numberOfLines={1}>
            {e.sender}
          </Text>
          <Text style={styles.smsTime}>{e.time}</Text>
        </View>

        <Text style={styles.smsBody}>{e.body}</Text>

        {e.pending && (
          <View style={styles.verdictScan}>
            <ActivityIndicator size="small" color={C.sub} />
            <Text style={styles.scanText}>  Memeriksa link…</Text>
          </View>
        )}

        {!e.pending && !!e.url && e.prob < 0 && (
          <View style={styles.verdictScan}>
            <Text style={styles.scanText}>
              ⚠️ Tidak dapat memeriksa (server tidak terjangkau)
            </Text>
          </View>
        )}

        {showVerdict && (
          <TouchableOpacity
            disabled={!e.bad}
            activeOpacity={0.7}
            onPress={onPress}
            style={[styles.verdict, {backgroundColor: t.bg}]}>
            <Text style={[styles.verdictText, {color: t.color}]}>
              {e.bad
                ? `🚫 Link berbahaya — jangan dibuka`
                : t.key === 'warn'
                ? `⚠️ Link mencurigakan — hati-hati`
                : `✓ Link aman diverifikasi`}
            </Text>
            <Text style={[styles.verdictPct, {color: t.color}]}>{pct(e.prob)}%</Text>
          </TouchableOpacity>
        )}

        {!e.pending && !e.url && (
          <Text style={styles.noLink}>Tidak ada link pada pesan ini.</Text>
        )}
      </View>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>📭</Text>
      <Text style={styles.emptyTitle}>Belum ada pesan</Text>
      <Text style={styles.emptyText}>
        SMS yang masuk akan otomatis muncul di sini lengkap dengan hasil
        pemeriksaan keamanannya.
      </Text>
    </View>
  );
}

/* ============================================================== layar */
export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API);
  const [history, setHistory] = useState<Entry[]>([]);
  const [manual, setManual] = useState('');
  const [manualResult, setManualResult] = useState<{prob: number} | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const apiRef = useRef(apiUrl);
  apiRef.current = apiUrl;

  const {checked, blocked} = useMemo(() => {
    let chk = 0;
    let blk = 0;
    for (const e of history) {
      if (!e.pending && e.url && e.prob >= 0) {
        chk++;
        if (e.bad) blk++;
      }
    }
    return {checked: chk, blocked: blk};
  }, [history]);

  async function predict(url: string): Promise<number> {
    const base = apiRef.current.replace(/\/+$/, '');
    const r = await fetch(base + '/api/predict', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({urls: [url]}),
    });
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    return d.results[0].probability as number;
  }

  // Simpan alamat API ke native setiap berubah, agar SmsReceiver (background) memakainya.
  useEffect(() => {
    try {
      SmsModule?.saveConfig(apiUrl);
    } catch {}
  }, [apiUrl]);

  // Minta izin & dengarkan event SMS dari native.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        await PermissionsAndroid.requestMultiple([
          'android.permission.RECEIVE_SMS' as any,
          'android.permission.POST_NOTIFICATIONS' as any,
        ]);
      } catch {}
    })();

    const emitter = new NativeEventEmitter(SmsModule);
    const sub = emitter.addListener(
      'onSmsReceived',
      (e: {sender: string; body: string; url: string | null; prob: number; bad: boolean}) => {
        setHistory(prev => [
          {
            id: counter++,
            sender: e.sender,
            body: e.body,
            url: e.url ?? null,
            prob: e.prob,
            bad: e.bad,
            pending: false,
            time: timeNow(),
          },
          ...prev,
        ]);
      },
    );
    return () => sub.remove();
  }, []);

  async function manualCheck() {
    const url = manual.trim();
    if (!url) return;
    setManualLoading(true);
    setManualResult(null);
    try {
      const prob = await predict(url);
      setManualResult({prob});
    } catch {
      setManualResult({prob: -1});
    }
    setManualLoading(false);
  }

  return (
    <View style={styles.root}>
      <StatusBar backgroundColor={C.redDeep} barStyle="light-content" />

      <Header />

      <ScrollView
        style={{flex: 1}}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        <HeroCard checked={checked} blocked={blocked} />

        {/* Pemeriksaan manual */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cek link manual</Text>
          <Text style={styles.cardHint}>
            Tempel tautan mencurigakan untuk diperiksa model AI.
          </Text>
          <TextInput
            style={styles.input}
            value={manual}
            onChangeText={setManual}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://contoh-link.com/klaim"
            placeholderTextColor={C.faint}
            onSubmitEditing={manualCheck}
          />
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={manualCheck}>
            <Text style={styles.primaryBtnText}>Periksa Sekarang</Text>
          </TouchableOpacity>

          {manualLoading && (
            <ActivityIndicator style={{marginTop: 16}} color={C.red} />
          )}
          {manualResult && !manualLoading && manualResult.prob < 0 && (
            <Text style={styles.errText}>
              Server tidak terjangkau. Periksa alamat di Pengaturan.
            </Text>
          )}
          {manualResult && !manualLoading && manualResult.prob >= 0 && (
            <RiskMeter prob={manualResult.prob} />
          )}
        </View>

        {/* Kotak masuk */}
        <View style={styles.sectionRow}>
          <Text style={styles.section}>Kotak Masuk</Text>
          {history.length > 0 && (
            <TouchableOpacity onPress={() => setHistory([])}>
              <Text style={styles.clear}>Bersihkan</Text>
            </TouchableOpacity>
          )}
        </View>

        {history.length === 0 ? (
          <EmptyState />
        ) : (
          history.map(e => <SmsCard key={e.id} e={e} />)
        )}

        {/* Pengaturan server */}
        <View style={[styles.card, {marginTop: 4}]}>
          <Text style={styles.cardTitle}>Pengaturan</Text>
          <Text style={styles.label}>Alamat server model</Text>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://10.0.2.2:8000"
            placeholderTextColor={C.faint}
          />
          <Text style={styles.cardHint}>
            Emulator: 10.0.2.2 = laptop. HP asli: pakai IP laptop di WiFi yang
            sama, mis. http://192.168.x.x:8000
          </Text>
        </View>

        <Text style={styles.foot}>Diperiksa oleh model AI · LightGBM</Text>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------- styles */
const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: {width: 0, height: 4},
  elevation: 2,
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: C.bg},

  /* header */
  header: {
    backgroundColor: C.red,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 22,
    paddingTop: STATUS_H + 12,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  title: {color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.2},
  subtitle: {color: '#FFD7DB', fontSize: 12.5, marginTop: 2},
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  statusDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: '#54F08A', marginRight: 6},
  statusText: {color: '#fff', fontSize: 12, fontWeight: '700'},

  scroll: {padding: 16, paddingTop: 0, paddingBottom: 32},

  /* hero */
  hero: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 16,
    marginTop: -14,
    ...shadow,
  },
  heroTop: {flexDirection: 'row', alignItems: 'center'},
  heroShield: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: C.safeBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  heroTitle: {fontSize: 16, fontWeight: '800', color: C.ink},
  heroSub: {fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 18},
  statRow: {
    flexDirection: 'row',
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 14,
  },
  stat: {flex: 1, alignItems: 'center'},
  statDivider: {width: 1, backgroundColor: C.line},
  statNum: {fontSize: 24, fontWeight: '800', color: C.ink},
  statLbl: {fontSize: 11.5, color: C.faint, marginTop: 2, fontWeight: '600'},

  /* card */
  card: {backgroundColor: C.card, borderRadius: 20, padding: 16, marginTop: 14, ...shadow},
  cardTitle: {fontSize: 16, fontWeight: '800', color: C.ink},
  cardHint: {fontSize: 12, color: C.faint, marginTop: 4, marginBottom: 12, lineHeight: 17},
  label: {fontSize: 12, fontWeight: '700', color: C.sub, marginTop: 12, marginBottom: 6},
  input: {
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14.5,
    color: C.ink,
    backgroundColor: '#FAFBFC',
  },
  primaryBtn: {
    backgroundColor: C.red,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
    ...shadow,
    shadowColor: C.red,
    shadowOpacity: 0.3,
  },
  primaryBtnText: {color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.2},
  errText: {color: C.red, fontSize: 12.5, marginTop: 14, textAlign: 'center', fontWeight: '600'},

  /* risk meter */
  meter: {borderRadius: 16, padding: 14, marginTop: 16},
  meterHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  meterPct: {fontSize: 34, fontWeight: '800'},
  meterChip: {borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6},
  meterChipText: {color: '#fff', fontSize: 12.5, fontWeight: '800'},
  meterTrack: {height: 10, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.07)', marginTop: 12, overflow: 'hidden'},
  meterFill: {height: '100%', borderRadius: 999},
  meterNote: {fontSize: 11, color: C.sub, marginTop: 8},

  /* section */
  sectionRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 10},
  section: {fontSize: 17, fontWeight: '800', color: C.ink},
  clear: {fontSize: 13, color: C.red, fontWeight: '700'},

  /* sms card */
  smsRow: {flexDirection: 'row', marginBottom: 12, borderRadius: 18, backgroundColor: C.card, ...shadow, overflow: 'hidden'},
  accent: {width: 5},
  smsCard: {flex: 1, padding: 14},
  smsHead: {flexDirection: 'row', alignItems: 'center', marginBottom: 8},
  avatar: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 10},
  avatarText: {color: '#fff', fontWeight: '800', fontSize: 15},
  smsSender: {flex: 1, fontWeight: '800', fontSize: 14.5, color: C.ink},
  smsTime: {fontSize: 11.5, color: C.faint, marginLeft: 8},
  smsBody: {fontSize: 14, lineHeight: 20, color: '#2C313A'},

  verdictScan: {flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12},
  scanText: {fontSize: 12.5, color: C.sub, fontWeight: '600'},
  verdict: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, marginTop: 12},
  verdictText: {fontSize: 13, fontWeight: '800', flex: 1},
  verdictPct: {fontSize: 13, fontWeight: '800', marginLeft: 8},
  noLink: {fontSize: 12.5, color: C.faint, marginTop: 10, fontStyle: 'italic'},

  /* empty */
  empty: {alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24},
  emptyIcon: {fontSize: 44, marginBottom: 12},
  emptyTitle: {fontSize: 16, fontWeight: '800', color: C.ink, marginBottom: 6},
  emptyText: {fontSize: 13, color: C.faint, textAlign: 'center', lineHeight: 19},

  foot: {textAlign: 'center', fontSize: 11, color: C.faint, marginTop: 24, fontWeight: '600'},
});
