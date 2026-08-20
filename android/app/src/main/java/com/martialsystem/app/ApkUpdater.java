package com.martialsystem.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdater extends Plugin {

    private static final String APK_DIR = "updates";
    private static final String APK_NAME = "martialsystem-update.apk";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL no proporcionada");
            return;
        }

        call.setKeepAlive(true);

        executor.execute(() -> {
            try {
                File apkFile = downloadApk(url, call);
                if (apkFile != null) {
                    installApk(apkFile, call);
                }
            } catch (Exception e) {
                call.reject("Error al descargar el APK: " + e.getMessage());
            }
        });
    }

    private File downloadApk(String urlString, PluginCall call) throws Exception {
        getActivity().runOnUiThread(() -> {
            JSObject progress = new JSObject();
            progress.put("event", "downloading");
            progress.put("progress", 0);
            notifyListeners("updateProgress", progress);
        });

        URL url = new URL(urlString);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(30000);
        connection.setReadTimeout(60000);
        connection.connect();

        int responseCode = connection.getResponseCode();
        if (responseCode != HttpURLConnection.HTTP_OK) {
            throw new Exception("HTTP error: " + responseCode);
        }

        long totalBytes = connection.getContentLengthLong();
        File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        File apkFile = new File(dir, APK_NAME);

        try (InputStream input = connection.getInputStream();
             FileOutputStream output = new FileOutputStream(apkFile)) {

            byte[] buffer = new byte[8192];
            int bytesRead;
            long totalRead = 0;
            while ((bytesRead = input.read(buffer)) != -1) {
                output.write(buffer, 0, bytesRead);
                totalRead += bytesRead;

                if (totalBytes > 0) {
                    int percent = (int) ((totalRead * 100) / totalBytes);
                    final int finalPercent = percent;
                    getActivity().runOnUiThread(() -> {
                        JSObject progress = new JSObject();
                        progress.put("event", "downloading");
                        progress.put("progress", finalPercent);
                        notifyListeners("updateProgress", progress);
                    });
                }
            }
        }

        getActivity().runOnUiThread(() -> {
            JSObject progress = new JSObject();
            progress.put("event", "downloaded");
            progress.put("progress", 100);
            notifyListeners("updateProgress", progress);
        });

        connection.disconnect();
        return apkFile;
    }

    private void installApk(File apkFile, PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Context context = getContext();

                // Check if "Install unknown apps" permission is needed (Android 8+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    boolean canInstall = context.getPackageManager().canRequestPackageInstalls();
                    if (!canInstall) {
                        // Ask user to grant permission
                        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                        intent.setData(Uri.parse("package:" + context.getPackageName()));
                        startActivityForResult(call, intent, "handleInstallPermissionResult");
                        return;
                    }
                }

                // Launch installer
                Uri apkUri;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    apkUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apkFile);
                } else {
                    apkUri = Uri.fromFile(apkFile);
                }

                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                context.startActivity(intent);

                call.resolve(new JSObject().put("success", true));
            } catch (Exception e) {
                call.reject("Error al instalar el APK: " + e.getMessage());
            }
        });
    }

    @ActivityCallback
    private void handleInstallPermissionResult(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            boolean canInstall = getContext().getPackageManager().canRequestPackageInstalls();
            if (canInstall) {
                // Permission granted, try to install
                File apkFile = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_DIR + "/" + APK_NAME);
                if (apkFile.exists()) {
                    installApk(apkFile, call);
                } else {
                    call.reject("APK no encontrado");
                }
            } else {
                call.reject("Permiso para instalar apps desconocidas no concedido");
            }
        }
    }
}