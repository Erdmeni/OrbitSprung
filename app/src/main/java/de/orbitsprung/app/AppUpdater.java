package de.orbitsprung.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;

/**
 * Selbst-Update: lädt das APK des neuesten GitHub-Releases und übergibt es dem Android-Paketinstaller.
 *
 * Ablauf (vom Spiel über window.OrbitUpdate angestoßen):
 *  1. Erlaubnis prüfen: Android verlangt einmalig „Unbekannte Apps installieren“ für Orbitsprung
 *     (REQUEST_INSTALL_PACKAGES im Manifest, Schalter in den Einstellungen). Fehlt sie, öffnet das Spiel
 *     auf Wunsch die Einstellungsseite; kommt der Nutzer mit Erlaubnis zurück, geht es automatisch weiter.
 *  2. APK nur von https://github.com/Erdmeni/OrbitSprung/releases/download/… laden (Fortschritt ans Spiel).
 *  3. Prüfen: gleiche Paket-ID, höhere versionCode, erwarteter Versionsname, gleiche Signatur.
 *  4. Installieren über PackageInstaller. Android zeigt die Bestätigung („Aktualisieren“); ab Android 12
 *     kann sie entfallen, wenn Orbitsprung die App zuletzt selbst installiert hat. Android beendet die App
 *     beim Ersetzen, danach wird sie neu geöffnet.
 *
 * Zustände an das Spiel: window.updNative(zustand, prozent, text) mit
 *  erlaubnis | laden | pruefen | installieren | bestaetigen | fertig | abgebrochen | fehler
 */
public class AppUpdater {

    static final String QUELLE = "https://github.com/Erdmeni/OrbitSprung/releases/download/";
    static final String AKTION_STATUS = "de.orbitsprung.app.UPDATE_STATUS";
    private static final long MAX_GROESSE = 60L * 1024 * 1024;

    /** Die laufende Instanz, damit der Status-Empfänger sie erreicht. */
    static AppUpdater aktiv;

    private final Activity act;
    private final WebView web;
    private volatile boolean laeuft;
    private volatile boolean abbruch;
    private String wartetUrl, wartetVersion;   // gemerkt, solange die Erlaubnis fehlt
    private boolean erlaubnisGeoeffnet;
    private int sitzung = -1;

    AppUpdater(Activity act, WebView web) {
        this.act = act;
        this.web = web;
        aktiv = this;
    }

    // ---------- Schnittstelle fürs Spiel ----------

    /** Kann diese App sich selbst aktualisieren? (immer ja ab Android 8, minSdk ist 26) */
    @JavascriptInterface
    public boolean verfuegbar() { return true; }

    /** Hat Android die Erlaubnis „Unbekannte Apps installieren“ schon erteilt? */
    @JavascriptInterface
    public boolean erlaubt() { return act.getPackageManager().canRequestPackageInstalls(); }

    /** Versionsname der installierten App (z. B. 1.6). */
    @JavascriptInterface
    public String version() {
        try { return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName; }
        catch (Exception e) { return ""; }
    }

    /** Update laden und installieren. url = APK-Datei des Releases, version = erwarteter Versionsname. */
    @JavascriptInterface
    public void starten(String url, String version) {
        if (!erlaubteQuelle(url)) { melde("fehler", 0, "Die Download-Adresse gehört nicht zu Orbitsprung."); return; }
        if (laeuft) return;
        if (!erlaubt()) {
            wartetUrl = url; wartetVersion = version;
            melde("erlaubnis", 0, "");
            return;
        }
        laeuft = true; abbruch = false;
        new Thread(() -> ablauf(url, version), "orbitsprung-update").start();
    }

    /** Öffnet die Android-Einstellung „Unbekannte Apps installieren“ für Orbitsprung. */
    @JavascriptInterface
    public void erlaubnisOeffnen() {
        erlaubnisGeoeffnet = true;
        act.runOnUiThread(() -> {
            try {
                act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + act.getPackageName())));
            } catch (Exception e) {
                erlaubnisGeoeffnet = false;
                melde("fehler", 0, "Die Einstellung lässt sich auf diesem Handy nicht öffnen.");
            }
        });
    }

    /** Laufenden Download abbrechen (die Installation selbst bricht der Nutzer im Android-Fenster ab). */
    @JavascriptInterface
    public void abbrechen() {
        abbruch = true;
        wartetUrl = null;
    }

    // ---------- Aufrufe aus der Activity ----------

    /** Nach der Rückkehr aus den Einstellungen: mit Erlaubnis automatisch weitermachen. */
    void beiRueckkehr() {
        if (!erlaubnisGeoeffnet) return;
        erlaubnisGeoeffnet = false;
        if (wartetUrl == null) return;
        String u = wartetUrl, v = wartetVersion;
        if (erlaubt()) { wartetUrl = null; starten(u, v); }
        else melde("erlaubnis", 0, "fehlt");
    }

    void beenden() { if (aktiv == this) aktiv = null; abbruch = true; }

    // ---------- Ablauf ----------

    static boolean erlaubteQuelle(String url) {
        return url != null && url.startsWith(QUELLE) && url.endsWith(".apk")
                && !url.contains("..") && !url.contains("@") && url.length() < 300;
    }

    private void ablauf(String url, String version) {
        File dir = new File(act.getCacheDir(), "update");
        File apk = new File(dir, "Orbitsprung.apk");
        try {
            dir.mkdirs();
            laden(url, apk);
            if (abbruch) { apk.delete(); laeuft = false; melde("abgebrochen", 0, ""); return; }
            melde("pruefen", 100, "");
            String fehler = pruefen(apk, version);
            if (fehler != null) { apk.delete(); laeuft = false; melde("fehler", 0, fehler); return; }
            melde("installieren", 100, "");
            installieren(apk);
            // weiter geht es im Status-Empfänger
        } catch (Exception e) {
            apk.delete();
            laeuft = false;
            melde(abbruch ? "abgebrochen" : "fehler", 0, abbruch ? "" : netzText(e));
        }
    }

    /** Fortschritt beim Laden (prozent -1 = Größe unbekannt). */
    interface Fortschritt { void prozent(int p); }
    interface Abbruch { boolean gewuenscht(); }

    private void laden(String url, File ziel) throws Exception {
        laden(url, ziel, p -> melde("laden", p, ""), () -> abbruch);
    }

    /** Lädt url nach ziel. Folgt bis zu 5 Weiterleitungen, aber nur über https. Statisch, damit es ohne Android testbar ist. */
    static void laden(String url, File ziel, Fortschritt f, Abbruch ab) throws Exception {
        HttpURLConnection c = null;
        try {
            URL u = new URL(url);
            // GitHub leitet auf seinen Download-Server weiter. Weiterleitungen selbst folgen, nur über https
            for (int i = 0; ; i++) {
                if (i >= 5) throw new Exception("zu viele Weiterleitungen");
                c = (HttpURLConnection) u.openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(15000);
                c.setReadTimeout(20000);
                c.setRequestProperty("Accept", "application/octet-stream");
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String loc = c.getHeaderField("Location");
                    c.disconnect(); c = null;
                    if (loc == null) throw new Exception("HTTP " + code);
                    u = new URL(u, loc);
                    if (!"https".equals(u.getProtocol())) throw new Exception("Weiterleitung ohne https");
                    continue;
                }
                if (code != 200) throw new Exception("HTTP " + code);
                break;
            }
            long gesamt = c.getContentLengthLong();
            if (gesamt > MAX_GROESSE) throw new Exception("Datei zu groß");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(ziel)) {
                byte[] buf = new byte[32768];
                long hat = 0; int zuletzt = -2, n;
                f.prozent(gesamt > 0 ? 0 : -1);
                while ((n = in.read(buf)) > 0) {
                    if (ab.gewuenscht()) return;
                    out.write(buf, 0, n);
                    hat += n;
                    if (hat > MAX_GROESSE) throw new Exception("Datei zu groß");
                    int p = gesamt > 0 ? (int) (hat * 100 / gesamt) : -1;
                    if (p != zuletzt) { zuletzt = p; f.prozent(p); }
                }
                if (gesamt > 0 && hat != gesamt) throw new Exception("Download unvollständig");
            }
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** null = in Ordnung, sonst Fehlertext. */
    private String pruefen(File apk, String version) {
        PackageManager pm = act.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo neu = pm.getPackageArchiveInfo(apk.getPath(), flags);
        if (neu == null) return "Die geladene Datei ist kein gültiges Update.";
        if (!act.getPackageName().equals(neu.packageName)) return "Die geladene Datei ist nicht Orbitsprung.";
        PackageInfo alt;
        try { alt = pm.getPackageInfo(act.getPackageName(), flags); }
        catch (Exception e) { return null; }
        if (versionCode(neu) <= versionCode(alt))
            return "Diese Version ist schon installiert oder älter.";
        if (version != null && !version.isEmpty() && neu.versionName != null && !version.equals(neu.versionName))
            return "Die geladene Datei hat Version " + neu.versionName + " statt " + version + ".";
        Signature[] sa = signaturen(alt), sn = signaturen(neu);
        if (sa != null && sn != null && !Arrays.equals(sa, sn))
            return "Das Update ist anders signiert als die installierte App und kann sie nicht ersetzen.";
        return null;
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo p) {
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static Signature[] signaturen(PackageInfo p) {
        if (Build.VERSION.SDK_INT >= 28) {
            if (p.signingInfo == null) return null;
            return p.signingInfo.hasMultipleSigners() ? p.signingInfo.getApkContentsSigners()
                                                      : p.signingInfo.getSigningCertificateHistory();
        }
        return p.signatures;
    }

    private void installieren(File apk) throws Exception {
        PackageInstaller pi = act.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        sp.setAppPackageName(act.getPackageName());
        sp.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 31) sp.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = pi.createSession(sp);
        sitzung = id;
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("Orbitsprung.apk", 0, apk.length())) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                s.fsync(out);
            }
            Intent i = new Intent(act, Status.class).setAction(AKTION_STATUS);
            int pf = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent p = PendingIntent.getBroadcast(act, id, i, pf);
            s.commit(p.getIntentSender());
        } catch (Exception e) {
            try { pi.abandonSession(id); } catch (Exception ignored) { }
            throw e;
        } finally {
            apk.delete();
        }
    }

    /** Rückmeldung des Paketinstallers (nicht exportiert: nur das System erreicht ihn über unser PendingIntent). */
    public static class Status extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            AppUpdater u = aktiv;
            if (u == null || !AKTION_STATUS.equals(intent.getAction())) return;
            u.status(intent);
        }
    }

    @SuppressWarnings("deprecation")
    void status(Intent intent) {
        int id = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -2);
        if (id != sitzung) return;
        int st = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        switch (st) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                Intent bestaetigen = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (bestaetigen == null) { laeuft = false; melde("fehler", 0, "Android hat die Installation nicht angezeigt."); return; }
                melde("bestaetigen", 100, "");
                act.runOnUiThread(() -> {
                    try { act.startActivity(bestaetigen.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
                    catch (Exception e) { laeuft = false; melde("fehler", 0, "Android hat die Installation nicht angezeigt."); }
                });
                return;
            }
            case PackageInstaller.STATUS_SUCCESS:
                laeuft = false; melde("fertig", 100, ""); return;
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                laeuft = false; melde("abgebrochen", 0, ""); return;
            default:
                laeuft = false; melde("fehler", 0, installText(st, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)));
        }
    }

    static String installText(int st, String sys) {
        switch (st) {
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                return "Das Update passt nicht zur installierten App (andere Signatur oder Version).";
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                return "Nicht genug Speicherplatz für das Update.";
            case PackageInstaller.STATUS_FAILURE_INVALID:
                return "Die Update-Datei ist beschädigt.";
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                return "Android hat die Installation blockiert.";
            default:
                return "Installation fehlgeschlagen" + (sys != null && !sys.isEmpty() ? " (" + sys + ")" : "") + ".";
        }
    }

    static String netzText(Exception e) {
        String m = e.getMessage() == null ? "" : e.getMessage();
        if (e instanceof java.net.UnknownHostException || e instanceof java.net.SocketTimeoutException
                || e instanceof java.net.ConnectException)
            return "Keine Verbindung zu GitHub. Prüfe das Internet und versuche es noch einmal.";
        if (m.startsWith("HTTP ")) return "GitHub antwortet nicht wie erwartet (" + m + ").";
        if (m.startsWith("Datei zu groß")) return "Die Update-Datei ist unerwartet groß.";
        return "Download fehlgeschlagen" + (m.isEmpty() ? "" : " (" + m + ")") + ".";
    }

    // ---------- Rückmeldung ans Spiel ----------

    private void melde(String zustand, int prozent, String text) {
        String js = "window.updNative&&window.updNative(" + JSONObject.quote(zustand) + "," + prozent + ","
                + JSONObject.quote(text == null ? "" : text) + ")";
        web.post(() -> { try { web.evaluateJavascript(js, null); } catch (Exception ignored) { } });
    }
}
