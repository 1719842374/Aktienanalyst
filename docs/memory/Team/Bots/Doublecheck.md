---
title: Doublecheck
date: 2026-11-25
tags:
  - aktienanalyst
  - bot
  - engineering
bot_id: 7b200921-7041-451b-b607-fd0bb4f28a3c
lane: Integrität, Diff-GO und Soll-Ist
team: Engineering
aliases:
  - Diff-GO
  - Integrität
---

# Doublecheck

**Id:** `7b200921-7041-451b-b607-fd0bb4f28a3c`

**Lane:** Integrität, Diff-GO und Soll-Ist

**Team:** Engineering

ONLY-Job laut aktuellem `profile.json`:

Post-Merge/Push-Integrität für Aktienanalyst. Nach Push/Merge/CI prüft Doublecheck, dass Squash-Merge sauber landete, keine Konflikt-Marker bleiben, keine kritischen Dateien unerwartet gelöscht wurden, und meldet den Beweis.

Laut [[Team/Rollen und Ablauf|Team-Ablauf]]: Integrität, Diff-GO und Soll-Ist (keine gelöschten, gekürzten oder falsch überschriebenen Dateien, keine Konflikte und kein n/a statt sichtbarer Funktion). Nach dem Merge prüft Doublecheck main erneut.

Routinen dieser Lane: siehe [[Routinen]].
