const USER_API = "http://localhost:3000";
const RESTAURANT_API = "http://localhost:3001";
const ORDER_API = "http://localhost:3002";
const PAYMENT_API = "http://localhost:3003";

const PROMO_CODES = {
    SAVE10: { type: "percent", value: 10, label: "10% off subtotal" },
    FREEDEL: { type: "delivery", value: 100, label: "Free delivery" }
};

let currentUser = null;
let systemRoles = [];
let currentRestaurant = null;
let menuItemsCache = [];
let cart = [];
let appliedPromo = null;
let selectedOwnerRestaurantId = null;

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await fetchRoles();
        await restoreSession();
        bindEnterToAuthForms();
    } catch (err) {
        notify(err.message || "Failed to initialize app");
    }
});

function bindEnterToAuthForms() {
    ["login-email", "login-password"].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.addEventListener("keydown", (event) => event.key === "Enter" && handleLogin());
    });

    ["reg-name", "reg-email", "reg-phone", "reg-password"].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.addEventListener("keydown", (event) => event.key === "Enter" && handleRegister());
    });
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    });
    const text = await response.text();
    let payload = {};

    try {
        payload = text ? JSON.parse(text) : {};
    } catch (err) {
        throw new Error(`Invalid response from ${url}`);
    }

    if (!response.ok || payload.success === false) {
        throw new Error(payload.error || payload.message || `Request failed: ${response.status}`);
    }

    return payload;
}

// ── Toast notification system ──────────────────────────────────────────────
function notify(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const isError = /error|fail|invalid|required|not found|cannot|unable|wrong|incorrect/i.test(message);
    const isSuccess = /success|saved|placed|updated|created|submitted|deleted|applied|cancelled|delivered|password|registered|added/i.test(message);
    const resolvedType = type !== "info" ? type : isError ? "error" : isSuccess ? "success" : "info";

    const toast = document.createElement("div");
    toast.className = `toast toast-${resolvedType}`;

    const icons = { success: "✓", error: "✕", info: "ℹ", warning: "⚠" };
    toast.innerHTML = `
        <span class="toast-icon">${icons[resolvedType] || icons.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;

    container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add("toast-visible"));

    // Auto-dismiss after 4s
    setTimeout(() => {
        toast.classList.remove("toast-visible");
        toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, 4000);
}

// ── Custom prompt / confirm modal ──────────────────────────────────────────
function showPrompt(options) {
    return new Promise((resolve) => {
        const overlay = document.getElementById("prompt-modal-overlay");
        const title = document.getElementById("prompt-modal-title");
        const body = document.getElementById("prompt-modal-body");
        const confirmBtn = document.getElementById("prompt-modal-confirm");
        const cancelBtn = document.getElementById("prompt-modal-cancel");

        title.textContent = options.title || "Confirm";
        body.innerHTML = "";

        if (options.message) {
            const p = document.createElement("p");
            p.className = "muted-note";
            p.textContent = options.message;
            body.appendChild(p);
        }

        let inputEl = null;
        if (options.inputLabel) {
            const label = document.createElement("label");
            label.className = "form-label";
            label.textContent = options.inputLabel;
            inputEl = document.createElement("input");
            inputEl.type = "text";
            inputEl.value = options.inputDefault || "";
            inputEl.placeholder = options.inputPlaceholder || "";
            inputEl.style.marginTop = "0.5rem";
            body.appendChild(label);
            body.appendChild(inputEl);
        }

        let selectEl = null;
        if (options.selectLabel && options.selectOptions) {
            const label = document.createElement("label");
            label.className = "form-label";
            label.textContent = options.selectLabel;
            selectEl = document.createElement("select");
            options.selectOptions.forEach(({ value, label: text }) => {
                const opt = document.createElement("option");
                opt.value = value;
                opt.textContent = text;
                if (value === options.selectDefault) opt.selected = true;
                selectEl.appendChild(opt);
            });
            selectEl.style.marginTop = "0.5rem";
            body.appendChild(label);
            body.appendChild(selectEl);
        }

        confirmBtn.textContent = options.confirmLabel || "Confirm";
        confirmBtn.className = `compact-btn ${options.danger ? "btn-danger" : ""}`;
        cancelBtn.textContent = options.cancelLabel || "Cancel";

        overlay.classList.remove("hidden");
        if (inputEl) setTimeout(() => inputEl.focus(), 50);

        function cleanup() {
            overlay.classList.add("hidden");
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
        }

        confirmBtn.onclick = () => {
            cleanup();
            if (inputEl) resolve(inputEl.value.trim());
            else if (selectEl) resolve(selectEl.value);
            else resolve(true);
        };

        cancelBtn.onclick = () => {
            cleanup();
            resolve(null);
        };
    });
}

function showView(viewId) {
    document.querySelectorAll(".view-section").forEach((section) => section.classList.remove("active"));
    document.getElementById(viewId)?.classList.add("active");
}

function parseDecimal(value) {
    if (value == null) return 0;
    if (typeof value === "number") return value;
    if (typeof value === "string") return parseFloat(value) || 0;
    if (value.$numberDecimal) return parseFloat(value.$numberDecimal) || 0;
    return parseFloat(value.toString()) || 0;
}

function formatCurrency(value) {
    return `₹${parseDecimal(value).toFixed(2)}`;
}

function formatDate(value) {
    return value ? new Date(value).toLocaleString() : "Not available";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getRoleName(roleId) {
    return systemRoles.find((role) => role._id === roleId)?.role_name || "customer";
}

function renderStats(containerId, stats) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = stats.map((stat) => `
        <div class="stat-card">
            <div class="label">${escapeHtml(stat.label)}</div>
            <div class="value">${escapeHtml(stat.value)}</div>
        </div>
    `).join("");
}

async function fetchRoles() {
    const payload = await apiRequest(`${USER_API}/roles`);
    systemRoles = payload.data || [];
}

async function restoreSession() {
    const savedUser = localStorage.getItem("indicrave_user");
    if (!savedUser) {
        updateNav();
        showView("auth-section");
        return;
    }

    try {
        const parsed = JSON.parse(savedUser);
        const payload = await apiRequest(`${USER_API}/users/${parsed._id}`);
        currentUser = payload.data;
        currentUser.roleName = getRoleName(currentUser.role_id);
        persistCurrentUser();
        updateNav();
        routeUserByRole();
    } catch (err) {
        currentUser = null;
        localStorage.removeItem("indicrave_user");
        updateNav();
        showView("auth-section");
    }
}

function persistCurrentUser() {
    if (currentUser) localStorage.setItem("indicrave_user", JSON.stringify(currentUser));
}

function updateNav() {
    const navLinks = document.getElementById("nav-links");
    if (!navLinks) return;

    if (!currentUser) {
        navLinks.innerHTML = "";
        return;
    }

    const roleName = currentUser.roleName || getRoleName(currentUser.role_id);
    const buttons = [];

    if (roleName === "customer") {
        buttons.push(`<button class="compact-btn btn-secondary" onclick="loadRestaurants()">Home</button>`);
        buttons.push(`<button class="compact-btn" onclick="loadMyOrders()">My Orders</button>`);
        buttons.push(`<button class="compact-btn ghost-btn" onclick="loadProfile()">Profile</button>`);
    }
    if (roleName === "restaurant_owner") {
        buttons.push(`<button class="compact-btn btn-secondary" onclick="loadOwnerDashboard()">Dashboard</button>`);
        buttons.push(`<button class="compact-btn ghost-btn" onclick="loadProfile()">Profile</button>`);
    }
    if (roleName === "delivery_partner") {
        buttons.push(`<button class="compact-btn btn-secondary" onclick="loadDeliveryDashboard()">Deliveries</button>`);
        buttons.push(`<button class="compact-btn ghost-btn" onclick="loadProfile()">Profile</button>`);
    }

    navLinks.innerHTML = `
        <span>Signed in as <b>${escapeHtml(currentUser.full_name)}</b> (${escapeHtml(roleName)})</span>
        ${buttons.join("")}
        <button class="compact-btn btn-danger" onclick="logout()">Logout</button>
    `;
}

function routeUserByRole() {
    if (!currentUser) return showView("auth-section");
    const roleName = currentUser.roleName || getRoleName(currentUser.role_id);

    if (roleName === "customer") {
        if (!currentUser.address?.street) return loadProfile(true);
        return loadRestaurants();
    }
    if (roleName === "restaurant_owner") return loadOwnerDashboard();
    if (roleName === "delivery_partner") return loadDeliveryDashboard();
    showView("auth-section");
}

async function handleLogin() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    if (!email || !password) return notify("Email and password are required.");

    try {
        const payload = await apiRequest(`${USER_API}/users/login`, {
            method: "POST",
            body: JSON.stringify({ email, password })
        });
        currentUser = payload.data;
        currentUser.roleName = currentUser.roleName || getRoleName(currentUser.role_id);
        persistCurrentUser();
        updateNav();
        routeUserByRole();
    } catch (err) {
        notify(err.message);
    }
}

async function handleRegister() {
    const full_name = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const phone = document.getElementById("reg-phone").value.trim();
    const password = document.getElementById("reg-password").value;
    const role_name = document.getElementById("reg-role")?.value || "customer";

    if (!full_name || !email || !phone || !password) {
        return notify("Name, email, phone, and password are required.");
    }

    try {
        await apiRequest(`${USER_API}/users/register`, {
            method: "POST",
            body: JSON.stringify({ full_name, email, phone, password, role_name })
        });
        const roleLabels = {
            customer: "Customer",
            restaurant_owner: "Restaurant Owner",
            delivery_partner: "Delivery Partner"
        };
        notify(`Registered as ${roleLabels[role_name] || role_name}. You can log in now.`);
        ["reg-name", "reg-email", "reg-phone", "reg-password"].forEach((id) => {
            document.getElementById(id).value = "";
        });
        document.getElementById("reg-role").value = "customer";
    } catch (err) {
        notify(err.message);
    }
}

function logout() {
    currentUser = null;
    currentRestaurant = null;
    cart = [];
    appliedPromo = null;
    selectedOwnerRestaurantId = null;
    localStorage.removeItem("indicrave_user");
    updateNav();
    showView("auth-section");
}

function loadProfile(force = false) {
    if (!currentUser) return;
    const roleName = currentUser.roleName || getRoleName(currentUser.role_id);

    // Hide all role panels, show correct one
    document.querySelectorAll(".profile-role-panel").forEach(el => el.classList.add("hidden"));

    const cancelBtn = document.getElementById("btn-cancel-profile");
    if (cancelBtn) cancelBtn.style.display = force ? "none" : "inline-block";

    if (roleName === "customer") {
        document.getElementById("profile-section-title").textContent = "Customer Profile";
        document.getElementById("profile-customer").classList.remove("hidden");
        document.getElementById("prof-name").value = currentUser.full_name || "";
        document.getElementById("prof-phone").value = currentUser.phone || "";
        document.getElementById("prof-street").value = currentUser.address?.street || "";
        document.getElementById("prof-city").value = currentUser.address?.city || "";
        document.getElementById("prof-state").value = currentUser.address?.state || "";
        document.getElementById("prof-pincode").value = currentUser.address?.pincode || "";
        document.getElementById("prof-dob").value = currentUser.date_of_birth ? currentUser.date_of_birth.slice(0, 10) : "";
        document.getElementById("prof-gender").value = currentUser.gender || "";
        document.getElementById("prof-diet").value = currentUser.dietary_preference || "";
        document.getElementById("prof-allergies").value = (currentUser.allergies || []).join(", ");
        document.getElementById("prof-fav-cuisines").value = (currentUser.favourite_cuisines || []).join(", ");
        document.getElementById("prof-spice").value = currentUser.preferred_spice_level || "";
        document.getElementById("prof-default-payment").value = currentUser.default_payment_method || "UPI";

    } else if (roleName === "restaurant_owner") {
        document.getElementById("profile-section-title").textContent = "Owner Profile";
        document.getElementById("profile-owner").classList.remove("hidden");
        document.getElementById("owner-prof-name").value = currentUser.full_name || "";
        document.getElementById("owner-prof-phone").value = currentUser.phone || "";
        document.getElementById("owner-prof-alt-phone").value = currentUser.alternate_phone || "";
        document.getElementById("owner-prof-street").value = currentUser.address?.street || "";
        document.getElementById("owner-prof-city").value = currentUser.address?.city || "";
        document.getElementById("owner-prof-state").value = currentUser.address?.state || "";
        document.getElementById("owner-prof-pincode").value = currentUser.address?.pincode || "";
        document.getElementById("owner-prof-gstin").value = currentUser.gstin || "";
        document.getElementById("owner-prof-pan").value = currentUser.pan_number || "";
        document.getElementById("owner-prof-fssai").value = currentUser.fssai_license || "";
        document.getElementById("owner-prof-bank-name").value = currentUser.bank_details?.bank_name || "";
        document.getElementById("owner-prof-account").value = currentUser.bank_details?.account_number || "";
        document.getElementById("owner-prof-ifsc").value = currentUser.bank_details?.ifsc_code || "";

    } else if (roleName === "delivery_partner") {
        document.getElementById("profile-section-title").textContent = "Delivery Partner Profile";
        document.getElementById("profile-delivery").classList.remove("hidden");
        document.getElementById("del-prof-name").value = currentUser.full_name || "";
        document.getElementById("del-prof-phone").value = currentUser.phone || "";
        document.getElementById("del-prof-alt-phone").value = currentUser.emergency_contact || "";
        document.getElementById("del-prof-street").value = currentUser.address?.street || "";
        document.getElementById("del-prof-city").value = currentUser.address?.city || "";
        document.getElementById("del-prof-state").value = currentUser.address?.state || "";
        document.getElementById("del-prof-pincode").value = currentUser.address?.pincode || "";
        document.getElementById("del-prof-dob").value = currentUser.date_of_birth ? currentUser.date_of_birth.slice(0, 10) : "";
        document.getElementById("del-prof-vehicle").value = currentUser.vehicle_type || "motorcycle";
        document.getElementById("del-prof-vehicle-number").value = currentUser.vehicle_number || "";
        document.getElementById("del-prof-license").value = currentUser.driving_license || "";
        document.getElementById("del-prof-zone").value = currentUser.preferred_zone || "";
        document.getElementById("del-prof-available").value = currentUser.is_available !== false ? "true" : "false";
        document.getElementById("del-prof-radius").value = currentUser.max_delivery_radius || "";
        document.getElementById("del-prof-bank-name").value = currentUser.bank_details?.bank_name || "";
        document.getElementById("del-prof-account").value = currentUser.bank_details?.account_number || "";
        document.getElementById("del-prof-ifsc").value = currentUser.bank_details?.ifsc_code || "";
        document.getElementById("del-prof-upi").value = currentUser.upi_id || "";
    }

    showView("profile-section");
}

async function saveProfile() {
    if (!currentUser) return;
    const full_name = document.getElementById("prof-name").value.trim();
    const phone = document.getElementById("prof-phone").value.trim();
    const street = document.getElementById("prof-street").value.trim();
    const city = document.getElementById("prof-city").value.trim();
    const state = document.getElementById("prof-state").value.trim();
    const pincode = document.getElementById("prof-pincode").value.trim();
    const gender = document.getElementById("prof-gender").value;
    const date_of_birth = document.getElementById("prof-dob").value || null;
    const dietary_preference = document.getElementById("prof-diet").value;
    const allergies = document.getElementById("prof-allergies").value.split(",").map(s => s.trim()).filter(Boolean);
    const favourite_cuisines = document.getElementById("prof-fav-cuisines").value.split(",").map(s => s.trim()).filter(Boolean);
    const preferred_spice_level = document.getElementById("prof-spice").value.trim();
    const default_payment_method = document.getElementById("prof-default-payment").value;

    if (!full_name || !phone || !street || !city) {
        return notify("Name, phone, street, and city are required.");
    }

    try {
        const payload = await apiRequest(`${USER_API}/users/${currentUser._id}`, {
            method: "PUT",
            body: JSON.stringify({
                full_name, phone,
                address: { street, city, state, pincode },
                gender, date_of_birth,
                dietary_preference, allergies, favourite_cuisines,
                preferred_spice_level, default_payment_method
            })
        });
        currentUser = { ...payload.data, roleName: currentUser.roleName || getRoleName(payload.data.role_id) };
        persistCurrentUser();
        updateNav();
        notify("Profile saved.");
        routeUserByRole();
    } catch (err) {
        notify(err.message);
    }
}

async function saveOwnerProfile() {
    if (!currentUser) return;
    const full_name = document.getElementById("owner-prof-name").value.trim();
    const phone = document.getElementById("owner-prof-phone").value.trim();
    const alternate_phone = document.getElementById("owner-prof-alt-phone").value.trim();
    const street = document.getElementById("owner-prof-street").value.trim();
    const city = document.getElementById("owner-prof-city").value.trim();
    const state = document.getElementById("owner-prof-state").value.trim();
    const pincode = document.getElementById("owner-prof-pincode").value.trim();
    const gstin = document.getElementById("owner-prof-gstin").value.trim();
    const pan_number = document.getElementById("owner-prof-pan").value.trim();
    const fssai_license = document.getElementById("owner-prof-fssai").value.trim();
    const bank_name = document.getElementById("owner-prof-bank-name").value.trim();
    const account_number = document.getElementById("owner-prof-account").value.trim();
    const ifsc_code = document.getElementById("owner-prof-ifsc").value.trim();

    if (!full_name || !phone) return notify("Name and phone are required.");

    try {
        const payload = await apiRequest(`${USER_API}/users/${currentUser._id}`, {
            method: "PUT",
            body: JSON.stringify({
                full_name, phone, alternate_phone,
                address: { street, city, state, pincode },
                gstin, pan_number, fssai_license,
                bank_details: { bank_name, account_number, ifsc_code }
            })
        });
        currentUser = { ...payload.data, roleName: currentUser.roleName || getRoleName(payload.data.role_id) };
        persistCurrentUser();
        updateNav();
        notify("Owner profile saved.");
        routeUserByRole();
    } catch (err) {
        notify(err.message);
    }
}

async function saveDeliveryProfile() {
    if (!currentUser) return;
    const full_name = document.getElementById("del-prof-name").value.trim();
    const phone = document.getElementById("del-prof-phone").value.trim();
    const emergency_contact = document.getElementById("del-prof-alt-phone").value.trim();
    const street = document.getElementById("del-prof-street").value.trim();
    const city = document.getElementById("del-prof-city").value.trim();
    const state = document.getElementById("del-prof-state").value.trim();
    const pincode = document.getElementById("del-prof-pincode").value.trim();
    const date_of_birth = document.getElementById("del-prof-dob").value || null;
    const vehicle_type = document.getElementById("del-prof-vehicle").value;
    const vehicle_number = document.getElementById("del-prof-vehicle-number").value.trim();
    const driving_license = document.getElementById("del-prof-license").value.trim();
    const preferred_zone = document.getElementById("del-prof-zone").value.trim();
    const is_available = document.getElementById("del-prof-available").value === "true";
    const max_delivery_radius = parseInt(document.getElementById("del-prof-radius").value, 10) || null;
    const bank_name = document.getElementById("del-prof-bank-name").value.trim();
    const account_number = document.getElementById("del-prof-account").value.trim();
    const ifsc_code = document.getElementById("del-prof-ifsc").value.trim();
    const upi_id = document.getElementById("del-prof-upi").value.trim();

    if (!full_name || !phone) return notify("Name and phone are required.");

    try {
        const payload = await apiRequest(`${USER_API}/users/${currentUser._id}`, {
            method: "PUT",
            body: JSON.stringify({
                full_name, phone, emergency_contact,
                address: { street, city, state, pincode },
                date_of_birth, vehicle_type, vehicle_number,
                driving_license, preferred_zone, is_available,
                max_delivery_radius, upi_id,
                bank_details: { bank_name, account_number, ifsc_code }
            })
        });
        currentUser = { ...payload.data, roleName: currentUser.roleName || getRoleName(payload.data.role_id) };
        persistCurrentUser();
        updateNav();
        notify("Delivery profile saved.");
        routeUserByRole();
    } catch (err) {
        notify(err.message);
    }
}

async function changePassword() {
    if (!currentUser) return;
    const currentPassword = document.getElementById("pwd-current").value;
    const newPassword = document.getElementById("pwd-new").value;
    if (!currentPassword || !newPassword) return notify("Both password fields are required.");
    try {
        await apiRequest(`${USER_API}/users/${currentUser._id}/password`, {
            method: "PUT",
            body: JSON.stringify({ currentPassword, newPassword })
        });
        document.getElementById("pwd-current").value = "";
        document.getElementById("pwd-new").value = "";
        notify("Password updated.");
    } catch (err) {
        notify(err.message);
    }
}

async function changeOwnerPassword() {
    if (!currentUser) return;
    const currentPassword = document.getElementById("owner-pwd-current").value;
    const newPassword = document.getElementById("owner-pwd-new").value;
    if (!currentPassword || !newPassword) return notify("Both password fields are required.");
    try {
        await apiRequest(`${USER_API}/users/${currentUser._id}/password`, {
            method: "PUT",
            body: JSON.stringify({ currentPassword, newPassword })
        });
        document.getElementById("owner-pwd-current").value = "";
        document.getElementById("owner-pwd-new").value = "";
        notify("Password updated.");
    } catch (err) {
        notify(err.message);
    }
}

async function changeDeliveryPassword() {
    if (!currentUser) return;
    const currentPassword = document.getElementById("del-pwd-current").value;
    const newPassword = document.getElementById("del-pwd-new").value;
    if (!currentPassword || !newPassword) return notify("Both password fields are required.");
    try {
        await apiRequest(`${USER_API}/users/${currentUser._id}/password`, {
            method: "PUT",
            body: JSON.stringify({ currentPassword, newPassword })
        });
        document.getElementById("del-pwd-current").value = "";
        document.getElementById("del-pwd-new").value = "";
        notify("Password updated.");
    } catch (err) {
        notify(err.message);
    }
}

async function loadRestaurants() {
    if (!currentUser) return;

    const search = document.getElementById("restaurant-search")?.value.trim() || "";
    const cuisine = document.getElementById("restaurant-cuisine")?.value.trim() || "";
    const city = document.getElementById("restaurant-city")?.value.trim() || "";
    const sort = document.getElementById("restaurant-sort")?.value || "";
    const open = document.getElementById("restaurant-open")?.value || "";

    try {
        const params = new URLSearchParams();
        if (cuisine) params.set("cuisine", cuisine);
        if (city) params.set("city", city);
        if (sort) params.set("sort", sort);
        if (open !== "") params.set("is_open", open);

        const [restaurantsPayload, orderStatsPayload, paymentStatsPayload] = await Promise.all([
            search
                ? apiRequest(`${RESTAURANT_API}/restaurants/search/${encodeURIComponent(search)}`)
                : apiRequest(`${RESTAURANT_API}/restaurants${params.toString() ? `?${params}` : ""}`),
            apiRequest(`${ORDER_API}/orders/stats/summary?user_id=${currentUser._id}`),
            apiRequest(`${PAYMENT_API}/payments/stats/summary?user_id=${currentUser._id}`)
        ]);

        const restaurants = restaurantsPayload.data || [];
        console.log("Restaurants:", restaurants);
        const orderStats = orderStatsPayload.data || {};
        const paymentStats = paymentStatsPayload.data || {};

        renderStats("customer-summary", [
            { label: "Orders", value: orderStats.total_orders ?? 0 },
            { label: "Delivered", value: orderStats.delivered_orders ?? 0 },
            { label: "Spend", value: formatCurrency(paymentStats.total_revenue || 0) },
            { label: "Success Rate", value: paymentStats.success_rate || "0%" }
        ]);

        const grid = document.getElementById("restaurants-grid");
        if (!restaurants.length) {
            grid.innerHTML = `<div class="card"><h3>No restaurants found</h3><p class="muted-note">Try a different search or filter.</p></div>`;
        } else {
            grid.innerHTML = restaurants.map((restaurant) => `
                <div class="card">
                    <div class="row-between">
                        <h3>${escapeHtml(restaurant.restaurant_name)}</h3>
                        <span class="status-badge status-${restaurant.is_open ? "delivered" : "cancelled"}">${restaurant.is_open ? "Open" : "Closed"}</span>
                    </div>
                    <p class="meta-line">${escapeHtml(restaurant.cuisine_type || "Various cuisines")}</p>
                    <div class="tag-row">
                        <span class="tag">⭐ ${escapeHtml((restaurant.rating || 0).toString())}</span>
                        <span class="tag">${escapeHtml((restaurant.delivery_time || 30).toString())} mins</span>
                        <span class="tag">Min ${formatCurrency(restaurant.minimum_order)}</span>
                    </div>
                    <p class="meta-line">${escapeHtml([restaurant.address?.street, restaurant.address?.city].filter(Boolean).join(", ") || "Address not listed")}</p>
                    <p class="meta-line">Hours: ${escapeHtml(restaurant.opening_hours || "Not specified")}</p>
                    <div class="card-actions">
                        <button class="compact-btn" onclick="loadMenu('${restaurant._id}')">View Menu</button>
                        <button class="compact-btn btn-secondary" onclick="viewRestaurantDetails('${restaurant._id}')">Details</button>
                    </div>
                </div>
            `).join("");
        }

        showView("restaurants-section");
    } catch (err) {
        notify(err.message);
    }
}

async function viewRestaurantDetails(restaurantId) {
    try {
        const [restaurantPayload, reviewsPayload] = await Promise.all([
            apiRequest(`${RESTAURANT_API}/restaurants/${restaurantId}`),
            apiRequest(`${RESTAURANT_API}/reviews?restaurant_id=${restaurantId}`)
        ]);

        const restaurant = restaurantPayload.data;
        const reviews = reviewsPayload.data || [];
        const summary = reviews.length
            ? reviews.slice(0, 3).map((review) => `${review.rating}/5: ${review.comment || "No comment"}`).join("\n")
            : "No reviews yet.";

        notify(
            `${restaurant.restaurant_name}\n` +
            `Cuisine: ${restaurant.cuisine_type || "Various"}\n` +
            `Rating: ${restaurant.rating || 0}\n` +
            `Delivery time: ${restaurant.delivery_time || 30} mins\n` +
            `Minimum order: ${formatCurrency(restaurant.minimum_order)}\n\n` +
            `Recent reviews:\n${summary}`
        );
    } catch (err) {
        notify(err.message);
    }
}

async function loadMenu(restaurantId) {
    try {
        const [restaurantPayload, menuPayload] = await Promise.all([
            apiRequest(`${RESTAURANT_API}/restaurants/${restaurantId}`),
            apiRequest(`${RESTAURANT_API}/menus?restaurant_id=${restaurantId}&available=true`)
        ]);

        currentRestaurant = restaurantPayload.data;
        menuItemsCache = menuPayload.data || [];
        cart = [];
        appliedPromo = null;

        document.getElementById("current-restaurant-name").textContent = currentRestaurant.restaurant_name;
        document.getElementById("restaurant-meta").textContent = `${currentRestaurant.cuisine_type || "Cuisine"} • ${currentRestaurant.delivery_time || 30} mins • Minimum order ${formatCurrency(currentRestaurant.minimum_order)}`;
        document.getElementById("promo-code").value = "";
        document.getElementById("order-note").value = "";
        document.getElementById("menu-search").value = "";
        document.getElementById("menu-category").value = "";
        document.getElementById("menu-veg").value = "";
        renderMenuItems();
        updateCartUI();
        showView("menu-section");
    } catch (err) {
        notify(err.message);
    }
}

function renderMenuItems() {
    const search = document.getElementById("menu-search").value.trim().toLowerCase();
    const category = document.getElementById("menu-category").value;
    const vegFilter = document.getElementById("menu-veg").value;
    const grid = document.getElementById("menu-grid");

    const filtered = menuItemsCache.filter((item) => {
        if (search && !`${item.item_name} ${item.description || ""}`.toLowerCase().includes(search)) return false;
        if (category && item.category !== category) return false;
        if (vegFilter === "veg" && !item.is_vegetarian) return false;
        if (vegFilter === "vegan" && !item.is_vegan) return false;
        if (vegFilter === "available" && !item.is_available) return false;
        return true;
    });

    if (!filtered.length) {
        grid.innerHTML = `<div class="card"><h3>No menu items match the filter</h3><p class="muted-note">Reset the menu filters to see more items.</p></div>`;
        return;
    }

    grid.innerHTML = filtered.map((item) => `
        <div class="card">
            <div class="row-between">
                <h3>${escapeHtml(item.item_name)}</h3>
                <span class="tag">${formatCurrency(item.price)}</span>
            </div>
            <p class="meta-line">${escapeHtml(item.description || "No description available.")}</p>
            <div class="tag-row">
                <span class="tag">${escapeHtml(item.category || "main_course")}</span>
                <span class="tag">${item.is_vegan ? "Vegan" : item.is_vegetarian ? "Vegetarian" : "Non-veg"}</span>
                <span class="tag">${escapeHtml(item.spice_level || "medium")}</span>
                <span class="tag">${escapeHtml((item.preparation_time || 15).toString())} mins</span>
            </div>
            <button onclick="addToCart('${item._id}')">Add to Cart</button>
        </div>
    `).join("");
}

function addToCart(menuId) {
    const item = menuItemsCache.find((entry) => entry._id === menuId);
    if (!item) return;

    const existing = cart.find((entry) => entry._id === menuId);
    if (existing) existing.quantity += 1;
    else {
        cart.push({
            _id: item._id,
            item_name: item.item_name,
            price: parseDecimal(item.price),
            quantity: 1,
            special_instructions: ""
        });
    }

    updateCartUI();
}

function updateCartItem(menuId, delta) {
    const item = cart.find((entry) => entry._id === menuId);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) cart = cart.filter((entry) => entry._id !== menuId);
    updateCartUI();
}

function updateInstruction(menuId, value) {
    const item = cart.find((entry) => entry._id === menuId);
    if (item) item.special_instructions = value;
}

function clearCart() {
    cart = [];
    appliedPromo = null;
    document.getElementById("promo-code").value = "";
    updateCartUI();
}

function calculateCartTotals() {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const minimumOrder = currentRestaurant ? parseDecimal(currentRestaurant.minimum_order) : 0;
    const deliveryFee = subtotal >= 300 || subtotal === 0 ? 0 : 40;
    const taxAmount = subtotal * 0.05;

    let discountAmount = 0;
    if (appliedPromo) {
        if (appliedPromo.type === "percent") discountAmount = subtotal * (appliedPromo.value / 100);
        if (appliedPromo.type === "delivery") discountAmount = deliveryFee;
    }

    const finalAmount = Math.max(subtotal - discountAmount + deliveryFee + taxAmount, 0);
    return {
        subtotal,
        discountAmount,
        deliveryFee,
        taxAmount,
        finalAmount,
        minimumOrder,
        belowMinimum: minimumOrder > 0 && subtotal < minimumOrder
    };
}

function updateCartUI() {
    const cartItems = document.getElementById("cart-items");
    const cartBreakdown = document.getElementById("cart-breakdown");
    const checkoutBtn = document.getElementById("checkout-btn");
    const totals = calculateCartTotals();

    if (!cart.length) {
        cartItems.innerHTML = `<p class="muted-note">Cart is empty.</p>`;
        cartBreakdown.innerHTML = "";
        checkoutBtn.disabled = true;
        checkoutBtn.textContent = "Place Order";
        return;
    }

    cartItems.innerHTML = cart.map((item) => `
        <div class="cart-item">
            <div class="row-between">
                <strong>${escapeHtml(item.item_name)}</strong>
                <span>${formatCurrency(item.price * item.quantity)}</span>
            </div>
            <div class="button-row" style="margin: 0.6rem 0;">
                <button class="compact-btn ghost-btn" onclick="updateCartItem('${item._id}', -1)">-</button>
                <span class="qty-count">${item.quantity}</span>
                <button class="compact-btn ghost-btn" onclick="updateCartItem('${item._id}', 1)">+</button>
            </div>
            <input type="text" value="${escapeHtml(item.special_instructions)}" placeholder="Special instructions" onchange="updateInstruction('${item._id}', this.value)">
        </div>
    `).join("");

    cartBreakdown.innerHTML = `
        <div class="price-line"><span>Subtotal</span><span>${formatCurrency(totals.subtotal)}</span></div>
        <div class="price-line"><span>Discount${appliedPromo ? ` (${escapeHtml(appliedPromo.code)})` : ""}</span><span>- ${formatCurrency(totals.discountAmount)}</span></div>
        <div class="price-line"><span>Delivery fee</span><span>${formatCurrency(totals.deliveryFee)}</span></div>
        <div class="price-line"><span>Tax (5%)</span><span>${formatCurrency(totals.taxAmount)}</span></div>
        <div class="price-line total"><span>Total</span><span>${formatCurrency(totals.finalAmount)}</span></div>
        ${totals.belowMinimum ? `<div class="price-line"><span>Minimum order required</span><span>${formatCurrency(totals.minimumOrder)}</span></div>` : ""}
    `;

    checkoutBtn.disabled = totals.belowMinimum || !currentUser?.address?.street;
    checkoutBtn.textContent = totals.belowMinimum ? `Minimum ${formatCurrency(totals.minimumOrder)}` : "Place Order";
}

function applyPromoCode() {
    const code = document.getElementById("promo-code").value.trim().toUpperCase();
    if (!code) {
        appliedPromo = null;
        return updateCartUI();
    }
    if (!PROMO_CODES[code]) return notify("Promo code not recognized.");
    appliedPromo = { ...PROMO_CODES[code], code };
    notify(`Promo applied: ${PROMO_CODES[code].label}`);
    updateCartUI();
}

async function processCheckout() {
    if (!currentUser?.address?.street) {
        notify("Complete your profile before placing an order.");
        return loadProfile(true);
    }

    const totals = calculateCartTotals();

    if (!cart.length) {
        return notify("Add items to the cart first.");
    }

    if (totals.belowMinimum) {
        return notify(`Minimum order is ${formatCurrency(totals.minimumOrder)}.`);
    }

    const checkoutBtn = document.getElementById("checkout-btn");
    const payment_method = document.getElementById("payment-method").value;
    const payment_gateway = document.getElementById("payment-gateway").value;

    try {
        checkoutBtn.disabled = true;
        checkoutBtn.textContent = "Processing...";

        // Step 1: Create the order
        const orderPayload = await apiRequest(`${ORDER_API}/orders`, {
            method: "POST",
            body: JSON.stringify({
                user_id: currentUser._id,
                restaurant_id: currentRestaurant._id,
                delivery_address: {
                    street: currentUser.address.street,
                    city: currentUser.address.city,
                    state: currentUser.address.state || "",
                    pincode: currentUser.address.pincode || ""
                },
                total_amount: totals.subtotal,
                discount_amount: totals.discountAmount,
                delivery_fee: totals.deliveryFee,
                tax_amount: totals.taxAmount,
                special_instructions: document.getElementById("order-note")?.value?.trim() || null
            })
        });

        const orderId = orderPayload.data._id;

        // Step 2: Save order items
        await apiRequest(`${ORDER_API}/order_items/batch`, {
            method: "POST",
            body: JSON.stringify({
                items: cart.map(item => ({
                    order_id: orderId,
                    menu_id: item._id,
                    item_name: item.item_name,
                    quantity: item.quantity,
                    price_at_order: item.price,
                    special_instructions: item.special_instructions || null
                }))
            })
        });

        // Step 3: Create payment record
        await apiRequest(`${PAYMENT_API}/payments`, {
            method: "POST",
            body: JSON.stringify({
                order_id: orderId,
                user_id: currentUser._id,
                amount: totals.finalAmount,
                payment_method: payment_method,
                payment_gateway: payment_gateway,
                payment_status: "pending"
            })
        });

        // Step 4: Clear cart and redirect
        cart = [];
        appliedPromo = null;
        updateCartUI();
        notify("Order placed successfully! 🎉");
        loadMyOrders();

    } catch (err) {
        notify(err.message);
    } finally {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = "Place Order";
    }
}

async function loadMyOrders() {
    if (!currentUser) return;

    try {
        const [ordersPayload, restaurantsPayload, reviewsPayload, paymentStatsPayload] = await Promise.all([
            apiRequest(`${ORDER_API}/orders?user_id=${currentUser._id}`),
            apiRequest(`${RESTAURANT_API}/restaurants`),
            apiRequest(`${RESTAURANT_API}/reviews?user_id=${currentUser._id}`),
            apiRequest(`${PAYMENT_API}/payments/stats/summary?user_id=${currentUser._id}`)
        ]);

        const orders = ordersPayload.data || [];
        const restaurants = restaurantsPayload.data || [];
        const reviews = reviewsPayload.data || [];
        const paymentStats = paymentStatsPayload.data || {};

        const ordersWithExtras = await Promise.all(orders.map(async (order) => {
            const [detailsPayload, payment] = await Promise.all([
                apiRequest(`${ORDER_API}/orders/${order._id}`),
                fetchPaymentForOrder(order._id)
            ]);
            return {
                ...detailsPayload.data,
                payment,
                review: reviews.find((review) => review.order_id === order._id),
                restaurant: restaurants.find((restaurant) => restaurant._id === order.restaurant_id)
            };
        }));

        renderStats("order-stats", [
            { label: "Total Orders", value: orders.length },
            { label: "Delivered", value: orders.filter((order) => order.status === "delivered").length },
            { label: "Pending", value: orders.filter((order) => ["pending", "confirmed", "preparing", "out_for_delivery"].includes(order.status)).length },
            { label: "Net Spend", value: formatCurrency(paymentStats.total_revenue || 0) }
        ]);

        const container = document.getElementById("my-orders-container");
        if (!ordersWithExtras.length) {
            container.innerHTML = `<div class="card"><h3>No orders yet</h3><p class="muted-note">Your order history will appear here.</p></div>`;
        } else {
            container.innerHTML = ordersWithExtras.map((order) => {
                const payment = order.payment;
                const canCancel = ["pending", "confirmed"].includes(order.status);
                const canRetryPayment = payment && payment.payment_status === "failed" && order.status !== "cancelled";
                const canReview = order.status === "delivered";
                const address = [order.delivery_address?.street, order.delivery_address?.city, order.delivery_address?.state, order.delivery_address?.pincode].filter(Boolean).join(", ");

                return `
                    <div class="card">
                        <div class="row-between">
                            <div>
                                <h3>${escapeHtml(order.restaurant?.restaurant_name || "Restaurant")}</h3>
                                <p class="meta-line">Order ...${escapeHtml(order._id.slice(-6))}</p>
                            </div>
                            <span class="status-badge status-${order.status}">${escapeHtml(order.status)}</span>
                        </div>
                        <p class="meta-line">Placed: ${escapeHtml(formatDate(order.order_date))}</p>
                        <p class="meta-line">ETA: ${escapeHtml(formatDate(order.estimated_delivery_time))}</p>
                        <p class="meta-line">Delivery address: ${escapeHtml(address || "Not available")}</p>
                        <ul class="order-list">
                            ${(order.items || []).map((item) => `<li>${escapeHtml(item.item_name)} x${item.quantity} • ${formatCurrency(item.subtotal || parseDecimal(item.price_at_order) * item.quantity)}</li>`).join("")}
                        </ul>
                        <div class="tag-row">
                            <span class="tag">Subtotal ${formatCurrency(order.total_amount)}</span>
                            <span class="tag">Tax ${formatCurrency(order.tax_amount)}</span>
                            <span class="tag">Delivery ${formatCurrency(order.delivery_fee)}</span>
                            <span class="tag">Final ${formatCurrency(order.final_amount)}</span>
                        </div>
                        <div class="tag-row">
                            <span class="tag">Payment: ${escapeHtml(payment?.payment_status || "not_attempted")}</span>
                            <span class="tag">${escapeHtml(payment?.payment_method || "N/A")}</span>
                        </div>
                        ${order.special_instructions ? `<p class="meta-line">Order note: ${escapeHtml(order.special_instructions)}</p>` : ""}
                        ${order.cancelled_reason ? `<p class="meta-line">Cancelled reason: ${escapeHtml(order.cancelled_reason)}</p>` : ""}
                        ${order.review ? `<p class="meta-line">Review: ${order.review.rating}/5 ${escapeHtml(order.review.comment || "")}</p>` : ""}
                        <div class="card-actions">
                            ${canCancel ? `<button class="compact-btn btn-danger" onclick="cancelOrder('${order._id}')">Cancel Order</button>` : ""}
                            ${canRetryPayment ? `<button class="compact-btn" onclick="retryPayment('${order._id}')">Retry Payment</button>` : ""}
                            ${canReview ? `<button class="compact-btn btn-secondary" onclick="openReviewModal('${order._id}', '${order.restaurant_id}', '${order.review?._id || ""}')">${order.review ? "Edit Review" : "Leave Review"}</button>` : ""}
                        </div>
                    </div>
                `;
            }).join("");
        }

        showView("my-orders-section");
    } catch (err) {
        notify(err.message);
    }
}

async function fetchPaymentForOrder(orderId) {
    try {
        const payload = await apiRequest(`${PAYMENT_API}/payments/order/${orderId}`);
        return payload.data;
    } catch (err) {
        return null;
    }
}

async function cancelOrder(orderId) {
    const reason = await showPrompt({
        title: "Cancel Order",
        message: "Are you sure you want to cancel this order?",
        inputLabel: "Reason for cancellation",
        inputDefault: "Changed my mind",
        inputPlaceholder: "Enter reason…",
        confirmLabel: "Cancel Order",
        cancelLabel: "Keep Order",
        danger: true
    });
    if (reason === null) return;

    try {
        await apiRequest(`${ORDER_API}/orders/${orderId}/cancel`, {
            method: "PUT",
            body: JSON.stringify({ reason })
        });

        const payment = await fetchPaymentForOrder(orderId);
        if (payment && payment.payment_status === "completed") {
            await apiRequest(`${PAYMENT_API}/payments/${payment._id}/refund`, {
                method: "POST",
                body: JSON.stringify({ reason: "Order cancelled by customer" })
            });
        }

        notify("Order cancelled.");
        loadMyOrders();
    } catch (err) {
        notify(err.message);
    }
}

async function retryPayment(orderId) {
    try {
        const [orderPayload, existingPayment] = await Promise.all([
            apiRequest(`${ORDER_API}/orders/${orderId}`),
            fetchPaymentForOrder(orderId)
        ]);

        const payment_method = await showPrompt({
            title: "Retry Payment",
            message: "Choose a payment method to retry:",
            selectLabel: "Payment Method",
            selectOptions: [
                { value: "UPI", label: "UPI" },
                { value: "wallet", label: "Wallet" },
                { value: "COD", label: "Cash on Delivery" },
                { value: "credit_card", label: "Credit Card" },
                { value: "debit_card", label: "Debit Card" },
                { value: "net_banking", label: "Net Banking" }
            ],
            selectDefault: existingPayment?.payment_method || "UPI",
            confirmLabel: "Retry Payment",
            cancelLabel: "Cancel"
        });
        if (!payment_method) return;

        const paymentPayload = await apiRequest(`${PAYMENT_API}/payments/process`, {
            method: "POST",
            body: JSON.stringify({
                order_id: orderId,
                user_id: currentUser._id,
                amount: parseDecimal(orderPayload.data.final_amount).toFixed(2),
                payment_method,
                payment_gateway: "manual"
            })
        });

        if (paymentPayload.data.payment_status === "completed") {
            await apiRequest(`${ORDER_API}/orders/${orderId}`, {
                method: "PUT",
                body: JSON.stringify({ status: "confirmed" })
            });
        }

        notify(paymentPayload.message || "Payment retried.");
        loadMyOrders();
    } catch (err) {
        notify(err.message);
    }
}

function openReviewModal(orderId, restaurantId, reviewId = "") {
    document.getElementById("review-order-id").value = orderId;
    document.getElementById("review-restaurant-id").value = restaurantId;
    document.getElementById("review-id").value = reviewId || "";
    document.getElementById("review-modal-title").textContent = reviewId ? "Edit Review" : "Leave a Review";
    document.getElementById("review-delete-btn").classList.toggle("hidden", !reviewId);
    document.getElementById("review-rating").value = 5;
    document.getElementById("review-comment").value = "";
    document.getElementById("review-modal").classList.remove("hidden");
    if (reviewId) prefillReview(reviewId);
}

async function prefillReview(reviewId) {
    try {
        const payload = await apiRequest(`${RESTAURANT_API}/reviews/${reviewId}`);
        document.getElementById("review-rating").value = payload.data.rating;
        document.getElementById("review-comment").value = payload.data.comment || "";
    } catch (err) {
        notify(err.message);
    }
}

function closeReviewModal() {
    document.getElementById("review-modal").classList.add("hidden");
}

async function submitReview() {
    const reviewId = document.getElementById("review-id").value;
    const order_id = document.getElementById("review-order-id").value;
    const restaurant_id = document.getElementById("review-restaurant-id").value;
    const rating = parseInt(document.getElementById("review-rating").value, 10);
    const comment = document.getElementById("review-comment").value.trim();

    try {
        if (reviewId) {
            await apiRequest(`${RESTAURANT_API}/reviews/${reviewId}`, {
                method: "PUT",
                body: JSON.stringify({ rating, comment })
            });
            notify("Review updated.");
        } else {
            await apiRequest(`${RESTAURANT_API}/reviews`, {
                method: "POST",
                body: JSON.stringify({ user_id: currentUser._id, restaurant_id, order_id, rating, comment })
            });
            notify("Review submitted.");
        }
        closeReviewModal();
        loadMyOrders();
    } catch (err) {
        notify(err.message);
    }
}

async function deleteReview() {
    const reviewId = document.getElementById("review-id").value;
    if (!reviewId) return;
    try {
        await apiRequest(`${RESTAURANT_API}/reviews/${reviewId}`, { method: "DELETE" });
        closeReviewModal();
        notify("Review deleted.");
        loadMyOrders();
    } catch (err) {
        notify(err.message);
    }
}

async function loadOwnerDashboard() {
    if (!currentUser) return;

    try {
        const restaurantsPayload = await apiRequest(`${RESTAURANT_API}/restaurants`);
        const myRestaurants = (restaurantsPayload.data || []).filter((restaurant) => restaurant.owner_id === currentUser._id);
        const panel = document.getElementById("owner-restaurants-panel");

        if (!myRestaurants.length) {
            renderStats("owner-overview", [
                { label: "Restaurants", value: 0 },
                { label: "Active Orders", value: 0 },
                { label: "Revenue", value: formatCurrency(0) },
                { label: "Menu Items", value: 0 }
            ]);
            panel.innerHTML = `
                <div class="card">
                    <h3>Create Your First Restaurant</h3>
                    <div class="filter-grid">
                        <input type="text" id="owner-new-name" placeholder="Restaurant name">
                        <input type="text" id="owner-new-cuisine" placeholder="Cuisine type">
                        <input type="text" id="owner-new-city" placeholder="City">
                        <input type="text" id="owner-new-hours" placeholder="Opening hours">
                        <button onclick="createOwnerRestaurant()">Create Restaurant</button>
                    </div>
                </div>
            `;
            document.getElementById("owner-orders-container").innerHTML = `<h3>No owner orders yet</h3><p class="muted-note">Create a restaurant first.</p>`;
            return showView("owner-section");
        }

        if (!selectedOwnerRestaurantId || !myRestaurants.some((restaurant) => restaurant._id === selectedOwnerRestaurantId)) {
            selectedOwnerRestaurantId = myRestaurants[0]._id;
        }

        const bundles = await Promise.all(myRestaurants.map(async (restaurant) => {
            const [restaurantStats, orderStats, menus] = await Promise.all([
                apiRequest(`${RESTAURANT_API}/restaurants/${restaurant._id}/stats`),
                apiRequest(`${ORDER_API}/orders/stats/summary?restaurant_id=${restaurant._id}`),
                apiRequest(`${RESTAURANT_API}/menus?restaurant_id=${restaurant._id}`)
            ]);
            return {
                restaurant,
                restaurantStats: restaurantStats.data,
                orderStats: orderStats.data,
                menus: menus.data || []
            };
        }));

        const selectedBundle = bundles.find((bundle) => bundle.restaurant._id === selectedOwnerRestaurantId) || bundles[0];
        selectedOwnerRestaurantId = selectedBundle.restaurant._id;

        renderStats("owner-overview", [
            { label: "Restaurants", value: myRestaurants.length },
            { label: "Active Orders", value: bundles.reduce((sum, item) => sum + (item.orderStats.pending_orders || 0), 0) },
            { label: "Revenue", value: formatCurrency(bundles.reduce((sum, item) => sum + parseDecimal(item.orderStats.total_revenue || 0), 0)) },
            { label: "Menu Items", value: bundles.reduce((sum, item) => sum + item.menus.length, 0) }
        ]);

        panel.innerHTML = `
            <div class="card" style="margin-bottom: 1rem;">
                <div class="filter-grid">
                    <select id="owner-restaurant-select" onchange="switchOwnerRestaurant(this.value)">
                        ${myRestaurants.map((restaurant) => `<option value="${restaurant._id}" ${restaurant._id === selectedOwnerRestaurantId ? "selected" : ""}>${escapeHtml(restaurant.restaurant_name)}</option>`).join("")}
                    </select>
                    <input type="text" id="owner-restaurant-name" value="${escapeHtml(selectedBundle.restaurant.restaurant_name)}" placeholder="Restaurant name">
                    <input type="text" id="owner-restaurant-cuisine" value="${escapeHtml(selectedBundle.restaurant.cuisine_type || "")}" placeholder="Cuisine">
                    <input type="text" id="owner-restaurant-hours" value="${escapeHtml(selectedBundle.restaurant.opening_hours || "")}" placeholder="Opening hours">
                    <input type="number" id="owner-restaurant-delivery" value="${escapeHtml((selectedBundle.restaurant.delivery_time || 30).toString())}" placeholder="Delivery time">
                    <input type="number" id="owner-restaurant-minimum" value="${parseDecimal(selectedBundle.restaurant.minimum_order)}" placeholder="Minimum order">
                    <select id="owner-restaurant-open">
                        <option value="true" ${selectedBundle.restaurant.is_open ? "selected" : ""}>Open</option>
                        <option value="false" ${!selectedBundle.restaurant.is_open ? "selected" : ""}>Closed</option>
                    </select>
                    <button onclick="saveOwnerRestaurant()">Save Restaurant</button>
                </div>
                <div class="tag-row">
                    <span class="tag">Rating ${escapeHtml((selectedBundle.restaurantStats.average_rating || 0).toString())}</span>
                    <span class="tag">Orders ${escapeHtml((selectedBundle.orderStats.total_orders || 0).toString())}</span>
                    <span class="tag">Reviews ${escapeHtml((selectedBundle.restaurantStats.total_reviews || 0).toString())}</span>
                </div>
            </div>

            <div class="profile-grid">
                <div class="card">
                    <h3>Add Menu Item</h3>
                    <div class="filter-grid">
                        <input type="text" id="owner-menu-name" placeholder="Item name">
                        <input type="text" id="owner-menu-description" placeholder="Description">
                        <input type="number" id="owner-menu-price" placeholder="Price">
                        <select id="owner-menu-category">
                            <option value="main_course">Main Course</option>
                            <option value="appetizer">Appetizer</option>
                            <option value="dessert">Dessert</option>
                            <option value="beverage">Beverage</option>
                            <option value="combo">Combo</option>
                        </select>
                        <select id="owner-menu-spice">
                            <option value="mild">Mild</option>
                            <option value="medium">Medium</option>
                            <option value="hot">Hot</option>
                            <option value="extra_hot">Extra Hot</option>
                        </select>
                        <input type="number" id="owner-menu-time" placeholder="Prep time">
                        <select id="owner-menu-veg">
                            <option value="false">Non-Veg</option>
                            <option value="true">Vegetarian</option>
                        </select>
                        <button onclick="createMenuItem()">Add Menu Item</button>
                    </div>
                </div>

                <div class="card">
                    <h3>Current Menu</h3>
                    ${selectedBundle.menus.length ? `
                        <table class="dashboard-table">
                            <thead>
                                <tr>
                                    <th>Item</th>
                                    <th>Price</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${selectedBundle.menus.map((menu) => `
                                    <tr>
                                        <td>${escapeHtml(menu.item_name)}</td>
                                        <td>${formatCurrency(menu.price)}</td>
                                        <td><span class="status-badge status-${menu.is_available ? "delivered" : "cancelled"}">${menu.is_available ? "Available" : "Hidden"}</span></td>
                                        <td class="button-row">
                                            <button class="compact-btn ghost-btn" onclick="toggleMenuAvailability('${menu._id}')">${menu.is_available ? "Hide" : "Show"}</button>
                                            <button class="compact-btn btn-danger" onclick="deleteMenuItem('${menu._id}')">Delete</button>
                                        </td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>
                    ` : `<p class="muted-note">No menu items yet.</p>`}
                </div>
            </div>
        `;

        await renderOwnerOrders(myRestaurants);
        await loadRestaurantReviews(selectedOwnerRestaurantId);
        showView("owner-section");
    } catch (err) {
        notify(err.message);
    }
}

async function renderOwnerOrders(myRestaurants) {
    const container = document.getElementById("owner-orders-container");
    const payloads = await Promise.all(myRestaurants.map((restaurant) => apiRequest(`${ORDER_API}/orders?restaurant_id=${restaurant._id}`)));
    const orders = payloads.flatMap((payload) => payload.data || []).filter((order) => order.status !== "delivered" && order.status !== "cancelled");

    if (!orders.length) {
        container.innerHTML = `<h3>Active Orders</h3><p class="muted-note">No active orders right now.</p>`;
        return;
    }

    container.innerHTML = `
        <h3>Active Orders</h3>
        <table class="dashboard-table">
            <thead>
                <tr>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Update</th>
                </tr>
            </thead>
            <tbody>
                ${orders.map((order) => `
                    <tr>
                        <td>...${escapeHtml(order._id.slice(-6))}</td>
                        <td><span class="status-badge status-${order.status}">${escapeHtml(order.status)}</span></td>
                        <td>${formatCurrency(order.final_amount)}</td>
                        <td class="button-row">
                            <select id="owner-status-${order._id}">
                                <option value="confirmed" ${order.status === "confirmed" ? "selected" : ""}>Confirmed</option>
                                <option value="preparing" ${order.status === "preparing" ? "selected" : ""}>Preparing</option>
                                <option value="out_for_delivery" ${order.status === "out_for_delivery" ? "selected" : ""}>Out for Delivery</option>
                                <option value="delivered" ${order.status === "delivered" ? "selected" : ""}>Delivered</option>
                            </select>
                            <button class="compact-btn" onclick="ownerUpdateOrderStatus('${order._id}')">Save</button>
                        </td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function switchOwnerRestaurant(value) {
    selectedOwnerRestaurantId = value;
    loadOwnerDashboard();
}

async function createOwnerRestaurant() {
    try {
        await apiRequest(`${RESTAURANT_API}/restaurants`, {
            method: "POST",
            body: JSON.stringify({
                restaurant_name: document.getElementById("owner-new-name").value.trim(),
                cuisine_type: document.getElementById("owner-new-cuisine").value.trim(),
                owner_id: currentUser._id,
                opening_hours: document.getElementById("owner-new-hours").value.trim(),
                address: { city: document.getElementById("owner-new-city").value.trim() }
            })
        });
        notify("Restaurant created.");
        loadOwnerDashboard();
    } catch (err) {
        notify(err.message);
    }
}

async function saveOwnerRestaurant() {
    try {
        await apiRequest(`${RESTAURANT_API}/restaurants/${selectedOwnerRestaurantId}`, {
            method: "PUT",
            body: JSON.stringify({
                restaurant_name: document.getElementById("owner-restaurant-name").value.trim(),
                cuisine_type: document.getElementById("owner-restaurant-cuisine").value.trim(),
                opening_hours: document.getElementById("owner-restaurant-hours").value.trim(),
                delivery_time: parseInt(document.getElementById("owner-restaurant-delivery").value, 10) || 30,
                minimum_order: parseFloat(document.getElementById("owner-restaurant-minimum").value || "0"),
                is_open: document.getElementById("owner-restaurant-open").value === "true"
            })
        });
        notify("Restaurant updated.");
        loadOwnerDashboard();
    } catch (err) {
        notify(err.message);
    }
}

async function createMenuItem() {
    try {
        await apiRequest(`${RESTAURANT_API}/menus`, {
            method: "POST",
            body: JSON.stringify({
                restaurant_id: selectedOwnerRestaurantId,
                item_name: document.getElementById("owner-menu-name").value.trim(),
                description: document.getElementById("owner-menu-description").value.trim(),
                price: parseFloat(document.getElementById("owner-menu-price").value || "0"),
                category: document.getElementById("owner-menu-category").value,
                spice_level: document.getElementById("owner-menu-spice").value,
                preparation_time: parseInt(document.getElementById("owner-menu-time").value, 10) || 15,
                is_vegetarian: document.getElementById("owner-menu-veg").value === "true",
                is_available: true
            })
        });
        notify("Menu item added.");
        loadOwnerDashboard();
    } catch (err) {
        notify(err.message);
    }
}

async function toggleMenuAvailability(menuId) {
    try {
        await apiRequest(`${RESTAURANT_API}/menus/${menuId}/toggle`, {
            method: "PATCH"
        });
        loadOwnerDashboard();
    } catch (err) {
        notify(err.message);
    }
}

async function deleteMenuItem(menuId) {
    try {
        await apiRequest(`${RESTAURANT_API}/menus/${menuId}`, { method: "DELETE" });
        loadOwnerDashboard();
    } catch (err) {
        notify(err.message);
    }
}

async function ownerUpdateOrderStatus(orderId) {
    const status = document.getElementById(`owner-status-${orderId}`).value;
    try {
        await apiRequest(`${ORDER_API}/orders/${orderId}`, {
            method: "PUT",
            body: JSON.stringify({ status })
        });
        loadOwnerDashboard();
    } catch (err) {
        notify(err.message);
    }
}

async function loadDeliveryDashboard() {
    if (!currentUser) return;

    try {
        const [ordersPayload, restaurantsPayload] = await Promise.all([
            apiRequest(`${ORDER_API}/orders`),
            apiRequest(`${RESTAURANT_API}/restaurants`)
        ]);
        const restaurants = restaurantsPayload.data || [];
        const orders = ordersPayload.data || [];

        const availableOrders = orders.filter((order) => order.status === "preparing" || (order.status === "out_for_delivery" && (!order.delivery_partner_id || order.delivery_partner_id === currentUser._id)));
        const myOrders = orders.filter((order) => order.delivery_partner_id === currentUser._id && order.status !== "delivered" && order.status !== "cancelled");

        renderStats("delivery-overview", [
            { label: "Available", value: availableOrders.length },
            { label: "Assigned", value: myOrders.length },
            { label: "Completed", value: orders.filter((order) => order.delivery_partner_id === currentUser._id && order.status === "delivered").length },
            { label: "Ready For Pickup", value: orders.filter((order) => order.status === "preparing").length }
        ]);

        const container = document.getElementById("delivery-orders-container");
        if (!availableOrders.length && !myOrders.length) {
            container.innerHTML = `<div class="card"><h3>No deliveries available</h3><p class="muted-note">Orders will appear here when restaurants move them to preparing or out for delivery.</p></div>`;
            return showView("delivery-section");
        }

        container.innerHTML = `
            <div class="profile-grid">
                <div class="card">
                    <h3>Available Orders</h3>
                    ${availableOrders.length ? availableOrders.map((order) => {
                        const restaurant = restaurants.find((item) => item._id === order.restaurant_id);
                        return `
                            <div class="cart-item">
                                <p><b>${escapeHtml(restaurant?.restaurant_name || "Restaurant")}</b></p>
                                <p class="meta-line">${escapeHtml(order.delivery_address?.street || "")}, ${escapeHtml(order.delivery_address?.city || "")}</p>
                                <p class="meta-line">Status: ${escapeHtml(order.status)}</p>
                                <button class="compact-btn" onclick="claimDelivery('${order._id}')">${order.delivery_partner_id === currentUser._id ? "Refresh" : "Claim Delivery"}</button>
                            </div>
                        `;
                    }).join("") : `<p class="muted-note">No available orders.</p>`}
                </div>
                <div class="card">
                    <h3>My Active Deliveries</h3>
                    ${myOrders.length ? myOrders.map((order) => `
                        <div class="cart-item">
                            <p><b>Order ...${escapeHtml(order._id.slice(-6))}</b></p>
                            <p class="meta-line">${escapeHtml(order.delivery_address?.street || "")}, ${escapeHtml(order.delivery_address?.city || "")}</p>
                            <p class="meta-line">ETA: ${escapeHtml(formatDate(order.estimated_delivery_time))}</p>
                            <button class="compact-btn btn-secondary" onclick="markDelivered('${order._id}')">Mark Delivered</button>
                        </div>
                    `).join("") : `<p class="muted-note">No active assignments.</p>`}
                </div>
            </div>
        `;

        showView("delivery-section");
    } catch (err) {
        notify(err.message);
    }
}

async function claimDelivery(orderId) {
    try {
        await apiRequest(`${ORDER_API}/orders/${orderId}`, {
            method: "PUT",
            body: JSON.stringify({ status: "out_for_delivery", delivery_partner_id: currentUser._id })
        });
        loadDeliveryDashboard();
    } catch (err) {
        notify(err.message);
    }
}

async function markDelivered(orderId) {
    try {
        await apiRequest(`${ORDER_API}/orders/${orderId}`, {
            method: "PUT",
            body: JSON.stringify({ status: "delivered" })
        });
        loadDeliveryDashboard();
    } catch (err) {
        notify(err.message);
    }
}

// WITH THIS:
async function loadRestaurantReviews(restaurantId) {
    const container = document.getElementById("reviews-list");
    if (!container) return;

    try {
        const [reviewsPayload, usersPayload] = await Promise.all([
            apiRequest(`${RESTAURANT_API}/reviews?restaurant_id=${restaurantId}`),
            apiRequest(`${USER_API}/users`)
        ]);

        const reviews = reviewsPayload.data || [];

        if (!reviews.length) {
            container.innerHTML = `<p class="muted-note">No reviews yet for this restaurant.</p>`;
            return;
        }

        const users = usersPayload.data || [];

        const avgRating = (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1);
        const starCounts = [5, 4, 3, 2, 1].map(star => ({
            star,
            count: reviews.filter(r => r.rating === star).length
        }));

        container.innerHTML = `
            <div class="reviews-summary">
                <div class="reviews-score">
                    <span class="reviews-big-score">${avgRating}</span>
                    <div class="reviews-stars">${renderStars(parseFloat(avgRating))}</div>
                    <span class="reviews-count">${reviews.length} review${reviews.length !== 1 ? "s" : ""}</span>
                </div>
                <div class="reviews-bars">
                    ${starCounts.map(({ star, count }) => `
                        <div class="bar-row">
                            <span class="bar-label">${star}★</span>
                            <div class="bar-track">
                                <div class="bar-fill" style="width: ${reviews.length ? Math.round((count / reviews.length) * 100) : 0}%"></div>
                            </div>
                            <span class="bar-count">${count}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
            <div class="reviews-cards">
                ${reviews.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(review => {
                    const user = users.find(u => u._id === review.user_id);
                    const initials = (user?.full_name || "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                    return `
                        <div class="review-card">
                            <div class="review-header">
                                <div class="review-avatar">${escapeHtml(initials)}</div>
                                <div class="review-meta">
                                    <span class="review-name">${escapeHtml(user?.full_name || "Customer")}</span>
                                    <span class="review-date">${review.created_at ? new Date(review.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Recently"}</span>
                                </div>
                                <div class="review-stars-inline">${renderStars(review.rating)}</div>
                            </div>
                            ${review.comment ? `<p class="review-comment">${escapeHtml(review.comment)}</p>` : `<p class="review-comment muted-note">No comment left.</p>`}
                        </div>
                    `;
                }).join("")}
            </div>
        `;
    } catch (err) {
        const container = document.getElementById("reviews-list");
        if (container) container.innerHTML = `<p class="muted-note">Could not load reviews.</p>`;
    }
}

function renderStars(rating) {
    return [1, 2, 3, 4, 5].map(i => {
        if (rating >= i) return `<span class="star full">★</span>`;
        if (rating >= i - 0.5) return `<span class="star half">★</span>`;
        return `<span class="star empty">☆</span>`;
    }).join("");
}