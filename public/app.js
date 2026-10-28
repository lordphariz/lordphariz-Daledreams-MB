const state = { customers: [], transactions: [], view: "dashboard", filter: "all" };
const currency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" });
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const today = () => new Date().toISOString().slice(0, 10);
const localPreview = window.location.protocol === "file:";
const localStorageKey = "daledreams-record-book";

function localRecords() {
  const saved = localStorage.getItem(localStorageKey);
  if (!saved) return { customers: [], transactions: [] };
  const records = JSON.parse(saved);
  if (!Array.isArray(records.customers) || !Array.isArray(records.transactions)) {
    throw new Error("Saved local records are invalid. Clear this site's browser data to start fresh.");
  }
  return records;
}

function saveLocalRecords(records) {
  localStorage.setItem(localStorageKey, JSON.stringify(records));
}

function localApi(path, options) {
  const records = localRecords();
  const segments = path.split("/").filter(Boolean);
  const [resource, id] = segments;
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};
  let result;

  if (resource === "customers") {
    if (method === "GET" && !id) result = records.customers;
    else if (method === "POST" && !id) {
      result = { id: crypto.randomUUID(), ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      records.customers.push(result);
    } else if (method === "PUT" && id) {
      const index = records.customers.findIndex((customer) => customer.id === id);
      if (index < 0) return Response.json({ error: "Customer not found." }, { status: 404 });
      result = { ...records.customers[index], ...body, updatedAt: new Date().toISOString() };
      records.customers[index] = result;
    } else if (method === "DELETE" && id) {
      const count = records.customers.length;
      records.customers = records.customers.filter((customer) => customer.id !== id);
      if (records.customers.length === count) return Response.json({ error: "Customer not found." }, { status: 404 });
      result = { ok: true };
    }
  } else if (resource === "transactions") {
    if (method === "GET" && !id) result = records.transactions;
    else if (method === "POST" && !id) {
      result = { id: crypto.randomUUID(), ...body, createdAt: new Date().toISOString() };
      records.transactions.push(result);
    } else if (method === "DELETE" && id) {
      const count = records.transactions.length;
      records.transactions = records.transactions.filter((transaction) => transaction.id !== id);
      if (records.transactions.length === count) return Response.json({ error: "Transaction not found." }, { status: 404 });
      result = { ok: true };
    }
  }

  if (result === undefined) return Response.json({ error: "API route not found." }, { status: 404 });
  if (method !== "GET") saveLocalRecords(records);
  return Response.json(result, { status: method === "POST" ? 201 : 200 });
}

async function api(path, options = {}) {
  const response = localPreview
    ? localApi(path, options)
    : await fetch(`/api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function showNotice(message) {
  const notice = $("#api-notice");
  notice.textContent = message;
  notice.hidden = false;
}
function hideNotice() { $("#api-notice").hidden = true; }
function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => toast.classList.remove("show"), 2600);
}
function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}
function initials(name = "") { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "?"; }
function total(type) {
  return state.transactions.filter((item) => item.type === type).reduce((sum, item) => sum + Number(item.amount), 0);
}

async function refreshData() {
  try {
    const [customers, transactions] = await Promise.all([api("/customers"), api("/transactions")]);
    state.customers = customers;
    state.transactions = transactions;
    if (localPreview) showNotice("Local preview: records are saved in this browser only. Deploy to Vercel to use your database.");
    else hideNotice();
    render();
  } catch (error) {
    showNotice(`Could not load your record book: ${error.message}. Check your database connection and try again.`);
  }
}

function render() {
  $("#customer-count").textContent = state.customers.length;
  $("#customer-list-count").textContent = state.customers.length;
  $("#total-income").textContent = currency.format(total("income"));
  $("#total-expenses").textContent = currency.format(total("expense"));
  $("#net-profit").textContent = currency.format(total("income") - total("expense"));
  $("#transactions-income").textContent = currency.format(total("income"));
  $("#transactions-expenses").textContent = currency.format(total("expense"));
  $("#transactions-profit").textContent = currency.format(total("income") - total("expense"));
  renderTransactions();
  renderCustomers($("#customer-search").value);
  renderChart();
}

function transactionLabel(item) {
  const title = item.type === "income" ? (item.customerName || "Customer payment") : item.expenseName;
  const subtitle = item.description || (item.type === "income" ? "Payment received" : "Studio expense");
  return `<span class="transaction-symbol ${item.type === "income" ? "symbol-income" : "symbol-expense"}">${item.type === "income" ? "↗" : "↘"}</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span>`;
}
function transactionRow(item, includeDelete = false) {
  return `<tr><td><div class="transaction-name">${transactionLabel(item)}</div></td><td>${item.type === "income" ? "Income" : "Expense"}</td><td>${escapeHtml(item.category || "—")}</td><td>${formatDate(item.date)}</td><td class="align-right ${item.type === "income" ? "amount-income" : "amount-expense"}">${item.type === "income" ? "+" : "−"}${currency.format(Number(item.amount))}</td>${includeDelete ? `<td><button class="delete-button" data-delete-transaction="${escapeHtml(item.id)}" aria-label="Delete transaction">×</button></td>` : ""}</tr>`;
}
function renderTransactions() {
  const transactions = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const recent = transactions.slice(0, 5);
  $("#recent-transactions").innerHTML = recent.length ? recent.map((item) => transactionRow(item)).join("") : '<tr><td class="empty-row" colspan="4">No transactions yet. Your income and expenses will appear here.</td></tr>';
  const filtered = state.filter === "all" ? transactions : transactions.filter((item) => item.type === state.filter);
  $("#transaction-count").textContent = filtered.length;
  $("#all-transactions").innerHTML = filtered.length ? filtered.map((item) => transactionRow(item, true)).join("") : '<tr><td class="empty-row" colspan="6">Nothing to show yet. Add an income or expense entry to get started.</td></tr>';
}
function renderCustomers(search = "") {
  const needle = search.trim().toLowerCase();
  const filtered = state.customers.filter((customer) => customer.fullName.toLowerCase().includes(needle) || customer.phone.toLowerCase().includes(needle));
  $("#customer-grid").innerHTML = filtered.length ? filtered.map((customer) => {
    const measurements = Object.entries(customer.measurements || {}).filter(([, value]) => value).slice(0, 4);
    const chips = measurements.length ? measurements.map(([key, value]) => `<span class="measure-chip">${escapeHtml(key)} ${escapeHtml(value)}</span>`).join("") : '<span class="measure-chip">No measurements yet</span>';
    return `<article class="customer-card"><div class="customer-card-top"><div class="customer-avatar">${escapeHtml(initials(customer.fullName))}</div><div><h3>${escapeHtml(customer.fullName)}</h3><div class="customer-phone">${escapeHtml(customer.phone)}</div></div><button class="customer-more" data-edit-customer="${escapeHtml(customer.id)}" aria-label="Edit ${escapeHtml(customer.fullName)}">···</button></div><div class="measurement-summary">${chips}</div><div class="customer-card-bottom"><span>${Object.values(customer.measurements || {}).filter(Boolean).length} measurements</span><button data-edit-customer="${escapeHtml(customer.id)}">View details →</button></div></article>`;
  }).join("") : `<div class="empty-state"><strong>${needle ? "No matching customers" : "Your customer book is ready"}</strong>${needle ? "Try another name or phone number." : "Add your first customer and keep their details close."}</div>`;
}

function renderChart() {
  const host = $("#cash-chart");
  const months = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    months.push({ key, label: new Intl.DateTimeFormat("en", { month: "short" }).format(date), income: 0, expense: 0 });
  }
  for (const item of state.transactions) {
    const month = months.find((entry) => entry.key === item.date.slice(0, 7));
    if (month) month[item.type] += Number(item.amount);
  }
  if (!months.some((month) => month.income || month.expense)) {
    host.innerHTML = '<div class="chart-empty">Add transactions to see your cash flow.</div>';
    return;
  }
  const width = 620, height = 190, pad = { top: 16, right: 12, bottom: 25, left: 40 };
  const max = Math.max(1, ...months.flatMap((month) => [month.income, month.expense])) * 1.15;
  const x = (index) => pad.left + index * (width - pad.left - pad.right) / (months.length - 1);
  const y = (value) => pad.top + (height - pad.top - pad.bottom) * (1 - value / max);
  const points = (key) => months.map((month, index) => `${x(index)},${y(month[key])}`).join(" ");
  const lines = [0, 1, 2, 3].map((step) => {
    const gridY = pad.top + step * (height - pad.top - pad.bottom) / 3;
    return `<line class="chart-grid" x1="${pad.left}" y1="${gridY}" x2="${width - pad.right}" y2="${gridY}"/><text class="chart-label" x="0" y="${gridY + 3}">${currency.format(max * (1 - step / 3)).replace(/\s/g, "")}</text>`;
  }).join("");
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Income and expense chart for the last six months">${lines}<polyline points="${points("income")}" fill="none" stroke="#a4d64f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/> <polyline points="${points("expense")}" fill="none" stroke="#eda66f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${months.map((month, index) => `<text class="chart-label" text-anchor="middle" x="${x(index)}" y="${height - 4}">${month.label}</text><circle cx="${x(index)}" cy="${y(month.income)}" r="3" fill="#a4d64f"/><circle cx="${x(index)}" cy="${y(month.expense)}" r="3" fill="#eda66f"/>`).join("")}</svg>`;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `view-${view}`));
  document.querySelectorAll(".nav-item, .mobile-nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $("#breadcrumb-current").textContent = view === "dashboard" ? "Overview" : view === "customers" ? "Customers" : "Transactions";
  $("#sidebar").classList.remove("open");
}

const measurementFields = ["Chest", "Waist", "Hips", "Shoulder", "Sleeve", "Armhole", "Blouse length", "Skirt / trouser length", "Neck", "Thigh"];
function showModal({ title, subtitle, content }) {
  $("#modal-root").innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button class="modal-close" type="button" aria-label="Close dialog">×</button></header>${content}</section></div>`;
  $(".modal-close").addEventListener("click", closeModal);
  $(".modal-backdrop").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeModal(); });
  document.addEventListener("keydown", escapeModal);
  $(".modal input")?.focus();
}
function closeModal() {
  $("#modal-root").innerHTML = "";
  document.removeEventListener("keydown", escapeModal);
}
function escapeModal(event) { if (event.key === "Escape") closeModal(); }

function entryChoiceModal() {
  showModal({
    title: "New entry",
    subtitle: "Choose what you’d like to add to your books.",
    content: `<div class="entry-choice"><button class="quick-action" data-entry-type="income"><span class="quick-icon income-icon">＋</span><span><strong>Record income</strong><small>Log a customer payment</small></span><b>→</b></button><button class="quick-action" data-entry-type="expense"><span class="quick-icon expense-icon">↗</span><span><strong>Record expense</strong><small>Log a studio cost</small></span><b>→</b></button></div>`,
  });
}

function customerModal(customer = null) {
  const measurements = customer?.measurements || {};
  const measurementInputs = measurementFields.map((field) => `<div class="form-field"><label for="measure-${field}">${field} <small>(in)</small></label><input id="measure-${field}" name="measurements[${field}]" inputmode="decimal" placeholder="e.g. 34" value="${escapeHtml(measurements[field] || "")}" /></div>`).join("");
  const customMeasurements = Object.entries(measurements).filter(([field]) => !measurementFields.includes(field))
    .map(([field, value]) => customMeasurementRow(field, value)).join("");
  showModal({
    title: customer ? "Edit customer" : "Add a customer",
    subtitle: "Save their contact details and measurements for next time.",
    content: `<form class="modal-form" id="customer-form"><div class="form-grid"><div class="form-field full"><label for="customer-name">Full name *</label><input id="customer-name" name="fullName" required maxlength="120" placeholder="e.g. Amara Okafor" value="${escapeHtml(customer?.fullName || "")}" /></div><div class="form-field full"><label for="customer-phone">Phone number *</label><input id="customer-phone" name="phone" required maxlength="40" type="tel" placeholder="e.g. +234 800 000 0000" value="${escapeHtml(customer?.phone || "")}" /></div><div class="form-section-title">TAILORING MEASUREMENTS · INCHES</div>${measurementInputs}<div class="form-section-title custom-measurement-heading">CUSTOM MEASUREMENTS <button type="button" class="button button-secondary add-measurement" id="add-measurement">＋ Add measurement</button></div><div class="form-field full custom-measurements" id="custom-measurements">${customMeasurements}</div><div class="form-field full"><label for="customer-notes">Notes</label><textarea id="customer-notes" name="notes" maxlength="1000" placeholder="Style preferences, fitting notes...">${escapeHtml(customer?.notes || "")}</textarea></div></div><p class="form-error" id="form-error"></p><div class="modal-actions">${customer ? '<button class="button button-secondary" type="button" id="delete-customer">Delete customer</button>' : ""}<button class="button button-secondary" type="button" data-cancel>Cancel</button><button class="button button-primary" type="submit">${customer ? "Save changes" : "Add customer"}</button></div></form>`,
  });
  $("[data-cancel]").addEventListener("click", closeModal);
  $("#add-measurement").addEventListener("click", () => {
    $("#custom-measurements").insertAdjacentHTML("beforeend", customMeasurementRow());
    $("#custom-measurements .custom-measurement-row:last-child input").focus();
  });
  $("#custom-measurements").addEventListener("click", (event) => {
    if (event.target.closest("[data-remove-measurement]")) event.target.closest(".custom-measurement-row").remove();
  });
  $("#customer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const measurementValues = Object.fromEntries(measurementFields.map((field) => [field, String(form.get(`measurements[${field}]`) || "").trim()]).filter(([, value]) => value));
    const customNames = form.getAll("customMeasurementName").map((value) => String(value).trim());
    const customValues = form.getAll("customMeasurementValue").map((value) => String(value).trim());
    const usedNames = new Set(Object.keys(measurementValues).map((field) => field.toLowerCase()));
    for (let index = 0; index < customNames.length; index++) {
      if (!customNames[index] && !customValues[index]) continue;
      const normalizedName = customNames[index].toLowerCase();
      if (!customNames[index] || !customValues[index] || normalizedName.length > 40 || usedNames.has(normalizedName)) {
        $("#form-error").textContent = "Enter a unique custom measurement name and value (up to 40 characters).";
        return;
      }
      usedNames.add(normalizedName);
      measurementValues[customNames[index]] = customValues[index];
    }
    if (Object.keys(measurementValues).length > 30) {
      $("#form-error").textContent = "A customer can have up to 30 measurements.";
      return;
    }
    const payload = { fullName: form.get("fullName"), phone: form.get("phone"), measurements: measurementValues, notes: form.get("notes") };
    try {
      await api(customer ? `/customers/${encodeURIComponent(customer.id)}` : "/customers", { method: customer ? "PUT" : "POST", body: JSON.stringify(payload) });
      closeModal();
      await refreshData();
      notify(customer ? "Customer details updated." : "Customer added to your book.");
    } catch (error) { $("#form-error").textContent = error.message; }
  });
  if (customer) $("#delete-customer").addEventListener("click", async () => {
    if (!confirm(`Delete ${customer.fullName} from your customer book? This cannot be undone.`)) return;
    try {
      await api(`/customers/${encodeURIComponent(customer.id)}`, { method: "DELETE" });
      closeModal();
      await refreshData();
      notify("Customer deleted.");
    } catch (error) { $("#form-error").textContent = error.message; }
  });
}

function customMeasurementRow(name = "", value = "") {
  return `<div class="custom-measurement-row"><input name="customMeasurementName" maxlength="40" placeholder="Measurement name" aria-label="Custom measurement name" value="${escapeHtml(name)}" /><input name="customMeasurementValue" maxlength="30" placeholder="Inches" aria-label="Custom measurement value" value="${escapeHtml(value)}" /><button class="remove-measurement" type="button" data-remove-measurement aria-label="Remove measurement">×</button></div>`;
}

function transactionModal(type) {
  const income = type === "income";
  const customerOptions = state.customers.map((customer) => `<option value="${escapeHtml(customer.fullName)}">${escapeHtml(customer.fullName)}</option>`).join("");
  const categories = ["Fabrics", "Accessories", "Transport", "Equipment", "Utilities", "Rent", "Other"];
  showModal({
    title: income ? "Record income" : "Record an expense",
    subtitle: income ? "Log a payment received by your studio." : "Keep track of a cost from your studio.",
    content: `<form class="modal-form" id="transaction-form"><div class="form-grid">${income ? `<div class="form-field full"><label for="income-customer">Customer name *</label><input id="income-customer" name="customerName" list="customer-options" maxlength="120" required placeholder="Enter customer name" /><datalist id="customer-options">${customerOptions}</datalist></div>` : `<div class="form-field full"><label for="expense-name">Expense name *</label><input id="expense-name" name="expenseName" maxlength="120" required placeholder="e.g. Ankara fabric" /></div>`}<div class="form-field"><label for="entry-amount">Amount (₦) *</label><input id="entry-amount" name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00" /></div><div class="form-field"><label for="entry-date">Date *</label><input id="entry-date" name="date" type="date" required value="${today()}" /></div>${income ? "" : `<div class="form-field full"><label for="entry-category">Category *</label><select id="entry-category" name="category" required>${categories.map((category) => `<option>${category}</option>`).join("")}</select></div>`}<div class="form-field full"><label for="entry-description">Description</label><textarea id="entry-description" name="description" maxlength="500" placeholder="Add a note (optional)"></textarea></div></div><p class="form-error" id="form-error"></p><div class="modal-actions"><button class="button button-secondary" type="button" data-cancel>Cancel</button><button class="button button-primary" type="submit">Save ${income ? "income" : "expense"}</button></div></form>`,
  });
  $("[data-cancel]").addEventListener("click", closeModal);
  $("#transaction-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { type, amount: Number(form.get("amount")), date: form.get("date"), description: form.get("description") };
    if (income) payload.customerName = form.get("customerName");
    else { payload.expenseName = form.get("expenseName"); payload.category = form.get("category"); }
    try {
      await api("/transactions", { method: "POST", body: JSON.stringify(payload) });
      closeModal();
      await refreshData();
      notify(income ? "Income recorded." : "Expense recorded.");
    } catch (error) { $("#form-error").textContent = error.message; }
  });
}

document.addEventListener("click", (event) => {
  const entryType = event.target.closest("[data-entry-type]")?.dataset.entryType;
  if (entryType === "income" || entryType === "expense") {
    closeModal();
    transactionModal(entryType);
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) { event.preventDefault(); setView(viewButton.dataset.view); return; }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "add-customer") customerModal();
  if (action === "add-income") transactionModal("income");
  if (action === "add-expense") transactionModal("expense");
  const editId = event.target.closest("[data-edit-customer]")?.dataset.editCustomer;
  if (editId) customerModal(state.customers.find((customer) => customer.id === editId));
  const deleteId = event.target.closest("[data-delete-transaction]")?.dataset.deleteTransaction;
  if (deleteId) {
    if (!confirm("Delete this transaction? This cannot be undone.")) return;
    api(`/transactions/${encodeURIComponent(deleteId)}`, { method: "DELETE" }).then(async () => { await refreshData(); notify("Transaction deleted."); }).catch((error) => showNotice(`Could not delete the transaction: ${error.message}`));
  }
  const filter = event.target.closest("[data-filter]")?.dataset.filter;
  if (filter) {
    state.filter = filter;
    document.querySelectorAll(".filter-button").forEach((button) => button.classList.toggle("active", button.dataset.filter === filter));
    renderTransactions();
  }
});
$("#top-add").addEventListener("click", entryChoiceModal);
$("#customer-search").addEventListener("input", (event) => renderCustomers(event.target.value));
$("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#today-label").textContent = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date());
refreshData();
