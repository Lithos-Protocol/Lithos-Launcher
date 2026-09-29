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
- **Creates or restores the wallet**, with a seed phrase screen that asks you to confirm three words and is hidden from
  screen capture while it is shown. It can also use an existing node keystore file: the launcher copies it into the
  node's wallet folder and the node checks its password.
- **Shows sync progress** (headers, blocks, index) with a time estimate, and starts the Lithos Client by itself once the
  node is ready.
- **Helps you mine:** picks a starting difficulty from your hashrate using the same formulas as the client's Difficulty
  page, explains the on-chain commitment before you opt in, and shows connected rigs, hashrate and super shares.
- **Streams the node's and client's console output** in tabs.
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
- The window runs sandboxed with context isolation, a strict content security policy and no navigation. Packaged builds
  disable `RunAsNode`, `NODE_OPTIONS` and inspector flags, and verify the app archive's integrity.

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
exists only if you change the install folder, memory sizes, or import a setup.

## Requirements

- Windows 10/11 or a desktop Linux (x64)
- About 8 GB of RAM for the node and client together
- Disk space for the chain: tens of GB, growing over time
- A GPU miner that supports Autolykos 2 (for example [SOAT Miner](https://github.com/blindrun/soat-miner))

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
| `npm run icons` | Re-render the app and tray icons from the cube SVG |

The code is Electron + TypeScript + Svelte 5, bundled with electron-vite:

- `src/main`: installs, configs, the vault, process management and the node/client APIs
- `src/preload`: the small API the window is allowed to call
- `src/renderer`: the interface
- `src/shared`: types and logic used by both (sync stages, mining maths)

## License

[CC0 1.0 Universal](LICENSE)
