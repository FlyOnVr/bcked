"""
Fusion Backend - a lightweight PlayFab-style game backend.
Covers: player auth/ID creation, virtual currencies, player data (cloud save),
inventory/catalog/store, and an admin API for the dashboard.

Deploy target: Render (Flask + SQLite), same pattern as the Discord bot.
"""

import os
import sqlite3
import secrets
import string
import json
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, request, jsonify, g
from flask_cors import CORS

app = Flask(__name__)

# CORS: allow your GitHub Pages admin dashboard + your game (Unity uses UnityWebRequest,
# not a browser, so CORS doesn't apply there, but we still allow it for safety)
CORS(app)

DB_PATH = os.environ.get("DB_PATH", "fusion_backend.db")

# Set this in Render's environment variables. NEVER hardcode this in a public repo.
ADMIN_KEY = os.environ.get("ADMIN_KEY", "change-me-immediately")


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS players (
            player_id TEXT PRIMARY KEY,
            device_id TEXT UNIQUE NOT NULL,
            session_token TEXT NOT NULL,
            display_name TEXT,
            created_at TEXT NOT NULL,
            last_login TEXT NOT NULL,
            banned INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS currencies (
            player_id TEXT NOT NULL,
            currency_code TEXT NOT NULL,
            amount INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (player_id, currency_code),
            FOREIGN KEY (player_id) REFERENCES players(player_id)
        );

        CREATE TABLE IF NOT EXISTS player_data (
            player_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (player_id, key),
            FOREIGN KEY (player_id) REFERENCES players(player_id)
        );

        CREATE TABLE IF NOT EXISTS catalog (
            item_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            currency_code TEXT NOT NULL,
            price INTEGER NOT NULL,
            icon_url TEXT,
            item_class TEXT,
            custom_data TEXT
        );

        CREATE TABLE IF NOT EXISTS inventory (
            instance_id TEXT PRIMARY KEY,
            player_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            custom_data TEXT,
            acquired_at TEXT NOT NULL,
            FOREIGN KEY (player_id) REFERENCES players(player_id),
            FOREIGN KEY (item_id) REFERENCES catalog(item_id)
        );
        """
    )
    conn.commit()
    conn.close()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_player_id():
    # PlayFab-style short ID, e.g. FLY-7F3K9QZ2
    alphabet = string.ascii_uppercase + string.digits
    suffix = "".join(secrets.choice(alphabet) for _ in range(8))
    return f"FLY-{suffix}"


def new_token():
    return secrets.token_hex(24)


def new_instance_id():
    return secrets.token_hex(12)


# ---------------------------------------------------------------------------
# Auth decorators
# ---------------------------------------------------------------------------

def require_player(f):
    """Requires a valid Bearer session token, injects player_id into kwargs."""

    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing bearer token"}), 401
        token = auth.split(" ", 1)[1]
        db = get_db()
        row = db.execute(
            "SELECT * FROM players WHERE session_token = ?", (token,)
        ).fetchone()
        if not row:
            return jsonify({"error": "Invalid session token"}), 401
        if row["banned"]:
            return jsonify({"error": "This account is banned"}), 403
        return f(player=row, *args, **kwargs)

    return wrapper


def require_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        key = request.headers.get("X-Admin-Key", "")
        if not secrets.compare_digest(key, ADMIN_KEY):
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# Auth / player creation
# ---------------------------------------------------------------------------

@app.route("/api/auth/login", methods=["POST"])
def login():
    """
    Called by Unity on game start. If the device_id has never been seen,
    a new PlayFab-style player ID is created automatically.
    """
    body = request.get_json(force=True, silent=True) or {}
    device_id = body.get("device_id")
    display_name = body.get("display_name")

    if not device_id:
        return jsonify({"error": "device_id is required"}), 400

    db = get_db()
    row = db.execute(
        "SELECT * FROM players WHERE device_id = ?", (device_id,)
    ).fetchone()

    is_new = False
    if row is None:
        player_id = new_player_id()
        token = new_token()
        db.execute(
            """INSERT INTO players
               (player_id, device_id, session_token, display_name, created_at, last_login, banned)
               VALUES (?, ?, ?, ?, ?, ?, 0)""",
            (player_id, device_id, token, display_name, now_iso(), now_iso()),
        )
        # starter currency grant
        db.execute(
            "INSERT INTO currencies (player_id, currency_code, amount) VALUES (?, 'GOLD', 100)",
            (player_id,),
        )
        db.commit()
        is_new = True
        row = db.execute(
            "SELECT * FROM players WHERE player_id = ?", (player_id,)
        ).fetchone()
    else:
        # refresh session token + last_login on every login
        token = new_token()
        db.execute(
            "UPDATE players SET session_token = ?, last_login = ? WHERE player_id = ?",
            (token, now_iso(), row["player_id"]),
        )
        db.commit()

    return jsonify(
        {
            "player_id": row["player_id"],
            "session_token": token,
            "display_name": row["display_name"],
            "is_new_player": is_new,
        }
    )


# ---------------------------------------------------------------------------
# Player data / cloud save
# ---------------------------------------------------------------------------

@app.route("/api/data", methods=["GET"])
@require_player
def get_data(player):
    db = get_db()
    rows = db.execute(
        "SELECT key, value FROM player_data WHERE player_id = ?", (player["player_id"],)
    ).fetchall()
    data = {r["key"]: json.loads(r["value"]) for r in rows}
    return jsonify({"data": data})


@app.route("/api/data", methods=["POST"])
@require_player
def set_data(player):
    body = request.get_json(force=True, silent=True) or {}
    data = body.get("data")
    if not isinstance(data, dict):
        return jsonify({"error": "Body must be {'data': {key: value, ...}}"}), 400

    db = get_db()
    for key, value in data.items():
        db.execute(
            """INSERT INTO player_data (player_id, key, value, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(player_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
            (player["player_id"], key, json.dumps(value), now_iso()),
        )
    db.commit()
    return jsonify({"success": True, "keys_updated": list(data.keys())})


# ---------------------------------------------------------------------------
# Currency
# ---------------------------------------------------------------------------

@app.route("/api/currency", methods=["GET"])
@require_player
def get_currency(player):
    db = get_db()
    rows = db.execute(
        "SELECT currency_code, amount FROM currencies WHERE player_id = ?",
        (player["player_id"],),
    ).fetchall()
    return jsonify({"currencies": {r["currency_code"]: r["amount"] for r in rows}})


def _adjust_currency(db, player_id, code, delta):
    row = db.execute(
        "SELECT amount FROM currencies WHERE player_id = ? AND currency_code = ?",
        (player_id, code),
    ).fetchone()
    current = row["amount"] if row else 0
    new_amount = current + delta
    if new_amount < 0:
        return None  # insufficient funds
    if row:
        db.execute(
            "UPDATE currencies SET amount = ? WHERE player_id = ? AND currency_code = ?",
            (new_amount, player_id, code),
        )
    else:
        db.execute(
            "INSERT INTO currencies (player_id, currency_code, amount) VALUES (?, ?, ?)",
            (player_id, code, new_amount),
        )
    db.commit()
    return new_amount


@app.route("/api/currency/add", methods=["POST"])
@require_player
def add_currency(player):
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("currency_code")
    amount = body.get("amount")
    if not code or not isinstance(amount, int) or amount <= 0:
        return jsonify({"error": "currency_code and positive integer amount required"}), 400
    db = get_db()
    new_amount = _adjust_currency(db, player["player_id"], code, amount)
    return jsonify({"currency_code": code, "amount": new_amount})


@app.route("/api/currency/subtract", methods=["POST"])
@require_player
def subtract_currency(player):
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("currency_code")
    amount = body.get("amount")
    if not code or not isinstance(amount, int) or amount <= 0:
        return jsonify({"error": "currency_code and positive integer amount required"}), 400
    db = get_db()
    new_amount = _adjust_currency(db, player["player_id"], code, -amount)
    if new_amount is None:
        return jsonify({"error": "Insufficient funds"}), 400
    return jsonify({"currency_code": code, "amount": new_amount})


# ---------------------------------------------------------------------------
# Catalog / Store / Inventory
# ---------------------------------------------------------------------------

@app.route("/api/catalog", methods=["GET"])
def get_catalog():
    db = get_db()
    rows = db.execute("SELECT * FROM catalog").fetchall()
    items = [
        {
            "item_id": r["item_id"],
            "name": r["name"],
            "description": r["description"],
            "currency_code": r["currency_code"],
            "price": r["price"],
            "icon_url": r["icon_url"],
            "item_class": r["item_class"],
            "custom_data": json.loads(r["custom_data"]) if r["custom_data"] else None,
        }
        for r in rows
    ]
    return jsonify({"catalog": items})


@app.route("/api/inventory", methods=["GET"])
@require_player
def get_inventory(player):
    db = get_db()
    rows = db.execute(
        """SELECT inventory.*, catalog.name, catalog.item_class
           FROM inventory JOIN catalog ON inventory.item_id = catalog.item_id
           WHERE inventory.player_id = ?""",
        (player["player_id"],),
    ).fetchall()
    items = [
        {
            "instance_id": r["instance_id"],
            "item_id": r["item_id"],
            "name": r["name"],
            "item_class": r["item_class"],
            "quantity": r["quantity"],
            "custom_data": json.loads(r["custom_data"]) if r["custom_data"] else None,
            "acquired_at": r["acquired_at"],
        }
        for r in rows
    ]
    return jsonify({"inventory": items})


@app.route("/api/store/purchase", methods=["POST"])
@require_player
def purchase(player):
    body = request.get_json(force=True, silent=True) or {}
    item_id = body.get("item_id")
    quantity = body.get("quantity", 1)
    if not item_id or not isinstance(quantity, int) or quantity <= 0:
        return jsonify({"error": "item_id and positive integer quantity required"}), 400

    db = get_db()
    item = db.execute("SELECT * FROM catalog WHERE item_id = ?", (item_id,)).fetchone()
    if not item:
        return jsonify({"error": "Item not found in catalog"}), 404

    total_cost = item["price"] * quantity
    new_balance = _adjust_currency(db, player["player_id"], item["currency_code"], -total_cost)
    if new_balance is None:
        return jsonify({"error": "Insufficient funds"}), 400

    instance_id = new_instance_id()
    db.execute(
        """INSERT INTO inventory (instance_id, player_id, item_id, quantity, custom_data, acquired_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (instance_id, player["player_id"], item_id, quantity, None, now_iso()),
    )
    db.commit()
    return jsonify(
        {
            "success": True,
            "instance_id": instance_id,
            "item_id": item_id,
            "quantity": quantity,
            "new_currency_balance": {item["currency_code"]: new_balance},
        }
    )


# ---------------------------------------------------------------------------
# Admin API (used by the GitHub Pages dashboard)
# ---------------------------------------------------------------------------

@app.route("/api/admin/players", methods=["GET"])
@require_admin
def admin_list_players():
    db = get_db()
    rows = db.execute(
        "SELECT player_id, device_id, display_name, created_at, last_login, banned FROM players ORDER BY created_at DESC"
    ).fetchall()
    return jsonify({"players": [dict(r) for r in rows]})


@app.route("/api/admin/players/<player_id>", methods=["GET"])
@require_admin
def admin_get_player(player_id):
    db = get_db()
    player = db.execute("SELECT * FROM players WHERE player_id = ?", (player_id,)).fetchone()
    if not player:
        return jsonify({"error": "Player not found"}), 404

    currencies = db.execute(
        "SELECT currency_code, amount FROM currencies WHERE player_id = ?", (player_id,)
    ).fetchall()
    data_rows = db.execute(
        "SELECT key, value FROM player_data WHERE player_id = ?", (player_id,)
    ).fetchall()
    inventory = db.execute(
        """SELECT inventory.*, catalog.name FROM inventory
           JOIN catalog ON inventory.item_id = catalog.item_id
           WHERE inventory.player_id = ?""",
        (player_id,),
    ).fetchall()

    return jsonify(
        {
            "player": {
                "player_id": player["player_id"],
                "device_id": player["device_id"],
                "display_name": player["display_name"],
                "created_at": player["created_at"],
                "last_login": player["last_login"],
                "banned": bool(player["banned"]),
            },
            "currencies": {r["currency_code"]: r["amount"] for r in currencies},
            "data": {r["key"]: json.loads(r["value"]) for r in data_rows},
            "inventory": [
                {
                    "instance_id": r["instance_id"],
                    "item_id": r["item_id"],
                    "name": r["name"],
                    "quantity": r["quantity"],
                    "acquired_at": r["acquired_at"],
                }
                for r in inventory
            ],
        }
    )


@app.route("/api/admin/players/<player_id>/currency", methods=["POST"])
@require_admin
def admin_set_currency(player_id):
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("currency_code")
    amount = body.get("amount")  # sets absolute amount
    if not code or not isinstance(amount, int) or amount < 0:
        return jsonify({"error": "currency_code and non-negative integer amount required"}), 400
    db = get_db()
    db.execute(
        """INSERT INTO currencies (player_id, currency_code, amount) VALUES (?, ?, ?)
           ON CONFLICT(player_id, currency_code) DO UPDATE SET amount = excluded.amount""",
        (player_id, code, amount),
    )
    db.commit()
    return jsonify({"success": True, "currency_code": code, "amount": amount})


@app.route("/api/admin/players/<player_id>/inventory/grant", methods=["POST"])
@require_admin
def admin_grant_item(player_id):
    body = request.get_json(force=True, silent=True) or {}
    item_id = body.get("item_id")
    quantity = body.get("quantity", 1)
    if not item_id:
        return jsonify({"error": "item_id required"}), 400
    db = get_db()
    item = db.execute("SELECT * FROM catalog WHERE item_id = ?", (item_id,)).fetchone()
    if not item:
        return jsonify({"error": "Item not found in catalog"}), 404
    instance_id = new_instance_id()
    db.execute(
        """INSERT INTO inventory (instance_id, player_id, item_id, quantity, custom_data, acquired_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (instance_id, player_id, item_id, quantity, None, now_iso()),
    )
    db.commit()
    return jsonify({"success": True, "instance_id": instance_id})


@app.route("/api/admin/players/<player_id>/ban", methods=["POST"])
@require_admin
def admin_ban_player(player_id):
    body = request.get_json(force=True, silent=True) or {}
    banned = 1 if body.get("banned", True) else 0
    db = get_db()
    db.execute("UPDATE players SET banned = ? WHERE player_id = ?", (banned, player_id))
    db.commit()
    return jsonify({"success": True, "banned": bool(banned)})


@app.route("/api/admin/catalog", methods=["POST"])
@require_admin
def admin_upsert_catalog_item():
    body = request.get_json(force=True, silent=True) or {}
    required = ["item_id", "name", "currency_code", "price"]
    if not all(k in body for k in required):
        return jsonify({"error": f"Required fields: {required}"}), 400
    db = get_db()
    db.execute(
        """INSERT INTO catalog (item_id, name, description, currency_code, price, icon_url, item_class, custom_data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(item_id) DO UPDATE SET
             name=excluded.name, description=excluded.description, currency_code=excluded.currency_code,
             price=excluded.price, icon_url=excluded.icon_url, item_class=excluded.item_class, custom_data=excluded.custom_data""",
        (
            body["item_id"],
            body["name"],
            body.get("description"),
            body["currency_code"],
            body["price"],
            body.get("icon_url"),
            body.get("item_class"),
            json.dumps(body["custom_data"]) if body.get("custom_data") else None,
        ),
    )
    db.commit()
    return jsonify({"success": True, "item_id": body["item_id"]})


@app.route("/api/admin/catalog/<item_id>", methods=["DELETE"])
@require_admin
def admin_delete_catalog_item(item_id):
    db = get_db()
    db.execute("DELETE FROM catalog WHERE item_id = ?", (item_id,))
    db.commit()
    return jsonify({"success": True})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "time": now_iso()})


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
else:
    # also run init_db when imported by gunicorn on Render
    init_db()
