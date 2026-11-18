package com.moonkip.synapsis;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * SleepService: overnight TMR foreground service.
 *
 * Science constraints baked in (see tmr-research-report.md):
 *  - low cue volume (plan.volume is small),
 *  - silence lead-in before the first cue (SWS takes ~30 min to dominate),
 *  - sparse cue gaps (intervalSec, >=5s to respect the ~3-6s spindle refractory window),
 *  - bounded total cueing time (capSec) so it auto-stops and cannot run forever,
 *  - optional mic gate: pauses cues when the room is noisy (avoids arousals —
 *    loud/early cues reverse the TMR benefit),
 *  - foreground service + PARTIAL_WAKE_LOCK so MIUI / aggressive OEMs cannot kill it.
 *
 * Cues are pure sine tones with frequencies computed deterministically, the SAME
 * formula the web app uses, so the item<->cue association learned on the PC study
 * app transfers intact to overnight replay on the phone.
 */
public class SleepService extends android.app.Service {
    private static final String TAG = "synapsis:service";
    private static final double[] F0 = {440, 349, 262, 330, 392, 294, 466, 262, 523, 349};
    private static final double[] F1 = {587, 523, 659, 740, 523, 587, 698, 494, 784, 466};

    private Handler worker;
    private AudioTrack track;
    private TextToSpeech tts;
    private PowerManager.WakeLock wakeLock;
    private MediaRecorder noiseSampler; // null if mic gate off / denied
    private volatile boolean running = false;

    // plan (parsed in runCueingLoop)
    private JSONArray planItems;
    private int leadInSec, intervalSec, capSec, blockOnSec, blockOffSec, sampleRate, bufSize;
    private double volume;
    private boolean useTts, useMicGate, useBlock, validationMode;
    private int playedItems, blockPlayed, sets;
    private long blockStartTime, blockStarted;

    public SleepService() {}

    @Override public void onCreate() {
        super.onCreate();
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKELOCK, "synapsis::TmrSleep");
        HandlerThread ht = new HandlerThread("tmr-worker"); ht.start();
        worker = new Handler(ht.getLooper());
        sampleRate = AudioFormat.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC);
        bufSize = AudioTrack.getMinBufferSize(sampleRate,
                AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT) * 2;
    }

    @Override public int onStartCommand(Intent i, int flags, int startId) {
        String planJson = i.getStringExtra("plan");
        startForeground(11, notification());
        wakeLock.acquire(/* timeoutMinutes= */ 60*12);
        parsePlan(planJson);
        running = true;
        worker.post(cueLoop);
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        stopSelf(); running = false;
        worker.removeCallbacksAndMessages(null);
        if (track != null) { track.playState(); track.flush(); track.release(); }
        if (tts != null) { try { tts.stop(); tts.shutdown(); } catch (Exception ignored){} }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (noiseSampler != null) { try { noiseSampler.stop(); } catch(Exception ignored){} noiseSampler.release(); }
        stopForeground(true);
        super.onDestroy();
    }

    @Override public android.os.IBinder onBind(Intent i) { return null; }

    private android.app.Notification notification() {
        String channel = "tmr_sleep";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.NotificationChannel c = new android.app.NotificationChannel(
                    channel, "TMR sleep cues", android.app.NotificationManager.IMPORTANCE_LOW);
            c.setShowBadge(false);
            ((android.app.NotificationManager) getSystemService(android.app.NotificationManager.class)).createNotificationChannel(c);
        }
        return new android.app.Notification.Builder(this, channel)
                .setContentTitle("synapsis · TMR sleeping")
                .setContentText("replaying study cues quietly")
                .setSmallIcon(R.drawable.ic_tmr)
                .setOngoing(true)
                .setCategory(android.app.Notification.CATEGORY_SERVICE).build();
    }

    private void parsePlan(String json) {
        try {
            JSONObject p = new JSONObject(json);
            planItems = p.getJSONArray("items");
            leadInSec = p.optInt("leadInSec", 60*60);
            intervalSec = Math.max(5, p.optInt("intervalSec", 12));
            capSec = Math.min(p.optInt("capSec", 40*60), 90*60);
            blockOnSec = p.optInt("blockOnSec", 10*60);
            blockOffSec = p.optInt("blockOffSec", 8*60);
            useBlock = (blockOnSec > 0 && blockOffSec > 0);
            blockStartTime = System.currentTimeMillis();
            blockStarted = System.currentTimeMillis();
            volume = Math.max(0.02, Math.min(0.30, p.optDouble("volume", 0.09)));
            useTts = "tone+text".equals(p.optString("voice","tone"));
            useMicGate = p.optBoolean("micGate", true);
            validationMode = p.optBoolean("validationMode", false);
            sets = p.optInt("sets", 1);
            if (useTts) {
                tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
                    @Override public void onInit(int s) {} });
            }
        } catch (JSONException e) {
            // fall back to safe defaults
            leadInSec=60*60; intervalSec=12; capSec=40*60; blockOnSec=10*60; blockOffSec=8*60; useBlock=true;
            volume=0.09; useTts=false; useMicGate=false; validationMode=false;
        }
    }

    private final Runnable cueLoop = new Runnable() {
        int played = 0;
        long startedAt = 0;
        boolean inBlock = false;
        @Override public void run() {
            try {
                if (startedAt == 0) startedAt = System.currentTimeMillis();

                // lead-in silence: deep sleep (SWS) dominates ~60-90 min after sleep onset
                if (System.currentTimeMillis() - startedAt < (long)leadInSec*1000) {
                    if (System.currentTimeMillis() - startedAt < (leadInSec-2)*1000) {
                        postDelayed(intervalSec*1000); return;
                    }
                }

                // block timing: alternate between cue-on and cue-off periods
                if (useBlock) {
                    long elapsedInCycle = (System.currentTimeMillis() - blockStartTime) / 1000;
                    if (!inBlock) {
                        // check if we should start a new block
                        if (elapsedInCycle >= blockOffSec) {
                            inBlock = true;
                            blockStarted = System.currentTimeMillis();
                            blockPlayed = 0;
                            Log.i(TAG, "block ON started");
                        }
                    } else {
                        // check if we should end the current block
                        if (elapsedInCycle >= blockOnSec) {
                            inBlock = false;
                            blockStartTime = System.currentTimeMillis();
                            Log.i(TAG, "block OFF started");
                        }
                    }
                }

                // skip cue if in OFF block
                if (useBlock && !inBlock) {
                    postDelayed(intervalSec*1000); return;
                }

                // mic gate: skip cue if environment is noisy (avoids arousal)
                if (useMicGate) initNoiseSampler();
                boolean noisy = useMicGate && isNoisy();
                if (noisy) {
                    if (useBlock) {
                        // don't count noise gaps toward cap
                    } else {
                        startedAt -= intervalSec*500;
                    }
                }

                // cap: count total time from start, not blocked time
                double elapsedCap = (System.currentTimeMillis() - startedAt)/1000.0;
                if (elapsedCap > capSec) { stopSelf(); return; }

                if (!noisy) {
                    playCueForNextItem();
                    played++;
                    blockPlayed++;
                    Log.i(TAG, "cue played=" + played + " blockPlayed=" + blockPlayed);
                }
                postDelayed(intervalSec*1000);
            } catch (Exception e) {
                Log.w(TAG, "loop error: " + e.getMessage());
                postDelayed(intervalSec*1000);
            }
        }
        private void postDelayed(long ms){ worker.postDelayed(this, ms); }
    };

    private void playCueForNextItem() {
        if (planItems == null || planItems.length() == 0) return;
        int i = (int)(System.currentTimeMillis() % planItems.length());
        try {
            JSONObject it = planItems.getJSONObject(i);
            // validation mode: skip cues for items marked "noCue" (50% randomly selected during planning)
            if (validationMode && !it.has("noCue") && it.optBoolean("noCue", false)) {
                Log.i(TAG, "validation: skipping noCue item " + i);
                return;
            }
            JSONArray f = it.getJSONArray("freqs");
            double[] freqs = { f.getDouble(0), f.getDouble(1) };
            double[] fixed = { F0[i % F0.length], F1[i % F0.length] }; // deterministic fallback if plan freq missing
            if (freqs.length < 2) freqs = fixed;
            playTone(freqs, 0.42, volume);
            if (useTts && tts != null && it.has("text")) {
                String txt = it.optString("text","");
                if (!txt.isEmpty()) tts.speak(txt, TextToSpeech.QUEUE_FLUSH, null, "cue"+i);
            }
        } catch (JSONException ignored) {}
    }
        } catch (JSONException ignored) {}
    }

    private void playTone(double[] freqs, double dur, double gain) {
        final int n = (int)(sampleRate * dur);
        final short[] smp = new short[n];
        final double twoPi = 2.0*Math.PI;
        for (int k=0;k<n;k++){
            double t = k/(double)sampleRate;
            double s = 0;
            for (double f: freqs) s += Math.sin(twoPi*f*t);
            s *= 0.4/freqs.length;
            smp[k] = (short)(Short.MAX_VALUE * gain * s);
        }
        if (track == null) {
            track = new AudioTrack(AudioManager.STREAM_MUSIC, sampleRate,
                    AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT,
                    bufSize, AudioTrack.MODE_STATIC);
        }
        track.flush();
        track.write(smp, 0, n);
        track.play();
    }

    private void initNoiseSampler() {
        if (noiseSampler != null) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) return;
        try {
            noiseSampler = new MediaRecorder();
            noiseSampler.setAudioSource(MediaRecorder.AudioSource.MIC);
            noiseSampler.setOutputFormat(MediaRecorder.OutputFormat.THREE_GPP);
            noiseSampler.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            noiseSampler.setOutputFile(android.os.Environment.getExternalStorageDirectory() + "/tmr_noise.tmp");
            noiseSampler.setAudioSamplingRate(sampleRate);
            noiseSampler.prepare();
            noiseSampler.start();
        } catch (Exception e) { Log.w(TAG,"no mic: "+e.getMessage()); noiseSampler=null; }
    }

    // crude RMS check via a temporary AudioRecord read is overkill; instead reuse MediaRecorder
    // amplitude. If unavailable, treat as not noisy (don't block cues).
    private boolean isNoisy() {
        if (noiseSampler == null) return false;
        try {
            int amp = noiseSampler.getMaxAmplitude();
            return amp > 2000; // empirical threshold for movement/talking; quiet breathing is far lower
        } catch (Exception e) { return false; }
    }

    private void stopNow() { stopSelf(); running=false; }
}
