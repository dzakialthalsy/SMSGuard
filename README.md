# SMS Guard 🛡️

Aplikasi Android yang **otomatis memeriksa setiap link di SMS masuk secara real-time**
dan memperingatkan pengguna sebelum membuka tautan penipuan (_smishing_) —
"selamat Anda menang hadiah", "akun diblokir", "paket tertahan", dsb.

Mesin deteksinya adalah model machine learning **LightGBM** yang mengklasifikasikan
URL **malicious vs aman** berdasarkan fitur leksikal.

> Dibuat untuk showcase Lab SI × Telkomsel. Positioning: sebagai operator, model ini
> bisa berjalan di level jaringan untuk melindungi seluruh pelanggan.

## ✨ Fitur

- **Deteksi real-time otomatis** — `BroadcastReceiver` native menangkap SMS masuk
  bahkan saat aplikasi tertutup, lalu memunculkan notifikasi peringatan.
- **Cek link manual** — tempel URL apa pun untuk diperiksa model.
- **Tiga tingkat risiko** — Aman (hijau) · Waspada (kuning) · Berbahaya (merah).

## 🏗️ Arsitektur

| Lapisan | Teknologi |
|---------|-----------|
| UI & logika | React Native (JavaScript/TypeScript) — `App.tsx` |
| Penangkap SMS | Modul native **Java** — `SmsReceiver.java`, `SmsModule.java` |
| Mesin deteksi | API FastAPI + model LightGBM (repo terpisah) |

Aplikasi memanggil endpoint `POST /api/predict` pada server model. Alamat server
dapat diatur di dalam aplikasi (menu Pengaturan).

## 🚀 Menjalankan

Prasyarat: Node.js ≥ 20, JDK 17+, Android SDK.

```bash
npm install

# 1) Jalankan server model (lihat repo backend), contoh:
#    uvicorn backend.main:app --host 0.0.0.0 --port 8000

# 2) Jalankan app (debug, butuh Metro):
npm run android

# 3) Build APK rilis (standalone):
cd android && ./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

Di dalam aplikasi, set **Alamat server model**:
- Emulator → `http://10.0.2.2:8000`
- HP asli → IP laptop di WiFi yang sama, mis. `http://192.168.x.x:8000`
  (jalankan server dengan `--host 0.0.0.0`).

## ⚠️ Catatan build di Windows

Build native C++ React Native bisa melebihi batas **260 karakter path Windows**.
Jika muncul error _"Filename longer than 260 characters"_, build dari folder berpath
pendek (mis. `C:\sg`) atau aktifkan _long paths_ Windows.

## 🔒 Catatan platform

- Izin SMS Android dibatasi Google Play untuk rilis publik — aman untuk pemakaian
  pribadi / sideload.
- Sebagian HP (Xiaomi/Oppo/Vivo) punya manajemen baterai agresif; aktifkan
  **Autostart** / matikan optimasi baterai agar deteksi background tetap jalan.
- Model menilai URL secara leksikal saja (tidak membuka isi halaman).
