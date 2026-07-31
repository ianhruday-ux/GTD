package com.ianhruday.oela;

import android.os.Bundle;
import android.view.ActionMode;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * THE REASON THE WRAPPER EXISTS (goal #1, wrapper-plan.md §0).
 *
 * spec.md §3, known issue 5: a sustained press-and-hold can trigger Android's
 * native text-selection UI, which races the app's own long-press drag detection.
 * When the system wins, the card sticks in a dimmed mid-drag state and the drag
 * is lost. Inside a browser the page cannot prevent this -- CSS and JS
 * mitigations were all tried and none worked, and broadening user-select:none
 * app-wide made it WORSE. The accepted mitigation was title-scoped selection
 * blocking plus a 4-second idle watchdog, which recovers from the failure rather
 * than preventing it.
 *
 * In a WebView we own, it is settled here: refuse to start the action mode at
 * all, so the selection UI never appears and never competes for the gesture.
 *
 * All three overrides are deliberate. onActionModeStarted is the classic path.
 * onWindowStartingActionMode has a one-argument form and a two-argument form
 * carrying TYPE_FLOATING, and the floating one is what modern Android actually
 * uses for text selection in a WebView. Overriding only the obvious first
 * method -- the easy mistake -- leaves the floating selection toolbar alive on
 * exactly the devices this is meant to fix, and looks like the fix failed.
 *
 * No app code changes accompany this. That is the whole point of chunk W0: if
 * this works, the drag bug is fixed by owning the browser rather than by
 * rewriting a drag implementation that is already 100% custom.
 */
public class MainActivity extends BridgeActivity {

    /**
     * SECOND DOOR, found by the drag log on the first real device test.
     *
     * Blocking the action mode above killed the selection TOOLBAR, and the bug
     * got much better without going away. The log showed why, four identical
     * times:
     *
     *   +24080ms  touchstart   div.card-title  [IS a drag title]
     *   +24481ms  HOLD FIRED → drag now active      (the app's 400ms hold)
     *   +24693ms  contextmenu prevented             (Android's long-press, ~200ms later)
     *   +24710ms  touchcancel  active=true          (the drag dies)
     *
     * The finger never left the title and the app did everything right. Two
     * long-press timers were running -- ours at 400ms and the WebView's at
     * roughly 600ms -- and the WebView's fired second. The page calls
     * preventDefault on the contextmenu, but THAT DOES NOT STOP THE WEBVIEW
     * CANCELLING THE TOUCH STREAM: touchcancel arrives regardless and the drag
     * is correctly torn down. The app was not misbehaving; it was being mugged.
     *
     * So the fix is not a shorter hold (that is a race, not a fix) and not more
     * JS (the page has already lost by the time it hears anything). It is to
     * tell the WebView it has no long-press behaviour to run:
     *
     *   · setLongClickable(false)   — no long-click handling
     *   · onLongClick returning true — consume it if one is dispatched anyway,
     *     so the default (context menu / selection) never runs
     *   · haptics off               — otherwise the system buzz still fires at
     *     600ms, a phantom second buzz 200ms after our own, which reads as the
     *     drag failing even on the attempts that now succeed
     *
     * This is precisely the thing spec.md §3 said a page "cannot fully control
     * from inside a browser it doesn't own but an owned WebView settles in one
     * line." It took two lines and a device to find the second one.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DropboxAuthPlugin.class); // must precede super.onCreate() per Capacitor's own registration contract
        super.onCreate(savedInstanceState);
        WebView web = (getBridge() != null) ? getBridge().getWebView() : null;
        if (web == null) {
            return; // nothing to harden; the bridge will have failed louder than this
        }
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true; // consumed — do not fall through to selection
            }
        });

        /**
         * B4 (wrapper-plan.md §5): BACK = CANCEL (✕), never Save, with the
         * resolution order dialog -> drawer -> page -> exit. That chain
         * already exists in app code as the Escape-key handler (app.js,
         * handleBackOrEscape, exposed here as window.__oelaHandleBack) --
         * this callback's only job is to ask the page whether it handled the
         * press before letting Android's own default happen.
         *
         * NOT Activity.onBackPressed(). This app targets SDK 36 (Android
         * 16), where predictive back is ON BY DEFAULT unless the manifest
         * opts out -- and once it's on, the system stops delivering the
         * classic back-key event to onBackPressed() at all; it calls a
         * registered OnBackInvokedCallback instead. An onBackPressed()
         * override here would simply never run, on this device or any other
         * shipping with predictive back on by default, which is exactly what
         * the first build of this chunk did wrong (device test: every back
         * press just closed the app, silently skipping the whole override).
         * OnBackPressedCallback is the AndroidX shim that speaks BOTH
         * dispatch mechanisms depending on OS version, so this is correct
         * going forward rather than a same-bug-different-Android-version
         * fix -- and it keeps the system's predictive-back preview animation
         * working for the app instead of turning it off wholesale.
         *
         * evaluateJavascript is async, so the decision can't be made inside
         * this single callback invocation. The callback disables itself and
         * re-asks the dispatcher, which — with this callback out of the way —
         * falls through to BridgeActivity's own default (no @capacitor/app
         * listener is registered, so that means WebView-back-history, else
         * finish the activity). Settled 2026-07-28: in the lanes, back exits
         * the app with no extra guard, which is exactly what that fallback
         * already does once nothing is left for the chain to intercept.
         */
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
                if (wv == null) {
                    fallThrough();
                    return;
                }
                wv.evaluateJavascript(
                    "(window.__oelaHandleBack ? !!window.__oelaHandleBack() : false)",
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            if (!"true".equals(value)) fallThrough();
                        }
                    }
                );
            }

            private void fallThrough() {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @Override
    public void onActionModeStarted(ActionMode mode) {
        if (mode != null) {
            mode.finish();
            return;
        }
        super.onActionModeStarted(mode);
    }

    @Override
    public ActionMode onWindowStartingActionMode(ActionMode.Callback callback) {
        return null;
    }

    @Override
    public ActionMode onWindowStartingActionMode(ActionMode.Callback callback, int type) {
        return null;
    }
}
