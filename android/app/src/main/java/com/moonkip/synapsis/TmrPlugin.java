package com.moonkip.synapsis;

import android.content.Intent;
import android.provider.Settings;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import android.Manifest;
import android.content.pm.PackageManager;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSObject;

/**
 * TmrPlugin: thin Capacitor bridge around {@link SleepService}.
 * The web app calls Plugins.Tmr.startSleep(plan) / stopSleep() at night.
 * All cue math runs in the foreground service (survives Xiaomi MIUI kills).
 */
@CapacitorPlugin(
        name = "Tmr",
        permissions = {
                @Permission(strings = {Manifest.permission.RECORD_AUDIO}, description = "mic gate detects room noise"),
                @Permission(strings = {Manifest.permission.WAKE_LOCK, Manifest.permission.FOREGROUND_SERVICE}, description = "keep playback alive overnight")
        })
public class TmrPlugin extends Plugin {

    @Override
    public void load() {
        // no-op
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void onRequestPermissionsResult(boolean allGranted) {
        JSObject res = new JSObject();
        res.put("granted", allGranted);
        saveCall(res);
    }

    @com.getcapacitor.annotation.InvokeAsMethod
    public void startSleep(@NonNull PluginCall call) {
        String plan = call.getString("plan");
        if (plan == null) { call.reject("missing plan"); return; }

        // runtime perms for mic + wake (required by API 31+)
        requestPermission(Manifest.permission.RECORD_AUDIO);
        requestPermission(Manifest.permission.WAKE_LOCK);

        Intent i = new Intent(getActivity(), SleepService.class);
        i.putExtra("plan", plan);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getActivity().startForegroundService(i);
        } else {
            getActivity().startService(i);
        }
        call.resolve();
    }

    @com.getcapacitor.annotation.InvokeAsMethod
    public void stopSleep(@NonNull PluginCall call) {
        Intent i = new Intent(getActivity(), SleepService.class);
        getActivity().stopService(i);
        call.resolve();
    }

    /**
     * Xiaomi / Android 6+ battery whitelisting. Returns a value the web app can
     * use to decide whether to nudge the user toward the system picker.
     */
    @com.getcapacitor.annotation.InvokeAsMethod
    public void requestBatteryExemption(@NonNull PluginCall call) {
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getActivity().getPackageName()));
        getActivity().startActivityForResult(i, call);
    }
}
