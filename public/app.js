const MAX_LETTER_BYTES = 45 * 1024 * 1024;

/** @typedef {{ fileName: string, mimeType: string }} LetterAttachmentMeta */

/** @typedef {{
 *  id: string,
 *  requestLetterText: string,
 *  requestLetterAttachment: LetterAttachmentMeta | null,
 *  requestDate: string,
 *  emailSent: boolean,
 *  project: string,
 *  transporter: string,
 *  vehicleNo: string,
 *  gpsInstalled: boolean,
 *  installationDate: string,
 *  imei: string,
 *  signature: string,
 *  deregisterLetterText: string,
 *  deregisterLetterAttachment: LetterAttachmentMeta | null,
 *  removalRequestDate: string,
 *  deregistrationDate: string,
 *  gpsSubmitted: boolean,
 *  receivedBy: string,
 *  gpsKeptAt: string,
 *  portalUpdated: boolean
 * }} Record */

/** @typedef {'requestLetter' | 'deregisterLetter'} LetterSlot */

function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** @param {unknown} a */
function normalizeAttachmentMeta(a) {
  if (!a || typeof a !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (a);
  const fileName = o.fileName != null ? String(o.fileName) : "";
  const mimeType = o.mimeType != null ? String(o.mimeType) : "";
  if (!fileName || !mimeType) return null;
  return { fileName, mimeType };
}

/** @param {unknown} r */
function normalizeRecord(r) {
  const o = /** @type {Record<string, unknown>} */ (r && typeof r === "object" ? r : {});
  return {
    id: typeof o.id === "string" ? o.id : uid(),
    requestLetterText: String(o.requestLetterText ?? ""),
    requestLetterAttachment: normalizeAttachmentMeta(o.requestLetterAttachment),
    requestDate: String(o.requestDate ?? ""),
    emailSent: Boolean(o.emailSent),
    project: String(o.project ?? ""),
    transporter: String(o.transporter ?? ""),
    vehicleNo: String(o.vehicleNo ?? ""),
    gpsInstalled: Boolean(o.gpsInstalled),
    installationDate: String(o.installationDate ?? ""),
    imei: String(o.imei ?? ""),
    signature: String(o.signature ?? ""),
    deregisterLetterText: String(o.deregisterLetterText ?? ""),
    deregisterLetterAttachment: normalizeAttachmentMeta(o.deregisterLetterAttachment),
    removalRequestDate: String(o.removalRequestDate ?? ""),
    deregistrationDate: String(o.deregistrationDate ?? ""),
    gpsSubmitted: Boolean(o.gpsSubmitted),
    receivedBy: String(o.receivedBy ?? ""),
    gpsKeptAt: String(o.gpsKeptAt ?? ""),
    portalUpdated: Boolean(o.portalUpdated),
  };
}

function formatDate(s) {
  if (!s) return "—";
  const d = new Date(s + "T12:00:00");
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function yesNo(v) {
  return v
    ? '<span class="badge badge--yes">Yes</span>'
    : '<span class="badge badge--no">No</span>';
}

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/** @param {File} file */
function isAllowedLetterFile(file) {
  if (file.type === "application/pdf") return true;
  if (file.type.startsWith("image/")) return true;
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) return true;
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp|tif{1,2})$/i.test(n);
}

/** @type {Record[]} */
let records = [];
let currentUser = null;
let editingId = null;
/** @type {Record | null} */
let modalContextRec = null;

let sortField = "createdAt";
let sortAsc = true;

/** @type {{ requestLetter: File | null, deregisterLetter: File | null }} */
const pendingFiles = { requestLetter: null, deregisterLetter: null };
/** @type {{ requestLetter: boolean, deregisterLetter: boolean }} */
const removeAttachment = { requestLetter: false, deregisterLetter: false };

const authPanel = document.getElementById("authPanel");
const mainApp = document.getElementById("mainApp");
const authError = document.getElementById("authError");
const headerUser = document.getElementById("headerUser");
const formLogin = document.getElementById("formLogin");
const btnManageUsers = document.getElementById("btnManageUsers");
const btnChangePassword = document.getElementById("btnChangePassword");

const tbody = document.getElementById("tbody");
const tbodyProjectsPage = document.getElementById("tbodyProjectsPage");
const tbodyTransportersPage = document.getElementById("tbodyTransportersPage");
const emptyState = document.getElementById("emptyState");
const search = document.getElementById("search");
const modal = document.getElementById("modal");
const form = document.getElementById("form");
const modalTitle = document.getElementById("modalTitle");
const projectList = document.getElementById("projectList");
const transporterList = document.getElementById("transporterList");

const statInstalled = document.getElementById("statInstalled");
const statInStock = document.getElementById("statInStock");
const statUnderRecovery = document.getElementById("statUnderRecovery");

const navButtons = document.querySelectorAll(".nav-btn");
const pages = document.querySelectorAll(".page");

function navigate(pageId) {
  pages.forEach(p => p.hidden = p.id !== pageId);
  navButtons.forEach(btn => {
    btn.classList.toggle("nav-btn--active", btn.dataset.nav === pageId);
  });
  
  // Update stats if going home
  if (pageId === "pageHome") updateStats();
  
  // Manage visibility of header actions
  const appActions = document.getElementById("appActions");
  appActions.hidden = pageId === "pageHome" || pageId === "pageProjects" || pageId === "pageTransporters";
}

navButtons.forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.nav));
});

/** @type {Record<string, Record<string, number>>} */
let statBreakdown = { installed: {}, inStock: {}, underRecovery: {} };

function updateStats() {
  const installedRecs = records.filter(r => r.gpsInstalled && !r.gpsSubmitted);
  const inStockRecs = records.filter(r => r.gpsSubmitted);
  const underRecoveryRecs = records.filter(r => (r.deregisterLetterText || r.deregisterLetterAttachment) && !r.portalUpdated);

  statInstalled.textContent = installedRecs.length;
  statInStock.textContent = inStockRecs.length;
  statUnderRecovery.textContent = underRecoveryRecs.length;

  // Calculate breakdown
  statBreakdown = { installed: {}, inStock: {}, underRecovery: {} };
  installedRecs.forEach(r => {
    const p = r.project || "UNASSIGNED";
    statBreakdown.installed[p] = (statBreakdown.installed[p] || 0) + 1;
  });
  inStockRecs.forEach(r => {
    const p = r.project || "UNASSIGNED";
    statBreakdown.inStock[p] = (statBreakdown.inStock[p] || 0) + 1;
  });
  underRecoveryRecs.forEach(r => {
    const p = r.project || "UNASSIGNED";
    statBreakdown.underRecovery[p] = (statBreakdown.underRecovery[p] || 0) + 1;
  });
}

const modalStatDetail = document.getElementById("modalStatDetail");
const tbodyStatDetail = document.getElementById("tbodyStatDetail");
const statDetailTotal = document.getElementById("statDetailTotal");
const modalStatDetailTitle = document.getElementById("modalStatDetailTitle");
const btnModalStatDetailClose = document.getElementById("btnModalStatDetailClose");

document.querySelectorAll(".stat-card").forEach(card => {
  card.style.cursor = "pointer";
  card.addEventListener("click", () => {
    const type = card.dataset.stat;
    const label = card.querySelector(".stat-card__label").textContent;
    showStatDetail(type, label);
  });
});

function showStatDetail(type, title) {
  const data = statBreakdown[type] || {};
  modalStatDetailTitle.textContent = title + " (Project-wise)";
  tbodyStatDetail.innerHTML = "";
  let total = 0;
  
  const sortedProjects = Object.keys(data).sort();
  sortedProjects.forEach(p => {
    const count = data[p];
    total += count;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(p)}</td><td style="text-align:right">${count}</td>`;
    tbodyStatDetail.appendChild(tr);
  });
  
  statDetailTotal.textContent = total;
  modalStatDetail.showModal();
}

btnModalStatDetailClose?.addEventListener("click", () => modalStatDetail.close());

const modalBulkAdd = document.getElementById("modalBulkAdd");
const formBulkAdd = document.getElementById("formBulkAdd");
const btnBulkAddOpen = document.getElementById("btnBulkAddOpen");
const btnModalBulkAddCancel = document.getElementById("btnModalBulkAddCancel");

btnBulkAddOpen?.addEventListener("click", () => {
  formBulkAdd.reset();
  modalBulkAdd.showModal();
});

btnModalBulkAddCancel?.addEventListener("click", () => modalBulkAdd.close());

formBulkAdd?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(formBulkAdd);
  const body = {
    count: parseInt(fd.get("count")),
    project: fd.get("project"),
    transporter: fd.get("transporter"),
    imeiPrefix: fd.get("imeiPrefix"),
    startImei: fd.get("startImei")
  };
  
  try {
    const res = await fetch("/api/records/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include"
    });
    
    if (res.ok) {
      modalBulkAdd.close();
      await fetchRecords();
    } else {
      const j = await res.json();
      alert(j.error || "Bulk add failed");
    }
  } catch {
    alert("Network error");
  }
});

const requestLetterFileInput = /** @type {HTMLInputElement} */ (document.getElementById("requestLetterFileInput"));
const deregisterLetterFileInput = /** @type {HTMLInputElement} */ (document.getElementById("deregisterLetterFileInput"));
const requestLetterFileStatus = document.getElementById("requestLetterFileStatus");
const deregisterLetterFileStatus = document.getElementById("deregisterLetterFileStatus");
const btnViewRequestLetterFile = document.getElementById("btnViewRequestLetterFile");
const btnRemoveRequestLetterFile = document.getElementById("btnRemoveRequestLetterFile");
const btnViewDeregisterLetterFile = document.getElementById("btnViewDeregisterLetterFile");
const btnRemoveDeregisterLetterFile = document.getElementById("btnRemoveDeregisterLetterFile");

const modalUsers = document.getElementById("modalUsers");
const tbodyUsers = document.getElementById("tbodyUsers");
const btnModalUsersClose = document.getElementById("btnModalUsersClose");
const btnAddUser = document.getElementById("btnAddUser");

const modalUserEdit = document.getElementById("modalUserEdit");
const formUserEdit = document.getElementById("formUserEdit");
const modalUserEditTitle = document.getElementById("modalUserEditTitle");
const btnModalUserEditCancel = document.getElementById("btnModalUserEditCancel");

// Project Management Elements
const modalProjects = document.getElementById("modalProjects");
const tbodyProjects = document.getElementById("tbodyProjects");
const btnModalProjectsClose = document.getElementById("btnModalProjectsClose");
const btnAddProject = document.getElementById("btnAddProject");
const btnAddProjectPage = document.getElementById("btnAddProjectPage");

const modalProjectEdit = document.getElementById("modalProjectEdit");
const formProjectEdit = document.getElementById("formProjectEdit");
const modalProjectEditTitle = document.getElementById("modalProjectEditTitle");
const btnModalProjectEditCancel = document.getElementById("btnModalProjectEditCancel");

// Transporter Management Elements
const modalTransporters = document.getElementById("modalTransporters");
const tbodyTransporters = document.getElementById("tbodyTransporters");
const btnModalTransportersClose = document.getElementById("btnModalTransportersClose");
const btnAddTransporter = document.getElementById("btnAddTransporter");
const btnAddTransporterPage = document.getElementById("btnAddTransporterPage");

const modalTransporterEdit = document.getElementById("modalTransporterEdit");
const formTransporterEdit = document.getElementById("formTransporterEdit");
const modalTransporterEditTitle = document.getElementById("modalTransporterEditTitle");
const btnModalTransporterEditCancel = document.getElementById("btnModalTransporterEditCancel");

const modalPassword = document.getElementById("modalPassword");
const formPassword = document.getElementById("formPassword");
const btnModalPasswordCancel = document.getElementById("btnModalPasswordCancel");

function showAuth() {
  currentUser = null;
  authPanel.hidden = false;
  mainApp.hidden = true;
  formLogin.reset();
  setAuthError("");
}

function showApp(user) {
  currentUser = user;
  authPanel.hidden = true;
  mainApp.hidden = false;
  headerUser.textContent = `${user.username} (${user.role})`;
  
  const isAdmin = user.role === "admin";
  btnManageUsers.hidden = !isAdmin;
  document.querySelectorAll(".admin-only").forEach(el => el.hidden = !isAdmin);

  if (user.mustChangePassword) {
    alert("You must change your password before continuing.");
    btnModalPasswordCancel.hidden = true;
    formPassword.reset();
    modalPassword.showModal();
  } else {
    btnModalPasswordCancel.hidden = false;
  }
  
  navigate("pageHome");
}

function setAuthError(msg) {
  if (!msg) {
    authError.hidden = true;
    authError.textContent = "";
    return;
  }
  authError.hidden = false;
  authError.textContent = msg;
}

formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  setAuthError("");
  const fd = new FormData(formLogin);
  const body = { username: String(fd.get("username") || ""), password: String(fd.get("password") || "") };
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    setAuthError(j.error || "Login failed");
    return;
  }
  showApp(j.user);
  await fetchRecords();
  await fetchProjects();
  await fetchTransporters();
});

document.getElementById("btnLogout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  records = [];
  render();
  showAuth();
});

async function fetchRecords() {
  const res = await fetch("/api/records", { credentials: "include" });
  if (res.status === 401) {
    showAuth();
    return;
  }
  if (!res.ok) {
    alert("Could not load records.");
    return;
  }
  const j = await res.json();
  records = (j.records || []).map(normalizeRecord);
  render();
  updateStats();
}

// Project Management Logic
async function fetchProjects() {
  try {
    const res = await fetch("/api/projects", { credentials: "include" });
    if (!res.ok) return;
    const { projects } = await res.json();
    renderProjects(projects);
    updateProjectDatalist(projects);
  } catch (e) {
    console.error(e);
  }
}

function updateProjectDatalist(projects) {
  if (!projectList) return;
  projectList.innerHTML = "";
  projects.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.name;
    projectList.appendChild(opt);
  });
}

function renderProjects(projects) {
  const containers = [tbodyProjectsPage, tbodyProjects].filter(Boolean);
  containers.forEach(container => {
    container.innerHTML = "";
    projects.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(p.name)}</td>
        <td>${esc(p.details || "—")}</td>
        <td style="text-align:right">
          <div class="row-actions">
            <button class="btn btn--ghost btn--small btn-proj-edit" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-details="${esc(p.details || "")}">Edit</button>
            <button class="btn btn--danger btn--small btn-proj-del" data-id="${esc(p.id)}">Del</button>
          </div>
        </td>
      `;
      container.appendChild(tr);
    });
  });
}

btnAddProjectPage?.addEventListener("click", () => {
  editingProjectId = null;
  formProjectEdit.reset();
  modalProjectEditTitle.textContent = "Add Project";
  modalProjectEdit.showModal();
});

const projectClickHandlers = (e) => {
  const btnEdit = e.target.closest(".btn-proj-edit");
  const btnDel = e.target.closest(".btn-proj-del");
  
  if (btnEdit) {
    editingProjectId = btnEdit.dataset.id;
    formProjectEdit.name.value = btnEdit.dataset.name;
    formProjectEdit.details.value = btnEdit.dataset.details;
    modalProjectEditTitle.textContent = "Edit Project";
    modalProjectEdit.showModal();
  }
  
  if (btnDel) {
    if (confirm("Delete this project?")) {
      deleteProject(btnDel.dataset.id);
    }
  }
};

tbodyProjectsPage?.addEventListener("click", projectClickHandlers);
tbodyProjects?.addEventListener("click", projectClickHandlers);

btnModalProjectsClose?.addEventListener("click", () => modalProjects.close());

let editingProjectId = null;

btnAddProject?.addEventListener("click", () => {
  editingProjectId = null;
  formProjectEdit.reset();
  modalProjectEditTitle.textContent = "Add Project";
  modalProjectEdit.showModal();
});

btnModalProjectEditCancel.addEventListener("click", () => modalProjectEdit.close());

async function deleteProject(id) {
  try {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) fetchProjects();
    else {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Could not delete project");
    }
  } catch (e) {
    alert("Network error");
  }
}

formProjectEdit.addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = new FormData(formProjectEdit);
  const name = b.get("name");
  const details = b.get("details");
  
  const url = editingProjectId ? `/api/projects/${editingProjectId}` : "/api/projects";
  const method = editingProjectId ? "PUT" : "POST";
  
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, details }),
    });
    if (res.ok) {
      modalProjectEdit.close();
      fetchProjects();
    } else {
      const { error } = await res.json();
      alert(error || "Operation failed");
    }
  } catch {
    alert("Server error");
  }
});

// Transporter Management Logic
async function fetchTransporters() {
  try {
    const res = await fetch("/api/transporters", { credentials: "include" });
    if (!res.ok) return;
    const { transporters } = await res.json();
    renderTransporters(transporters);
    updateTransporterDatalist(transporters);
  } catch (e) {
    console.error(e);
  }
}

function updateTransporterDatalist(transporters) {
  if (!transporterList) return;
  transporterList.innerHTML = "";
  transporters.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.name;
    transporterList.appendChild(opt);
  });
}

function renderTransporters(transporters) {
  const containers = [tbodyTransportersPage, tbodyTransporters].filter(Boolean);
  containers.forEach(container => {
    container.innerHTML = "";
    transporters.forEach(t => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(t.name)}</td>
        <td>${esc(t.details || "—")}</td>
        <td style="text-align:right">
          <div class="row-actions">
            <button class="btn btn--ghost btn--small btn-trans-edit" data-id="${esc(t.id)}" data-name="${esc(t.name)}" data-details="${esc(t.details || "")}">Edit</button>
            <button class="btn btn--danger btn--small btn-trans-del" data-id="${esc(t.id)}">Del</button>
          </div>
        </td>
      `;
      container.appendChild(tr);
    });
  });
}

btnAddTransporterPage?.addEventListener("click", () => {
  editingTransporterId = null;
  formTransporterEdit.reset();
  modalTransporterEditTitle.textContent = "Add Transporter";
  modalTransporterEdit.showModal();
});

const transporterClickHandlers = (e) => {
  const btnEdit = e.target.closest(".btn-trans-edit");
  const btnDel = e.target.closest(".btn-trans-del");
  
  if (btnEdit) {
    editingTransporterId = btnEdit.dataset.id;
    formTransporterEdit.name.value = btnEdit.dataset.name;
    formTransporterEdit.details.value = btnEdit.dataset.details;
    modalTransporterEditTitle.textContent = "Edit Transporter";
    modalTransporterEdit.showModal();
  }
  
  if (btnDel) {
    if (confirm("Delete this transporter?")) {
      deleteTransporter(btnDel.dataset.id);
    }
  }
};

tbodyTransportersPage?.addEventListener("click", transporterClickHandlers);
tbodyTransporters?.addEventListener("click", transporterClickHandlers);

btnModalTransportersClose?.addEventListener("click", () => modalTransporters.close());

let editingTransporterId = null;

btnAddTransporter?.addEventListener("click", () => {
  editingTransporterId = null;
  formTransporterEdit.reset();
  modalTransporterEditTitle.textContent = "Add Transporter";
  modalTransporterEdit.showModal();
});

btnModalTransporterEditCancel.addEventListener("click", () => modalTransporterEdit.close());

async function deleteTransporter(id) {
  try {
    const res = await fetch(`/api/transporters/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) fetchTransporters();
    else {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Could not delete transporter");
    }
  } catch (e) {
    alert("Network error");
  }
}

formTransporterEdit.addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = new FormData(formTransporterEdit);
  const name = b.get("name");
  const details = b.get("details");
  
  const url = editingTransporterId ? `/api/transporters/${editingTransporterId}` : "/api/transporters";
  const method = editingTransporterId ? "PUT" : "POST";
  
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, details }),
    });
    if (res.ok) {
      modalTransporterEdit.close();
      fetchTransporters();
    } else {
      const { error } = await res.json();
      alert(error || "Operation failed");
    }
  } catch {
    alert("Server error");
  }
});

async function trySession() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.ok) {
    const j = await res.json();
    showApp(j.user);
    await fetchRecords();
    await fetchProjects();
    await fetchTransporters();
  } else {
    showAuth();
  }
}

// User Management Logic
btnManageUsers.addEventListener("click", () => {
  fetchUsers();
  modalUsers.showModal();
});

btnModalUsersClose.addEventListener("click", () => modalUsers.close());

async function fetchUsers() {
  try {
    const res = await fetch("/api/admin/users", { credentials: "include" });
    if (!res.ok) return;
    const { users } = await res.json();
    renderUsers(users);
  } catch (e) {
    console.error(e);
  }
}

function renderUsers(users) {
  tbodyUsers.innerHTML = "";
  users.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(u.username)}</td>
      <td><span class="badge ${u.role === "admin" ? "badge--yes" : "badge--no"}">${u.role}</span></td>
      <td class="cell-muted">${new Date(u.created_at).toLocaleString()}</td>
      <td style="text-align:right">
        <div class="row-actions">
          <button class="btn btn--ghost btn--small btn-user-pw" data-id="${esc(u.id)}" data-username="${esc(u.username)}">PW</button>
          ${u.id !== currentUser.id ? `<button class="btn btn--danger btn--small btn-user-del" data-id="${esc(u.id)}">Del</button>` : ""}
        </div>
      </td>
    `;
    tbodyUsers.appendChild(tr);
  });
}

tbodyUsers.addEventListener("click", (e) => {
  const btnPw = e.target.closest(".btn-user-pw");
  const btnDel = e.target.closest(".btn-user-del");
  
  if (btnPw) {
    const id = btnPw.dataset.id;
    const username = btnPw.dataset.username;
    const pw = prompt(`Set new password for ${username}:`);
    if (pw && pw.length >= 8) {
      updateUserPassword(id, pw);
    } else if (pw) {
      alert("Password must be at least 8 characters");
    }
  }
  
  if (btnDel) {
    if (confirm("Delete this user?")) {
      deleteUser(btnDel.dataset.id);
    }
  }
});

async function updateUserPassword(id, password) {
  try {
    const res = await fetch(`/api/admin/users/${id}/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    });
    if (res.ok) alert("Password updated");
    else {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Could not update password");
    }
  } catch (e) {
    alert("Network error");
  }
}

async function deleteUser(id) {
  try {
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) fetchUsers();
    else {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Could not delete user");
    }
  } catch (e) {
    alert("Network error");
  }
}

btnAddUser.addEventListener("click", () => {
  formUserEdit.reset();
  modalUserEditTitle.textContent = "Add New User";
  modalUserEdit.showModal();
});

btnModalUserEditCancel.addEventListener("click", () => modalUserEdit.close());

formUserEdit.addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = new FormData(formUserEdit);
  const username = b.get("username");
  const password = b.get("password");
  const role = b.get("role");
  
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role }),
    });
    if (res.ok) {
      modalUserEdit.close();
      fetchUsers();
    } else {
      const { error } = await res.json();
      alert(error || "Registration failed");
    }
  } catch {
    alert("Server error");
  }
});

btnChangePassword.addEventListener("click", () => {
  formPassword.reset();
  modalPassword.showModal();
});

btnModalPasswordCancel.addEventListener("click", () => modalPassword.close());

formPassword.addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = new FormData(formPassword);
  const password = b.get("password");
  const confirmP = b.get("passwordConfirm");
  
  if (password !== confirmP) {
    alert("Passwords do not match");
    return;
  }
  
  try {
    const res = await fetch("/api/auth/change-password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      alert("Password changed successfully");
      currentUser.mustChangePassword = false;
      btnModalPasswordCancel.hidden = false;
      modalPassword.close();
    } else {
      const { error } = await res.json().catch(() => ({}));
      alert(error || "Change failed");
    }
  } catch {
    alert("Network error");
  }
});

function resetAttachmentDraft() {
  pendingFiles.requestLetter = null;
  pendingFiles.deregisterLetter = null;
  removeAttachment.requestLetter = false;
  removeAttachment.deregisterLetter = false;
  requestLetterFileInput.value = "";
  deregisterLetterFileInput.value = "";
}

/** @param {LetterSlot} slot */
function effectiveAttachmentMeta(slot) {
  if (pendingFiles[slot]) {
    return {
      fileName: pendingFiles[slot].name,
      mimeType: pendingFiles[slot].type || "application/octet-stream",
    };
  }
  if (removeAttachment[slot]) return null;
  if (!modalContextRec) return null;
  return slot === "requestLetter"
    ? modalContextRec.requestLetterAttachment
    : modalContextRec.deregisterLetterAttachment;
}

/** @param {LetterSlot} slot */
function syncLetterRowUI(slot) {
  const isReq = slot === "requestLetter";
  const statusEl = isReq ? requestLetterFileStatus : deregisterLetterFileStatus;
  const btnView = isReq ? btnViewRequestLetterFile : btnViewDeregisterLetterFile;
  const btnRemove = isReq ? btnRemoveRequestLetterFile : btnRemoveDeregisterLetterFile;

  const meta = effectiveAttachmentMeta(slot);
  const hadSaved =
    modalContextRec &&
    (isReq ? modalContextRec.requestLetterAttachment : modalContextRec.deregisterLetterAttachment);

  if (pendingFiles[slot]) {
    statusEl.textContent = `${pendingFiles[slot].name} (not saved yet)`;
    btnView.hidden = false;
    btnRemove.hidden = false;
    return;
  }
  if (removeAttachment[slot] && hadSaved) {
    statusEl.textContent = "File will be removed when you save.";
    btnView.hidden = true;
    btnRemove.hidden = false;
    return;
  }
  if (meta) {
    statusEl.textContent = meta.fileName;
    btnView.hidden = false;
    btnRemove.hidden = false;
    return;
  }
  statusEl.textContent = "No file attached.";
  btnView.hidden = true;
  btnRemove.hidden = true;
}

function syncAllLetterUI() {
  syncLetterRowUI("requestLetter");
  syncLetterRowUI("deregisterLetter");
}

/** @param {File} file @param {LetterSlot} slot */
function setPendingLetterFile(file, slot) {
  if (file.size > MAX_LETTER_BYTES) {
    alert(`File is too large (max ${Math.round(MAX_LETTER_BYTES / (1024 * 1024))} MB).`);
    return;
  }
  if (!isAllowedLetterFile(file)) {
    alert("Please choose a PDF or an image file.");
    return;
  }
  pendingFiles[slot] = file;
  removeAttachment[slot] = false;
  syncAllLetterUI();
}

/** @param {LetterSlot} slot */
function onRemoveLetterClick(slot) {
  if (pendingFiles[slot]) {
    pendingFiles[slot] = null;
    (slot === "requestLetter" ? requestLetterFileInput : deregisterLetterFileInput).value = "";
    syncAllLetterUI();
    return;
  }
  const hadSaved =
    modalContextRec &&
    (slot === "requestLetter"
      ? modalContextRec.requestLetterAttachment
      : modalContextRec.deregisterLetterAttachment);
  if (hadSaved) {
    removeAttachment[slot] = true;
  }
  syncAllLetterUI();
}

/** @param {LetterSlot} slot */
function openLetterFile(slot) {
  if (pendingFiles[slot]) {
    const url = URL.createObjectURL(pendingFiles[slot]);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const recordId = editingId;
  if (!recordId || removeAttachment[slot]) return;
  window.open(`/api/records/${encodeURIComponent(recordId)}/attachment/${slot}`, "_blank", "noopener,noreferrer");
}

requestLetterFileInput.addEventListener("change", () => {
  const f = requestLetterFileInput.files?.[0];
  if (f) setPendingLetterFile(f, "requestLetter");
});
deregisterLetterFileInput.addEventListener("change", () => {
  const f = deregisterLetterFileInput.files?.[0];
  if (f) setPendingLetterFile(f, "deregisterLetter");
});

btnViewRequestLetterFile.addEventListener("click", () => openLetterFile("requestLetter"));
btnViewDeregisterLetterFile.addEventListener("click", () => openLetterFile("deregisterLetter"));
btnRemoveRequestLetterFile.addEventListener("click", () => onRemoveLetterClick("requestLetter"));
btnRemoveDeregisterLetterFile.addEventListener("click", () => onRemoveLetterClick("deregisterLetter"));

function recordMatchesQuery(rec, q) {
  if (!q) return true;
  const attachNames = [
    rec.requestLetterAttachment?.fileName,
    rec.deregisterLetterAttachment?.fileName,
  ]
    .filter(Boolean)
    .join(" ");
  const hay = [
    rec.requestLetterText,
    rec.deregisterLetterText,
    attachNames,
    rec.requestDate,
    rec.project,
    rec.transporter,
    rec.vehicleNo,
    rec.installationDate,
    rec.imei,
    rec.signature,
    rec.removalRequestDate,
    rec.deregistrationDate,
    rec.receivedBy,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function getFiltered() {
  const q = search.value.trim().toLowerCase();
  const list = records.filter((r) => recordMatchesQuery(r, q));

  if (sortField) {
    list.sort((a, b) => {
      let va = a[sortField] || "";
      let vb = b[sortField] || "";
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();

      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }
  return list;
}

/** @param {Record} rec @param {LetterSlot} slot */
function letterCellHtml(rec, slot) {
  const text = slot === "requestLetter" ? rec.requestLetterText : rec.deregisterLetterText;
  const meta = slot === "requestLetter" ? rec.requestLetterAttachment : rec.deregisterLetterAttachment;
  const textHtml = text
    ? `<span class="letter-cell__text">${esc(text)}</span>`
    : '<span class="letter-cell__text cell-muted">—</span>';
  if (!meta) {
    return `<div class="letter-cell">${textHtml}</div>`;
  }
  const kind = meta.mimeType === "application/pdf" ? "PDF" : "Image";
  return `<div class="letter-cell">${textHtml}<button type="button" class="link-btn" data-open-letter="${esc(
    rec.id
  )}" data-slot="${slot}">View ${kind}</button><span class="cell-muted" style="font-size:0.75rem">${esc(
    meta.fileName
  )}</span></div>`;
}

/** @type {Set<string>} */
let selectedIds = new Set();

const bulkActions = document.getElementById("bulkActions");
const appActions = document.getElementById("appActions");
const selectionCount = document.getElementById("selectionCount");
const selectAll = /** @type {HTMLInputElement} */ (document.getElementById("selectAll"));
const btnBulkEdit = document.getElementById("btnBulkEdit");
const btnBulkDelete = document.getElementById("btnBulkDelete");
const btnBulkCancel = document.getElementById("btnBulkCancel");

const modalBulk = /** @type {HTMLDialogElement} */ (document.getElementById("modalBulk"));
const formBulk = /** @type {HTMLFormElement} */ (document.getElementById("formBulk"));
const btnModalBulkCancel = document.getElementById("btnModalBulkCancel");

function syncSelectionUI() {
  const count = selectedIds.size;
  if (count > 0) {
    bulkActions.hidden = false;
    appActions.hidden = true;
    selectionCount.textContent = `${count} record${count > 1 ? "s" : ""} selected`;
  } else {
    bulkActions.hidden = true;
    appActions.hidden = false;
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
}

selectAll.addEventListener("change", () => {
  if (selectAll.checked) {
    getFiltered().forEach((r) => selectedIds.add(r.id));
  } else {
    selectedIds.clear();
  }
  render();
  syncSelectionUI();
});

btnBulkCancel.addEventListener("click", () => {
  selectedIds.clear();
  render();
  syncSelectionUI();
});

btnBulkDelete.addEventListener("click", async () => {
  const count = selectedIds.size;
  if (!confirm(`Delete ${count} selected record${count > 1 ? "s" : ""} permanently?`)) return;
  
  for (const id of selectedIds) {
    await fetch(`/api/records/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
  }
  selectedIds.clear();
  await fetchRecords();
  syncSelectionUI();
});

/** @param {Record} rec */
function formBulkFromRecord(rec) {
  const f = formBulk;
  if (f.requestLetterText) f.requestLetterText.value = rec.requestLetterText;
  if (f.requestDate) f.requestDate.value = rec.requestDate;
  if (f.emailSent) f.emailSent.checked = rec.emailSent;
  if (f.project) f.project.value = rec.project;
  if (f.transporter) f.transporter.value = rec.transporter;
  if (f.gpsInstalled) f.gpsInstalled.checked = rec.gpsInstalled;
  if (f.installationDate) f.installationDate.value = rec.installationDate;
  if (f.signature) f.signature.value = rec.signature;
  if (f.deregisterLetterText) f.deregisterLetterText.value = rec.deregisterLetterText;
  if (f.removalRequestDate) f.removalRequestDate.value = rec.removalRequestDate;
  if (f.deregistrationDate) f.deregistrationDate.value = rec.deregistrationDate;
  if (f.gpsSubmitted) f.gpsSubmitted.checked = rec.gpsSubmitted;
  if (f.receivedBy) f.receivedBy.value = rec.receivedBy;
  if (f.gpsKeptAt) f.gpsKeptAt.value = rec.gpsKeptAt;
  if (f.portalUpdated) f.portalUpdated.checked = rec.portalUpdated;
}

btnBulkEdit.addEventListener("click", () => {
  formBulk.reset();
  
  if (selectedIds.size === 1) {
    const id = [...selectedIds][0];
    const rec = records.find(r => r.id === id);
    if (rec) formBulkFromRecord(rec);
  }

  formBulk.querySelectorAll("[data-bulk-toggle]").forEach((cb) => {
    const name = cb.getAttribute("data-bulk-toggle");
    const input = /** @type {HTMLInputElement | null} */ (formBulk.querySelector(`[name="${name}"]`));
    if (input) input.disabled = true;
  });
  modalBulk.showModal();
});

btnModalBulkCancel.addEventListener("click", () => modalBulk.close());

formBulk.addEventListener("change", (e) => {
  const target = /** @type {HTMLInputElement} */ (e.target);
  const toggleName = target.getAttribute("data-bulk-toggle");
  if (toggleName) {
    const input = formBulk.querySelector(`[name="${toggleName}"]`);
    if (input) input.disabled = !target.checked;
  }
});

formBulk.addEventListener("submit", async (e) => {
  e.preventDefault();
  const updates = {};
  
  formBulk.querySelectorAll("[data-bulk-toggle]:checked").forEach((cb) => {
    const name = cb.getAttribute("data-bulk-toggle");
    const input = formBulk.querySelector(`[name="${name}"]`);
    if (input) {
      if (input.type === "checkbox") {
        updates[name] = input.checked;
      } else {
        updates[name] = input.value;
      }
    }
  });

  if (Object.keys(updates).length === 0) {
    alert("No fields selected to update.");
    return;
  }

  const count = selectedIds.size;
  if (!confirm(`Update ${count} record${count > 1 ? "s" : ""} with selected values?`)) return;

  let failCount = 0;
  let lastError = "";

  for (const id of selectedIds) {
    const rec = records.find((r) => r.id === id);
    if (!rec) continue;
    
    const payload = { ...rec, ...updates };
    const fd = new FormData();
    fd.append("data", JSON.stringify(payload));

    const res = await fetch(`/api/records/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: fd,
      credentials: "include",
    });

    if (!res.ok) {
      failCount++;
      try {
        const j = await res.json();
        if (j.error) lastError = j.error;
      } catch { /* ignore */ }
    }
  }

  if (failCount > 0) {
    alert(`Updated ${count - failCount} records. ${failCount} failed to update.\nLast error: ${lastError}`);
  }

  selectedIds.clear();
  await fetchRecords();
  syncSelectionUI();
  modalBulk.close();
});

function render() {
  const list = getFiltered();
  emptyState.hidden = records.length > 0;
  tbody.innerHTML = "";

  document.querySelectorAll(".sort-btn").forEach((btn) => {
    const field = btn.getAttribute("data-sort");
    const icon = btn.querySelector(".sort-icon");
    if (field === sortField) {
      icon.textContent = sortAsc ? "↑" : "↓";
      btn.classList.add("sort-btn--active");
    } else {
      icon.textContent = "↕";
      btn.classList.remove("sort-btn--active");
    }
  });

  if (records.length === 0) return;

  const isAdmin = currentUser && currentUser.role === "admin";
  
  // Sync Select All checkbox
  const allSelected = list.length > 0 && list.every(r => selectedIds.has(r.id));
  const someSelected = list.some(r => selectedIds.has(r.id));
  selectAll.checked = allSelected;
  selectAll.indeterminate = someSelected && !allSelected;

  list.forEach((rec, idx) => {
    const isSelected = selectedIds.has(rec.id);
    const tr = document.createElement("tr");
    if (isSelected) tr.classList.add("row-selected");
    tr.innerHTML = `
      <td class="col-select"><input type="checkbox" class="row-select" data-id="${esc(rec.id)}" ${isSelected ? "checked" : ""} /></td>
      <td class="cell-muted">${idx + 1}</td>
      <td>${esc(rec.project) || '<span class="cell-muted">—</span>'}</td>
      <td>${esc(rec.transporter) || '<span class="cell-muted">—</span>'}</td>
      <td>${letterCellHtml(rec, "requestLetter")}</td>
      <td>${esc(formatDate(rec.requestDate))}</td>
      <td><strong>${esc(rec.vehicleNo) || '<span class="cell-muted">—</span>'}</strong></td>
      <td>${yesNo(rec.emailSent)}</td>
      <td>${yesNo(rec.gpsInstalled)}</td>
      <td>${esc(rec.imei) || '<span class="cell-muted">—</span>'}</td>
      <td>${esc(formatDate(rec.installationDate))}</td>
      <td>${esc(rec.signature) || '<span class="cell-muted">—</span>'}</td>
      <td>${letterCellHtml(rec, "deregisterLetter")}</td>
      <td>${esc(formatDate(rec.removalRequestDate))}</td>
      <td>${yesNo(rec.gpsSubmitted)}</td>
      <td>${esc(formatDate(rec.deregistrationDate))}</td>
      <td>${esc(rec.receivedBy) || '<span class="cell-muted">—</span>'}</td>
      <td>${esc(rec.gpsKeptAt) || '<span class="cell-muted">—</span>'}</td>
      <td class="col-actions admin-only" ${isAdmin ? "" : "hidden"}>
        <div class="row-actions">
          <button type="button" class="btn btn--ghost btn--small" data-edit="${esc(rec.id)}">Edit</button>
          <button type="button" class="btn btn--ghost btn--small btn--danger" data-del="${esc(
            rec.id
          )}">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".row-select").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = cb.getAttribute("data-id");
      if (cb.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      render();
      syncSelectionUI();
    });
  });

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      if (id) openModal(id);
    });
  });
  tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!id) return;
      if (!confirm("Delete this record permanently?")) return;
      const res = await fetch(`/api/records/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 401) {
        showAuth();
        return;
      }
      if (!res.ok) {
        alert("Could not delete record.");
        return;
      }
      await fetchRecords();
    });
  });

  tbody.querySelectorAll("[data-open-letter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-open-letter");
      const slot = /** @type {LetterSlot | null} */ (btn.getAttribute("data-slot"));
      if (!id || !slot) return;
      window.open(`/api/records/${encodeURIComponent(id)}/attachment/${slot}`, "_blank", "noopener,noreferrer");
    });
  });
}

/** @returns {Record} */
function emptyRecord() {
  return {
    id: "",
    requestLetterText: "",
    requestLetterAttachment: null,
    requestDate: "",
    emailSent: false,
    project: "",
    transporter: "",
    vehicleNo: "",
    gpsInstalled: false,
    installationDate: "",
    imei: "",
    signature: "",
    deregisterLetterText: "",
    deregisterLetterAttachment: null,
    removalRequestDate: "",
    deregistrationDate: "",
    gpsSubmitted: false,
    receivedBy: "",
    gpsKeptAt: "",
    portalUpdated: false,
  };
}

/** @param {Record} rec */
function formFromRecord(rec) {
  form.requestLetterText.value = rec.requestLetterText;
  form.deregisterLetterText.value = rec.deregisterLetterText;
  form.requestDate.value = rec.requestDate;
  form.emailSent.checked = rec.emailSent;
  form.project.value = rec.project;
  form.transporter.value = rec.transporter;
  form.vehicleNo.value = rec.vehicleNo;
  form.gpsInstalled.checked = rec.gpsInstalled;
  form.installationDate.value = rec.installationDate;
  form.imei.value = rec.imei;
  form.signature.value = rec.signature;
  form.removalRequestDate.value = rec.removalRequestDate;
  form.deregistrationDate.value = rec.deregistrationDate;
  form.gpsSubmitted.checked = rec.gpsSubmitted;
  form.receivedBy.value = rec.receivedBy;
  form.gpsKeptAt.value = rec.gpsKeptAt;
  form.portalUpdated.checked = rec.portalUpdated;
}

/** @returns {Omit<Record, 'id' | 'requestLetterAttachment' | 'deregisterLetterAttachment'>} */
function recordFromForm() {
  return {
    requestLetterText: form.requestLetterText.value.trim().toUpperCase(),
    requestDate: form.requestDate.value,
    emailSent: form.emailSent.checked,
    project: form.project.value.trim().toUpperCase(),
    transporter: form.transporter.value.trim().toUpperCase(),
    vehicleNo: form.vehicleNo.value.trim().toUpperCase(),
    gpsInstalled: form.gpsInstalled.checked,
    installationDate: form.installationDate.value,
    imei: form.imei.value.trim().toUpperCase(),
    signature: form.signature.value.trim().toUpperCase(),
    deregisterLetterText: form.deregisterLetterText.value.trim().toUpperCase(),
    removalRequestDate: form.removalRequestDate.value,
    deregistrationDate: form.deregistrationDate.value,
    gpsSubmitted: form.gpsSubmitted.checked,
    receivedBy: form.receivedBy.value.trim().toUpperCase(),
    gpsKeptAt: form.gpsKeptAt.value.trim().toUpperCase(),
    portalUpdated: form.portalUpdated.checked,
  };
}

/** @param {string | null} id */
function openModal(id) {
  const rec = id ? records.find((r) => r.id === id) : null;
  if (id && !rec) return;

  resetAttachmentDraft();
  editingId = id;
  const base = rec ? { ...rec } : emptyRecord();
  modalContextRec = base;

  if (!id) {
    modalTitle.textContent = "Add record";
  } else {
    modalTitle.textContent = "Edit record";
  }
  formFromRecord(base);
  syncAllLetterUI();
  modal.showModal();
}

function closeModal() {
  modal.close();
  editingId = null;
  modalContextRec = null;
  resetAttachmentDraft();
}

document.getElementById("btnAdd").addEventListener("click", () => openModal(null));

document.getElementById("btnModalCancel").addEventListener("click", () => closeModal());

form.addEventListener("submit", (e) => {
  e.preventDefault();
  
  // Basic validation
  if (!form.vehicleNo.value.trim() && !form.imei.value.trim()) {
    alert("Vehicle number or IMEI is required");
    form.vehicleNo.focus();
    return;
  }

  void (async () => {
    try {
      const data = recordFromForm();
      const payload = {
        ...data,
        removeRequestLetter: removeAttachment.requestLetter,
        removeDeregisterLetter: removeAttachment.deregisterLetter,
      };
      const fd = new FormData();
      fd.append("data", JSON.stringify(payload));
      if (pendingFiles.requestLetter) fd.append("requestLetterFile", pendingFiles.requestLetter);
      if (pendingFiles.deregisterLetter) fd.append("deregisterLetterFile", pendingFiles.deregisterLetter);

      const url = editingId ? `/api/records/${encodeURIComponent(editingId)}` : "/api/records";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, { method, body: fd, credentials: "include" });
      
      if (res.status === 401) {
        showAuth();
        return;
      }
      
      if (!res.ok) {
        let msg = "Could not save.";
        try {
          const j = await res.json();
          if (j.error) msg = j.error;
        } catch { /* ignore */ }
        alert(msg);
        return;
      }
      
      await fetchRecords();
      closeModal();
    } catch (err) {
      console.error(err);
      alert("A JavaScript error occurred while saving: " + err.message);
    }
  })();
});

modal.addEventListener("close", () => {
  editingId = null;
  modalContextRec = null;
  resetAttachmentDraft();
});

search.addEventListener("input", () => render());

document.querySelectorAll(".sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const field = btn.getAttribute("data-sort");
    if (field === sortField) {
      sortAsc = !sortAsc;
    } else {
      sortField = field;
      sortAsc = true;
    }
    render();
  });
});

document.getElementById("btnExport").addEventListener("click", () => {
  const headers = [
    "Sl.NO.",
    "Project",
    "Transporter",
    "Request Letter",
    "Request Letter (File)",
    "Date",
    "Vehicle No.",
    "Email Sent",
    "GPS installed",
    "IMEI No.",
    "Installation Date",
    "Signature",
    "Removal Letter",
    "Removal Letter (File)",
    "Date",
    "Removal Status",
    "Removed On Date",
    "Signature",
    "GPS is kept at",
  ];
  const rows = records.map((r, i) => [
    i + 1,
    r.project,
    r.transporter,
    r.requestLetterText,
    r.requestLetterAttachment?.fileName ?? "",
    r.requestDate,
    r.vehicleNo,
    r.emailSent ? "Yes" : "No",
    r.gpsInstalled ? "Yes" : "No",
    r.imei,
    r.installationDate,
    r.signature,
    r.deregisterLetterText,
    r.deregisterLetterAttachment?.fileName ?? "",
    r.removalRequestDate,
    r.gpsSubmitted ? "Yes" : "No",
    r.deregistrationDate,
    r.receivedBy,
    r.gpsKeptAt,
  ]);

  function csvEscape(cell) {
    const s = String(cell ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  const csv = [headers, ...rows].map((line) => line.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gps-management-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/** @param {Record} rec */
async function postRecordToApi(rec) {
  const payload = {
    requestLetterText: rec.requestLetterText,
    requestDate: rec.requestDate,
    emailSent: rec.emailSent,
    project: rec.project,
    transporter: rec.transporter,
    vehicleNo: rec.vehicleNo,
    gpsInstalled: rec.gpsInstalled,
    installationDate: rec.installationDate,
    imei: rec.imei,
    signature: rec.signature,
    deregisterLetterText: rec.deregisterLetterText,
    removalRequestDate: rec.removalRequestDate,
    deregistrationDate: rec.deregistrationDate,
    gpsSubmitted: rec.gpsSubmitted,
    receivedBy: rec.receivedBy,
    gpsKeptAt: rec.gpsKeptAt,
    portalUpdated: rec.portalUpdated,
    removeRequestLetter: false,
    removeDeregisterLetter: false,
  };
  const fd = new FormData();
  fd.append("data", JSON.stringify(payload));
  const res = await fetch("/api/records", { method: "POST", body: fd, credentials: "include" });
  if (!res.ok) {
    let msg = "Import row failed";
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
}

document.getElementById("importFile").addEventListener("change", (ev) => {
  const file = /** @type {HTMLInputElement} */ (ev.target).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "");
    void (async () => {
      try {
        const imported = parseCsvImport(text);
        if (imported.length === 0) {
          alert("No data rows found in CSV.");
          return;
        }
        if (
          !confirm(
            `Import ${imported.length} row(s). This will add them to your account. Continue?`
          )
        ) {
          return;
        }
        for (const rec of imported) {
          await postRecordToApi(rec);
        }
        await fetchRecords();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Could not parse or import CSV.");
      }
      /** @type {HTMLInputElement} */ (ev.target).value = "";
    })();
  };
  reader.readAsText(file);
});

/**
 * @param {string} text
 * @returns {Record[]}
 */
function parseCsvImport(text) {
  const lines = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (cur.length || lines.length === 0) lines.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  if (cur.length || lines.length === 0) lines.push(cur);
  if (lines.length < 2) return [];

  function parseLine(line) {
    const cells = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            cell += '"';
            i++;
          } else q = false;
        } else cell += c;
      } else {
        if (c === '"') q = true;
        else if (c === ",") {
          cells.push(cell);
          cell = "";
        } else cell += c;
      }
    }
    cells.push(cell);
    return cells;
  }

  const headerCells = parseLine(lines[0]).map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/\./g, "")
  );

  const alias = {
    sl: "_skip",
    slno: "_skip",
    serial: "_skip",
    project: "project",
    "request letter": "requestLetterText",
    "request letter (notes)": "requestLetterText",
    requestletter: "requestLetterText",
    "request letter file": "requestLetterFileName",
    requestletterfile: "requestLetterFileName",
    date: "requestDate",
    "request date": "requestDate",
    "email sent": "emailSent",
    emailsent: "emailSent",
    transporter: "transporter",
    "vehicle no": "vehicleNo",
    vehicleno: "vehicleNo",
    "vehicle number": "vehicleNo",
    "gps installed": "gpsInstalled",
    gpsinstalled: "gpsInstalled",
    "gps installation date": "installationDate",
    installationdate: "installationDate",
    "imei no": "imei",
    imeino: "imei",
    imei: "imei",
    signature: "signature",
    singature: "signature",
    "removal letter": "deregisterLetterText",
    "deregister letter": "deregisterLetterText",
    "deregister letter (notes)": "deregisterLetterText",
    deregisterletter: "deregisterLetterText",
    "deregister letter file": "deregisterLetterFileName",
    deregisterletterfile: "deregisterLetterFileName",
    "deregistration date": "deregistrationDate",
    "removed on date": "deregistrationDate",
    deregistrationdate: "deregistrationDate",
    "deregistation date": "deregistrationDate",
    "gps submitted": "gpsSubmitted",
    "removal status": "gpsSubmitted",
    gpssubmitted: "gpsSubmitted",
    "received by": "receivedBy",
    receivedby: "receivedBy",
    "gps is kept at": "gpsKeptAt",
    gpskeptat: "gpsKeptAt",
    "portal updated": "portalUpdated",
    "portal updation": "portalUpdated",
    portalupdated: "portalUpdated",
    "removal request date": "removalRequestDate",
  };

  /** @type {Record<string, number>} */
  const colMap = {};
  headerCells.forEach((h, idx) => {
    const key = alias[h] || alias[h.replace(/\s+/g, " ")];
    if (key && key !== "_skip") colMap[key] = idx;
  });

  const out = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseLine(lines[li]);
    if (!cells.some((c) => c.trim())) continue;

    function cell(key, def = "") {
      const i = colMap[key];
      if (i === undefined) return def;
      return (cells[i] ?? "").trim();
    }

    function boolCell(key) {
      const v = cell(key).toLowerCase();
      return v === "yes" || v === "true" || v === "1" || v === "y";
    }

    function dateCell(key) {
      const v = cell(key);
      if (!v) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      const tryD = new Date(v);
      if (!Number.isNaN(tryD.getTime())) {
        const y = tryD.getFullYear();
        const m = String(tryD.getMonth() + 1).padStart(2, "0");
        const d = String(tryD.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
      return v;
    }

    const vehicleNo = cell("vehicleNo");
    if (!vehicleNo && !cell("imei")) continue;

    out.push(
      normalizeRecord({
        id: uid(),
        requestLetterText: cell("requestLetterText"),
        requestDate: dateCell("requestDate"),
        emailSent: boolCell("emailSent"),
        project: cell("project"),
        transporter: cell("transporter"),
        vehicleNo,
        gpsInstalled: boolCell("gpsInstalled"),
        installationDate: dateCell("installationDate"),
        imei: cell("imei"),
        signature: cell("signature"),
        deregisterLetterText: cell("deregisterLetterText"),
        removalRequestDate: dateCell("removalRequestDate"),
        deregistrationDate: dateCell("deregistrationDate"),
        gpsSubmitted: boolCell("gpsSubmitted"),
        receivedBy: cell("receivedBy"),
        gpsKeptAt: cell("gpsKeptAt"),
        portalUpdated: boolCell("portalUpdated"),
      })
    );
  }
  return out;
}

document.getElementById("btnClear").addEventListener("click", () => {
  if (
    !confirm(
      "Delete ALL records in the system? This cannot be undone. Export a CSV first if you need a backup."
    )
  ) {
    return;
  }
  void (async () => {
    const res = await fetch("/api/records", { method: "DELETE", credentials: "include" });
    if (res.status === 401) {
      showAuth();
      return;
    }
    if (!res.ok) {
      alert("Could not delete records.");
      return;
    }
    await fetchRecords();
  })();
});

modalPassword.addEventListener("cancel", (e) => {
  if (currentUser && currentUser.mustChangePassword) {
    e.preventDefault();
  }
});

// Resizable Columns Logic
function initResizableColumns() {
  const tables = document.querySelectorAll(".data-table");
  tables.forEach((table) => {
    const resizers = table.querySelectorAll(".resizer");
    resizers.forEach((resizer) => {
      resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const th = resizer.parentElement;
        const startX = e.pageX;
        const startWidth = th.offsetWidth;

        document.body.classList.add("resizing");

        const onMouseMove = (moveEvent) => {
          const newWidth = startWidth + (moveEvent.pageX - startX);
          th.style.width = `${newWidth}px`;
          th.style.minWidth = `${newWidth}px`;
        };

        const onMouseUp = () => {
          document.body.classList.remove("resizing");
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    });
  });
}

// Call init after a short delay or when records are fetched
const originalFetchRecords = fetchRecords;
fetchRecords = async (...args) => {
  await originalFetchRecords(...args);
  initResizableColumns();
};

void trySession();
