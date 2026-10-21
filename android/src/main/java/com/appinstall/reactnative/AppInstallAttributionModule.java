package com.appinstall.reactnative;

import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.AtomicFile;
import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.facebook.react.bridge.*;
import com.facebook.react.module.annotations.ReactModule;
import com.appinstall.internal.walle.PayloadReader;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@ReactModule(name = AppInstallAttributionModule.NAME)
public final class AppInstallAttributionModule extends ReactContextBaseJavaModule {
    public static final String NAME = "AppInstallAttribution";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private InstallReferrerClient client;
    private Promise pending;
    private Runnable timeout;
    private volatile boolean closed;
    public AppInstallAttributionModule(ReactApplicationContext context) { super(context); }
    @Override public String getName() { return NAME; }
    private interface Work { Object run() throws Exception; }
    private void work(Promise promise, Work work) {
        if (closed) { promise.reject("UNAVAILABLE", "Module stopped"); return; }
        try { io.execute(() -> { try { promise.resolve(work.run()); } catch (Exception e) { promise.reject("INSTALL_IO", "Installation operation failed"); } }); }
        catch (Exception e) { promise.reject("UNAVAILABLE", "Module stopped"); }
    }
    private AtomicFile stateFile(String scope) throws Exception {
        if (scope == null || scope.length() > 4096) throw new IOException("Invalid scope");
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(scope.getBytes(StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder("appinstall-rn-");
        for (byte b : digest) name.append(String.format("%02x", b & 255));
        return new AtomicFile(new File(getReactApplicationContext().getNoBackupFilesDir(), name + ".json"));
    }
    @ReactMethod public void readState(String scope, Promise promise) { work(promise, () -> {
        try { return new String(stateFile(scope).readFully(), StandardCharsets.UTF_8); }
        catch (FileNotFoundException missing) { return null; }
    }); }
    @ReactMethod public void writeState(String scope, String state, Promise promise) { work(promise, () -> {
        if (state.length() > 262144) throw new IOException("State too large");
        AtomicFile file = stateFile(scope); FileOutputStream stream = null;
        try { stream = file.startWrite(); stream.write(state.getBytes(StandardCharsets.UTF_8)); file.finishWrite(stream); }
        catch (Exception e) { if (stream != null) file.failWrite(stream); throw e; }
        return null;
    }); }
    @ReactMethod public void clearState(String scope, Promise promise) { work(promise, () -> { stateFile(scope).delete(); return null; }); }
    @ReactMethod public void newInstanceId(Promise promise) { promise.resolve(UUID.randomUUID().toString()); }
    @ReactMethod public void getTimezone(Promise promise) { promise.resolve(java.util.TimeZone.getDefault().getID()); }
    @ReactMethod public void readClipboard(Promise promise) { main.post(() -> {
        try {
            if (closed || getCurrentActivity() == null || !getCurrentActivity().hasWindowFocus()) { promise.reject("BACKGROUND", "Clipboard requires foreground"); return; }
            ClipboardManager clipboard = (ClipboardManager) getReactApplicationContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData data = clipboard.getPrimaryClip();
            CharSequence text = data == null || data.getItemCount() == 0 ? null : data.getItemAt(0).getText();
            promise.resolve(text != null && text.length() <= 8192 ? text.toString() : null);
        } catch (Exception e) { promise.reject("CLIPBOARD", "Clipboard unavailable"); }
    }); }
    @ReactMethod public void readPackageSource(Promise promise) { work(promise, () -> {
        String raw = PayloadReader.getString(new File(getReactApplicationContext().getApplicationInfo().sourceDir), 0x71777777);
        if (raw == null || raw.length() > 8192) return null;
        return new JSONObject(raw).optString("channel", null);
    }); }
    @ReactMethod public void readReferrer(Promise promise) { main.post(() -> {
        if (closed) { promise.resolve(source("unavailable", null)); return; }
        if (pending != null) { promise.resolve(source("pending", null)); return; }
        try {
            Context context = getReactApplicationContext();
            String installer = context.getPackageManager().getInstallerPackageName(context.getPackageName());
            if (installer != null && !"com.android.vending".equals(installer)) { promise.resolve(source("unavailable", null)); return; }
            pending = promise; timeout = () -> finish("pending", null); main.postDelayed(timeout, 5000);
            client = InstallReferrerClient.newBuilder(context).build();
            final InstallReferrerClient current = client;
            current.startConnection(new InstallReferrerStateListener() {
                @Override public void onInstallReferrerSetupFinished(int code) { main.post(() -> {
                    if (client != current) return;
                    if (code == InstallReferrerClient.InstallReferrerResponse.OK) {
                        try { finish("complete", current.getInstallReferrer().getInstallReferrer()); }
                        catch (Exception e) { finish("pending", null); }
                    } else { finish(code == InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED ? "unavailable" : "pending", null); }
                }); }
                @Override public void onInstallReferrerServiceDisconnected() { main.post(() -> { if (client == current) finish("pending", null); }); }
            });
        } catch (Exception e) { if (pending == null) promise.resolve(source("unavailable", null)); else finish("pending", null); }
    }); }
    private WritableMap source(String status, String referrer) {
        WritableMap value = Arguments.createMap(); value.putString("status", status);
        if (referrer != null && referrer.length() <= 8192) value.putString("referrer", referrer);
        return value;
    }
    private void finish(String status, String referrer) {
        Promise result = pending; pending = null;
        if (timeout != null) main.removeCallbacks(timeout); timeout = null;
        InstallReferrerClient current = client; client = null;
        if (current != null) { try { current.endConnection(); } catch (Exception ignored) {} }
        if (result != null) result.resolve(source(status, referrer));
    }
    @Override public void invalidate() { closed = true; main.post(() -> finish("unavailable", null)); io.shutdown(); super.invalidate(); }
}
