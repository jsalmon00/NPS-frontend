# NoPayStation Modern Frontend & Manager

A modern, responsive desktop and web frontend for browsing, downloading, and managing NoPayStation content across PS Vita, PSP, PSX (PS1), PS3, and PS Mobile titles.

## Features

- **Extensive Catalog**: Live synchronization with official NoPayStation TSV feeds (34,000+ entries across games, DLCs, and themes).
- **Automated Artwork & Metadata**: High-resolution game cover resolution mapped via Title IDs with fallback chains and dynamic gradient cards.
- **Genre & Platform Filtering**: Browse by platform (PSV, PSP, PSX, PS3, PSM), content type (Games, DLCs, Themes), region, and genre tags.
- **Download & Extraction Queue**: Concurrent streaming downloads with live progress, transfer speed, and automatic extraction using `pkg2zip`.
- **PSP Direct USB Transfer**: Automatic detection of connected PSP devices/memory sticks, storage verification, and one-click transfer to `/ISO/` or `/PSP/GAME/`.
- **PS Vita FTP / NoNpDrm Network Installation**: Wireless deployment directly to PS Vita running VitaShell (port 1337), organizing folders for LiveArea refresh or Adrenaline.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `pkg2zip.exe` (placed inside the `NoPayStation/` folder or configured via Settings)

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the application:
   ```bash
   npm start
   ```
   Or double-click `start.bat` on Windows.

3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Configuration

Settings (download paths, `pkg2zip` parameters, HMAC keys, and TSV sources) can be modified directly within the UI or via `config.json`.
