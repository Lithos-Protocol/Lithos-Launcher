# Lithos Launcher

A desktop app that sets up and runs everything needed to mine on [Lithos](https://github.com/Lithos-Protocol/Lithos-Client),
the decentralized mining pool on Ergo: Java, an Ergo node and the Lithos Client. For Windows and Linux.

It is built for miners who have never run a node. Quick setup takes you from a fresh download to a synced node, a
backed-up wallet and a running Lithos Client, and the dashboard then tells you in plain language what is happening and
what to do next.

## What it does

- **Installs** a Java 11 runtime (Eclipse Temurin), the Ergo node and the Lithos Client. Every download is checked
  against its published SHA-256 checksum, and nothing is installed system-wide.
- **Configures** the node and client for Lithos: indexing, mining, and the network (mainnet or testnet).
- **Creates or restores the wallet**, with a seed phrase screen that asks you to confirm three words. On Windows the
  screen is hidden from screen capture while it is shown. Linux has no way to do that, so there the words stay masked
  until you hold a button (or turn masking off), and the screen warns that screenshots and recordings can capture them.
  It can also use an existing node keystore file: the launcher copies it into the node's wallet folder and the node
  checks its password.
- **Shows sync progress** (headers, blocks, index) with a time estimate, and starts the Lithos Client by itself once the
  node is ready and the wallet has caught up. A restored or imported wallet rescans the chain first; starting the
  client before that finishes asks whether to wait, since the client funds its bonds and fees from the wallet.
- **Helps you mine:** picks a starting difficulty from your hashrate using the same formulas as the client's Difficulty
  page, explains the on-chain commitment before you opt in, and shows connected rigs, hashrate and super shares.
  **Test mining**, next to Start client, mines at your chosen difficulty with `forceConfigDiff` and sends no
  transactions while you try difficulties out: it also sets `disableTransforms` and turns off emissions, DEX broadcasts,
  storage rent and extra block transactions. Restarts and "Start when ready" keep whichever mode the client last ran in.
- **Streams the node's and client's console output** in tabs.
- **Keeps the node and client current:** the Setup card flags a newer release, and Versions switches either one to
  any release on GitHub (restarting it if it runs). For the node it offers both of Ergo's builds, LevelDB (6.0.x) and
  RocksDB (6.1.x), and keeps you on the one your synced chain was written with, since neither can read the other's.
- **Imports an existing setup:** uses your synced chain and wallet where they are, so nothing re-syncs.
- **Keeps mining in the background** from the system tray when you close the window.

## Keys and passwords

- The node's API key, the wallet password, the Lithos API key and the client's application secret are stored encrypted
  by the operating system (DPAPI on Windows, libsecret or KWallet on Linux). With no keyring on Linux, nothing is saved:
  secrets live in memory until the launcher closes.
- No secret is written to a config file. `ergo.conf` holds only the API key's hash (computed by the node itself), and
  `lithos.conf` reads the key and password from environment variables set when the client starts.
- The seed phrase is never stored. It is shown once, when the wallet is created.
- The node and client cards copy their API keys for the panels without showing them: the copy is kept out of Windows
  clipboard history and cleared after 30 seconds. In Settings, either key can be replaced with a new random one or
  with one you choose; both are stored only encrypted, like every other secret.
- The node's API listens on `127.0.0.1` only. So does the Lithos panel, unless you open it to your network in Settings
  to check on mining from a phone; it then accepts only this computer's own addresses as host names. Stratum listens on
  your network so other rigs can connect.
- The window runs with context isolation, no Node access, a strict content security policy and no navigation. It also
  asks for Chromium's OS sandbox, which is on for the Windows installer and the Linux `.deb`. The AppImage turns the
  sandbox off wherever the system blocks what it needs (on Ubuntu 24.04 that is usually the case), and Settings says
  when that has happened. Packaged builds disable `RunAsNode`, `NODE_OPTIONS` and inspector flags, and verify the app
  archive's integrity.

## Where things go

Everything lives in `~/Lithos` (`C:\Users\<you>\Lithos` on Windows) unless you choose another folder in Settings:

```
~/Lithos/
  java/temurin-11-jre/
  mainnet/ and testnet/
    node/      ergo-<version>.jar, ergo.conf, .ergo/ (chain and wallet)
    client/    lithos.conf, .lithos/ (client data), logs/, lithos-client-<version>/
```

The launcher writes only a clearly marked block at the top of `ergo.conf` and `lithos.conf`. Settings you add below that
block are kept, and win over the launcher's. Settings opens either file, and warns if your additions override something
the launcher relies on. The launcher's own settings file (`launcher.json`, in the app's data folder)
exists only if you change the install folder, memory sizes or versions, or import a setup.

## Requirements

- Windows 10/11 or a desktop Linux (x64)
- About 8 GB of RAM for the node and client together
- Disk space for the chain: tens of GB, growing over time
- A GPU miner that supports Autolykos 2 (for example [SOAT Miner](https://github.com/blindrun/soat-miner))

### Linux: .deb or AppImage

On Ubuntu, Debian and their relatives, install the `.deb`:

```bash
sudo apt install ./Lithos-Launcher-<version>.deb
```

It runs with Chromium's sandbox on and needs nothing else. The AppImage works on other distributions, with two
caveats:

- It needs FUSE 2. On Ubuntu 24.04 that is `sudo apt install libfuse2t64` (`libfuse2` on older releases). Without it the
  AppImage fails with `dlopen(): error loading libfuse.so.2`; running it with `--appimage-extract-and-run` also works.
- It runs without Chromium's sandbox where the system doesn't allow one (see Keys and passwords).

Keeping mining in the background uses the system tray. Stock GNOME has no tray without an AppIndicator extension
(Ubuntu ships one); without it, start Lithos Launcher again to bring the window back.

## Development

```bash
npm install
npm run dev
```

To keep a development instance away from your real setup, point it at another folder. It then uses its own launcher
profile as well:

```bash
LITHOS_LAUNCHER_ROOT=./test-root npm run dev
```

`LITHOS_LAUNCHER_SKIP_SYNC_GATE=1` lets the client start before the node is synced. Both are ignored in packaged builds.

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript and Svelte checks |
| `npm run build` | Typecheck and bundle into `out/` |
| `npm run dist:win` | Windows installer (NSIS) in `release/` |
| `npm run dist:linux` | AppImage and .deb in `release/` |
| `npm run icons` | Re-render the app and tray icons from the Lithos mark (`src/renderer/src/assets/lithos-mark.png`, the web docs logo) |

The code is Electron + TypeScript + Svelte 5, bundled with electron-vite:

- `src/main`: installs, configs, the vault, process management and the node/client APIs
- `src/preload`: the small API the window is allowed to call
- `src/renderer`: the interface
- `src/shared`: types and logic used by both (sync stages, mining maths)

### Releasing

From a clean `main`, set the version. This commits it and tags `v<version>`:

```bash
npm version 0.2.0 -m "Release %s"
```

Then push the commit and the tag:

```bash
git push origin main v0.2.0
```

The Release workflow builds both platforms, writes `SHA256SUMS`, and opens a draft release with the installers and the
standing notes from [`.github/release-notes.md`](.github/release-notes.md). Fill in "What's new" and publish it. A tag
that doesn't match `package.json` fails the build, and a tag with a suffix (`v0.3.0-beta.1`) becomes a pre-release.

## License

[CC0 1.0 Universal](LICENSE)
