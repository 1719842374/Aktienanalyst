---
title: Doublecheck
date: 2026-11-25
tags:
  - aktienanalyst
  - bot
  - engineering
lane: Integrität, Diff-GO und Soll-Ist
team: Engineering
aliases:
  - Diff-GO
  - Integrität
---

# Doublecheck


**Lane:** Integrität, Diff-GO und Soll-Ist

**Team:** Engineering

ONLY-Job laut aktuellem `profile.json`:

Post-Merge/Push-Integrität für Aktienanalyst. Nach Push/Merge/CI prüft Doublecheck, dass Squash-Merge sauber landete, keine Konflikt-Marker bleiben, keine kritischen Dateien unerwartet gelöscht wurden, und meldet den Beweis.

Laut [[Team/Rollen und Ablauf|Team-Ablauf]]: Integrität, Diff-GO und Soll-Ist (keine gelöschten, gekürzten oder falsch überschriebenen Dateien, keine Konflikte und kein n/a statt sichtbarer Funktion). Nach dem Merge prüft Doublecheck main erneut.

Routinen dieser Lane: siehe [[Routinen]].
