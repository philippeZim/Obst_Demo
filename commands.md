# Signierte Release-APK selbst bauen

Optimierte, signierte APK (für OnePlus 12 / Modell CPH2447) erzeugen und installieren.
Aus dem Projekt-Root ausführen: `/home/eron/Documents/Programming/tauri/Obst_Demo`.

> **WICHTIG — nicht den `gradlew`-Direktweg nehmen.** `./gradlew assembleArm64Release`
> ruft intern `tauri android android-studio-script` auf, und das ist ein **Dev-Build**:
> es brennt die Dev-Server-URL (`http://<PC-LAN-IP>:1420`) in die App ein, statt die
> Assets einzubetten. Ergebnis: die App startet nur, wenn das Handy den PC erreicht
> (USB-Tethering) und zeigt sonst "error sending request for url".
> Ein echtes Standalone-APK gibt es **nur** über `tauri android build`.

## 0. Voraussetzungen

```bash
npx tauri --version                              # Tauri CLI 2.x
java -version                                    # JDK 21
rustup target list --installed | grep android    # aarch64-linux-android
echo "$ANDROID_HOME"   # /home/eron/Android/Sdk
echo "$NDK_HOME"       # .../ndk/28.2.13676358

# Falls das aarch64-Rust-Target fehlt:
rustup target add aarch64-linux-android
```

## 1. Identifier OHNE Unterstrich

`tauri android build` lehnt Identifier mit `_` ab. In `src-tauri/tauri.conf.json` muss stehen:

```json
"identifier": "com.eron.obstdemo"
```

> Wurde der Identifier geändert, muss das Android-Projekt einmal neu generiert werden,
> damit Package-Pfade und JNI-Symbolnamen passen:
> ```bash
> mv src-tauri/gen/android src-tauri/gen/android.bak   # altes sichern
> npx tauri android init
> ```
> Danach Schritt 2 (Signing) erneut anwenden – `init` überschreibt build.gradle.kts.

## 2. Keystore + Signing (einmalig einrichten)

> ⚠️ Denselben Keystore für ALLE künftigen Updates verwenden, sonst verweigert Android
> die Installation. Für echte Releases ein starkes Passwort statt `obstdemo` nehmen.

```bash
mkdir -p ~/.android-keystores
keytool -genkeypair -v \
  -keystore ~/.android-keystores/obst_demo.jks \
  -alias obst_demo -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass obstdemo -keypass obstdemo \
  -dname "CN=Obst Demo, O=Eron, L=, ST=, C=DE"
```

`src-tauri/gen/android/keystore.properties`:

```properties
storeFile=/home/eron/.android-keystores/obst_demo.jks
storePassword=obstdemo
keyAlias=obst_demo
keyPassword=obstdemo
```

In `src-tauri/gen/android/app/build.gradle.kts` (vor `buildTypes`) die Signing-Config
einfügen und im `release`-BuildType referenzieren (v1 + v2 erzwingen):

```kotlin
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) { propFile.inputStream().use { load(it) } }
}
// ... in android { } vor buildTypes:
signingConfigs {
    create("release") {
        keyAlias = keystoreProperties["keyAlias"] as String?
        keyPassword = keystoreProperties["keyPassword"] as String?
        storeFile = (keystoreProperties["storeFile"] as String?)?.let { file(it) }
        storePassword = keystoreProperties["storePassword"] as String?
        enableV1Signing = true
        enableV2Signing = true
    }
}
// ... in buildTypes.getByName("release"):
signingConfig = signingConfigs.getByName("release")
```

## 2b. Kamera-Permission ins Manifest (sonst "permission denied")

Die Live-Kamera braucht die CAMERA-Permission. `tauri android init` erzeugt das Manifest
OHNE sie — nach jedem Re-Init erneut eintragen. In
`src-tauri/gen/android/app/src/main/AndroidManifest.xml` direkt nach der INTERNET-Zeile:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
```

> Die Runtime-Abfrage macht Tauris WebView automatisch (RustWebChromeClient.onPermissionRequest):
> beim ersten Modell-Tap erscheint der System-Dialog. `adb shell pm grant ... CAMERA` ist auf
> OnePlus/ColorOS blockiert — die Permission muss über den Dialog erteilt werden.

## 3. Bauen (offizieller Weg)

```bash
npx tauri android build --apk --target aarch64
```

Das baut das Frontend (`npm run build`), kompiliert Rust mit voller Optimierung,
**bettet die Assets ein** (keine Dev-URL) und signiert via Gradle-Config.

Output:
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`

## 4. Signatur verifizieren

```bash
APKSIGNER=$(ls $ANDROID_HOME/build-tools/*/apksigner | sort -V | tail -1)
APK=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

# v1 UND v2 müssen true sein (bei min-sdk 24 zeigt verify v1=false, weil v2 genügt):
"$APKSIGNER" verify --verbose --min-sdk-version 19 "$APK"
```

## 5. Installieren

```bash
ADB=$ANDROID_HOME/platform-tools/adb
$ADB devices                                   # Gerät muss "device" zeigen

# Falls eine alte Version mit anderer Signatur installiert ist:
$ADB uninstall com.eron.obstdemo               # INSTALL_FAILED_UPDATE_INCOMPATIBLE vermeiden

$ADB install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
$ADB shell am start -n com.eron.obstdemo/.MainActivity
```

## Kontrolle: ist wirklich KEINE Dev-URL eingebettet?

```bash
APK=src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
unzip -o -q "$APK" 'lib/*' -d /tmp/apk_check
strings -n 8 /tmp/apk_check/lib/arm64-v8a/libobst_demo_lib.so | grep -iE ":1420/|10\.[0-9]+\."
# 'localhost:1420' als inerter Config-Wert ist OK (wird im Prod-Build ignoriert).
# Eine LAN-IP wie 10.56.x.x wäre ein Dev-Build -> falsch.
```
