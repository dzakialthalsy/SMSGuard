package com.smsguard;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * Native module (Java) untuk SMS Guard.
 *  - saveConfig(apiUrl): menyimpan alamat server model ke SharedPreferences,
 *    supaya {@link SmsReceiver} (berjalan di background) bisa membacanya.
 *  - showAlert(): notifikasi peringatan (dipakai jalur simulasi di dalam app).
 *
 * Penangkapan SMS asli ditangani oleh {@link SmsReceiver} (manifest receiver),
 * sehingga tetap bekerja walau aplikasi tertutup.
 */
public class SmsModule extends ReactContextBaseJavaModule {

    public static final String NAME = "SmsModule";
    private static final String CHANNEL_ID = "sms_guard_alerts";

    private final ReactApplicationContext reactContext;

    public SmsModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void saveConfig(String apiUrl) {
        SharedPreferences sp = reactContext.getSharedPreferences("smsguard", Context.MODE_PRIVATE);
        sp.edit().putString("api", apiUrl).apply();
        ensureChannel();
    }

    @ReactMethod
    public void showAlert(String sender, String url, int pct) {
        ensureChannel();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(reactContext, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_warning)
                .setContentTitle("⚠️ Link berbahaya dari " + sender)
                .setContentText("Risiko " + pct + "% — jangan buka link ini.")
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText("Link berbahaya terdeteksi (" + pct + "%):\n" + url + "\nJangan dibuka."))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true);
        NotificationManager nm =
                (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
        try {
            nm.notify((int) (System.currentTimeMillis() % 100000), builder.build());
        } catch (Exception ignored) {
        }
    }

    // Diperlukan agar NativeEventEmitter tidak memunculkan warning.
    @ReactMethod
    public void addListener(String eventName) {
    }

    @ReactMethod
    public void removeListeners(double count) {
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm =
                    (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Peringatan Link", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Peringatan saat SMS berisi link berbahaya");
            nm.createNotificationChannel(ch);
        }
    }
}
