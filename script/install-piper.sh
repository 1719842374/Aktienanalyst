#!/usr/bin/env sh
# Installiert Piper (rhasspy/piper 2023.11.14-2, MIT) und die Stimme de_DE-thorsten-high
# (rhasspy/piper-voices v1.0.0, Datensatz CC0) nach vendor/piper. Prüfsummen sind fest.
# Scheitert ein Download, endet das Skript mit 0 und ohne Dateien: der Server meldet dann
# „Piper ist auf diesem Server nicht installiert“ und der Player spricht im Browser.
set -u

DEST="${1:-vendor/piper}"
PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
PIPER_SHA="a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992"
VOICE="de_DE-thorsten-high"
VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/high"
VOICE_SHA="9df1c43c61149ef9b39e618e2b861fbe41e1fcea9390b2dac62e8761573ea4f1"
VOICE_JSON_SHA="6de734444e4c3f9e33b7ebe2746dbc19b71e85f613e79c65acf623200b99a76a"

if [ "$(uname -m)" != "x86_64" ]; then
  echo "[install-piper] Architektur $(uname -m) nicht unterstützt, Browser-Stimme bleibt aktiv"
  exit 0
fi

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fetch() {
  # $1 URL, $2 Ziel, $3 sha256
  curl -fsSL --retry 3 -o "$2" "$1" || return 1
  echo "$3  $2" | sha256sum -c - >/dev/null 2>&1 || { echo "[install-piper] Prüfsumme falsch: $1"; return 1; }
}

if ! fetch "$PIPER_URL" "$TMP/piper.tgz" "$PIPER_SHA" \
  || ! fetch "$VOICE_BASE/$VOICE.onnx" "$TMP/$VOICE.onnx" "$VOICE_SHA" \
  || ! fetch "$VOICE_BASE/$VOICE.onnx.json" "$TMP/$VOICE.onnx.json" "$VOICE_JSON_SHA"; then
  echo "[install-piper] Download fehlgeschlagen, Browser-Stimme bleibt aktiv"
  exit 0
fi

mkdir -p "$DEST"
tar -xzf "$TMP/piper.tgz" -C "$DEST"
mv "$TMP/$VOICE.onnx" "$TMP/$VOICE.onnx.json" "$DEST/"
if echo "Test." | "$DEST/piper/piper" --model "$DEST/$VOICE.onnx" --output_file "$TMP/t.wav" --quiet >/dev/null 2>&1; then
  echo "[install-piper] ok: $DEST ($VOICE)"
else
  echo "[install-piper] Probelauf fehlgeschlagen, Dateien entfernt, Browser-Stimme bleibt aktiv"
  rm -rf "$DEST"
fi
exit 0
