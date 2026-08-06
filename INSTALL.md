# Installing OELA

OELA is a task manager. Five lists — Next Actions, Waiting On, Current Projects, Future/Someday and
Habits — plus notes and a calendar.

**It runs entirely on your own device.** There is no account, no server, and nothing to sign up for.
It works with the wi-fi off, on a plane, forever. Nobody, including me, can see what you put in it.

That also means: **your data lives on the device you typed it into.** Read "Your data" near the
bottom before you rely on it. There is a backup button and you should use it.

---

## Which one do I install?

| You have | Take | Size | What it gives you |
|---|---|---|---|
| Any computer, any phone, five seconds | `OELA-1.0.1.html` | 1 MB | The whole app in one file. Open it, use it. |
| An Android phone | `OELA-1.0.1.apk` | 5 MB | A real installed app with an icon, plus sync. |
| A Windows PC | `OELA-1.0.1-windows-x64.zip` | 138 MB | A real desktop app, plus sync. |

Yes, the Windows download really is that much bigger than the app. Roughly 1 MB of it is OELA; the
rest is Chromium, which a desktop app has to bring along and a browser already has. That is also why
the one-file version is not a lesser version — it is the same app, running in the browser you
already installed.

You can install more than one. If you want your phone and your computer to hold the *same* list,
install both and then read "Sync" below.

There is no iPhone version and there isn't going to be one. macOS and Linux are possible but not
built — ask me if you want one.

---

## The one-file version (start here)

1. Download `OELA-1.0.1.html`.
2. Open it. Double-click it, or drag it into a browser window.

That is the entire installation. Everything the app needs — the code, the fonts, the icons — is
inside that one file.

**On a phone,** the tidy version of this is to open the app's web page in Chrome or Safari, then use
**Add to Home Screen** (Share menu on iPhone, ⋮ menu on Android). You get an icon and no browser bars.

**The catch, and it's a real one:** a browser decides for itself how long to keep a website's data.
If you clear your browsing data, or use private/incognito mode, or your phone runs low on storage,
your lists can be thrown away. The installed Android and Windows versions below do not have this
problem — that is most of the reason they exist.

So: the one-file version is perfect for deciding whether you like the app. Do not put a year of your
life into it without exporting a backup now and then.

---

## Android

The app is not on the Play Store, so you install it yourself. This is called sideloading and it is a
normal, supported thing to do — but Android has been making it steadily less pleasant, and on a
current phone it is more than a couple of confirmations. Step 4 is the awkward one. Read it before
you start rather than in the middle.

1. **Get `OELA-1.0.1.apk` onto the phone.** Email it to yourself, put it in Dropbox, or plug the phone
   into a computer and copy it across. Downloading it in Chrome on the phone is easiest.
2. **Tap the file.** In Chrome, pull down the notification shade and tap the finished download; or
   open **Files** → **Downloads** and tap it there.
3. **Android will say the app you tapped from isn't allowed to install apps.** Tap **Settings** on
   that prompt, turn on **Allow from this source**, and press back. This is a permission you are
   granting to whatever you tapped from — Chrome, Dropbox, Files — not to me.
4. **Play Protect will block it.** On some phones the dialog offers **More details → Install
   anyway** and you can just tap that. **On many current phones it does not** — there is no
   install-anyway option at all, only a button that dismisses it. If that's what you get, you have
   to switch Play Protect off for the length of the install:

   - **Play Store** → your **profile icon** (top right) → **Play Protect** → the **gear icon** →
     turn off **Scan apps with Play Protect**, and confirm.
   - Install the APK.
   - **Go back and turn it on again.** It only needs to be off for the install itself, not to run
     the app afterwards.

   Play Protect says this about any app that didn't come from the Play Store, especially one it has
   never seen before. It has not examined OELA and found something — it has no idea what OELA is,
   and that is the entire complaint. But turning it off, even briefly, is a real reduction in your
   phone's protection, and you are doing it on my say-so. **If you'd rather not, stop here and use
   the one-file version** — it asks nothing of you and is the same app.
5. **Install.** Then find OELA in your app drawer.

**Updates.** When I send you a newer APK, just install it over the top — your lists are kept. This
only works because every build I hand out is signed with the same key. If you ever *uninstall* OELA,
Android deletes its data with it, so export a backup first.

**If you have `adb`, skip all of the above.** `adb install -r OELA-1.0.1.apk` over USB goes around
both step 3 and step 4 entirely — no source permission, no Play Protect dialog, nothing to switch
off and remember to switch back on. It is by far the least annoying route if you already have the
Android platform tools, and the only reason it isn't the main instruction is that most people
don't.

### Why it asks for permission to use the internet

Nothing else in the app touches the network, but the Dropbox sync below does, and Android requires
the permission to be declared up front whether or not you ever turn sync on.

---

## Windows

1. Download `OELA-1.0.1-windows-x64.zip`.
2. **Right-click it → Extract All.** Put the folder wherever you keep programs — it is not an
   installer and it will run happily from anywhere, including a USB stick.
3. Open the folder and run **OELA.exe**.
4. **Windows SmartScreen will say "Windows protected your PC".** Click **More info** → **Run
   anyway**.

That warning is not about anything found in the file. It appears because the app is **unsigned** — I
have not bought a code-signing certificate, which costs a few hundred dollars a year and is the only
thing that makes the warning go away. Same trade-off as Play Protect above, same honest answer: if
that isn't good enough, the one-file version asks nothing of you.

To make it convenient: right-click `OELA.exe` → **Show more options** → **Send to** → **Desktop
(create shortcut)**, or drag it onto the taskbar to pin it.

To uninstall, delete the folder. There is no registry entry and nothing else to clean up. (Your
lists are *not* in that folder — see "Your data".)

---

## Sync — getting your phone and your computer to agree

**This is optional.** The app is complete without it. Skip this section entirely if you only use
one device.

Sync works through **your own Dropbox**. There is no OELA server; the two copies of the app pass a
single small file back and forth inside your own account. I cannot see it. If you delete the file,
you have lost sync, not your lists.

### What you need

- A Dropbox account — the free one is fine.
- **On Windows: the Dropbox desktop app installed and signed in.** The desktop version of OELA syncs
  by reading and writing a file in your local Dropbox folder, so something has to be keeping that
  folder up to date. The Android version talks to Dropbox directly and needs no such thing.
- **Both devices signed into the same Dropbox account.** This is one person's list on two devices,
  not a shared list between two people. Sharing a list with someone else is not a feature and
  pointing two accounts at one file is not a supported way to fake it.

### Turning it on

On each device: open the **⋯** menu → **Connect Dropbox**.

- **On Android**, your browser opens, you log into Dropbox, you tap Allow, and you land back in the
  app. Use **Chrome** for this if you can — the login step is known to be awkward in DuckDuckGo's
  browser, and Chrome is the one that has actually been tested.
- **On Windows**, there is no login. The app finds your Dropbox folder by itself, and asks you to
  point at it if it can't.

After that you should never think about it again. It syncs when you open the app, when you come back
to it, and when you leave it — and there is a **Sync now** button in the same menu that tells you how
long ago it last succeeded. Everything keeps working with no signal; it catches up when there is one.

If the same thing changed on both devices before they could talk, the app keeps the newer one **and
tells you**, in a list you can read in the ⋯ menu. It will not quietly throw away your work and say
nothing.

### About the app key

The Dropbox App Key — the thing that identifies OELA to Dropbox — is **already inside the APK**, so
there is nothing for you to enter and nothing for you to ask me for. Connect Dropbox just works.

Two things follow from that, and one of them is a favour I need from you:

- **Please tell me if you're going to use sync.** Everyone who connects is linking their Dropbox to
  the same registration of mine, and Dropbox counts them. An app that hasn't been submitted for
  production review can link up to 500 accounts, and once it passes **50** I have two weeks to apply
  for approval before new sign-ins stop working. We are nowhere near that with a handful of friends —
  but I'd rather know the number than find out from a friend whose Connect button stopped working.
- **If you build from source, the key is not in the repo** — it is the one file left out of it. Ask
  me and I'll send it, or register your own free Dropbox app in two minutes and use that instead.
  See "Building it yourself".

---

## Your data

**Where it lives:** on the device, in the app's own private storage. Not in a file you can open, and
not anywhere I can reach.

- **Android** keeps a second, durable copy outside the browser storage, specifically so that Android
  reclaiming space cannot take your lists with it.
- **Windows** keeps it in your user profile, not in the folder you unzipped. Deleting the app folder
  does not delete your lists; reinstalling into a new folder finds them again.
- **The one-file version** keeps it in the browser, under whatever rules that browser applies. This
  is the fragile one.

**Back it up.** ⋯ menu → **Export a backup** writes everything to a file. **Import a backup** reads
one back. Do this before you uninstall anything, before you clear browser data, and every so often
for its own sake. It is a plain file: keep it wherever you keep things you'd miss.

**Restore app to defaults**, in the same menu, erases everything and puts the sample data back. It
asks first.

---

## Did I get the right file?

`CHECKSUMS.txt` ships beside the downloads and lists a long fingerprint for each one. To check a file
matches what I actually built:

```
Windows:      certutil -hashfile OELA-1.0.1.apk SHA256
Mac / Linux:  shasum -a 256 OELA-1.0.1.apk
```

The number it prints should match the line in `CHECKSUMS.txt`. If it doesn't, the download was
corrupted or altered — don't install it, tell me.

You are installing a stranger's binary from outside an app store. This is how you check it is at
least the same binary the stranger meant to send.

---

## When something is wrong

**The Android app won't install — "App not installed".** Usually an older OELA is already there,
signed differently. Uninstall it (export a backup first) and install again.

**Connect Dropbox does nothing, or the browser opens and never comes back.** Set your phone's
default browser to Chrome and try again.

**The two devices connect but never see each other's changes.** Check they are on the same Dropbox
account. On Windows, check the Dropbox desktop app is actually running and finished syncing — OELA
reads what Dropbox has already brought down to the disk, so if Dropbox is paused, OELA is looking at
old news.

**There's a folder in my Dropbox called `Apps/OELA_sync_ianhruday`.** That's the sync file. The odd
name is the app's registered name and not a mistake. Don't delete it while you're using sync.

**My Dropbox isn't in English — the folder is called `Aplicaciones`, or `Applications`.** That's
fine; OELA looks for the sync folder rather than assuming what its parent is called. One wrinkle: if
you set up the **Windows** side first, before ever connecting on a phone, it creates the folder
using the English name `Apps`, which is not the one Dropbox would have used. **Connect on the phone
first if you use both.** If you only use Windows, it doesn't matter at all.

**Something else.** Tell me what you tapped and what happened. There is no crash reporting in this
app and no telemetry of any kind, so if you don't tell me, I don't know.

---

## Building it yourself

Everything is on GitHub and there is nothing to compile for the web version.

```bash
python build.py          # staples src/ into dist/index.html — that's the whole app
```

For the Android and Windows builds:

```bash
python tools_package.py  # -> release/
```

That needs Android Studio (for the SDK and its bundled JDK) and Node. Two files it expects are
deliberately **not** in the repo, and it will tell you clearly if either is missing:

- **`wrapper/android/secrets.properties`** — the Dropbox App Key, as `dropboxAppKey=...`. Ask me for
  mine, or register your own app at dropbox.com/developers (choose **Scoped access** → **App
  folder**), which takes about two minutes and keeps your users off my count. Without it the build
  still succeeds; sync just refuses to connect.
- **`wrapper/android/keystore.properties`** and **`release.keystore`** — my signing key, which
  identifies updates as coming from the same place. You cannot have this one; generate your own with
  `keytool`. An APK you sign yourself won't install over one of mine, and vice versa.
