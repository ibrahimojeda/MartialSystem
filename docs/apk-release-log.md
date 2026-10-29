# Registro de APK — MartialSystem

Registro de la última compilación y publicación del APK de Android.

## Último build (2026-10-29)

| Campo | Valor |
|---|---|
| Archivo | `MartialSystem_v2.11.3.apk` |
| Tamaño | 22,347,216 bytes (~21.3 MB) |
| Versión de app | 2.11.3 |
| Build | 27 |
| Commit de origen | `122b6c6` (docs) sobre funcional `8f2db8f` |
| Rama | `master` |
| Fecha de build | 2026-10-29 (~14:27 local) |
| Release de GitHub | `Martial_System` (tag `Martial_System`) |
| Asset en el release | `MartialSystem_v2.11.3.apk` (sobrescrito con `--clobber`) |

## URL de descarga

```
https://github.com/ibrahimojeda/MartialSystem/releases/download/Martial_System/MartialSystem_v2.11.3.apk
```

`web/version.json` apunta a esta URL (`apkUrl`), por lo que la app la usa sin cambios.

## Proceso de build

1. `npx cap copy android` — sincroniza `web/` → `android/app/src/main/assets/public/`.
2. `android\gradlew.bat assembleDebug` — `BUILD SUCCESSFUL in 3m 24s` (153 tasks).
3. Copiar `android/app/build/outputs/apk/debug/app-debug.apk` → `MartialSystem_v2.11.3.apk`.
4. `gh release upload Martial_System MartialSystem_v2.11.3.apk --clobber`.

## Entorno

- Java: OpenJDK 21.0.11
- Gradle: wrapper del proyecto (`gradlew.bat`)
- Capacitor: `@capacitor/android 8.5.1`, CLI `^8.5.0`
- `appId`: `com.martialsystem.app`
- GitHub CLI: `gh` 2.89.0 (autenticado como `ibrahimojeda`)

## Notas

- **Sin bump de versión**: el APK se reconstruyó sobre la misma versión `2.11.3` del
  release congelado. El contenido `web/` incluye Fase C (calendario, notificaciones,
  mensajería), pero `web/version.json` sigue con el changelog previo ("Consumo de las IAs").
- El asset `v2.11.3` se **sobrescribió**; no se conservó una copia previa del mismo nombre.
- El APK es **debug** (`assembleDebug`), sin firma de release/keystore. Para distribución
  pública (Play Store) se requiere `assembleRelease` + firma AAB.
- Archivos `*.apk` y `*.log` están en `.gitignore`; no ensucian el repositorio.
