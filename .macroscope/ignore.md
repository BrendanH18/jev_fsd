# Macroscope ignore rules for this repository.
# Docs: https://docs.macroscope.com/code-review/ignore-files
# This file REPLACES Macroscope's defaults, so the defaults are copied below.
# One bare glob per line: no bullets, backticks, quotes, leading "/" or trailing comments.
# Tests stay excluded by Macroscope's own test detection (ignoreTests defaults to true).
# Macroscope reads the committed version of this file; uncommitted edits have no effect.

# Macroscope default base patterns, copied from https://docs.macroscope.com/code-review/ignore-files.md on 2026-10-22
# === Vendored / dependency directories ===
**/.git/**
**/__pycache__/**
**/.pytest_cache/**
**/.mypy_cache/**
**/.ruff_cache/**
**/venv/**
**/.venv/**
**/node_modules/**
**/site-packages/**
**/.pnpm-store/**
**/__Snapshots__/**
**/__snapshots__/**
**/.agents/skills/**
**/.claude/skills/**
**/.github/skills/**
**/bower_components/**
**/jspm_packages/**
**/.next/**
**/.svelte-kit/**
**/.nuxt/**
**/.output/**
**/.vercel/**
**/.angular/**
**/vendor/**
**/_vendor/**
**/third_party/**
**/Pods/**
**/.bundle/**

# === Root-anchored ambiguous directories ===
build/**
out/**
env/**
ENV/**

# === Generated / build-output directories (match anywhere) ===
**/target/**
**/dist/**
**/generated/**
**/intermediates/**
**/generated_sources/**
**/generated-sources/**
**/generated-src/**
**/src/main/generated/**

# === Minified build output ===
**/*.min.js
**/*.min.css
**/*.bundle.js

# === Yarn PnP loader files ===
**/.pnp.cjs
**/.pnp.loader.mjs

# === Generated protobuf / codegen files ===
**/*_pb.d.ts
**/*_pb.js
**/*.pb.go
**/*_pb2.py
**/*_pb2_grpc.py
**/*_pb2.pyi
**/*.grpc.swift
**/*.pb.swift
**/*.sql.go
**/*.designer.cs
**/*.g.dart
**/*.pb.dart
**/*_pb.rb
**/*.d.ts
**/*.gen.ts
**/*.gen.tsx
**/*.gen.js
**/*.gen.jsx

# === Package manager files ===
**/go.mod
**/package.json
**/*.pbxproj
**/*.xcstrings
**/*.strings
**/*.properties
**/pom.xml
**/Package.swift
**/bun.lock
**/.eslintrc
**/.eslintignore

# === Lock / sum files ===
**/go.sum
**/package-lock.json
**/pnpm-lock.yaml
**/yarn.lock
**/Package.resolved

# === Images ===
**/*.jpg
**/*.jpeg
**/*.png
**/*.gif
**/*.svg
**/*.ico
**/*.webp
**/*.bmp
**/*.tiff

# === Fonts ===
**/*.woff
**/*.woff2
**/*.ttf
**/*.eot
**/*.otf

# === Media ===
**/*.mp3
**/*.mp4
**/*.wav
**/*.avi
**/*.mov
**/*.mkv
**/*.flac
**/*.ogg
**/*.srt

# === Archives ===
**/*.zip
**/*.tar
**/*.gz
**/*.rar
**/*.7z
**/*.bz2

# === Documents ===
**/*.pdf
**/*.doc
**/*.docx
**/*.xls
**/*.xlsx
**/*.ppt
**/*.pptx

# === Data / serialized ===
**/*.db
**/*.sqlite
**/*.sqlite3
**/*.parquet
**/*.avro
**/*.arrow
**/*.npy
**/*.pkl
**/*.json
**/*.jsonl

# === ML models ===
**/*.onnx
**/*.tflite
**/*.h5
**/*.safetensors

# === Compiled / binary ===
**/*.exe
**/*.dll
**/*.so
**/*.dylib
**/*.bin
**/*.pyc
**/*.class
**/*.o
**/*.a
**/*.wasm

# === Certificates / keys ===
**/*.cer
**/*.pem
**/*.p12

# === Platform-specific / non-reviewable ===
**/*.stringsdict
**/*.snap
**/*.adoc
**/*.arb
**/*.lock
**/*.po
**/*.fbx
**/*.log
**/*.xib
**/*.meta
**/*.kml
**/*.prefab
**/*.eml
**/*.csv
**/*.grpc.reflection
**/*.js.map

# ==== Project-specific patterns ====
# Raw OpenStreetMap downloads (XML data dumps cached by scripts/fetch_map.py; the processed packs are JSON, already a default)
data/maps/*.osm.xml

# Static demo site written by scripts/build_demo.py (copies of static/ plus map packs)
.demo-site/**

# Prose: README, CHANGELOG, docs, vendored notices and agent instructions
**/*.md
LICENSE*
