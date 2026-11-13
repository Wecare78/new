# Account Funds

Multi-page financial activation, live credit dashboard, UTR verification, and admin control portal powered by Vite, Firebase Firestore, and an optional Express server.

## Works Directly on GitHub Pages & Any Device

This repository includes automatic static build & deployment compatibility:
- **GitHub Pages Ready**: Configured with `base: './'` in `vite.config.ts`, relative asset references across `index.html`, `dashboard.html`, and `admin.html`, and an automated `.github/workflows/deploy.yml` workflow that builds and publishes `dist/` on push to `main` or `master`.
- **Static Hosting Fallback**: OTP generation/verification and Admin authentication automatically fall back cleanly when deployed statically without a Node server, while continuing to sync live user, UTR, receipt, and audit data with Firebase Firestore.
- **Responsive Across Devices**: Mobile (`320px+`), tablet, and desktop layouts, plus print/PDF-ready verified payment receipts.

### Enable GitHub Pages on Your Repository
1. Open **Settings → Pages** in your GitHub repository.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or trigger the **Deploy to GitHub Pages** workflow manually). Your live site URL will work out of the box.

## Local Development

### Prerequisites
- Node.js 20+

### Full-Stack Dev Server (Express + Vite)
```bash
npm install
npm run dev
```
Runs on `http://localhost:3000`.

### Production Static Build
```bash
npm run build
npm run preview
```
Outputs the multi-page bundle into `dist/` (`index.html`, `dashboard.html`, `admin.html`).

## Key Workflows
- **Customer Portal (`index.html` & `dashboard.html`)**: Mobile OTP verification, registration/login, bank & IFSC auto-verification, autodebit configuration, ₹399 activation UTR submission with live 3-step verification tracker, live credit engine, and ₹199 limit upgrade UTR submission with automatic Official Payment & Withdrawal Receipt generation upon Admin approval.
- **Admin Portal (`admin.html`)**: Real-time Firestore dashboard, user inspector, live activity & SMS logs, and filtered Customer UTR Verification Queue (`All`, `Pending`, `Verified`, `Rejected`) supporting instant approval/rejection and automatic receipt issuance.
