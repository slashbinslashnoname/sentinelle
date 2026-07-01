# Getting started — from zero to your first invoice

This walks you through the three things Sentinelle needs:

1. a **watch-only xpub** (for on-chain payments) — we'll make one with Electrum,
2. a **phoenixd** node (for Lightning) — binary or Docker,
3. wiring them into Sentinelle at **`/admin`**.

You can do on-chain only, Lightning only, or both. Do the parts you want.

---

## 1. Generate a watch-only xpub with Electrum

Sentinelle only ever holds the **public** key (`xpub`/`ypub`/`zpub`), so it can
*receive* on-chain but can **never spend**. Your seed stays with you.

1. Install [Electrum](https://electrum.org/) and open it.
2. **File → New/Restore**, give the wallet a name → **Next**.
3. Choose **Standard wallet → Next**.
4. Choose **Create a new seed → Next**.
5. Keep the seed type as **SegWit** (the default) → **Next**.
6. **Write the 12-word seed down and keep it offline.** This is the only backup
   of your money. Confirm it → set a password → finish.
7. Open **Wallet → Information**.
8. Copy the **Master Public Key** — for a SegWit wallet it starts with **`zpub`**.
   That string is what you paste into Sentinelle.

> **Which prefix?** Electrum SegWit → `zpub` (native segwit, addresses `bc1…`).
> Sentinelle also accepts `ypub` (wrapped segwit, `3…`) and `xpub` (legacy `1…`),
> and the testnet forms `vpub`/`upub`/`tpub`. The prefix tells Sentinelle which
> address type to derive — just paste whatever Electrum shows.

> **Testnet?** Restore/create the Electrum wallet in testnet mode
> (`electrum --testnet`) to get a `vpub`, and run phoenixd on testnet (below).
> Mainnet keys and testnet nodes don't mix.

To **watch incoming payments** yourself, this same wallet in Electrum will show
each address Sentinelle hands out (Sentinelle derives `…/0/0`, `…/0/1`, … which
are exactly Electrum's receive addresses).

---

## 2. Set up phoenixd (Lightning)

[phoenixd](https://phoenix.acinq.co/server) is ACINQ's headless Lightning server.
It manages channels and liquidity for you — great for a shop.

### Option A — download & run the binary

```bash
wget https://github.com/ACINQ/phoenixd/releases/download/v0.8.0/phoenixd-0.8.0-linux-x64.zip
unzip -j phoenixd-0.8.0-linux-x64.zip

# run the daemon — that's it (first run creates a seed + config)
./phoenixd
```

Interact with it using `phoenix-cli`:

```bash
# basic info about your node
./phoenix-cli getinfo

# create a Lightning invoice
./phoenix-cli createinvoice --description "my first invoice" --amountSat 12345

# send to a bitcoin address
./phoenix-cli sendtoaddress \
  --address tb1q2qlmx0t2g33tjgujr8h53dxmypuf8qps9jnv8q \
  --amountSat 100000 \
  --feerateSatByte 12
```

On first start phoenixd writes `~/.phoenix/phoenix.conf` and prints two
passwords. You need the HTTP API one for Sentinelle:

```bash
grep http-password ~/.phoenix/phoenix.conf
# http-password=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx           <- primary
# http-password-limited-access=yyyyyyyyyyyyyyyyyyyyyyyy    <- enough for Sentinelle
```

Sentinelle only **creates and reads invoices**, so the **limited-access** password
is sufficient (and safer). phoenixd listens on `http://127.0.0.1:9740` by default.

> **Testnet:** run `./phoenixd --chain testnet`.

### Option B — Docker

Run phoenixd in a container and persist its data (seed + config) on a volume:

```yaml
# phoenixd.compose.yml
services:
  phoenixd:
    image: acinq/phoenixd:0.8.0        # if unavailable, build from the phoenixd repo
    command: ["--http-bind-ip", "0.0.0.0"]   # so other containers can reach it
    ports:
      - "9740:9740"
    volumes:
      - phoenix-data:/phoenix/.phoenix
volumes:
  phoenix-data:
```

```bash
docker compose -f phoenixd.compose.yml up -d
# read the API password out of the container's config:
docker compose -f phoenixd.compose.yml exec phoenixd \
  sh -c 'grep http-password /phoenix/.phoenix/phoenix.conf'
```

> If Sentinelle also runs in Docker on the same network, point its `phoenixd_url`
> at `http://phoenixd:9740` (the service name) instead of `127.0.0.1`.

Fund the node by receiving a Lightning payment or splicing in on-chain — see the
[phoenixd docs](https://phoenix.acinq.co/server) for liquidity details.

---

## 3. Configure Sentinelle at /admin

Start Sentinelle (`pnpm dev`, `pnpm start`, or the Docker image — see the
[README](../README.md)), then open **http://localhost:8080/admin**.

1. **Create your first credentials.** On the very first visit you'll see a
   **Register** screen — choose an admin password. (After that it's login-only;
   there is no password in `.env`.)
2. **Configure your Bitcoin xpub.** Go to **Settings → Bitcoin (on-chain)** and
   paste the **`zpub`** Electrum gave you. Click **Validate xpub** — it should
   report the script type, network, and the first address (compare it with
   Electrum's first receive address to be 100% sure).
3. **Point to your phoenixd instance.** Go to **Settings → Lightning (phoenixd)**:
   - **phoenixd URL:** `http://127.0.0.1:9740` (or `http://phoenixd:9740` in Docker).
   - **phoenixd password:** the `http-password-limited-access` from `phoenix.conf`.
   - Click **Test phoenixd connection** — it should print your node id.
4. (Optional) **Settings → Block explorer / Rates / Notifications** — the explorer
   and live rates default to `mempool.space`; set SMTP if you want email alerts.
5. **Create an API key.** Go to **API keys → Create key**. Copy it once; your shop
   sends it as the `x-api-key` header.
6. Open the **LLM integration** tab to copy a ready-made integration guide, or see
   [`docs/LLM.md`](LLM.md).

You're live. Create a test invoice:

```bash
curl -X POST http://localhost:8080/api/invoices \
  -H 'x-api-key: snl_your_key' -H 'content-type: application/json' \
  -d '{ "amount": "1.00", "currency": "EUR", "description": "Test order" }'
```

The response contains an on-chain `address`, a Lightning `invoice`, `expiresAt`,
and the operator's `paymentPolicy`. Pay it from any wallet and watch the
**Dashboard** (or a `ws /ws?invoice=<id>` stream) flip it to **paid**.

---

## Troubleshooting

- **On-chain says “disabled”.** No xpub saved — set it in Settings → Bitcoin.
- **`Test phoenixd` fails.** Check the URL/port and that the password is the one
  from `phoenix.conf`; make sure phoenixd is running (`./phoenix-cli getinfo`).
- **Validated address doesn't match Electrum.** You likely pasted a key of a
  different account or script type — re-copy the **Master Public Key** from
  Electrum's **Wallet → Information**.
- **Testnet vs mainnet mismatch.** A `vpub` (testnet) needs phoenixd on
  `--chain testnet`; a `zpub` (mainnet) needs mainnet phoenixd.
