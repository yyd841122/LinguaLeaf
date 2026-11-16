package dev.lingualeaf.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  // Custom app plugins register here (Capacitor 8): the JS proxy's
  // registerPlugin("SaveToDownloads") resolves through this list — an
  // unregistered name never fails a build or a unit test, it only fails
  // on-device at tap time (2026-11-16 终审 P1: 保存到本机自 scaffold 起
  // 未注册)。The vitest registration gate is the build-time catcher.
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(SaveToDownloadsPlugin.class);
    super.onCreate(savedInstanceState);
  }

  // Dark follow (ticket 06): the page carries its own dark palette
  // (color-scheme: light dark + prefers-color-scheme tokens in
  // reader.css). Algorithmic darkening lets the WebView evaluate that
  // media query against the system night mode — the 机检 finding: without
  // it the query reads light forever, dark-follow only painted the
  // status bar. The uiMode config change is already in the manifest's
  // configChanges, so toggling dark re-renders without a bridge rebuild.
  @Override
  protected void load() {
    super.load();
    WebSettings settings = bridge.getWebView().getSettings();
    applyDarkFollow(settings);
  }

  // The dark-follow flags straddle removals: force-dark was deleted from
  // the compile SDK at API 33 (runtime-only below it), algorithmic
  // darkening arrived at 33 (and androidx.webkit's copy is a dependency
  // this app does not carry) — reached reflectively so one tree builds
  // everywhere. Each call stands alone: 机检 round 4 found an OEM
  // WebView (ColorOS, API 30) whose settings class lacks the STRATEGY
  // field, and a single thrown lookup used to disable the whole chain —
  // force-dark AUTO must still land. Constants fall back to their API
  // values when the field is missing.
  private static void applyDarkFollow(WebSettings settings) {
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      invoke(settings, "setAlgorithmicDarkeningAllowed", Boolean.TRUE);
      return;
    }
    // AUTO follows the system night mode (ON would force dark in
    // daylight); WEB_THEME_DARKENING_ONLY keeps the renderer's hands
    // off the page, which paints its own dark palette.
    invoke(settings, "setForceDark", constant(settings, "FORCE_DARK_AUTO", 1));
    invoke(
      settings,
      "setForceDarkStrategy",
      constant(settings, "FORCE_DARK_STRATEGY_WEB_THEME_DARKENING_ONLY", 1)
    );
  }

  private static void invoke(WebSettings settings, String name, Object value) {
    try {
      for (java.lang.reflect.Method method : settings.getClass().getMethods()) {
        if (method.getName().equals(name) && method.getParameterCount() == 1) {
          method.invoke(settings, value);
          return;
        }
      }
      android.util.Log.w("LinguaLeaf", "dark follow method missing: " + name);
    } catch (ReflectiveOperationException | IllegalArgumentException failed) {
      android.util.Log.w("LinguaLeaf", "dark follow call failed: " + name, failed);
    }
  }

  private static int constant(WebSettings settings, String field, int fallback) {
    try {
      return settings.getClass().getField(field).getInt(null);
    } catch (ReflectiveOperationException missing) {
      return fallback;
    }
  }
}
