---
title: Structure and Skills Setup
doc_type: changelog
status: draft
created_at: 2026-06-04
updated_at: 2026-06-04
---

# 2026-06-04 Structure and Skills Setup

## Added

- Added ADR directory and initial decisions for Android-first MVP, stack choice, Android preview, coordinate model, and test gate.
- Added guide, test, reference, and project changelog indexes.
- Added local project skills and agent role documentation.
- Added planned code-layer placeholders for apps, packages, and artifacts.
- Grouped implementation directories under `platform/` so root-level structure stays focused on `platform/`, `docs/`, and `skills/`.

## Rationale

This structure borrows the useful parts of the control reference project: strong docs, ADRs, test evidence, and AI skills. It keeps this project lighter by avoiding separate docs and skills repositories at MVP stage.
