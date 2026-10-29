package com.jandco.tbilling;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        String jobName = call.getString("jobName", "T Billing Receipt");
        getActivity().runOnUiThread(() -> {
            PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            WebView webView = getBridge().getWebView();

            if (printManager == null || webView == null) {
                call.reject("Android print service is not available.");
                return;
            }

            PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
            PrintAttributes attributes = new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.UNKNOWN_PORTRAIT)
                    .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                    .build();

            printManager.print(jobName, adapter, attributes);

            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        });
    }
}
