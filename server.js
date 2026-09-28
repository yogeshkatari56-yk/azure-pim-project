const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MySQL Connection Pool with your verified credentials
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'y115@224Y',
  database: 'azure_pim_db',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function initDatabase() {
  try {
    // 1. Establish initial connection to ensure azure_pim_db exists
    const initConn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'y115@224Y',
      port: 3306
    });
    await initConn.query('CREATE DATABASE IF NOT EXISTS azure_pim_db;');
    await initConn.end();

    const conn = await pool.getConnection();

    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        name VARCHAR(100) NOT NULL,
        appRole VARCHAR(20) NOT NULL,
        department VARCHAR(100),
        isVerified TINYINT(1) DEFAULT 1,
        jitPermissionGranted TINYINT(1) DEFAULT 1
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        scope VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        maxDurationHours INT NOT NULL,
        requireApproval TINYINT(1) NOT NULL,
        requireMFA TINYINT(1) NOT NULL,
        approvers VARCHAR(255) NOT NULL
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id VARCHAR(50) PRIMARY KEY,
        user VARCHAR(100) NOT NULL,
        roleName VARCHAR(100) NOT NULL,
        scope VARCHAR(255) NOT NULL,
        ticketId VARCHAR(50),
        justification TEXT NOT NULL,
        durationSeconds INT NOT NULL,
        status VARCHAR(50) NOT NULL,
        createdAt VARCHAR(50) NOT NULL,
        expiresAt BIGINT NULL,
        approver VARCHAR(100) NULL,
        isBreakGlass TINYINT(1) DEFAULT 0
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(50) PRIMARY KEY,
        timestamp VARCHAR(50) NOT NULL,
        action VARCHAR(100) NOT NULL,
        actor VARCHAR(100) NOT NULL,
        details TEXT NOT NULL
      ) ENGINE=InnoDB;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS protected_resources (
        id VARCHAR(50) PRIMARY KEY,
        resourceName VARCHAR(100) NOT NULL,
        resourceType VARCHAR(50) NOT NULL,
        requiredRole VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL
      ) ENGINE=InnoDB;
    `);

    // Ensure baseline users are seeded
    await conn.query(`
      INSERT INTO users (id, email, password, name, appRole, department, isVerified, jitPermissionGranted) VALUES
      ('usr-superadmin', 'superadminazure@gmail.com', 'superadmin@123', 'Global SuperAdmin (CISO)', 'superadmin', 'Identity Governance Root', 1, 1),
      ('usr-admin', 'admin@contoso.com', 'admin@123', 'Operational Admin (Manager)', 'admin', 'IT Operations', 1, 1),
      ('usr-user', 'user@contoso.com', 'user@123', 'Standard User (Engineer)', 'user', 'Cloud Infrastructure', 1, 1)
      ON DUPLICATE KEY UPDATE password=VALUES(password);
    `);

    // Ensure baseline roles
    const [roleRows] = await conn.query('SELECT COUNT(*) as count FROM roles');
    if (roleRows[0].count === 0) {
      await conn.query(`
        INSERT INTO roles VALUES 
        ('role-1', 'Subscription Contributor', '/subscriptions/prod-sub-01/resourceGroups/rg-core-services', 'Azure Resource', 8, 1, 1, 'admin@contoso.com, superadminazure@gmail.com'),
        ('role-2', 'User Access Administrator', 'Tenant Root Group (Entra ID Directory)', 'Directory Role', 4, 1, 1, 'superadminazure@gmail.com'),
        ('role-3', 'Key Vault Crypto Officer', 'kv-prod-eastus-01 (Secrets & Keys)', 'Azure Resource', 2, 1, 1, 'admin@contoso.com, superadminazure@gmail.com'),
        ('role-4', 'Network Contributor (Emergency Only)', 'vnet-hub-spoke-prod', 'Azure Resource', 1, 0, 1, 'None (Pre-authorized)');
      `);
    }

    // Ensure baseline resources
    const [resRows] = await conn.query('SELECT COUNT(*) as count FROM protected_resources');
    if (resRows[0].count === 0) {
      await conn.query(`
        INSERT INTO protected_resources VALUES
        ('res-1', 'vm-production-sql-01', 'Virtual Machine', 'Subscription Contributor', 'RESTRICTED'),
        ('res-2', 'kv-prod-eastus-01', 'Key Vault Secret Store', 'Key Vault Crypto Officer', 'RESTRICTED'),
        ('res-3', 'entra-tenant-users', 'Identity Directory Tenant', 'User Access Administrator', 'RESTRICTED');
      `);
    }

    conn.release();
    console.log('[SUCCESS] Connected to MySQL Workbench schema: azure_pim_db');
  } catch (err) {
    console.error('[ERROR] MySQL Connection Failed:', err.message);
  }
}

initDatabase();

async function logAudit(action, actor, details) {
  try {
    const id = 'LOG-' + Math.floor(1000 + Math.random() * 9000);
    const timestamp = new Date().toLocaleTimeString();
    await pool.query(
      'INSERT INTO audit_logs (id, timestamp, action, actor, details) VALUES (?, ?, ?, ?, ?)',
      [id, timestamp, action, actor, details]
    );
  } catch (e) {}
}

async function getCallerUser(req) {
  const email = req.headers['x-user-email'];
  if (!email) return null;
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0] || null;
}

// 1. User Registration with Password Validation
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, department } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const [existing] = await pool.query('SELECT email FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const newId = 'usr-' + Date.now().toString().slice(-6);
    await pool.query(
      `INSERT INTO users (id, email, password, name, appRole, department, isVerified, jitPermissionGranted)
       VALUES (?, ?, ?, ?, 'user', ?, 0, 0)`,
      [newId, email, password, name, department || 'General Engineering']
    );

    await logAudit('USER_REGISTERED', email, `New user account created: ${name} (${email}). Awaiting SuperAdmin verification.`);

    res.json({
      success: true,
      message: 'Account registered successfully! Please sign in. SuperAdmin will verify your account.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error occurred during registration.' });
  }
});

// 2. User Sign-in
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND password = ?', [email, password]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials. Please verify your email and password.' });
    }

    await logAudit('USER_LOGIN', user.email, `User logged in with role [${user.appRole.toUpperCase()}].`);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        appRole: user.appRole,
        department: user.department,
        isVerified: Boolean(user.isVerified),
        jitPermissionGranted: Boolean(user.jitPermissionGranted)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Cannot connect to database. Ensure MySQL service is running.' });
  }
});

// 3. User Governance Directory
app.get('/api/users', async (req, res) => {
  const [users] = await pool.query('SELECT id, email, name, appRole, department, isVerified, jitPermissionGranted FROM users');
  res.json(users.map(u => ({ ...u, isVerified: Boolean(u.isVerified), jitPermissionGranted: Boolean(u.jitPermissionGranted) })));
});

// 4. Promote / Demote
app.post('/api/users/:id/promote-demote', async (req, res) => {
  const caller = await getCallerUser(req);
  if (!caller || caller.appRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only SuperAdmin can promote or demote users.' });
  }

  const { id } = req.params;
  const { targetRole } = req.body;
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  const target = rows[0];

  if (!target) return res.status(404).json({ error: 'Target identity not found.' });
  if (target.appRole === 'superadmin') {
    return res.status(400).json({ error: 'SuperAdmin cannot be demoted.' });
  }

  await pool.query('UPDATE users SET appRole = ? WHERE id = ?', [targetRole, id]);
  await logAudit('ROLE_CONVERSION', caller.email, `SuperAdmin converted role of ${target.email} to ${targetRole.toUpperCase()}`);

  res.json({ success: true, message: `Successfully updated ${target.email} to ${targetRole.toUpperCase()}` });
});

// 5. User Verification & JIT Toggle
app.post('/api/users/:id/governance', async (req, res) => {
  const caller = await getCallerUser(req);
  if (!caller || caller.appRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only SuperAdmin can verify users and manage JIT access grants.' });
  }

  const { id } = req.params;
  const { isVerified, jitPermissionGranted } = req.body;
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'User not found' });

  await pool.query(
    'UPDATE users SET isVerified = ?, jitPermissionGranted = ? WHERE id = ?',
    [isVerified ? 1 : 0, jitPermissionGranted ? 1 : 0, id]
  );

  await logAudit('USER_GOVERNANCE_UPDATE', caller.email, `Updated ${target.email}: Verified=${Boolean(isVerified)}, JIT_Allowed=${Boolean(jitPermissionGranted)}`);
  res.json({ success: true });
});

// 6. Full Telemetry Dump
app.get('/api/pim/full-inspection', async (req, res) => {
  const caller = await getCallerUser(req);
  if (!caller || caller.appRole !== 'superadmin') {
    return res.status(403).json({ error: 'SuperAdmin credentials required for telemetry.' });
  }

  const [users] = await pool.query('SELECT id, email, name, appRole, department, isVerified, jitPermissionGranted FROM users');
  const [roles] = await pool.query('SELECT * FROM roles');
  const [requests] = await pool.query('SELECT * FROM requests ORDER BY id DESC');
  const [auditLogs] = await pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50');
  const [resources] = await pool.query('SELECT * FROM protected_resources');

  res.json({
    generatedAt: new Date().toISOString(),
    superAdminAuthorized: caller.email,
    summary: {
      totalUsers: users.length,
      verifiedUsers: users.filter(u => u.isVerified).length,
      admins: users.filter(u => u.appRole === 'admin').length,
      activeJitSessions: requests.filter(r => r.status === 'Active').length,
      pendingRequests: requests.filter(r => r.status === 'Pending Approval').length
    },
    users: users.map(u => ({ ...u, isVerified: Boolean(u.isVerified), jitPermissionGranted: Boolean(u.jitPermissionGranted) })),
    roles,
    requests,
    resources,
    auditLogs
  });
});

// 7. Roles & Policies
app.get('/api/roles', async (req, res) => {
  const [roles] = await pool.query('SELECT * FROM roles');
  res.json(roles.map(r => ({ ...r, requireApproval: Boolean(r.requireApproval), requireMFA: Boolean(r.requireMFA) })));
});

app.post('/api/roles/policy', async (req, res) => {
  const caller = await getCallerUser(req);
  if (!caller || caller.appRole !== 'superadmin') {
    return res.status(403).json({ error: 'Only SuperAdmin can modify governance policies.' });
  }

  const { id, maxDurationHours, requireApproval, requireMFA } = req.body;
  await pool.query(
    'UPDATE roles SET maxDurationHours = ?, requireApproval = ?, requireMFA = ? WHERE id = ?',
    [Number(maxDurationHours), requireApproval ? 1 : 0, requireMFA ? 1 : 0, id]
  );
  await logAudit('POLICY_UPDATED', caller.email, `Updated policy for role ID ${id}`);
  res.json({ success: true });
});

// 8. Requests & Approvals
app.get('/api/requests', async (req, res) => {
  const [requests] = await pool.query('SELECT * FROM requests ORDER BY id DESC');
  res.json(requests);
});

app.post('/api/requests/create', async (req, res) => {
  const caller = await getCallerUser(req);
  if (!caller) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });

  if (!caller.isVerified) {
    return res.status(403).json({ error: 'Identity Unverified: SuperAdmin must verify your account before you can request access.' });
  }

  if (!caller.jitPermissionGranted && !req.body.isBreakGlass) {
    return res.status(403).json({ error: 'Permission Denied: SuperAdmin has not granted JIT permissions to your account.' });
  }

  const { roleName, ticketId, justification, durationSeconds, mfaCode, isBreakGlass } = req.body;

  if (isBreakGlass && caller.appRole !== 'superadmin') {
    return res.status(403).json({ error: 'Break-Glass procedure strictly requires SuperAdmin clearance.' });
  }

  const [roleRows] = await pool.query('SELECT * FROM roles WHERE name = ?', [roleName]);
  const roleConfig = roleRows[0];
  if (!roleConfig) return res.status(400).json({ error: 'Role not found' });

  if (roleConfig.requireMFA && mfaCode !== '123456' && !isBreakGlass) {
    return res.status(401).json({ error: 'Invalid MFA verification passcode. Use OTP: 123456' });
  }

  const needsApproval = isBreakGlass ? false : Boolean(roleConfig.requireApproval);
  const reqId = 'REQ-' + Math.floor(1000 + Math.random() * 9000);
  const nowTime = new Date().toLocaleTimeString();
  const expiresAt = needsApproval ? null : Date.now() + parseInt(durationSeconds) * 1000;
  const status = needsApproval ? 'Pending Approval' : 'Active';
  const approver = isBreakGlass ? 'BREAK-GLASS BYPASS' : (needsApproval ? null : 'Policy Direct Grant');

  await pool.query(
    `INSERT INTO requests (id, user, roleName, scope, ticketId, justification, durationSeconds, status, createdAt, expiresAt, approver, isBreakGlass)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [reqId, caller.email, roleName, roleConfig.scope, ticketId || 'N/A', justification, parseInt(durationSeconds), status, nowTime, expiresAt, approver, isBreakGlass ? 1 : 0]
  );

  await logAudit(
    isBreakGlass ? 'BREAK_GLASS_ELEVATION' : (needsApproval ? 'ELEVATION_REQUESTED' : 'ELEVATION_GRANTED_DIRECT'),
    caller.email,
    `[Role: ${caller.appRole.toUpperCase()}] Request for ${roleName} (${status}). Ticket: ${ticketId}`
  );

  res.json({ success: true, request: { id: reqId, status } });
});

app.post('/api/requests/:id/action', async (req, res) => {
  const caller = await getCallerUser(req);
  if (!caller || (caller.appRole !== 'admin' && caller.appRole !== 'superadmin')) {
    return res.status(403).json({ error: 'Only Admin or SuperAdmin can review elevation requests.' });
  }

  const { id } = req.params;
  const { action } = req.body;
  const [rows] = await pool.query('SELECT * FROM requests WHERE id = ?', [id]);
  const target = rows[0];

  if (!target) return res.status(404).json({ error: 'Request not found' });
  if (target.status !== 'Pending Approval') return res.status(400).json({ error: 'Request is no longer pending' });

  if (action === 'approve') {
    const expiresAt = Date.now() + target.durationSeconds * 1000;
    await pool.query('UPDATE requests SET status = ?, approver = ?, expiresAt = ? WHERE id = ?', ['Active', caller.email, expiresAt, id]);
    await logAudit('ELEVATION_APPROVED', caller.email, `Approved request ${id} (${target.roleName}) for ${target.user}`);
  } else {
    await pool.query('UPDATE requests SET status = ?, approver = ? WHERE id = ?', ['Denied', caller.email, id]);
    await logAudit('ELEVATION_DENIED', caller.email, `Rejected request ${id} for ${target.user}`);
  }

  res.json({ success: true });
});

app.get('/api/audit', async (req, res) => {
  const [logs] = await pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100');
  res.json(logs);
});

app.get('/api/resources', async (req, res) => {
  const [resources] = await pool.query('SELECT * FROM protected_resources');
  const [activeRoles] = await pool.query("SELECT DISTINCT roleName FROM requests WHERE status = 'Active'");
  const activeRoleSet = new Set(activeRoles.map(r => r.roleName));

  const statusMapped = resources.map(resItem => ({
    ...resItem,
    accessible: activeRoleSet.has(resItem.requiredRole)
  }));

  res.json(statusMapped);
});

setInterval(async () => {
  try {
    const now = Date.now();
    const [activeList] = await pool.query("SELECT * FROM requests WHERE status = 'Active'");

    for (const req of activeList) {
      if (req.expiresAt && now >= req.expiresAt) {
        await pool.query("UPDATE requests SET status = 'Expired' WHERE id = ?", [req.id]);
        await logAudit('PRIVILEGE_REVOKED', 'Azure-PIM-Scheduler', `Automatic role revocation: ${req.roleName} expired for ${req.user}`);
      }
    }
  } catch (e) {}
}, 1000);

app.listen(PORT, () => {
  console.log(`Azure PIM SuperAdmin Hub running at: http://localhost:${PORT}`);
});
