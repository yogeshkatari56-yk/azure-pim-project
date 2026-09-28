# Microsoft Entra ID Privileged Identity Management (PIM) Portal

A full-stack implementation of Azure Entra ID Privileged Identity Management (PIM) built with Node.js, Express, and MySQL.

## Key Features
- **Zero-Trust Access Control**: Time-bound Just-In-Time (JIT) access with automated expiration countdowns (1–8 hours).
- **MFA Enforcement**: Entra ID code validation for elevated role activations.
- **Three-Tier Role Hierarchy**:
  - `Tier 1`: Registered Users (unverified by default).
  - `Tier 2`: Approvers / Managers.
  - `Tier 3`: SuperAdmin (Root CISO) with full governance authority.
- **Approver Dashboard**: Review, approve, or deny elevation requests in real time.
- **Emergency Break-Glass (P0)**: Fast-track bypass for critical outage incidents with high-severity audit logging.
- **Live Audit & Compliance Trail**: Complete session telemetry with CSV and JSON export support.

## Tech Stack
- **Backend**: Node.js, Express.js, `mysql2/promise`
- **Database**: MySQL Server (`azure_pim_db`)
- **Frontend**: Vanilla JavaScript, CSS3, HTML5

## Getting Started

### Prerequisites
- Node.js installed
- MySQL Server running on `localhost:3306`

### Database Setup
Create the database in MySQL Workbench:
```sql
CREATE DATABASE IF NOT EXISTS azure_pim_db;
