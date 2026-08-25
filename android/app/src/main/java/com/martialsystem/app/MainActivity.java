package com.martialsystem.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import ee.forgr.biometric.NativeBiometric;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(ApkUpdater.class);
        registerPlugin(NativeBiometric.class);
    }
}
