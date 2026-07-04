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

function showTab(tabName) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.add("hidden"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  $(`tab-${tabName}`).classList.remove("hidden");
  const navBtn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
  if (navBtn) navBtn.classList.add("active");
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
    const { player, currencies, data, inventory } = await api(`/api/admin/players/${playerId}`);

    $("detail-currencies").innerHTML = Object.entries(currencies).length
      ? Object.entries(currencies).map(([code, amt]) => `<div class="row-item"><span>${code}</span><span>${amt}</span></div>`).join("")
      : `<p style="color:var(--steel-400)">No currencies yet.</p>`;

    $("detail-inventory").innerHTML = inventory.length
      ? inventory.map((i) => `<div class="row-item"><span>${i.name} ×${i.quantity}</span><span style="color:var(--steel-400)">${i.instance_id.slice(0, 8)}</span></div>`).join("")
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
  } catch (e) {
    alert("Failed to load player: " + e.message);
  }
}

$("set-currency-btn").addEventListener("click", async () => {
  const code = $("set-currency-code").value.trim().toUpperCase();
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
$("catalog-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    item_id: $("item-id").value.trim(),
    name: $("item-name").value.trim(),
    description: $("item-desc").value.trim() || null,
    currency_code: $("item-currency").value.trim().toUpperCase(),
    price: parseInt($("item-price").value, 10),
    item_class: $("item-class").value.trim() || null,
    icon_url: $("item-icon").value.trim() || null,
  };
  try {
    await api("/api/admin/catalog", { method: "POST", body });
    alert(`Saved item: ${body.item_id}`);
    e.target.reset();
  } catch (err) {
    alert("Error: " + err.message);
  }
});
