package dev.lingualeaf.app;

import android.os.Bundle;
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
}
