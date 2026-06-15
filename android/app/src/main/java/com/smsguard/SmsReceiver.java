package com.smsguard;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import androidx.core.app.NotificationCompat;

import com.facebook.react.ReactApplication;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Manifest-declared receiver: dibangunkan Android setiap ada SMS masuk,
 * BAHKAN saat aplikasi tertutup. Memeriksa link ke model lalu memunculkan
 * notifikasi peringatan secara native. Jika app sedang terbuka, juga mengirim
 * event ke JavaScript agar Kotak Masuk ter-update real-time.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String CHANNEL_ID = "sms_guard_alerts";
    private static final double THRESHOLD = 0.5119020229513724;
    private static final Pattern URL_RE =
            Pattern.compile("((https?://)?[\\w-]+(\\.[\\w-]+)+(:\\d+)?(/\\S*)?)", Pattern.CASE_INSENSITIVE);

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
            return;
        }
        SmsMessage[] msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (msgs == null || msgs.length == 0) {
            return;
        }
        String sender = msgs[0].getDisplayOriginatingAddress();
        StringBuilder sb = new StringBuilder();
        for (SmsMessage m : msgs) {
            if (m.getMessageBody() != null) {
                sb.append(m.getMessageBody());
            }
        }
        final String body = sb.toString();
        final String finalSender = sender == null ? "Tidak dikenal" : sender;
        final String url = firstUrl(body);
        final Context appCtx = context.getApplicationContext();
        final PendingResult pending = goAsync();

        new Thread(() -> {
            double prob = -1;
            boolean bad = false;
            try {
                if (url != null) {
                    prob = predict(appCtx, url);
                    bad = prob >= THRESHOLD;
                    if (bad) {
                        showAlert(appCtx, finalSender, url, (int) Math.round(prob * 100));
                    }
                }
                emitToJs(appCtx, finalSender, body, url, prob, bad);
            } catch (Exception ignored) {
            } finally {
                pending.finish();
            }
        }).start();
    }

    private String firstUrl(String text) {
        Matcher m = URL_RE.matcher(text);
        while (m.find()) {
            String u = m.group(1);
            if (u == null) {
                continue;
            }
            String host = u.replaceFirst("(?i)^https?://", "").split("/")[0].split("\\?")[0];
            int dot = host.lastIndexOf('.');
            if (dot < 0) {
                continue;
            }
            String tld = host.substring(dot + 1);
            boolean hasLetter = false;
            for (char c : tld.toCharArray()) {
                if (Character.isLetter(c)) {
                    hasLetter = true;
                    break;
                }
            }
            if (!hasLetter) {
                continue; // buang angka seperti "175.000.000"
            }
            return u.replaceAll("[.,)]+$", "");
        }
        return null;
    }

    private double predict(Context ctx, String url) throws Exception {
        SharedPreferences sp = ctx.getSharedPreferences("smsguard", Context.MODE_PRIVATE);
        String base = sp.getString("api", "http://10.0.2.2:8000");
        if (base == null || base.isEmpty()) {
            base = "http://10.0.2.2:8000";
        }
        base = base.replaceAll("/+$", "");
        HttpURLConnection conn = (HttpURLConnection) new URL(base + "/api/predict").openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(8000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        String payload = new JSONObject().put("urls", new JSONArray().put(url)).toString();
        try (OutputStream os = conn.getOutputStream()) {
            os.write(payload.getBytes("UTF-8"));
        }
        int code = conn.getResponseCode();
        InputStream is = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
        BufferedReader br = new BufferedReader(new InputStreamReader(is, "UTF-8"));
        StringBuilder rb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) {
            rb.append(line);
        }
        br.close();
        if (code < 200 || code >= 300) {
            throw new RuntimeException("HTTP " + code);
        }
        JSONObject res = new JSONObject(rb.toString()).getJSONArray("results").getJSONObject(0);
        return res.getDouble("probability");
    }

    private void emitToJs(Context appCtx, String sender, String body, String url, double prob, boolean bad) {
        try {
            ReactApplication app = (ReactApplication) appCtx;
            ReactContext rc = app.getReactHost().getCurrentReactContext();
            if (rc == null) {
                return; // app tertutup — cukup notifikasi native
            }
            WritableMap params = Arguments.createMap();
            params.putString("sender", sender);
            params.putString("body", body);
            if (url == null) {
                params.putNull("url");
            } else {
                params.putString("url", url);
            }
            params.putDouble("prob", prob);
            params.putBoolean("bad", bad);
            rc.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("onSmsReceived", params);
        } catch (Exception ignored) {
        }
    }

    private void showAlert(Context ctx, String sender, String url, int pct) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Peringatan Link", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Peringatan saat SMS berisi link berbahaya");
            nm.createNotificationChannel(ch);
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_warning)
                .setContentTitle("⚠️ Link berbahaya dari " + sender)
                .setContentText("Risiko " + pct + "% — jangan buka link ini.")
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText("Link berbahaya terdeteksi (" + pct + "%):\n" + url + "\nJangan dibuka."))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true);
        try {
            nm.notify((int) (System.currentTimeMillis() % 100000), b.build());
        } catch (Exception ignored) {
        }
    }
}
