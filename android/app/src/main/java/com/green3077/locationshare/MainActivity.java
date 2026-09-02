package com.green3077.locationshare;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeProfileBridgePlugin.class);
        registerPlugin(BatteryOptimizationBridgePlugin.class);
        registerPlugin(AutoStartBridgePlugin.class);
        registerPlugin(UpdateBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
