(() => {
  "use strict";

  const base = String(window.SOLVELANG_ADMIN_GATEWAY_BASE || "").replace(/\/$/, "");
  let csrfToken = "";
  let customer = null;

  const $ = (id) => document.getElementById(id);
  const loginPanel = $("login-panel");
  const appPanel = $("app-panel");
  const customerPanel = $("customer");
  const loginError = $("login-error");
  const appError = $("app-error");

  async function request(path, { method = "GET", body, csrf = false } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(csrf ? { "x-solvelang-csrf": csrfToken } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({ error: "Invalid server response." }));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }

  function showSignedIn(signedIn) {
    loginPanel.classList.toggle("hidden", signedIn);
    appPanel.classList.toggle("hidden", !signedIn);
    if (!signedIn) {
      customerPanel.classList.add("hidden");
      customer = null;
      csrfToken = "";
    }
  }

  function identity() {
    if (!customer?.accountId) throw new Error("Load a customer first.");
    return { accountId: customer.accountId };
  }

  function fillCustomer(payload) {
    customer = payload;
    customerPanel.classList.remove("hidden");
    $("customer-json").textContent = JSON.stringify(payload, null, 2);
    const profile = payload.crm?.profile || {};
    $("crm-stage").value = profile.stage || "new";
    $("crm-priority").value = profile.priority || "normal";
    $("crm-owner").value = profile.owner || "";
    $("crm-company").value = profile.company || "";
    $("crm-summary").value = profile.summary || "";
    $("crm-next-action").value = profile.nextAction || "";
    $("termination-confirmation").placeholder = `TERMINATE ${payload.accountId}`;
  }

  async function reloadCustomer() {
    const params = new URLSearchParams({ accountId: customer.accountId });
    fillCustomer(await request(`/customers?${params}`));
  }

  async function mutate(path, body) {
    appError.textContent = "";
    await request(path, { method: "POST", body, csrf: true });
    await reloadCustomer();
  }

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    try {
      const result = await request("/session/login", { method: "POST", body: { password: $("password").value } });
      csrfToken = result.csrfToken;
      $("password").value = "";
      showSignedIn(true);
    } catch (error) {
      loginError.textContent = error.message;
    }
  });

  $("logout").addEventListener("click", async () => {
    try { await request("/session/logout", { method: "POST", body: {}, csrf: true }); } catch {}
    showSignedIn(false);
  });

  $("search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    appError.textContent = "";
    try {
      const params = new URLSearchParams({ [$("lookup-type").value]: $("lookup-value").value.trim() });
      fillCustomer(await request(`/customers?${params}`));
    } catch (error) {
      appError.textContent = error.message;
    }
  });

  for (const button of document.querySelectorAll("button[data-state]")) {
    button.addEventListener("click", async () => {
      try {
        const state = button.dataset.state;
        await mutate("/account-access", {
          accountId: identity().accountId,
          state,
          reason: $("access-reason").value.trim(),
          requestId: `admin-${state}-${Date.now()}`,
        });
      } catch (error) { appError.textContent = error.message; }
    });
  }

  $("terminate").addEventListener("click", async () => {
    try {
      await mutate("/account-access", {
        accountId: identity().accountId,
        state: "terminated",
        reason: $("access-reason").value.trim(),
        requestId: `admin-terminate-${Date.now()}`,
        confirmation: $("termination-confirmation").value.trim(),
      });
    } catch (error) { appError.textContent = error.message; }
  });

  $("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await mutate("/crm/profile", {
        identity: identity(),
        profile: {
          stage: $("crm-stage").value.trim(),
          priority: $("crm-priority").value.trim(),
          owner: $("crm-owner").value.trim(),
          company: $("crm-company").value.trim(),
          summary: $("crm-summary").value.trim(),
          nextAction: $("crm-next-action").value.trim(),
        },
      });
    } catch (error) { appError.textContent = error.message; }
  });

  $("note-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await mutate("/crm/notes", { identity: identity(), note: { text: $("note-body").value.trim() } });
      $("note-body").value = "";
    } catch (error) { appError.textContent = error.message; }
  });

  $("task-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const due = $("task-due").value;
      await mutate("/crm/tasks", {
        identity: identity(),
        task: { title: $("task-title").value.trim(), ...(due ? { dueAt: `${due}T23:59:59Z` } : {}) },
      });
      $("task-title").value = "";
      $("task-due").value = "";
    } catch (error) { appError.textContent = error.message; }
  });

  request("/session").then((session) => {
    csrfToken = session.csrfToken;
    showSignedIn(true);
  }).catch(() => showSignedIn(false));
})();
