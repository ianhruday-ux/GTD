package com.ianhruday.oela;

import android.view.ActionMode;
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
