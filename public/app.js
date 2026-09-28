let currentAuthUser = null;
let currentDirectoryUsers = [];
let currentRoles = [];
let currentRequests = [];
let currentAuditLogs = [];
let currentResources = [];

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initNavigation();
  initModals();
  initForm();

  const saved = localStorage.getItem('azure_pim_user');
  if (saved) {
    try {
      currentAuthUser = JSON.parse(saved);
      launchPortal();
    } catch(e) {
      localStorage.removeItem('azure_pim_user');
    }
  }

  setInterval(() => {
    if (currentAuthUser) syncData();
  }, 1000);
});

function formatRemainingTime(seconds) {
  const sec = parseInt(seconds) || 0;
  if (sec <= 0) return "00h 00m 00s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h < 10 ? '0' : ''}${h}h ${m < 10 ? '0' : ''}${m}m ${s < 10 ? '0' : ''}${s}s`;
}

window.fillLogin = function(email, password) {
  document.getElementById('loginEmail').value = email;
  document.getElementById('loginPassword').value = password;
  document.getElementById('loginForm').dispatchEvent(new Event('submit'));
};

function initAuth() {
  const tabSignIn = document.getElementById('tabSignInBtn');
  const tabRegister = document.getElementById('tabRegisterBtn');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginError = document.getElementById('loginError');
  const regError = document.getElementById('regError');
  const regSuccess = document.getElementById('regSuccess');

  if (tabSignIn && tabRegister) {
    tabSignIn.addEventListener('click', () => {
      tabSignIn.classList.add('active');
      tabRegister.classList.remove('active');
      loginForm.style.display = 'block';
      registerForm.style.display = 'none';
    });

    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabSignIn.classList.remove('active');
      registerForm.style.display = 'block';
      loginForm.style.display = 'none';
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginError.style.display = 'none';
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          loginError.innerText = data.error || 'Authentication failed.';
          loginError.style.display = 'block';
          return;
        }
        currentAuthUser = data.user;
        localStorage.setItem('azure_pim_user', JSON.stringify(data.user));
        launchPortal();
      } catch (err) {
        loginError.innerText = 'Unable to reach backend. Check port 3002.';
        loginError.style.display = 'block';
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      regError.style.display = 'none';
      regSuccess.style.display = 'none';

      const name = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const department = document.getElementById('regDept').value.trim();
      const password = document.getElementById('regPassword').value;
      const confirmPassword = document.getElementById('regConfirmPassword').value;

      if (password !== confirmPassword) {
        regError.innerText = 'Passwords do not match.';
        regError.style.display = 'block';
        return;
      }

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, department, password })
        });
        const data = await res.json();
        if (!res.ok) {
          regError.innerText = data.error || 'Registration failed.';
          regError.style.display = 'block';
          return;
        }
        regSuccess.innerText = data.message;
        regSuccess.style.display = 'block';
        registerForm.reset();
        setTimeout(() => {
          tabSignIn.click();
          document.getElementById('loginEmail').value = email;
        }, 1500);
      } catch (err) {
        regError.innerText = 'Registration request failed.';
        regError.style.display = 'block';
      }
    });
  }

  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      localStorage.removeItem('azure_pim_user');
      currentAuthUser = null;
      document.getElementById('portalView').style.display = 'none';
      document.getElementById('loginView').style.display = 'flex';
      showToast('Signed out of Microsoft Azure.', 'info');
    });
  }
}

function launchPortal() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('portalView').style.display = 'block';
  applyRbacUI();
  loadData();
  showToast(`Signed in: ${currentAuthUser.name}`, 'success');
}

function applyRbacUI() {
  const role = currentAuthUser.appRole;
  document.getElementById('userNameDisplay').innerText = currentAuthUser.name;
  document.getElementById('userEmailDisplay').innerText = currentAuthUser.email;
  document.getElementById('avatarDisplay').innerText = role === 'user' ? 'US' : (role === 'admin' ? 'AD' : 'SA');

  const pill = document.getElementById('currentRolePill');
  pill.innerText = role.toUpperCase();
  pill.className = `role-pill-badge role-pill-${role}`;

  document.getElementById('reqUser').value = currentAuthUser.email;
  document.getElementById('bgUser').value = currentAuthUser.email;

  const bgBtn = document.getElementById('openBreakGlassModalBtn');
  const inspectBtn = document.getElementById('openFullInspectionBtn');
  if (bgBtn) bgBtn.style.display = role === 'superadmin' ? 'inline-flex' : 'none';
  if (inspectBtn) inspectBtn.style.display = role === 'superadmin' ? 'inline-flex' : 'none';

  const adminLinks = document.querySelectorAll('.rbac-admin-up');
  const superadminLinks = document.querySelectorAll('.rbac-superadmin-up');
  const sidebarNote = document.getElementById('sidebarRbacMsg');

  if (role === 'user') {
    adminLinks.forEach(el => el.style.display = 'none');
    superadminLinks.forEach(el => el.style.display = 'none');
    if (sidebarNote) sidebarNote.innerText = 'Tier 1 [User]: JIT Elevation requests require approval & SuperAdmin verification.';
    switchToTab('tab-jit');
  } else if (role === 'admin') {
    adminLinks.forEach(el => el.style.display = 'flex');
    superadminLinks.forEach(el => el.style.display = 'none');
    if (sidebarNote) sidebarNote.innerText = 'Tier 2 [Admin]: Can review/approve elevation requests and view audit logs.';
  } else if (role === 'superadmin') {
    adminLinks.forEach(el => el.style.display = 'flex');
    superadminLinks.forEach(el => el.style.display = 'flex');
    if (sidebarNote) sidebarNote.innerText = 'Tier 3 [SuperAdmin]: Full authority. Promote/demote users, inspect telemetry, edit policies.';
  }
}

function switchToTab(tabId) {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  navItems.forEach(n => n.classList.remove('active'));
  panes.forEach(p => p.classList.remove('active'));

  const targetNav = document.querySelector(`[data-tab="${tabId}"]`);
  if (targetNav) targetNav.classList.add('active');
  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.add('active');
}

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = item.getAttribute('data-tab');
      switchToTab(tabId);
    });
  });

  const sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });
  }

  const refreshBtn = document.getElementById('refreshTableBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      syncData();
      showToast('Dashboard synchronized with database', 'info');
    });
  }

  const searchInput = document.getElementById('requestSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      renderRequestsTable(currentRequests.filter(r => 
        (r.roleName && r.roleName.toLowerCase().includes(term)) ||
        (r.user && r.user.toLowerCase().includes(term)) ||
        (r.ticketId && r.ticketId.toLowerCase().includes(term)) ||
        (r.status && r.status.toLowerCase().includes(term))
      ));
    });
  }

  const expCsv = document.getElementById('exportCsvBtn');
  if (expCsv) expCsv.addEventListener('click', exportAuditCsv);
  const expJson = document.getElementById('exportJsonBtn');
  if (expJson) expJson.addEventListener('click', exportAuditJson);
}

function initModals() {
  const reqModal = document.getElementById('requestModal');
  const bgModal = document.getElementById('breakGlassModal');
  const flowModal = document.getElementById('flowChartModal');
  const inspectModal = document.getElementById('fullInspectionModal');

  const openReq = document.getElementById('openRequestModalBtn');
  if (openReq) openReq.addEventListener('click', () => reqModal.classList.add('active'));
  const closeReq = document.getElementById('closeRequestModalBtn');
  if (closeReq) closeReq.addEventListener('click', () => reqModal.classList.remove('active'));
  const cancelReq = document.getElementById('cancelRequestBtn');
  if (cancelReq) cancelReq.addEventListener('click', () => reqModal.classList.remove('active'));

  const openBg = document.getElementById('openBreakGlassModalBtn');
  if (openBg) {
    openBg.addEventListener('click', () => {
      if (currentAuthUser.appRole !== 'superadmin') {
        showToast('SuperAdmin clearance required for Break-Glass procedure', 'danger');
        return;
      }
      bgModal.classList.add('active');
    });
  }
  const closeBg = document.getElementById('closeBreakGlassModalBtn');
  if (closeBg) closeBg.addEventListener('click', () => bgModal.classList.remove('active'));
  const cancelBg = document.getElementById('cancelBreakGlassBtn');
  if (cancelBg) cancelBg.addEventListener('click', () => bgModal.classList.remove('active'));

  const openFlow = document.getElementById('openFlowChartBtn');
  if (openFlow) openFlow.addEventListener('click', () => flowModal.classList.add('active'));
  const closeFlow = document.getElementById('closeFlowModalBtn');
  if (closeFlow) closeFlow.addEventListener('click', () => flowModal.classList.remove('active'));

  const openInsp = document.getElementById('openFullInspectionBtn');
  if (openInsp) openInsp.addEventListener('click', fetchFullInspectionTelemetry);
  const relInsp = document.getElementById('reloadTelemetryBtn');
  if (relInsp) relInsp.addEventListener('click', fetchFullInspectionTelemetry);
  const closeInsp = document.getElementById('closeInspectionModalBtn');
  if (closeInsp) closeInsp.addEventListener('click', () => inspectModal.classList.remove('active'));

  window.addEventListener('click', (e) => {
    if (e.target === reqModal) reqModal.classList.remove('active');
    if (e.target === bgModal) bgModal.classList.remove('active');
    if (e.target === flowModal) flowModal.classList.remove('active');
    if (e.target === inspectModal) inspectModal.classList.remove('active');
  });
}

async function fetchFullInspectionTelemetry() {
  if (currentAuthUser.appRole !== 'superadmin') return;
  const modal = document.getElementById('fullInspectionModal');
  modal.classList.add('active');
  const box = document.getElementById('telemetryJsonBox');
  box.innerText = 'Requesting GET /api/pim/full-inspection...';

  try {
    const res = await fetch('/api/pim/full-inspection', {
      headers: { 'x-user-email': currentAuthUser.email }
    });
    const telemetry = await res.json();
    box.innerText = JSON.stringify(telemetry, null, 2);
  } catch (err) {
    box.innerText = 'Failed to load telemetry from endpoint.';
  }
}

function initForm() {
  const form = document.getElementById('submitRequestForm');
  const roleSelect = document.getElementById('reqRoleSelect');

  if (roleSelect) {
    roleSelect.addEventListener('change', () => {
      const selected = currentRoles.find(r => r.name === roleSelect.value);
      const preview = document.getElementById('policyPreviewBox');
      if (selected && preview) {
        preview.innerHTML = `
          <strong>Policy Guardrails for ${selected.name}:</strong><br>
          • Approval Required: <strong>${selected.requireApproval ? 'Yes (' + selected.approvers + ')' : 'No (Direct Activation)'}</strong><br>
          • Max Elevation: <strong>${selected.maxDurationHours} Hours</strong> | MFA Mandated: <strong>${selected.requireMFA ? 'Enforced' : 'Optional'}</strong>
        `;
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const durEl = document.querySelector('input[name="duration"]:checked');
      const duration = durEl ? durEl.value : '3600';
      const payload = {
        roleName: roleSelect.value,
        ticketId: document.getElementById('reqTicket').value,
        justification: document.getElementById('reqJustification').value,
        durationSeconds: duration,
        mfaCode: document.getElementById('reqMfaCode').value.trim(),
        isBreakGlass: false
      };

      try {
        const res = await fetch('/api/requests/create', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-user-email': currentAuthUser.email
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Request failed', 'danger');
          return;
        }
        document.getElementById('requestModal').classList.remove('active');
        form.reset();
        showToast(
          data.request.status === 'Active' 
            ? `Granted temporary access to ${data.request.roleName}` 
            : `Elevation request submitted. Awaiting manager sign-off.`,
          data.request.status === 'Active' ? 'success' : 'info'
        );
        syncData();
      } catch (err) {
        showToast('Error communicating with Azure PIM API', 'danger');
      }
    });
  }

  const bgForm = document.getElementById('submitBreakGlassForm');
  if (bgForm) {
    bgForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        roleName: document.getElementById('bgRoleSelect').value,
        ticketId: document.getElementById('bgTicket').value,
        justification: '[BREAK-GLASS EMERGENCY] ' + document.getElementById('bgJustification').value,
        durationSeconds: 3600,
        mfaCode: '123456',
        isBreakGlass: true
      };

      const res = await fetch('/api/requests/create', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': currentAuthUser.email
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        document.getElementById('breakGlassModal').classList.remove('active');
        bgForm.reset();
        showToast('Break-glass privilege elevation activated!', 'danger');
        syncData();
      } else {
        showToast(data.error || 'Authorization failed', 'danger');
      }
    });
  }
}

async function loadData() {
  try {
    const [usersRes, rolesRes, reqsRes, auditRes, resRes] = await Promise.all([
      fetch('/api/users'),
      fetch('/api/roles'),
      fetch('/api/requests'),
      fetch('/api/audit'),
      fetch('/api/resources')
    ]);

    currentDirectoryUsers = await usersRes.json();
    currentRoles = await rolesRes.json();
    currentRequests = await reqsRes.json();
    currentAuditLogs = await auditRes.json();
    currentResources = await resRes.json();

    populateRoleOptions();
    renderPolicyTable();
    renderUsersVerificationTable();
    updateUI();
  } catch (err) {
    console.error('Data load failed:', err);
  }
}

async function syncData() {
  try {
    const [usersRes, reqsRes, auditRes, resRes] = await Promise.all([
      fetch('/api/users'),
      fetch('/api/requests'),
      fetch('/api/audit'),
      fetch('/api/resources')
    ]);

    currentDirectoryUsers = await usersRes.json();
    currentRequests = await reqsRes.json();
    currentAuditLogs = await auditRes.json();
    currentResources = await resRes.json();
    updateUI();
  } catch (err) {
    console.error('Sync error:', err);
  }
}

function updateUI() {
  try { updateMetrics(); } catch(e) { console.error('updateMetrics', e); }
  try { renderActiveRoleCards(); } catch(e) { console.error('renderActiveRoleCards', e); }
  try { renderRequestsTable(currentRequests); } catch(e) { console.error('renderRequestsTable', e); }
  try { renderApprovalsQueue(); } catch(e) { console.error('renderApprovalsQueue', e); }
  try { renderResourcesGrid(); } catch(e) { console.error('renderResourcesGrid', e); }
  try { renderAuditLogs(); } catch(e) { console.error('renderAuditLogs', e); }
}

function populateRoleOptions() {
  const sel = document.getElementById('reqRoleSelect');
  const bgSel = document.getElementById('bgRoleSelect');
  if (!sel || !bgSel) return;
  const options = currentRoles.map(r => `<option value="${r.name}">${r.name} (${r.type})</option>`).join('');
  sel.innerHTML = options;
  bgSel.innerHTML = options;
  sel.dispatchEvent(new Event('change'));
}

function updateMetrics() {
  const active = currentRequests.filter(r => r.status === 'Active').length;
  const pending = currentRequests.filter(r => r.status === 'Pending Approval').length;
  const expired = currentRequests.filter(r => r.status === 'Expired').length;

  const eligEl = document.getElementById('statEligibleCount');
  if (eligEl) eligEl.innerText = currentRoles.length;
  const actEl = document.getElementById('statActiveCount');
  if (actEl) actEl.innerText = active;
  const pendEl = document.getElementById('statPendingCount');
  if (pendEl) pendEl.innerText = pending;
  const expEl = document.getElementById('statExpiredCount');
  if (expEl) expEl.innerText = expired;

  const notifDot = document.getElementById('pendingNotifDot');
  const counter = document.getElementById('approvalCounter');
  if (counter) counter.innerText = pending;
  if (notifDot) {
    if (pending > 0 && currentAuthUser && currentAuthUser.appRole !== 'user') {
      notifDot.classList.add('visible');
    } else {
      notifDot.classList.remove('visible');
    }
  }
}

function renderActiveRoleCards() {
  const container = document.getElementById('activeRolesContainer');
  if (!container) return;
  const activeReqs = currentRequests.filter(r => r.status === 'Active');
  const now = Date.now();

  if (activeReqs.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: #64748b; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px;">
        <i class="fa-solid fa-shield-halved" style="font-size: 1.8rem; margin-bottom: 8px;"></i>
        <p>No active elevated privileges. Standing access is Zero-Trust restricted.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = activeReqs.map(r => {
    const totalMs = (parseInt(r.durationSeconds) || 3600) * 1000;
    const remainingMs = Math.max(0, (parseInt(r.expiresAt) || 0) - now);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const progressPct = Math.min(100, Math.max(0, (remainingMs / totalMs) * 100));

    return `
      <div class="active-card">
        <div class="active-card-top">
          <div>
            <div class="active-role-title">${r.roleName}</div>
            <div class="scope-badge"><i class="fa-solid fa-cube"></i> ${r.scope}</div>
          </div>
          <span class="status-badge status-active">${r.isBreakGlass ? 'P0 Break-Glass' : 'Active JIT'}</span>
        </div>
        <div class="countdown-box">
          <span style="font-size: 0.8rem; color: #64748b;"><i class="fa-solid fa-hourglass-half"></i> Revocation Countdown</span>
          <span class="countdown-digits" style="font-size: 1.05rem;">${formatRemainingTime(remainingSec)}</span>
        </div>
        <div class="countdown-bar-wrapper">
          <div class="countdown-bar-fill" style="width: ${progressPct}%;"></div>
        </div>
        <div style="margin-top: 10px; font-size: 0.75rem; color: #64748b;">
          Assigned User: <strong>${r.user}</strong> | Approver: <strong>${r.approver || 'System'}</strong>
        </div>
      </div>
    `;
  }).join('');
}

function renderRequestsTable(list) {
  const tbody = document.getElementById('requestsTableBody');
  if (!tbody) return;
  const now = Date.now();

  tbody.innerHTML = list.map(r => {
    let statusClass = 'status-pending';
    let timeLeft = 'Awaiting Sign-off';

    if (r.status === 'Active') {
      statusClass = 'status-active';
      const sec = Math.max(0, Math.ceil(((parseInt(r.expiresAt) || 0) - now) / 1000));
      timeLeft = `<strong>${formatRemainingTime(sec)} remaining</strong>`;
    } else if (r.status === 'Expired') {
      statusClass = 'status-expired';
      timeLeft = 'Revoked Automatically';
    } else if (r.status === 'Denied') {
      statusClass = 'status-denied';
      timeLeft = 'Denied';
    }

    return `
      <tr>
        <td><strong>${r.id}</strong></td>
        <td>
          <div style="font-weight: 600;">${r.roleName}</div>
          <div style="font-size: 0.72rem; color: #64748b;">User: ${r.user}</div>
        </td>
        <td><code style="font-size: 0.72rem; background: #f1f5f9; padding: 2px 4px;">${r.scope}</code></td>
        <td>
          <div><strong class="text-azure">[${r.ticketId}]</strong> ${r.justification}</div>
        </td>
        <td><span class="status-badge ${statusClass}">${r.status}</span></td>
        <td>${timeLeft}</td>
        <td>
          ${(r.status === 'Active' && currentAuthUser && (currentAuthUser.appRole === 'superadmin' || r.user === currentAuthUser.email)) 
            ? `<button class="btn btn-outline btn-sm" onclick="forceExpire('${r.id}')"><i class="fa-solid fa-lock"></i> Deactivate</button>` 
            : '-'}
        </td>
      </tr>
    `;
  }).join('');
}

function renderApprovalsQueue() {
  const container = document.getElementById('approvalQueueContainer');
  if (!container) return;
  const pending = currentRequests.filter(r => r.status === 'Pending Approval');

  if (pending.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 30px; text-align: center; color: #64748b;">
        <i class="fa-solid fa-clipboard-check" style="font-size: 2rem; margin-bottom: 8px;"></i>
        <p>No pending authorization requests in queue.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = pending.map(r => {
    const sec = parseInt(r.durationSeconds) || 3600;
    const durDisplay = sec >= 3600 ? (sec / 3600) + ' Hour(s)' : sec + 's';
    return `
      <div class="approval-card" style="border: 1px solid #edebe9; border-left: 5px solid #d97706; padding: 16px; border-radius: 4px; background: #fff; margin-bottom: 12px;">
        <h4 style="font-size: 1rem; color: #1e293b; margin-bottom: 6px;">${r.roleName}</h4>
        <div class="approval-meta" style="font-size: 0.82rem; color: #64748b; margin-bottom: 8px;">
          Request ID: <strong>${r.id}</strong> | Requestor: <strong>${r.user}</strong><br>
          Requested Duration: <strong>${durDisplay}</strong> | Created: ${r.createdAt}
        </div>
        <div class="approval-justification" style="background: #f8fafc; border: 1px dashed #cbd5e1; padding: 10px; border-radius: 3px; font-size: 0.82rem; font-style: italic; margin-bottom: 12px;">
          "${r.justification || 'No justification provided'}" [Ticket: ${r.ticketId || 'N/A'}]
        </div>
        <div class="approval-btn-group" style="display: flex; gap: 8px;">
          <button class="btn btn-success btn-sm" onclick="decideRequest('${r.id}', 'approve')">
            <i class="fa-solid fa-check"></i> Approve Elevation
          </button>
          <button class="btn btn-danger btn-sm" onclick="decideRequest('${r.id}', 'reject')">
            <i class="fa-solid fa-xmark"></i> Deny
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderResourcesGrid() {
  const container = document.getElementById('resourceGridContainer');
  if (!container) return;
  container.innerHTML = currentResources.map(res => `
    <div class="resource-card ${res.accessible ? 'unlocked' : 'locked'}">
      <div class="resource-card-header">
        <span class="resource-name">${res.resourceName}</span>
        <span class="gate-status ${res.accessible ? 'gate-unlocked' : 'gate-locked'}">
          <i class="fa-solid ${res.accessible ? 'fa-lock-open' : 'fa-lock'}"></i>
          ${res.accessible ? 'ACCESSIBLE' : 'ACCESS DENIED'}
        </span>
      </div>
      <div class="resource-type">${res.resourceType}</div>
      <div style="margin-top: 12px; font-size: 0.8rem; color: #475569;">
        Required Elevated Role:<br>
        <strong>${res.requiredRole}</strong>
      </div>
      <div style="margin-top: 10px;">
        <button class="btn btn-sm ${res.accessible ? 'btn-azure' : 'btn-outline'}" ${!res.accessible ? 'disabled' : ''} onclick="accessResource('${res.resourceName}')">
          <i class="fa-solid fa-terminal"></i> ${res.accessible ? 'Manage Resource' : 'Permission Required'}
        </button>
      </div>
    </div>
  `).join('');
}

function renderPolicyTable() {
  const tbody = document.getElementById('policyTableBody');
  if (!tbody) return;
  tbody.innerHTML = currentRoles.map(r => `
    <tr>
      <td><strong>${r.name}</strong></td>
      <td><span style="font-size: 0.75rem; color: #64748b;">${r.scope}</span></td>
      <td>
        <input type="number" id="dur-${r.id}" value="${r.maxDurationHours}" min="1" max="24" style="width: 50px; padding: 4px;"> hrs
      </td>
      <td>
        <input type="checkbox" id="appr-${r.id}" ${r.requireApproval ? 'checked' : ''}> Required
      </td>
      <td>
        <input type="checkbox" id="mfa-${r.id}" ${r.requireMFA ? 'checked' : ''}> Enforce MFA
      </td>
      <td><span style="font-size: 0.78rem;">${r.approvers}</span></td>
      <td>
        <button class="btn btn-azure btn-sm" onclick="savePolicy('${r.id}')"><i class="fa-solid fa-floppy-disk"></i> Save</button>
      </td>
    </tr>
  `).join('');
}

async function savePolicy(id) {
  if (!currentAuthUser || currentAuthUser.appRole !== 'superadmin') {
    showToast('Only SuperAdmin can modify governance policies.', 'danger');
    return;
  }

  const payload = {
    id,
    maxDurationHours: document.getElementById(`dur-${id}`).value,
    requireApproval: document.getElementById(`appr-${id}`).checked,
    requireMFA: document.getElementById(`mfa-${id}`).checked
  };

  const res = await fetch('/api/roles/policy', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-user-email': currentAuthUser.email
    },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    showToast('Governance policy updated successfully', 'success');
    loadData();
  } else {
    const data = await res.json();
    showToast(data.error || 'Failed to update policy', 'danger');
  }
}

function renderUsersVerificationTable() {
  const tbody = document.getElementById('usersVerificationTableBody');
  if (!tbody) return;
  tbody.innerHTML = currentDirectoryUsers.map(u => {
    const isSuperAdmin = u.appRole === 'superadmin';

    let actionBtn = '';
    if (isSuperAdmin) {
      actionBtn = '<span style="font-size: 0.75rem; color: #b91c1c; font-weight: 700;">ROOT SUPERADMIN</span>';
    } else if (u.appRole === 'user') {
      actionBtn = `
        <button class="btn btn-sm btn-promote" onclick="promoteDemoteUser('${u.id}', 'admin')">
          <i class="fa-solid fa-arrow-up"></i> Promote to Admin
        </button>
      `;
    } else if (u.appRole === 'admin') {
      actionBtn = `
        <button class="btn btn-sm btn-demote" onclick="promoteDemoteUser('${u.id}', 'user')">
          <i class="fa-solid fa-arrow-down"></i> Demote to User
        </button>
      `;
    }

    return `
      <tr>
        <td>
          <strong>${u.name}</strong><br>
          <code style="font-size: 0.75rem; color: #64748b;">${u.email}</code>
        </td>
        <td>
          <span class="role-pill-badge role-pill-${u.appRole}">${u.appRole.toUpperCase()}</span>
        </td>
        <td>
          <input type="checkbox" id="user-verify-${u.id}" ${u.isVerified ? 'checked' : ''} ${isSuperAdmin ? 'disabled' : ''}>
          <span class="${u.isVerified ? 'badge-verified' : 'badge-unverified'}">${u.isVerified ? 'Verified' : 'Unverified'}</span>
        </td>
        <td>
          <input type="checkbox" id="user-jit-${u.id}" ${u.jitPermissionGranted ? 'checked' : ''} ${isSuperAdmin ? 'disabled' : ''}>
          <span style="font-size: 0.8rem;">${u.jitPermissionGranted ? 'Enabled' : 'Disabled'}</span>
        </td>
        <td>${actionBtn}</td>
        <td>
          ${isSuperAdmin ? '-' : `
            <button class="btn btn-azure btn-sm" onclick="saveUserGovernance('${u.id}')">
              <i class="fa-solid fa-floppy-disk"></i> Save Permissions
            </button>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

async function promoteDemoteUser(id, targetRole) {
  if (!currentAuthUser || currentAuthUser.appRole !== 'superadmin') return;

  const res = await fetch(`/api/users/${id}/promote-demote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-email': currentAuthUser.email
    },
    body: JSON.stringify({ targetRole })
  });

  const data = await res.json();
  if (res.ok) {
    showToast(data.message, 'success');
    loadData();
  } else {
    showToast(data.error || 'Failed to update role', 'danger');
  }
}

async function saveUserGovernance(id) {
  if (!currentAuthUser || currentAuthUser.appRole !== 'superadmin') return;

  const isVerified = document.getElementById(`user-verify-${id}`).checked;
  const jitPermissionGranted = document.getElementById(`user-jit-${id}`).checked;

  const res = await fetch(`/api/users/${id}/governance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-email': currentAuthUser.email
    },
    body: JSON.stringify({ isVerified, jitPermissionGranted })
  });

  if (res.ok) {
    showToast('Identity verification status and JIT permissions updated', 'success');
    loadData();
  } else {
    const data = await res.json();
    showToast(data.error || 'Update failed', 'danger');
  }
}

function renderAuditLogs() {
  const stream = document.getElementById('auditLogStream');
  if (!stream) return;
  stream.innerHTML = currentAuditLogs.map(l => `
    <div class="log-row">
      <span class="log-time">[${l.timestamp}]</span>
      <span class="log-action">&lt;${l.action}&gt;</span>
      <span class="log-actor">[${l.actor}]</span>:
      <span class="log-details">${l.details}</span>
    </div>
  `).join('');
}

async function decideRequest(id, action) {
  const res = await fetch(`/api/requests/${id}/action`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-user-email': currentAuthUser.email
    },
    body: JSON.stringify({ action })
  });

  const data = await res.json();
  if (res.ok) {
    showToast(`Request ${id} marked as ${action === 'approve' ? 'Approved' : 'Denied'}`, action === 'approve' ? 'success' : 'danger');
    syncData();
  } else {
    showToast(data.error || 'Authorization failed', 'danger');
  }
}

async function forceExpire(id) {
  const res = await fetch(`/api/requests/${id}/action`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-user-email': currentAuthUser.email
    },
    body: JSON.stringify({ action: 'reject' })
  });
  showToast('Privilege revocation executed immediately', 'info');
  syncData();
}

function accessResource(name) {
  showToast(`Authorized session open for ${name}. Permissions verified via active JIT token.`, 'success');
}

function exportAuditCsv() {
  const headers = ['Log ID,Timestamp,Action,Actor,Details\n'];
  const rows = currentAuditLogs.map(l => `"${l.id}","${l.timestamp}","${l.action}","${l.actor}","${l.details.replace(/"/g, '""')}"`);
  downloadFile(headers.concat(rows).join('\n'), 'azure-pim-audit.csv', 'text/csv');
}

function exportAuditJson() {
  downloadFile(JSON.stringify(currentAuditLogs, null, 2), 'azure-pim-audit.json', 'application/json');
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
