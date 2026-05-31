# Auto-Updater Setup

Husk uses Tauri's built-in updater plugin to deliver one-click updates to users.

## How It Works

1. On app launch, Husk silently checks a JSON endpoint for a newer version.
2. If an update is found, a toast notification appears with the new version info.
3. The update downloads in the background and installs automatically.
4. The app restarts to apply the update.

## Configuration

### 1. Signing Keys (Required)

Generate an Ed25519 key pair for signing updates:

```bash
cd src-tauri
cargo tauri signer generate --force
```

This creates:
- `tauri.key` — **Private key**. Add to GitHub Secrets as `TAURI_SIGNING_PRIVATE_KEY`.
- `tauri.key.pub` — **Public key**. Paste the contents into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

> **Security**: Never commit the private key. The public key is safe to commit.

### 2. Update Endpoint

The updater checks `latest.json` at the configured endpoint. By default it's set to GitHub Releases:

```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/akikp/husk/releases/latest/download/latest.json"
      ]
    }
  }
}
```

You can change this to any HTTPS URL that serves the correct JSON format.

### 3. Release via GitHub Actions

Pushing a tag like `v1.2.0` triggers the release workflow:

```bash
git tag v1.2.0
git push origin v1.2.0
```

The workflow:
1. Builds the app for macOS (Intel + Apple Silicon), Linux, and Windows.
2. Signs the update bundles with your private key.
3. Creates a GitHub Release draft with all assets attached.
4. You publish the draft release when ready.

### 4. Manual Update Check

Users can trigger a check manually. Add this to your settings or command palette:

```ts
import { checkForUpdates } from "@/updater";

// Silent check (no toast if up to date)
await checkForUpdates(false);

// Manual check (shows "No updates available" if up to date)
await checkForUpdates(true);
```

## `latest.json` Format

When the release workflow runs, Tauri automatically generates and uploads `latest.json` to the release assets. You don't need to create it manually. The format is:

```json
{
  "version": "1.2.0",
  "notes": "Bug fixes and improvements",
  "pub_date": "2026-05-31T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "Content of the .sig file...",
      "url": "https://github.com/akikp/husk/releases/download/v1.2.0/husk_1.2.0_aarch64.dmg"
    },
    "darwin-x86_64": {
      "signature": "...",
      "url": "https://github.com/akikp/husk/releases/download/v1.2.0/husk_1.2.0_x64.dmg"
    },
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/akikp/husk/releases/download/v1.2.0/husk_1.2.0_x64_en-US.msi.zip"
    }
  }
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Update check failed" toast | Check network connectivity and that `latest.json` is accessible at the endpoint URL. |
| Updates not installing | Ensure the app is signed. Unsigned apps on macOS/Windows will be blocked by the OS. |
| Wrong architecture downloaded | Verify the `platforms` keys in `latest.json` match the user's architecture (`aarch64` vs `x86_64`). |
| CI build fails with signing error | Confirm `TAURI_SIGNING_PRIVATE_KEY` is set correctly in GitHub Secrets. |
