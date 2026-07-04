# Fusion Backend — a custom game backend for Fusion Studios

A working, self-hosted alternative to PlayFab covering: player accounts/auth,
virtual currencies, cloud save, and an inventory/catalog/store system, plus an
admin dashboard.

**Important architectural note:** GitHub Pages only hosts static files — it
cannot run a database or server-side logic. So the split is:

- **`backend/`** → Flask + SQLite API. This is the real "PlayFab" — it must run
  on a real server. Deploy it to **Render** (same as your Discord bot).
- **`admin-dashboard/`** → static HTML/JS/CSS. This *does* go on **GitHub
  Pages**, and it talks to your Render backend over the network using your
  admin key.
- **`unity-scripts/`** → C# scripts for your Unity project that call the
  backend directly (not through GitHub Pages at all).

```
Unity Game  ──────────┐
                       ├──▶  Render (Flask + SQLite)  ◀── GitHub Pages (Admin Dashboard)
Admin Dashboard  ──────┘
```

---

## 1. Deploy the backend to Render

1. Push the `backend/` folder to a new GitHub repo (or a subfolder of an
   existing one).
2. In Render: **New → Web Service**, connect the repo.
3. Settings:
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `gunicorn app:app`
4. Add an environment variable:
   - `ADMIN_KEY` = a long random secret (used to authenticate the admin
     dashboard — treat it like a password). Generate one with:
     ```
     python3 -c "import secrets; print(secrets.token_hex(32))"
     ```
5. Deploy. Render will give you a URL like `https://fusion-backend.onrender.com`.
6. Sanity check: visit `https://fusion-backend.onrender.com/health` — you
   should see `{"status": "ok", ...}`.

Note: on Render's free tier the service sleeps after inactivity (same issue
you solved with UptimeRobot for the Discord bot) — set up the same ping if you
want it always warm.

**Data persistence warning:** Render's free tier filesystem is ephemeral —
the SQLite file can be wiped on redeploy. For a game with real players, either
upgrade to a paid Render disk (persistent disk add-on) or swap SQLite for a
managed Postgres database (Render offers this too). Fine for now while
testing; upgrade before shipping.

---

## 2. Deploy the admin dashboard to GitHub Pages

1. Put the `admin-dashboard/` folder's contents (`index.html`, `style.css`,
   `app.js`) into a repo — e.g. a new repo, or a `docs/` folder or separate
   branch of your existing `fusionstudiosvr.com` repo.
2. In that repo's Settings → Pages, set the source to the folder containing
   `index.html`.
3. Once published, open the dashboard URL, enter:
   - **Backend URL:** your Render URL (no trailing slash)
   - **Admin key:** the `ADMIN_KEY` you set in Render
4. You'll see all players, their currencies, inventory, and cloud save data,
   and can grant items/currency or ban accounts.

Keep the admin key private — anyone with it has full admin access to your
player data. Don't commit it into the dashboard's source code.

---

## 3. Wire up Unity

1. Copy all files from `unity-scripts/` into your Unity project, e.g.
   `Assets/FusionBackend/`.
2. Create an empty GameObject in your first/bootstrap scene, e.g.
   `BackendManager`, and attach:
   - `FusionAPIClient` — set `Backend Url` in the Inspector to your Render URL
   - `FusionAuthManager`
   - `FusionCurrencyManager`
   - `FusionCloudSaveManager`
   - `FusionInventoryManager`
3. Call `FusionAuthManager.Instance.Login(...)` once at startup (see
   `FusionBootstrapExample.cs`). This automatically creates a new PlayFab-style
   player ID (`FLY-XXXXXXXX`) the very first time the game runs on a device,
   and logs the same player back in on every subsequent launch.
4. From anywhere in your game, call:
   - `FusionCurrencyManager.Instance.AddCurrency(...)` / `SubtractCurrency(...)`
   - `FusionInventoryManager.Instance.GetCatalog(...)` / `PurchaseItem(...)` / `GetInventory(...)`
   - `FusionCloudSaveManager.Instance.SaveValue(...)` / `LoadAll(...)`

All calls are async (coroutine-based) and take `onSuccess`/`onError`
callbacks — nothing blocks the main thread.

---

## 4. Adding catalog items

Items must exist in the catalog before players can buy or be granted them.
Add them from the admin dashboard's **Catalog** tab (e.g. `item_id: sword_iron`,
`currency_code: GOLD`, `price: 250`).

---

## Security notes (read before going live)

- Currency add/subtract endpoints currently trust the client-authenticated
  player call directly — fine for testing, but for a real economy you should
  move reward-granting logic (e.g. "player killed an NPC, give 10 gold") into
  server-side endpoints that Unity calls with a specific action ID, rather
  than letting the client say "give me 10 gold" directly. Otherwise a
  modified client could grant itself currency. I can help build that
  server-authoritative layer next if you want it.
- Rotate `ADMIN_KEY` if it's ever exposed (e.g. accidentally committed).
- This is a solid foundation but is not a drop-in PlayFab replacement for
  matchmaking, multiplayer server hosting, or CloudScript — those are much
  larger systems. Happy to scope any of those next if you need them.
