package de.orbitsprung.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebViewClient;

/** Zeigt das Spiel bildschirmfüllend in einer WebView an. */
public class MainActivity extends Activity {

    private WebView web;
    private AppUpdater updater;
    private static final int KAMERA_ANFRAGE = 7;
    /** Wartende Kamera-Anfrage der Webseite, bis der Nutzer die Android-Erlaubnis beantwortet hat. */
    private PermissionRequest kameraWartet;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#071219"));
        w.setNavigationBarColor(Color.parseColor("#10303b"));
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#071219"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // Spielstand, Rekorde und Skins (localStorage)
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);                    // Systemschriftgröße soll das Layout nicht verschieben

        web.setWebViewClient(new WebViewClient() {
            // Links ins Netz (z. B. „Zum Download“ im Update-Hinweis) im Browser öffnen, nicht im Spiel
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String sc = u.getScheme();
                if ("http".equals(sc) || "https".equals(sc)) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* kein Browser */ }
                    return true;
                }
                return false;
            }
        });
        // Selbst-Update: das Spiel ruft window.OrbitUpdate auf, wenn GitHub eine neuere Version meldet
        updater = new AppUpdater(this, web);
        web.addJavascriptInterface(updater, "OrbitUpdate");
        // Kamera für „QR-Code scannen“ (Freunde): nur Video, und nur wenn Android die Erlaubnis gibt
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest req) {
                runOnUiThread(() -> {
                    boolean video = false;
                    for (String r : req.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) video = true;
                    if (!video) { req.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        req.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        if (kameraWartet != null) kameraWartet.deny();
                        kameraWartet = req;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, KAMERA_ANFRAGE);
                    }
                });
            }
            @Override
            public void onPermissionRequestCanceled(PermissionRequest req) {
                if (req == kameraWartet) kameraWartet = null;
            }
        });
        setContentView(web);
        hideSystemBars();

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl("file:///android_asset/index.html");
    }

    /** Vollbild: Status- und Navigationsleiste ausblenden, mit Wischen kurz wieder einblendbar. */
    private void hideSystemBars() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                  | View.SYSTEM_UI_FLAG_FULLSCREEN
                  | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                  | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code != KAMERA_ANFRAGE || kameraWartet == null) return;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED)
            kameraWartet.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else kameraWartet.deny();
        kameraWartet = null;
    }

    @Override protected void onPause()  { super.onPause();  if (web != null) web.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); if (updater != null) updater.beiRueckkehr(); }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (updater != null) { updater.beenden(); updater = null; }
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
