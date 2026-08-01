package com.ianhruday.oela;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.GeneralSecurityException;
import java.io.IOException;
import java.util.Collections;
import net.openid.appauth.AuthState;
import net.openid.appauth.AuthorizationException;
import net.openid.appauth.AuthorizationRequest;
import net.openid.appauth.AuthorizationResponse;
import net.openid.appauth.AuthorizationService;
import net.openid.appauth.AuthorizationServiceConfiguration;
import net.openid.appauth.ResponseTypeValues;
import net.openid.appauth.TokenResponse;
import org.json.JSONException;

/**
 * W5 (wrapper-plan.md §4.1, §1): OAuth through the system browser, PKCE, no
 * app secret -- the "AppAuth pattern -- available BECAUSE the wrapper owns
 * its auth flow" this project's plan already committed to. This class is the
 * whole boundary between that and the rest of the app: JS never sees a token
 * exchange, a code verifier, or a refresh cycle -- it calls authorize(),
 * isAuthorized(), getAccessToken(), or signOut() and gets a Promise back.
 *
 * Deliberately NOT reusing storage.js's gtd_ mirror (W2) or Capacitor
 * Preferences for the refresh token. That mirror exists so app DATA survives
 * a wipe; a sync CREDENTIAL is a different thing with a different failure
 * mode -- Reset local data (spec.md) must not be able to silently strand a
 * live Dropbox grant, and a plain Preferences value is not encrypted at
 * rest. EncryptedSharedPreferences (Android Keystore-backed AES) in its own
 * file is the correct boundary for a credential specifically.
 */
@CapacitorPlugin(name = "DropboxAuth")
public class DropboxAuthPlugin extends Plugin {

    private static final String PREFS_FILE = "oela_dropbox_auth";
    private static final String KEY_AUTH_STATE = "auth_state";

    // Fixed endpoints, not discovered -- Dropbox's OAuth2 implementation is
    // not an OIDC issuer, so AuthorizationServiceConfiguration.fetchFromIssuer
    // (which expects a /.well-known/openid-configuration document) does not
    // apply here; these two URLs are Dropbox's documented, stable endpoints.
    private static final Uri AUTH_ENDPOINT = Uri.parse("https://www.dropbox.com/oauth2/authorize");
    private static final Uri TOKEN_ENDPOINT = Uri.parse("https://api.dropboxapi.com/oauth2/token");
    private static final String REDIRECT_URI = "com.ianhruday.oela://oauth2redirect";
    private static final String SCOPE = "files.content.write files.content.read";

    private AuthorizationService authService;

    @Override
    public void load() {
        authService = new AuthorizationService(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (authService != null) authService.dispose();
        super.handleOnDestroy();
    }

    /** True if a grant is stored, regardless of whether the access token inside it has expired -- an expiry is a refresh, not a re-login. */
    @PluginMethod
    public void isAuthorized(PluginCall call) {
        AuthState state = loadAuthState();
        JSObject ret = new JSObject();
        ret.put("authorized", state != null && state.isAuthorized());
        call.resolve(ret);
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        String clientId = BuildConfig.DROPBOX_APP_KEY;
        if (clientId == null || clientId.isEmpty()) {
            call.reject("No Dropbox App Key configured -- see wrapper/android/secrets.properties");
            return;
        }
        AuthorizationServiceConfiguration serviceConfig =
            new AuthorizationServiceConfiguration(AUTH_ENDPOINT, TOKEN_ENDPOINT);

        // .Builder generates a PKCE code verifier/challenge by default and
        // carries it through to createTokenExchangeRequest() below -- this is
        // the entire reason no App Secret was collected in the setup
        // checklist (public-client PKCE has none), and it must not be
        // disabled here or the exchange step will be rejected by Dropbox.
        // ⚑ token_access_type=offline IS LOAD-BEARING, and its absence is what
        // broke phone sync roughly four hours after every login (found live,
        // 2026-07-31: the phone last synced successfully at 23:09 on the 30th
        // and every attempt after that failed, while the desktop -- which uses
        // no OAuth at all, just the local Dropbox folder -- carried on fine).
        //
        // Dropbox issues SHORT-LIVED access tokens (~4 hours) and returns a
        // refresh token ONLY when this parameter is present. Without it the
        // grant we store has an access token and nothing to renew it with, so
        // getAccessToken()'s performActionWithFreshTokens() below has nothing
        // to refresh FROM and rejects -- correctly, and permanently, until the
        // user logs in again. The symptom is the worst kind: connecting works,
        // syncing works, and then it quietly stops that evening.
        //
        // AppAuth has no typed setter for this; it is a Dropbox-specific
        // authorization parameter and rides in additionalParameters.
        AuthorizationRequest request = new AuthorizationRequest.Builder(
                serviceConfig, clientId, ResponseTypeValues.CODE, Uri.parse(REDIRECT_URI))
            .setScope(SCOPE)
            .setAdditionalParameters(Collections.singletonMap("token_access_type", "offline"))
            .build();

        saveCall(call);
        startActivityForResult(call, authService.getAuthorizationRequestIntent(request), "authorizeCallback");
    }

    @ActivityCallback
    private void authorizeCallback(PluginCall call, ActivityResult result) {
        if (call == null) return; // process death mid-flow; nothing to resolve

        Intent data = result.getData();
        if (data == null) {
            call.reject("No response from the Dropbox login screen (cancelled or dismissed)");
            return;
        }
        AuthorizationResponse resp = AuthorizationResponse.fromIntent(data);
        AuthorizationException authEx = AuthorizationException.fromIntent(data);
        if (resp == null) {
            call.reject("Dropbox authorization failed: " + (authEx != null ? authEx.errorDescription : "unknown error"));
            return;
        }

        authService.performTokenRequest(resp.createTokenExchangeRequest(), (TokenResponse tokenResp, AuthorizationException tokenEx) -> {
            if (tokenResp == null) {
                call.reject("Dropbox token exchange failed: " + (tokenEx != null ? tokenEx.errorDescription : "unknown error"));
                return;
            }
            AuthState state = new AuthState(resp, authEx);
            state.update(tokenResp, tokenEx);
            if (!saveAuthState(state)) {
                call.reject("Signed in, but the device could not save the credential securely");
                return;
            }
            call.resolve(new JSObject());
        });
    }

    /** Returns a currently-valid access token, silently refreshing first if the stored one has expired. Rejects if there's no stored grant at all -- caller should have checked isAuthorized() first. */
    @PluginMethod
    public void getAccessToken(PluginCall call) {
        AuthState state = loadAuthState();
        if (state == null || !state.isAuthorized()) {
            call.reject("Not signed in to Dropbox");
            return;
        }
        state.performActionWithFreshTokens(authService, (String accessToken, String idToken, AuthorizationException ex) -> {
            if (ex != null || accessToken == null) {
                call.reject("Could not refresh the Dropbox session: " + (ex != null ? ex.errorDescription : "unknown error"));
                return;
            }
            saveAuthState(state); // the refresh may have rotated the refresh token; persist the updated state, not just hand back the access token
            JSObject ret = new JSObject();
            ret.put("accessToken", accessToken);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        SharedPreferences prefs = encryptedPrefs();
        if (prefs != null) prefs.edit().remove(KEY_AUTH_STATE).apply();
        call.resolve(new JSObject());
    }

    private SharedPreferences encryptedPrefs() {
        try {
            Context ctx = getContext();
            MasterKey masterKey = new MasterKey.Builder(ctx)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
            return EncryptedSharedPreferences.create(
                ctx, PREFS_FILE, masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (GeneralSecurityException | IOException e) {
            return null; // Keystore unavailable -- treat as "not signed in" rather than crash
        }
    }

    private AuthState loadAuthState() {
        SharedPreferences prefs = encryptedPrefs();
        if (prefs == null) return null;
        String json = prefs.getString(KEY_AUTH_STATE, null);
        if (json == null) return null;
        try {
            return AuthState.jsonDeserialize(json);
        } catch (JSONException e) {
            return null; // corrupt entry -- treat as signed out rather than crash; authorize() re-establishes it
        }
    }

    private boolean saveAuthState(AuthState state) {
        SharedPreferences prefs = encryptedPrefs();
        if (prefs == null) return false;
        prefs.edit().putString(KEY_AUTH_STATE, state.jsonSerializeString()).apply();
        return true;
    }
}
