package dev.lingualeaf.app;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

// The backup's 保存到本机 (mobile-app ticket 05): insert the JSON straight
// into the shared Downloads collection via MediaStore — no storage
// permission on Android 10+ (scoped storage), visible in the 文件管理
// Downloads folder where the import picker starts. The share-sheet path
// (Share plugin) stays for sending the file elsewhere.
@CapacitorPlugin(name = "SaveToDownloads")
public class SaveToDownloadsPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        String name = call.getString("name");
        if (data == null || name == null || name.isEmpty()) {
            call.reject("缺少保存内容或文件名。");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("本机保存仅支持 Android 10 及以上，请改用分享。");
            return;
        }
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            }
            Uri uri = getContext().getContentResolver().insert(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("系统没有接受保存请求，请重试。");
                return;
            }
            try (OutputStream out = getContext().getContentResolver()
                    .openOutputStream(uri)) {
                if (out == null) {
                    call.reject("保存通道无法打开，请重试。");
                    return;
                }
                out.write(data.getBytes(StandardCharsets.UTF_8));
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContext().getContentResolver().update(uri, values, null, null);
            }
            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (SecurityException e) {
            call.reject("系统拒绝了保存请求，请改用分享。");
        } catch (Exception e) {
            call.reject("保存失败：" + e.getMessage() + "。请重试或改用分享。");
        }
    }
}
