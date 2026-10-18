# PharmacyOS

**PharmacyOS** is a pharmacy management and point-of-sale system engineered specifically for community pharmacies in Pakistan. It combines a transactional NestJS backend with a Next.js App Router web application featuring FEFO (First-Expired, First-Out) batch inventory, audit logging, cash drawer reconciliation, and a keyboard-first POS counter.

---

## 1. System Architecture

```
PharmacyOS/
├── apps/
│   ├── api/                 # NestJS 11 REST API (Node.js, Mongoose, Pino)
│   │   ├── src/             # Domain modules: products, inventory, pos, purchasing, etc.
│   │   └── test/            # Integration & unit test suites (Jest, Supertest)
│   └── web/                 # Next.js 15 App Router web application
│       ├── src/app/         # Routes: Dashboard, POS, Products, Inventory, Purchasing, Sales, etc.
│       ├── src/components/  # UI primitives & application shell (Sidebar, Header, Dialogs)
│       └── src/lib/         # Centralized API client, AuthContext, PKR formatting utilities
├── packages/
│   └── shared-types/        # Shared DTOs, Enums, and Permission matrices
├── docs/                    # Implementation status & architecture notes
└── .mongo-data/             # Embedded persistent MongoDB WiredTiger replica set (zero setup)
```

---

## 2. Design System & Aesthetics

PharmacyOS uses an intentional visual hierarchy tailored for healthcare operations:
- **Midnight Navy-Teal (`#122A36`)**: Shell, headers, high-contrast typography, and cards.
- **Pharmacy Green (`#159A72`)**: Primary action buttons, badges, profit metrics, and accents.
- **Mist Background (`#F4F7F6`)**: Low-glare, eye-friendly surface for long shifts.
- **Amber Accent (`#E8B04A`)**: Warnings, near-expiry alerts, and secondary chart metrics.
- **PKR Currency Precision**: Formatted integer minor units (paisa) into Pakistani Rupees (`Rs. X.XX`).

---

## 3. Quick Start & Local Setup

### Prerequisites
- **Node.js**: >= 20.x
- **pnpm**: >= 10.x / 11.x

### Installation
Clone the repository and install all workspace dependencies:
```bash
pnpm install
```

### Environment Configuration
Copy the provided `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(Note: Leaving `MONGODB_URI` empty enables the built-in embedded replica set in `.mongo-data`, meaning zero external database setup is required for local development).*

### Seed Realistic Demo Data
The seed script populates 39 common Pakistani market medicines, realistic suppliers, customers, 70 days of transactional sales history, and action center alerts:
```bash
pnpm seed
```

### Start Local Development Servers
Run both the API and Web App in parallel:
```bash
pnpm dev
```
- **Web App**: [http://localhost:3000](http://localhost:3000)
- **API Server**: [http://localhost:4000/api/v1](http://localhost:4000/api/v1)
- **Swagger Documentation**: [http://localhost:4000/api/docs](http://localhost:4000/api/docs)

---

## 4. Key Application Features

### 🛒 Dedicated POS Counter (`/pos`)
- **Keyboard-First Shortcuts**:
  - `F2`: Instant focus on barcode/name search
  - `F4`: Open or manage cash drawer session
  - `F7`: Held carts dialog
  - `F8`: Hold active cart to serve next patron
  - `F9`: Pay & checkout tender confirmation
  - `Esc`: Close modals or cancel search
- **FEFO Batch Allocations**: Cart lines calculate live advisory quotes via `POST /pos/sales/quote`.
- **Payment Tenders**: Cash with quick change calculation, Card slip reference, Mobile Wallet (Easypaisa/JazzCash), and Customer Credit.
- **Thermal Receipt**: Formatted 80mm printable thermal receipt view confirmed by server invoice.

### 📦 Batch-Level Inventory & Expiry Tracking (`/inventory`)
- Real-time batch cards with landed purchase costs, remaining shelf-life days, and status (`ACTIVE`, `QUARANTINED`, `EXPIRED`, `DEPLETED`).
- Double-entry stock movement ledger recording every physical unit addition, sale decrement, return, or write-off.
- Cyclic stock counts with maker-checker approval workflows.

### 🚚 Purchasing & Goods Receipts (`/purchasing`)
- Supplier directory with contact details and credit terms.
- Purchase orders with status tracking (`DRAFT` &rarr; `SUBMITTED` &rarr; `RECEIVED`).
- Goods receiving dialog capturing manufacturer lot number and expiry dates.

### 💰 Cash Drawer Sessions (`/cash-sessions`)
- Opening float declaration, intermediate cash-in / cash-out drops, physical counted closing, and variance calculation.

### 📊 Profit & Loss Reports (`/reports`)
- Authoritative server gross profit calculation from exact batch acquisition costs.
- 14-day sales trends, top sellers ranking, and slow-moving stock warnings.

### 🛡️ Action Center & Expiry Rescue (`/intelligence`)
- Automated rule-based engine scanning for batches expiring within 90 days and items falling below safety reorder levels.
- Interactive Business Assistant answering operational pharmacy questions.

---

## 5. Testing & Build Verification

### Backend Tests
```bash
pnpm --filter @pharmacy-os/api test
```
- 47 passing unit and integration tests verifying transactional consistency, concurrency race-condition prevention, and RBAC security.

### Web Tests
```bash
pnpm --filter @pharmacy-os/web test
```
- Vitest unit tests verifying currency formatters, date localization, and token lifecycle.

### Typecheck & Production Build
```bash
pnpm typecheck
pnpm build
```
- Full production compilation across all workspace packages with zero type errors.
