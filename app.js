// Fusion Backend Admin Dashboard
// Stores backend URL + admin key in memory only (not localStorage, so re-enter each session).

let state = {
  backendUrl: "",
  adminKey: "",
  currentPlayerId: null,
};

const $ = (id) => document.getElementById(id);

async function api(path, { method = "GET", body = null } = {}) {
  const res = await fetch(`${state.backendUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": state.adminKey,
    },
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---- Login ----
$("connect-btn").addEventListener("click", async () => {
  const url = $("backend-url").value.trim().replace(/\/$/, "");
  const key = $("admin-key").value.trim();
  $("login-error").textContent = "";

  if (!url || !key) {
    $("login-error").textContent = "Enter both backend URL and admin key.";
    return;
  }

  state.backendUrl = url;
  state.adminKey = key;

  try {
    await api("/api/admin/players");
    $("login-screen").classList.add("hidden");
    $("app-screen").classList.remove("hidden");
    loadPlayers();
  } catch (e) {
    $("login-error").textContent = "Connection failed: " + e.message;
  }
});

$("disconnect-btn").addEventListener("click", () => {
  state = { backendUrl: "", adminKey: "", currentPlayerId: null };
  $("app-screen").classList.add("hidden");
  $("login-screen").classList.remove("hidden");
  $("admin-key").value = "";
});

// ---- Tab navigation ----
document.querySelectorAll(".nav-btn[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab));
});
$("back-to-players").addEventListener("click", () => showTab("players"));
$("back-to-catalog").addEventListener("click", () => showTab("catalog"));

function showTab(tabName) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.add("hidden"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  $(`tab-${tabName}`).classList.remove("hidden");
  // Highlight the matching sidebar entry even for sub-pages like item-create
  const navMatch = tabName === "item-create" ? "catalog" : tabName;
  const navBtn = document.querySelector(`.nav-btn[data-tab="${navMatch}"]`);
  if (navBtn) navBtn.classList.add("active");

  if (tabName === "catalog") loadCatalog();
  if (tabName === "currencies") loadCurrencies();
  if (tabName === "item-create") populateCurrencyDropdown();
}

// ---- Players list ----
$("refresh-players").addEventListener("click", loadPlayers);

async function loadPlayers() {
  const tbody = document.querySelector("#players-table tbody");
  tbody.innerHTML = `<tr><td colspan="6">Loading…</td></tr>`;
  try {
    const { players } = await api("/api/admin/players");
    tbody.innerHTML = "";
    if (players.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">No players yet. They'll appear here after first game launch.</td></tr>`;
      return;
    }
    players.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><a class="player-id-link" data-id="${p.player_id}">${p.player_id}</a></td>
        <td>${p.display_name || "—"}</td>
        <td>${formatDate(p.created_at)}</td>
        <td>${formatDate(p.last_login)}</td>
        <td><span class="badge ${p.banned ? "badge-banned" : "badge-ok"}">${p.banned ? "Banned" : "Active"}</span></td>
        <td><button class="view-btn" data-id="${p.player_id}">View</button></td>
      `;
      tbody.appendChild(tr);
    });
    document.querySelectorAll(".player-id-link, .view-btn").forEach((el) => {
      el.addEventListener("click", () => openPlayerDetail(el.dataset.id));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6">Error: ${e.message}</td></tr>`;
  }
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

// ---- Player detail ----
async function openPlayerDetail(playerId) {
  state.currentPlayerId = playerId;
  $("detail-nav").style.display = "block";
  showTab("player-detail");
  $("detail-title").textContent = `Player — ${playerId}`;

  try {
    await populateSetCurrencyDropdown();
    const { player, currencies, data, inventory } = await api(`/api/admin/players/${playerId}`);

    $("detail-currencies").innerHTML = Object.entries(currencies).length
      ? Object.entries(currencies).map(([code, amt]) => `<div class="row-item"><span>${code}</span><span>${amt}</span></div>`).join("")
      : `<p style="color:var(--steel-400)">No currencies yet.</p>`;

    $("detail-inventory").innerHTML = inventory.length
      ? inventory.map((i) => `
          <div class="row-item">
            <span>${i.name} ×${i.quantity}</span>
            <button class="small-btn revoke-item-btn" data-instance="${i.instance_id}">Revoke</button>
          </div>`).join("")
      : `<p style="color:var(--steel-400)">No items yet.</p>`;

    $("detail-data").textContent = Object.keys(data).length ? JSON.stringify(data, null, 2) : "// no cloud save data yet";

    $("detail-account").innerHTML = `
      <div class="row-item"><span>Device ID</span><span>${player.device_id.slice(0, 12)}…</span></div>
      <div class="row-item"><span>Created</span><span>${formatDate(player.created_at)}</span></div>
      <div class="row-item"><span>Last login</span><span>${formatDate(player.last_login)}</span></div>
    `;
    const banBtn = $("ban-toggle-btn");
    banBtn.textContent = player.banned ? "Unban Player" : "Ban Player";
    banBtn.style.background = player.banned ? "var(--ok)" : "var(--danger)";
    banBtn.style.color = "#fff";
    banBtn.style.width = "100%";
    banBtn.style.padding = "10px";
    banBtn.style.marginTop = "8px";
    banBtn.onclick = async () => {
      await api(`/api/admin/players/${playerId}/ban`, { method: "POST", body: { banned: !player.banned } });
      openPlayerDetail(playerId);
    };

    // Wire up per-item revoke buttons
    document.querySelectorAll(".revoke-item-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Revoke this item from the player? This cannot be undone.")) return;
        try {
          await api(`/api/admin/players/${playerId}/inventory/${btn.dataset.instance}`, { method: "DELETE" });
          openPlayerDetail(playerId);
        } catch (e) {
          alert("Error: " + e.message);
        }
      });
    });
  } catch (e) {
    alert("Failed to load player: " + e.message);
  }
}

$("delete-account-btn").addEventListener("click", async () => {
  const playerId = state.currentPlayerId;
  if (!confirm(`Permanently delete account ${playerId}? This deletes all their data, currency, and inventory. This cannot be undone.`)) return;
  try {
    await api(`/api/admin/players/${playerId}`, { method: "DELETE" });
    showTab("players");
    loadPlayers();
  } catch (e) {
    alert("Error: " + e.message);
  }
});

async function populateSetCurrencyDropdown() {
  const select = $("set-currency-code");
  select.innerHTML = `<option value="">Loading…</option>`;
  try {
    const { currencies } = await api("/api/currencies");
    select.innerHTML = currencies.length
      ? currencies.map((c) => `<option value="${c.code}">${c.name} (${c.code})</option>`).join("")
      : `<option value="">No currencies yet — create one in the Currency tab</option>`;
  } catch (e) {
    select.innerHTML = `<option value="">Failed to load</option>`;
  }
}

$("set-currency-btn").addEventListener("click", async () => {
  const code = $("set-currency-code").value;
  const amount = parseInt($("set-currency-amount").value, 10);
  if (!code || isNaN(amount)) return alert("Enter a currency code and amount.");
  try {
    await api(`/api/admin/players/${state.currentPlayerId}/currency`, { method: "POST", body: { currency_code: code, amount } });
    $("set-currency-code").value = "";
    $("set-currency-amount").value = "";
    openPlayerDetail(state.currentPlayerId);
  } catch (e) {
    alert("Error: " + e.message);
  }
});

$("grant-item-btn").addEventListener("click", async () => {
  const itemId = $("grant-item-id").value.trim();
  const qty = parseInt($("grant-quantity").value, 10) || 1;
  if (!itemId) return alert("Enter an item_id.");
  try {
    await api(`/api/admin/players/${state.currentPlayerId}/inventory/grant`, { method: "POST", body: { item_id: itemId, quantity: qty } });
    $("grant-item-id").value = "";
    openPlayerDetail(state.currentPlayerId);
  } catch (e) {
    alert("Error: " + e.message);
  }
});

// ---- Catalog ----
$("new-item-btn").addEventListener("click", () => showTab("item-create"));

async function loadCatalog() {
  const tbody = document.querySelector("#catalog-table tbody");
  tbody.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;
  try {
    const { catalog } = await api("/api/catalog");
    tbody.innerHTML = "";
    if (catalog.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">No items yet. Click "+ New Item" to add one.</td></tr>`;
      return;
    }
    catalog.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.item_id}</td>
        <td>${item.name}</td>
        <td>${item.item_class || "—"}</td>
        <td>${item.price} ${item.currency_code}</td>
        <td><button class="small-btn delete-catalog-btn" data-id="${item.item_id}">Delete</button></td>
      `;
      tbody.appendChild(tr);
    });
    document.querySelectorAll(".delete-catalog-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`Delete catalog item "${btn.dataset.id}"? Existing player inventories keep the item; only future purchases/grants are affected.`)) return;
        try {
          await api(`/api/admin/catalog/${btn.dataset.id}`, { method: "DELETE" });
          loadCatalog();
        } catch (e) {
          alert("Error: " + e.message);
        }
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5">Error: ${e.message}</td></tr>`;
  }
}

async function populateCurrencyDropdown() {
  const select = $("item-currency");
  select.innerHTML = `<option value="">Loading currencies…</option>`;
  try {
    const { currencies } = await api("/api/currencies");
    if (currencies.length === 0) {
      select.innerHTML = `<option value="">No currencies yet — create one in the Currency tab first</option>`;
      return;
    }
    select.innerHTML = currencies.map((c) => `<option value="${c.code}">${c.name} (${c.code})</option>`).join("");
  } catch (e) {
    select.innerHTML = `<option value="">Failed to load currencies</option>`;
  }
}

$("catalog-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("catalog-form-error").textContent = "";
  const body = {
    item_id: $("item-id").value.trim(),
    name: $("item-name").value.trim(),
    description: $("item-desc").value.trim() || null,
    currency_code: $("item-currency").value,
    price: parseInt($("item-price").value, 10),
    item_class: $("item-class").value.trim() || null,
    icon_url: $("item-icon").value.trim() || null,
  };
  if (!body.currency_code) {
    $("catalog-form-error").textContent = "Select a currency (create one first if the list is empty).";
    return;
  }
  try {
    await api("/api/admin/catalog", { method: "POST", body });
    e.target.reset();
    showTab("catalog");
  } catch (err) {
    $("catalog-form-error").textContent = "Error: " + err.message;
  }
});

// ---- Currencies ----
async function loadCurrencies() {
  const tbody = document.querySelector("#currency-table tbody");
  tbody.innerHTML = `<tr><td colspan="3">Loading…</td></tr>`;
  try {
    const { currencies } = await api("/api/currencies");
    tbody.innerHTML = "";
    if (currencies.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3">No currencies yet. Create one below.</td></tr>`;
      return;
    }
    currencies.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.code}</td>
        <td>${c.name}</td>
        <td><button class="small-btn delete-currency-btn" data-code="${c.code}">Delete</button></td>
      `;
      tbody.appendChild(tr);
    });
    document.querySelectorAll(".delete-currency-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`Delete currency "${btn.dataset.code}"? Catalog items or player balances using it will keep referencing a currency that no longer exists.`)) return;
        try {
          await api(`/api/admin/currencies/${btn.dataset.code}`, { method: "DELETE" });
          loadCurrencies();
        } catch (e) {
          alert("Error: " + e.message);
        }
      });
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3">Error: ${e.message}</td></tr>`;
  }
}

$("currency-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("currency-form-error").textContent = "";
  const code = $("new-currency-code").value.trim().toUpperCase();
  const name = $("new-currency-name").value.trim();
  if (!code || !name) {
    $("currency-form-error").textContent = "Both code and name are required.";
    return;
  }
  try {
    await api("/api/admin/currencies", { method: "POST", body: { code, name } });
    e.target.reset();
    loadCurrencies();
  } catch (err) {
    $("currency-form-error").textContent = "Error: " + err.message;
  }
});
