package com.moonkip.synapsis;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void load() {
        // register our overnight TMR foreground-service plugin before the bridge
        // is created (load() runs last in onCreate, prior to bridge.build).
        registerPlugin(TmrPlugin.class);
    }
}
