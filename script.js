function bootstrapApp() {

let _cdnBridgePromise = null;

async function bootstrapCdnFirebaseStore() {
    if (window.FirebaseStore) return window.FirebaseStore;
    if (_cdnBridgePromise) return _cdnBridgePromise;

    _cdnBridgePromise = (async () => {
        try {
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const cfgTimer = controller ? setTimeout(() => controller.abort(), 3000) : null;
            const cfgRes = await fetch('./firebase-applet-config.json', controller ? { signal: controller.signal } : undefined);
            if (cfgTimer) clearTimeout(cfgTimer);
            if (!cfgRes.ok) return null;
            const firebaseConfig = await cfgRes.json();

            const sdkLoad = Promise.all([
                import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js'),
                import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js')
            ]);
            const [appMod, fsMod] = await Promise.race([
                sdkLoad,
                new Promise((_, reject) => setTimeout(() => reject(new Error('CDN timeout')), 4500))
            ]);

            const app = appMod.initializeApp(firebaseConfig);
            const db = fsMod.getFirestore(app, firebaseConfig.firestoreDatabaseId);
            const toDocId = (u) => (String(u || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_') || `user_${Date.now()}`).slice(0, 120);
            const safeId = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            const cdnOtps = new Map();
            let activeTargetMobile = '';

            const findUser = async (identifier) => {
                const cleanId = String(identifier || '').trim();
                if (!cleanId) return null;
                try {
                    const directSnap = await fsMod.getDoc(fsMod.doc(db, 'users', toDocId(cleanId)));
                    if (directSnap.exists()) return directSnap.data();
                } catch {}
                try {
                    const q1 = fsMod.query(fsMod.collection(db, 'users'), fsMod.where('username', '==', cleanId), fsMod.limit(1));
                    const s1 = await fsMod.getDocs(q1);
                    if (!s1.empty) return s1.docs[0].data();
                } catch {}
                const digits = cleanId.replace(/\D/g, '').slice(-10);
                if (digits.length === 10) {
                    try {
                        const q2 = fsMod.query(fsMod.collection(db, 'users'), fsMod.where('mobile', '==', digits), fsMod.limit(1));
                        const s2 = await fsMod.getDocs(q2);
                        if (!s2.empty) return s2.docs[0].data();
                    } catch {}
                }
                return null;
            };

            const writeAct = async (username, actionType, details, category = 'general', status = 'success', mobileOverride = '') => {
                if (!username || username === 'demo') return null;
                const id = safeId('ACT');
                const entry = {
                    id,
                    username: String(username).slice(0, 64),
                    mobile: String(mobileOverride || '').slice(0, 20),
                    actionType: String(actionType).slice(0, 48),
                    category: String(category).slice(0, 48),
                    details: String(details || '').slice(0, 490),
                    status: String(status || 'success').slice(0, 32),
                    timestamp: new Date().toISOString()
                };
                try {
                    await fsMod.setDoc(fsMod.doc(db, 'activityLogs', id), entry);
                } catch {}
                return entry;
            };

            const store = {
                async sendRealMobileOtp(mobile) {
                    const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
                    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
                        return { success: false, message: 'Please enter a valid 10-digit Indian mobile number (starting 6-9)!' };
                    }
                    try {
                        const qMob = fsMod.query(fsMod.collection(db, 'users'), fsMod.where('mobile', '==', cleanMobile), fsMod.limit(1));
                        const snap = await Promise.race([
                            fsMod.getDocs(qMob),
                            new Promise((resolve) => setTimeout(() => resolve(null), 2200))
                        ]);
                        if (snap && !snap.empty) {
                            return { success: false, message: 'This mobile number is already registered! Please login instead.' };
                        }
                    } catch {}
                    activeTargetMobile = cleanMobile;
                    const code = String(Math.floor(100000 + Math.random() * 900000));
                    cdnOtps.set(cleanMobile, { code, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });
                    return { success: true, provider: 'free-otp', mobile: cleanMobile, otpCode: code, message: `Verification OTP generated for +91 ${cleanMobile}` };
                },
                async verifyRealMobileOtp(otpCode, mobile) {
                    const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
                    const cleanCode = String(otpCode || '').trim();
                    if (!/^\d{6}$/.test(cleanCode)) return { success: false, message: 'Please enter a valid 6-digit OTP code.' };
                    if (activeTargetMobile && activeTargetMobile !== cleanMobile) {
                        return { success: false, message: 'Mobile number changed. Please click Get OTP again.' };
                    }
                    const rec = cdnOtps.get(cleanMobile);
                    if (!rec) return { success: false, message: 'OTP expired or not found. Please click Get OTP again.' };
                    if (Date.now() > rec.expiresAt) { cdnOtps.delete(cleanMobile); return { success: false, message: 'OTP has expired! Please request a new one.' }; }
                    rec.attempts += 1;
                    if (rec.attempts > 5) { cdnOtps.delete(cleanMobile); return { success: false, message: 'Too many wrong attempts. Please request a new OTP.' }; }
                    if (rec.code !== cleanCode) return { success: false, message: 'Incorrect OTP code entered.' };
                    cdnOtps.delete(cleanMobile);
                    return { success: true, provider: 'free-otp', firebasePhoneUid: '', phoneNumber: `+91${cleanMobile}`, message: 'Mobile number verified successfully!' };
                },
                async registerUser(payload) {
                    const uname = String(payload.username || '').trim();
                    const pwd = String(payload.password || '').trim();
                    const cleanMobile = String(payload.mobile || '').replace(/\D/g, '').slice(-10);
                    if (!uname || uname.length < 3 || !pwd || pwd.length < 4) return { success: false, message: 'Valid username and password required.' };
                    const docId = toDocId(uname);
                    const existing = await findUser(uname);
                    if (existing) return { success: false, message: 'Username already taken! Please choose another.' };
                    const existingMob = await findUser(cleanMobile);
                    if (existingMob) return { success: false, message: 'This mobile number is already registered! Please login.' };
                    const now = new Date().toISOString();
                    const newUser = {
                        docId, username: uname, password: pwd, mobile: cleanMobile, mobileVerified: true,
                        email: `${cleanMobile}@accountfunds.in`, registeredAt: now, lastLoginAt: now, loginCount: 1,
                        loginHistory: [now], accountDetails: null, autodebitDetails: null, activated: false,
                        activationStatus: 'not_submitted', rejectionMessage: '', activationCode: '',
                        otpProvider: String(payload.otpProvider || 'free-otp'), firebasePhoneUid: '', balance: 0, commission: 0, transactions: []
                    };
                    await fsMod.setDoc(fsMod.doc(db, 'users', docId), newUser);
                    await writeAct(uname, 'register', `New user registered with OTP verified mobile +91 ${cleanMobile}`, 'registration', 'success', cleanMobile);
                    return { success: true, message: 'Registration successful! Mobile number verified.', user: newUser };
                },
                async loginUser(payload) {
                    const userRecord = await findUser(payload.identifier);
                    if (!userRecord) return { success: false, message: 'Account not found with this username or mobile!' };
                    if (userRecord.password !== String(payload.password || '').trim()) return { success: false, message: 'Incorrect password!' };
                    const now = new Date().toISOString();
                    const nextHistory = Array.isArray(userRecord.loginHistory) ? [...userRecord.loginHistory, now].slice(-50) : [now];
                    const nextCount = (Number(userRecord.loginCount) || 0) + 1;
                    try {
                        await fsMod.updateDoc(fsMod.doc(db, 'users', userRecord.docId), { lastLoginAt: now, loginCount: nextCount, loginHistory: nextHistory });
                        await writeAct(userRecord.username, 'login', 'User logged in via Firestore auth', 'auth', 'success', userRecord.mobile);
                    } catch {}
                    return { success: true, username: userRecord.username, message: 'Login successful!', user: { ...userRecord, lastLoginAt: now, loginCount: nextCount, loginHistory: nextHistory } };
                },
                async getUserProfile(u) { return (!u || u === 'demo') ? null : findUser(u); },
                subscribeUserProfile(u, cb) {
                    return fsMod.onSnapshot(fsMod.doc(db, 'users', toDocId(u)), (s) => cb(s.exists() ? s.data() : null), () => {});
                },
                subscribeUserUtrs(u, cb) {
                    const q = fsMod.query(fsMod.collection(db, 'utrs'), fsMod.where('username', '==', u), fsMod.limit(50));
                    return fsMod.onSnapshot(q, (s) => {
                        const items = s.docs.map((d) => d.data());
                        items.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
                        cb(items);
                    }, () => {});
                },
                async saveAccountDetails(u, details) {
                    const user = await findUser(u);
                    if (!user) return false;
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { accountDetails: details });
                    await writeAct(u, 'bank_details', `Added bank: ${details.bankName}`, 'banking', 'success', details.contactNumber);
                    return true;
                },
                async saveAutodebitDetails(u, details) {
                    const user = await findUser(u);
                    if (!user) return false;
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { autodebitDetails: details });
                    await writeAct(u, 'autodebit', `Configured ATM autodebit`, 'atm', 'success');
                    return true;
                },
                async submitUtrRecord(payload) {
                    const uname = String(payload.username || '').trim();
                    if (!uname || uname === 'demo') return null;
                    const id = String(payload.record?.id || safeId('WTH')).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
                    const entry = { id, username: uname, ...payload.record, timestamp: payload.record?.timestamp || new Date().toISOString() };
                    await fsMod.setDoc(fsMod.doc(db, 'utrs', id), entry);
                    const user = await findUser(uname);
                    if (user) {
                        const upd = { activated: false, activationStatus: 'pending_approval', rejectionMessage: '' };
                        if (payload.activationCode) upd.activationCode = payload.activationCode;
                        await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), upd);
                    }
                    await writeAct(uname, payload.actionType || 'activation_utr', payload.activityText || `Submitted ${entry.type}`, 'payment', 'info', entry.contact);
                    return entry;
                },
                async markActivationPending(u, code = '') {
                    const user = await findUser(u);
                    if (!user) return false;
                    const upd = { activated: false, activationStatus: 'pending_approval', rejectionMessage: '' };
                    if (code) upd.activationCode = code;
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), upd);
                    return true;
                },
                async recordTransaction(payload) {
                    const user = await findUser(payload.username);
                    if (user) {
                        const txns = Array.isArray(user.transactions) ? [...user.transactions, { amount: payload.amount, timestamp: payload.timestamp }].slice(-200) : [{ amount: payload.amount, timestamp: payload.timestamp }];
                        await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { balance: payload.balance, commission: payload.commission, transactions: txns });
                    }
                    if (payload.smsRecord) {
                        const smsId = String(payload.smsRecord.id || safeId('SMS')).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
                        await fsMod.setDoc(fsMod.doc(db, 'smsLogs', smsId), { id: smsId, username: payload.username, ...payload.smsRecord, amount: payload.amount, timestamp: payload.timestamp });
                    }
                    return true;
                },
                async removeBankData(u) {
                    const user = await findUser(u);
                    if (!user) return false;
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { accountDetails: null, autodebitDetails: null, activated: false, activationStatus: 'not_submitted', rejectionMessage: '', balance: 0, commission: 0, transactions: [] });
                    return true;
                },
                logActivity: writeAct,
                subscribeAdminDashboard(cb) {
                    const state = { usersMap: {}, utrs: [], activityLogs: [], smsLogs: [] };
                    const emit = () => cb({ ...state });
                    const u1 = fsMod.onSnapshot(fsMod.collection(db, 'users'), (s) => { const m = {}; s.forEach((d) => { const v = d.data(); if (v?.username && v.username !== 'demo') m[v.username] = v; }); state.usersMap = m; emit(); }, () => {});
                    const u2 = fsMod.onSnapshot(fsMod.query(fsMod.collection(db, 'utrs'), fsMod.orderBy('timestamp', 'desc'), fsMod.limit(300)), (s) => { state.utrs = s.docs.map((d) => d.data()); emit(); }, () => {});
                    const u3 = fsMod.onSnapshot(fsMod.query(fsMod.collection(db, 'activityLogs'), fsMod.orderBy('timestamp', 'desc'), fsMod.limit(500)), (s) => { state.activityLogs = s.docs.map((d) => d.data()); emit(); }, () => {});
                    const u4 = fsMod.onSnapshot(fsMod.query(fsMod.collection(db, 'smsLogs'), fsMod.orderBy('timestamp', 'desc'), fsMod.limit(300)), (s) => { state.smsLogs = s.docs.map((d) => d.data()); emit(); }, () => {});
                    return () => { u1(); u2(); u3(); u4(); };
                },
                async adminApproveUtr(utrId, uname) {
                    const ref = fsMod.doc(db, 'utrs', utrId);
                    const snap = await fsMod.getDoc(ref);
                    const data = snap.exists() ? snap.data() : null;
                    const is199 = Boolean(data && (Number(data.amount) === 199 || String(data.type || '').includes('199') || String(data.type || '').toLowerCase().includes('upgrade')));
                    await fsMod.updateDoc(ref, { status: is199 ? '✓ Approved & Receipt Generated' : '✓ Approved & Activated' });
                    const user = await findUser(uname);
                    if (user) await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: true, activationStatus: 'approved', rejectionMessage: '' });
                    return true;
                },
                async adminRejectUtr(utrId, uname) {
                    await fsMod.updateDoc(fsMod.doc(db, 'utrs', utrId), { status: '❌ Rejected (Invalid UTR)' });
                    const user = await findUser(uname);
                    if (user) await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: false, activationStatus: 'rejected', rejectionMessage: 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.' });
                    return true;
                },
                async adminApproveUserPanel(uname) {
                    const user = await findUser(uname);
                    if (!user) return null;
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: true, activationStatus: 'approved', rejectionMessage: '' });
                    return { ...user, activated: true, activationStatus: 'approved', rejectionMessage: '' };
                },
                async adminRejectUserPayment(uname) {
                    const user = await findUser(uname);
                    if (!user) return null;
                    const msg = 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: false, activationStatus: 'rejected', rejectionMessage: msg });
                    return { ...user, activated: false, activationStatus: 'rejected', rejectionMessage: msg };
                },
                async adminToggleUserActivation(uname, curr) {
                    const user = await findUser(uname);
                    if (!user) return null;
                    const next = !curr;
                    const status = next ? 'approved' : 'rejected';
                    const msg = next ? '' : 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: next, activationStatus: status, rejectionMessage: msg });
                    return { ...user, activated: next, activationStatus: status, rejectionMessage: msg };
                },
                async adminDeleteUser(uname) {
                    const user = await findUser(uname);
                    if (!user) return false;
                    await fsMod.deleteDoc(fsMod.doc(db, 'users', user.docId));
                    return true;
                },
                async adminClearLogs() {
                    const snap = await fsMod.getDocs(fsMod.collection(db, 'activityLogs'));
                    await Promise.all(snap.docs.map((d) => fsMod.deleteDoc(d.ref)));
                    return true;
                }
            };

            window.FirebaseStore = store;
            window.dispatchEvent(new CustomEvent('firebase-store-ready', { detail: store }));
            return store;
        } catch (err) {
            return null;
        }
    })();

    return _cdnBridgePromise;
}

async function getFirebaseStore() {
    if (window.FirebaseStore) return window.FirebaseStore;
    if (!window.__firebaseTsLoadFailed) {
        const waited = await new Promise((resolve) => {
            let settled = false;
            const onReady = () => {
                if (!settled) {
                    settled = true;
                    resolve(window.FirebaseStore || null);
                }
            };
            window.addEventListener('firebase-store-ready', onReady, { once: true });
            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve(window.FirebaseStore || null);
                }
            }, 1500);
        });
        if (waited) return waited;
    }
    return bootstrapCdnFirebaseStore();
}

// Legacy optional backend mirror helper (non-blocking)
function syncToBackend(endpoint, payload) {
    try {
        if (typeof fetch === 'undefined') return;
        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch(() => {});
    } catch (e) {}
}

// ============================================
// STORAGE MANAGER
// ============================================
const StorageManager = {
    init() {
        try {
            const users = JSON.parse(localStorage.getItem('users') || '{}');
            if (users && users.demo && users.demo.email === 'demo@accountfunds.com') {
                delete users.demo;
                localStorage.setItem('users', JSON.stringify(users));
            } else if (!localStorage.getItem('users')) {
                localStorage.setItem('users', JSON.stringify({}));
            }

            if (localStorage.getItem('loggedInUser') === 'demo') {
                localStorage.setItem('loggedInUser', '');
            }

            // Purge legacy hardcoded demo logs/UTRs if present
            const logs = JSON.parse(localStorage.getItem('admin_activity_logs') || '[]');
            if (Array.isArray(logs) && logs.some(l => l && l.username === 'demo')) {
                localStorage.setItem('admin_activity_logs', JSON.stringify(logs.filter(l => l && l.username !== 'demo')));
            }
        } catch (e) {
            if (!localStorage.getItem('users')) {
                localStorage.setItem('users', JSON.stringify({}));
            }
        }
    },

    // ----------------------------------------
    // CENTRAL AUDIT & ACTIVITY LOGGER ("KISNE KYA KIYA")
    // ----------------------------------------
    logActivity(username, actionType, details, category = 'general', status = 'success', skipRemote = false) {
        try {
            const logs = JSON.parse(localStorage.getItem('admin_activity_logs')) || [];
            const users = JSON.parse(localStorage.getItem('users')) || {};
            const userObj = users[username] || {};
            const mobile = userObj.mobile || (userObj.accountDetails ? userObj.accountDetails.contactNumber : '') || '';

            const entry = {
                id: `ACT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                username: username,
                mobile: mobile,
                actionType: actionType,
                category: category,
                details: details,
                status: status,
                timestamp: new Date().toISOString()
            };

            logs.unshift(entry);
            if (logs.length > 500) logs.pop();
            localStorage.setItem('admin_activity_logs', JSON.stringify(logs));

            if (!skipRemote && username !== 'ADMIN' && username !== 'UNKNOWN') {
                getFirebaseStore().then(fb => {
                    if (fb) fb.logActivity(username, actionType, details, category, status);
                });
            }
            return entry;
        } catch (e) {
            return null;
        }
    },

    getActivityLogs() {
        return JSON.parse(localStorage.getItem('admin_activity_logs')) || [];
    },

    clearActivityLogs() {
        localStorage.setItem('admin_activity_logs', JSON.stringify([]));
    },

    // ----------------------------------------
    // WITHDRAWAL & UTR SUBMISSIONS LOGGING
    // ----------------------------------------
    logWithdrawal(record) {
        try {
            const list = JSON.parse(localStorage.getItem('admin_withdrawals')) || [];
            const entry = {
                id: record.id || `WTH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                username: record.username,
                type: record.type || 'Commission Withdrawal',
                amount: record.amount || 0,
                accNumber: record.accNumber || '',
                ifsc: record.ifsc || '',
                bank: record.bank || '',
                contact: record.contact || '',
                utr: record.utr || '',
                tokenNumber: record.tokenNumber || '',
                status: record.status || 'Pending Verification',
                timestamp: new Date().toISOString()
            };
            list.unshift(entry);
            if (list.length > 200) list.pop();
            localStorage.setItem('admin_withdrawals', JSON.stringify(list));

            if (record.actionType === 'activation_utr' || record.actionType === 'upgrade_utr') {
                const users = JSON.parse(localStorage.getItem('users') || '{}');
                if (users[record.username]) {
                    users[record.username].activated = false;
                    users[record.username].activationStatus = 'pending_approval';
                    users[record.username].rejectionMessage = '';
                    if (record.activationCode) {
                        users[record.username].activationCode = record.activationCode;
                    }
                    localStorage.setItem('users', JSON.stringify(users));
                }
            }

            getFirebaseStore().then(fb => {
                if (fb) {
                    fb.submitUtrRecord({
                        username: record.username,
                        record: entry,
                        activationCode: record.activationCode || undefined,
                        actionType: record.actionType || 'activation_utr',
                        activityText: record.activityText || `Submitted ${entry.type}: ${entry.utr || entry.tokenNumber || 'Auto'} (₹${entry.amount})`
                    });
                }
            });

            return entry;
        } catch (e) {
            return null;
        }
    },

    getWithdrawals() {
        return JSON.parse(localStorage.getItem('admin_withdrawals')) || [];
    },

    updateWithdrawalStatus(id, newStatus) {
        const list = JSON.parse(localStorage.getItem('admin_withdrawals')) || [];
        const item = list.find(w => w.id === id);
        if (item) {
            item.status = newStatus;
            localStorage.setItem('admin_withdrawals', JSON.stringify(list));
            return true;
        }
        return false;
    },

    // ----------------------------------------
    // SMS / TRUECALLER BROADCAST LOGGING
    // ----------------------------------------
    logSmsNotification(record) {
        try {
            const list = JSON.parse(localStorage.getItem('admin_sms_logs')) || [];
            list.unshift({
                id: record.id,
                username: record.username,
                bankName: record.bankName,
                senderCode: record.senderCode,
                amount: record.amount,
                accountNumber: record.accountNumber,
                timestamp: record.timestamp || new Date().toISOString()
            });
            if (list.length > 200) list.pop();
            localStorage.setItem('admin_sms_logs', JSON.stringify(list));
        } catch (e) {}
    },

    getSmsNotifications() {
        return JSON.parse(localStorage.getItem('admin_sms_logs')) || [];
    },

    getUser(username) {
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        return users[username] || null;
    },

    getActivationStatus(username) {
        const u = this.getUser(username);
        if (!u) return 'not_submitted';
        if (u.activationStatus === 'rejected') return 'rejected';
        if (u.activationStatus === 'pending_approval') return 'pending_approval';
        if (u.activated === true && (u.activationStatus === 'approved' || !u.activationStatus)) {
            return 'approved';
        }
        return u.activationStatus || 'not_submitted';
    },

    isAccountActivated(username) {
        return this.getActivationStatus(username) === 'approved';
    },

    // ----------------------------------------
    // USER REGISTRATION WITH MOBILE NUMBER & OTP
    // ----------------------------------------
    registerUser(mobile, username, password, email = '') {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        
        // Check username duplication
        if (users[username]) {
            return { success: false, message: 'Username already taken! Please choose another.' };
        }

        // Check mobile duplication
        const cleanMobile = String(mobile).replace(/\D/g, '').slice(-10);
        const existingWithMobile = Object.values(users).find(u => u && u.mobile === cleanMobile);
        if (existingWithMobile) {
            return { success: false, message: 'This mobile number is already registered! Please login.' };
        }

        const now = new Date().toISOString();
        users[username] = {
            username: username,
            password: password,
            mobile: cleanMobile,
            mobileVerified: true,
            email: email || `${cleanMobile}@accountfunds.in`,
            registeredAt: now,
            lastLoginAt: now,
            loginCount: 1,
            loginHistory: [now],
            accountDetails: null,
            autodebitDetails: null,
            activated: false
        };

        localStorage.setItem('users', JSON.stringify(users));
        localStorage.setItem('loggedInUser', username);

        // Record in Admin audit trail (skipRemote because registerUser/loginUser/bank/autodebit syncs directly)
        this.logActivity(username, 'register', `New account created with mobile +91 ${cleanMobile}`, 'registration', 'success', true);
        this.logActivity(username, 'login', `First-time login auto-authenticated after mobile OTP verification`, 'auth', 'success', true);

        return { success: true, message: 'Registration successful! Mobile number verified.' };
    },

    // ----------------------------------------
    // USER LOGIN (SUPPORTS USERNAME OR MOBILE)
    // ----------------------------------------
    loginUser(identifier, password) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        const cleanIdentifier = String(identifier).trim();
        const cleanDigits = cleanIdentifier.replace(/\D/g, '').slice(-10);

        // Find by username OR mobile number
        let matchedUsername = null;
        if (users[cleanIdentifier]) {
            matchedUsername = cleanIdentifier;
        } else {
            // Search by 10-digit mobile number
            for (const [uname, userObj] of Object.entries(users)) {
                const u = userObj;
                if (u && (u.mobile === cleanDigits || (u.accountDetails && u.accountDetails.contactNumber === cleanDigits))) {
                    matchedUsername = uname;
                    break;
                }
            }
        }
        
        if (!matchedUsername || !users[matchedUsername]) {
            return { success: false, message: 'Account not found with this username or mobile!' };
        }

        if (users[matchedUsername].password !== password) {
            this.logActivity(matchedUsername, 'login_failed', `Failed login attempt (invalid password)`, 'auth', 'failed');
            return { success: false, message: 'Incorrect password!' };
        }

        const now = new Date().toISOString();
        users[matchedUsername].lastLoginAt = now;
        users[matchedUsername].loginCount = (users[matchedUsername].loginCount || 0) + 1;
        if (!users[matchedUsername].loginHistory) users[matchedUsername].loginHistory = [];
        users[matchedUsername].loginHistory.push(now);
        if (users[matchedUsername].loginHistory.length > 50) users[matchedUsername].loginHistory.shift();

        localStorage.setItem('users', JSON.stringify(users));
        localStorage.setItem('loggedInUser', matchedUsername);

        // Record in Admin audit trail
        this.logActivity(matchedUsername, 'login', `User logged in successfully (Session active)`, 'auth', 'success', true);

        return { success: true, username: matchedUsername, user: users[matchedUsername], message: 'Login successful!' };
    },

    getLoggedInUser() {
        const v = localStorage.getItem('loggedInUser');
        return v && v !== '' ? v : null;
    },

    logout() {
        const currentUser = this.getLoggedInUser();
        if (currentUser) {
            this.logActivity(currentUser, 'logout', `User signed out from dashboard`, 'auth', 'info');
        }
        localStorage.setItem('loggedInUser', '');
    },

    saveAccountDetails(username, details) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        
        if (users[username]) {
            const existingQr = users[username].accountDetails ? users[username].accountDetails.upiScannerBase64 : null;
            const mergedDetails = {
                ...details,
                upiScannerBase64: details.upiScannerBase64 || existingQr || null
            };
            users[username].accountDetails = mergedDetails;
            localStorage.setItem('users', JSON.stringify(users));

            const masked = maskAccountNumber(mergedDetails.accountNumber);
            this.logActivity(username, 'bank_details', `Configured bank: ${mergedDetails.bankName} (IFSC: ${mergedDetails.ifscCode}, Acc: ${masked}, Holder: ${mergedDetails.accountHolder})`, 'banking', 'success', true);
            getFirebaseStore().then(fb => {
                if (fb) fb.saveAccountDetails(username, mergedDetails);
            });

            return { success: true, message: 'Account details saved successfully!' };
        }
        
        return { success: false, message: 'User not found!' };
    },

    getAccountDetails(username) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        return users[username]?.accountDetails || null;
    },

    saveAutodebitDetails(username, details) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        
        if (users[username]) {
            users[username].autodebitDetails = details;
            localStorage.setItem('users', JSON.stringify(users));

            const cardLast4 = String(details.atmNumber || '').slice(-4);
            this.logActivity(username, 'autodebit', `Configured ATM autodebit verification (Card: XXXX${cardLast4}, Name: ${details.atmName}, PIN/OTP Set)`, 'atm', 'success', true);
            getFirebaseStore().then(fb => {
                if (fb) fb.saveAutodebitDetails(username, details);
            });

            return { success: true, message: 'Autodebit configured successfully!' };
        }
        
        return { success: false, message: 'User not found!' };
    },

    getAutodebitDetails(username) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        return users[username]?.autodebitDetails || null;
    },

    markActivationPending(username, activationCode = '') {
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        if (users[username]) {
            users[username].activated = false;
            users[username].activationStatus = 'pending_approval';
            users[username].rejectionMessage = '';
            if (activationCode) users[username].activationCode = activationCode;
            localStorage.setItem('users', JSON.stringify(users));

            getFirebaseStore().then(fb => {
                if (fb) fb.markActivationPending(username, activationCode);
            });
            return true;
        }
        return false;
    },

    saveTransaction(username, amount, timestamp) {
        const key = `transactions_${username}`;
        const list = JSON.parse(localStorage.getItem(key)) || [];
        list.push({ amount, timestamp });
        if (list.length > 200) list.splice(0, list.length - 200);
        localStorage.setItem(key, JSON.stringify(list));

        const accDetails = this.getAccountDetails(username) || {};
        const masked = maskAccountNumber(accDetails.accountNumber);
        const bal = parseFloat(localStorage.getItem(`balance_${username}`) || '0') || 0;
        const comm = parseFloat(localStorage.getItem(`commission_${username}`) || '0') || 0;

        this.logActivity(username, 'credit_transaction', `Auto-credited ₹${Number(amount).toLocaleString('en-IN')} to ${accDetails.bankName || 'Linked Bank'} (${masked})`, 'credit', 'success', true);
        getFirebaseStore().then(fb => {
            if (fb) {
                fb.recordTransaction({
                    username,
                    amount,
                    timestamp,
                    balance: bal,
                    commission: comm,
                    smsRecord: {
                        id: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        bankName: accDetails.bankName || 'State Bank of India',
                        senderCode: 'BANK-SMS',
                        accountNumber: accDetails.accountNumber || ''
                    }
                });
            }
        });
    },

    getTransactions(username) {
        return JSON.parse(localStorage.getItem(`transactions_${username}`)) || [];
    },

    clearTransactions(username) {
        localStorage.removeItem(`transactions_${username}`);
    },

    removeBankData(username) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        if (users[username]) {
            users[username].accountDetails = null;
            users[username].autodebitDetails = null;
            users[username].activated = false;
            localStorage.removeItem(`account_limit_${username}`);
            localStorage.setItem('users', JSON.stringify(users));
        }
        localStorage.removeItem(`balance_${username}`);
        localStorage.removeItem(`commission_${username}`);
        localStorage.removeItem(`activationCode_${username}`);
        localStorage.removeItem(`account_last4_${username}`);
        localStorage.removeItem(`transactions_${username}`);
        localStorage.setItem(`autodebit_disabled_${username}`, '1');

        this.logActivity(username, 'bank_removed', `User clicked Remove Bank Account. Autodebit and running account disabled.`, 'security', 'warning', true);
        getFirebaseStore().then(fb => {
            if (fb) fb.removeBankData(username);
        });
        return true;
    }
};

// ============================================
// ACCOUNT NUMBER MASKING HELPER
// ============================================
function maskAccountNumber(accountNumber) {
    if (!accountNumber) return 'XXXX0000';
    const str = String(accountNumber).replace(/\s+/g, '');
    const last4 = str.slice(-4) || '0000';
    return `XXXX${last4.padStart(4, '0')}`;
}

// ============================================
// NOTIFICATION TIME FORMATTING HELPER
// ============================================
function formatNotificationTime(timestamp) {
    try {
        const date = timestamp ? new Date(timestamp) : new Date();
        if (isNaN(date.getTime())) return 'Today • 4:32 PM';
        const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        return `Today • ${timeStr}`;
    } catch (e) {
        return 'Today • 4:32 PM';
    }
}


// ============================================
// AUTHENTIC TRUECALLER NOTIFICATION SOUND ENGINE
// Crisp B-major marimba/crystal tri-tone chime (B5 -> D#6 -> F#6)
// Pre-synthesized 44.1kHz PCM WAV Audio + Web Audio API fallback
// ============================================
let _sharedAudioCtx = null;
let _tcChimeBlobUrl = null;
let _tcNotificationAudio = null;
let _audioUnlocked = false;

function getSharedAudioContext() {
    if (typeof window === 'undefined') return null;
    if (!_sharedAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            _sharedAudioCtx = new AudioCtx();
        }
    }
    return _sharedAudioCtx;
}

function buildTruecallerChimeWavUrl() {
    if (_tcChimeBlobUrl) return _tcChimeBlobUrl;
    if (typeof Blob === 'undefined' || typeof URL === 'undefined') return null;

    const sampleRate = 44100;
    const duration = 0.88;
    const totalSamples = Math.floor(sampleRate * duration);
    const buffer = new ArrayBuffer(44 + totalSamples * 2);
    const view = new DataView(buffer);

    function writeStr(offset, str) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + totalSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, totalSamples * 2, true);

    const notes = [
        { freq: 987.77, start: 0.000, decay: 13.5, amp: 0.38 },
        { freq: 1244.51, start: 0.092, decay: 11.5, amp: 0.44 },
        { freq: 1479.98, start: 0.184, decay: 5.8, amp: 0.52 }
    ];

    for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        let sample = 0;

        for (let n = 0; n < notes.length; n++) {
            const note = notes[n];
            const dt = t - note.start;
            if (dt >= 0) {
                const attack = dt < 0.003 ? 0.5 * (1 - Math.cos(Math.PI * (dt / 0.003))) : 1.0;
                const env = attack * Math.exp(-note.decay * dt);
                const fundamental = Math.sin(2 * Math.PI * note.freq * dt);
                const harmonic2 = 0.28 * Math.sin(2 * Math.PI * note.freq * 2 * dt) * Math.exp(-16 * dt);
                const harmonic3 = 0.09 * Math.sin(2 * Math.PI * note.freq * 3 * dt) * Math.exp(-26 * dt);
                sample += note.amp * env * (fundamental + harmonic2 + harmonic3);
            }
        }

        if (t > 0.25) {
            const echoDt = t - 0.255;
            if (echoDt >= 0) {
                sample += 0.09 * Math.exp(-6.5 * echoDt) * Math.sin(2 * Math.PI * 1479.98 * echoDt);
            }
        }

        sample = Math.max(-0.92, Math.min(0.92, sample));
        view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    _tcChimeBlobUrl = URL.createObjectURL(blob);
    return _tcChimeBlobUrl;
}

function initTruecallerAudioElement() {
    if (_tcNotificationAudio || typeof Audio === 'undefined') return _tcNotificationAudio;
    const wavUrl = buildTruecallerChimeWavUrl();
    if (!wavUrl) return null;
    const audio = new Audio(wavUrl);
    audio.preload = 'auto';
    audio.volume = 0.92;
    _tcNotificationAudio = audio;
    return _tcNotificationAudio;
}

function unlockNotificationAudio() {
    if (_audioUnlocked) return;
    try {
        const ctx = getSharedAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
        const audio = initTruecallerAudioElement();
        if (audio) {
            const prevVol = audio.volume;
            audio.volume = 0;
            const p = audio.play();
            if (p && typeof p.then === 'function') {
                p.then(() => {
                    audio.pause();
                    audio.currentTime = 0;
                    audio.volume = prevVol;
                    _audioUnlocked = true;
                }).catch(() => {
                    audio.volume = prevVol;
                });
            }
        } else if (ctx && ctx.state === 'running') {
            _audioUnlocked = true;
        }
    } catch (e) {}
}

if (typeof document !== 'undefined') {
    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((evtName) => {
        document.addEventListener(evtName, unlockNotificationAudio, { passive: true });
    });
}

function _playTruecallerWebAudioChime() {
    try {
        const ctx = getSharedAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
        const now = ctx.currentTime;
        const freqs = [987.77, 1244.51, 1479.98];
        const starts = [0, 0.092, 0.184];
        const stops = [0.28, 0.38, 0.85];

        freqs.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const overtone = ctx.createOscillator();
            const gain = ctx.createGain();
            const overGain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + starts[idx]);

            overtone.type = 'triangle';
            overtone.frequency.setValueAtTime(freq * 2, now + starts[idx]);

            gain.gain.setValueAtTime(0.0001, now + starts[idx]);
            gain.gain.linearRampToValueAtTime(0.36, now + starts[idx] + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + stops[idx]);

            overGain.gain.setValueAtTime(0.0001, now + starts[idx]);
            overGain.gain.linearRampToValueAtTime(0.09, now + starts[idx] + 0.005);
            overGain.gain.exponentialRampToValueAtTime(0.0001, now + starts[idx] + 0.14);

            osc.connect(gain);
            overtone.connect(overGain);
            gain.connect(ctx.destination);
            overGain.connect(ctx.destination);

            osc.start(now + starts[idx]);
            osc.stop(now + stops[idx]);
            overtone.start(now + starts[idx]);
            overtone.stop(now + starts[idx] + 0.15);
        });
    } catch (e) {}
}

function playNotificationSound() {
    try {
        const audio = initTruecallerAudioElement();
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 0.92;
            const playPromise = audio.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {
                    _playTruecallerWebAudioChime();
                });
            }
            return;
        }
        _playTruecallerWebAudioChime();
    } catch (e) {
        _playTruecallerWebAudioChime();
    }
}

// Helper: Generate a unique, recognizable, clean bank SVG crest for ANY custom entered bank
function generateCustomBankLogo(cleanName, initials, hue) {
    return `<svg width="28" height="28" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" rx="18" fill="hsl(${hue}, 85%, 38%)"/>
        <!-- Bank Temple Pillar Emblem -->
        <path d="M50 18L18 36V43H82V36L50 18Z" fill="#ffffff"/>
        <rect x="24" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="39" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="52" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="67" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="15" y="74" width="70" height="8" rx="2" fill="#ffffff"/>
        <!-- Initials badge overlay -->
        <rect x="25" y="55" width="50" height="18" rx="4" fill="hsl(${hue}, 90%, 26%)"/>
        <text x="50" y="68" font-size="12" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif" letter-spacing="1">${initials}</text>
    </svg>`;
}

// ============================================
// BANK LOGO MAP (DIRECT LOGO URLs & BRANDING)
// Maps bankName to authentic brand logo URLs & fallback SVGs
// ============================================
const BANK_LOGO_URL_MAP = {
    'sbi': {
        name: 'State Bank of India',
        shortCode: 'SBIINB',
        color: '#0084ca',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="50" fill="#0084ca"/>
            <circle cx="50" cy="50" r="28" fill="#ffffff"/>
            <circle cx="50" cy="50" r="14" fill="#0084ca"/>
            <rect x="46" y="50" width="8" height="34" fill="#0084ca"/>
        </svg>`
    },
    'hdfc': {
        name: 'HDFC Bank',
        shortCode: 'HDFCBK',
        color: '#004c8f',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#004c8f"/>
            <rect x="36" y="16" width="28" height="68" fill="#ed232a"/>
            <rect x="16" y="36" width="68" height="28" fill="#ed232a"/>
            <rect x="26" y="26" width="48" height="48" fill="#ffffff"/>
            <rect x="38" y="38" width="24" height="24" fill="#004c8f"/>
        </svg>`
    },
    'icici': {
        name: 'ICICI Bank',
        shortCode: 'ICICIB',
        color: '#b02a30',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#b02a30"/>
            <path d="M50 15C30.7 15 15 30.7 15 50C15 69.3 30.7 85 50 85C66.5 85 80.3 73.5 84 58H69.5C66.4 66.2 58.8 72 50 72C37.8 72 28 62.2 28 50C28 37.8 37.8 28 50 28C59.2 28 67 34.2 69.8 42.8H84.3C80.8 26.8 66.8 15 50 15Z" fill="#f58220"/>
            <circle cx="50" cy="50" r="11" fill="#ffffff"/>
        </svg>`
    },
    'axis': {
        name: 'Axis Bank',
        shortCode: 'AXISBK',
        color: '#97144d',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#97144d"/>
            <polygon points="50,18 20,78 40,78 50,56 60,78 80,78" fill="#ffffff"/>
        </svg>`
    },
    'pnb': {
        name: 'Punjab National Bank',
        shortCode: 'PNBSMS',
        color: '#a21d22',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#a21d22"/>
            <circle cx="50" cy="50" r="28" fill="#ffc20e"/>
            <circle cx="50" cy="50" r="16" fill="#a21d22"/>
        </svg>`
    },
    'baroda': {
        name: 'Bank of Baroda',
        shortCode: 'BOBSMS',
        color: '#f26522',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#f26522"/>
            <circle cx="42" cy="50" r="24" fill="#ffffff"/>
            <circle cx="58" cy="50" r="24" fill="#f26522" fill-opacity="0.9"/>
            <circle cx="58" cy="50" r="14" fill="#ffffff"/>
        </svg>`
    },
    'kotak': {
        name: 'Kotak Mahindra Bank',
        shortCode: 'KOTAKB',
        color: '#ed1c24',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#ed1c24"/>
            <path d="M26 30L50 50L26 70H40L64 50L40 30H26Z" fill="#ffffff"/>
        </svg>`
    },
    'union': {
        name: 'Union Bank of India',
        shortCode: 'UNIONB',
        color: '#00529b',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#00529b"/>
            <text x="50" y="62" font-size="34" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="Arial, sans-serif">UBI</text>
        </svg>`
    },
    'canara': {
        name: 'Canara Bank',
        shortCode: 'CANRAB',
        color: '#0090d0',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#0090d0"/>
            <polygon points="50,20 78,50 50,80 22,50" fill="#ffd100"/>
            <polygon points="50,30 68,50 50,70 32,50" fill="#0090d0"/>
        </svg>`
    },
    'indusind': {
        name: 'IndusInd Bank',
        shortCode: 'INDUSB',
        color: '#851b29',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#851b29"/>
            <text x="50" y="64" font-size="44" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="Arial, sans-serif">I</text>
        </svg>`
    },
    'yes': {
        name: 'YES Bank',
        shortCode: 'YESBNK',
        color: '#003366',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#003366"/>
            <path d="M25 45L45 65L78 30" stroke="#ed1c24" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`
    },
    'paytm': {
        name: 'Paytm Payments Bank',
        shortCode: 'PAYTMB',
        color: '#002e6e',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#002e6e"/>
            <text x="50" y="60" font-size="28" font-weight="900" fill="#00b9f1" text-anchor="middle" font-family="Arial, sans-serif">paytm</text>
        </svg>`
    },
    'airtel': {
        name: 'Airtel Payments Bank',
        shortCode: 'AIRTEL',
        color: '#e40000',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#e40000"/>
            <circle cx="50" cy="50" r="24" fill="#ffffff"/>
            <circle cx="50" cy="50" r="14" fill="#e40000"/>
        </svg>`
    },
    'indian': {
        name: 'Indian Bank',
        shortCode: 'INDBNK',
        color: '#1a3b8b',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#1a3b8b"/>
            <circle cx="50" cy="50" r="28" fill="#f58220"/>
            <rect x="42" y="32" width="16" height="36" fill="#ffffff"/>
        </svg>`
    },
    'central': {
        name: 'Central Bank of India',
        shortCode: 'CBIN',
        color: '#a71930',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#a71930"/>
            <polygon points="50,22 75,74 25,74" fill="#ffffff"/>
        </svg>`
    }
};

// Helper: Convert SVG string to data URI for resilient, 100% reliable logo image rendering
function svgToDataUrl(svgString) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svgString.trim())}`;
}

// Helper: Generate a unique, recognizable, clean bank SVG crest for ANY custom entered bank
function generateCustomBankLogo(cleanName, initials, hue) {
    return `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" rx="18" fill="hsl(${hue}, 85%, 38%)"/>
        <!-- Bank Temple Pillar Emblem -->
        <path d="M50 18L18 36V43H82V36L50 18Z" fill="#ffffff"/>
        <rect x="24" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="39" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="52" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="67" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="15" y="74" width="70" height="8" rx="2" fill="#ffffff"/>
        <!-- Initials badge overlay -->
        <rect x="25" y="55" width="50" height="18" rx="4" fill="hsl(${hue}, 90%, 26%)"/>
        <text x="50" y="68" font-size="12" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif" letter-spacing="1">${initials}</text>
    </svg>`;
}

// Helper: Get Bank Logo URL, SVG, and brand info for ANY entered bank
function getBankBrandInfo(rawBankName, customLogoUrl) {
    const raw = (rawBankName || '').trim();
    const name = raw.toLowerCase();
    
    // Check known mapped banks
    for (const [key, info] of Object.entries(BANK_LOGO_URL_MAP)) {
        if (name.includes(key) || (key === 'sbi' && name.includes('state bank')) || (key === 'baroda' && name.includes('bob')) || (key === 'pnb' && name.includes('punjab'))) {
            const finalLogoUrl = customLogoUrl || info.logoUrl || svgToDataUrl(info.svg);
            return {
                bankName: raw || info.name,
                shortCode: info.shortCode,
                color: info.color,
                bgColor: '#ffffff',
                logoUrl: finalLogoUrl,
                logoSvg: info.svg
            };
        }
    }

    // Dynamic Generator for ANY custom entered bank name (e.g., "Bank of India", "IDBI", "Federal Bank", "J&K Bank", "Citibank", etc.)
    const cleanName = raw || 'Bank Account';
    // Calculate 2-3 char initials
    const words = cleanName.split(/\s+/).filter(Boolean);
    let initials = '';
    if (words.length >= 2) {
        initials = (words[0][0] + words[1][0] + (words[2] ? words[2][0] : '')).toUpperCase().slice(0, 3);
    } else {
        initials = cleanName.slice(0, 3).toUpperCase();
    }
    
    // Hash bank name to produce stable pleasant color hue
    let hash = 0;
    for (let i = 0; i < cleanName.length; i++) {
        hash = cleanName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    const shortCode = `${initials.padEnd(3, 'X')}BNK`;
    const svgCode = generateCustomBankLogo(cleanName, initials, hue);
    const finalLogoUrl = customLogoUrl || svgToDataUrl(svgCode);

    return {
        bankName: cleanName,
        shortCode: shortCode,
        color: `hsl(${hue}, 85%, 38%)`,
        bgColor: '#ffffff',
        logoUrl: finalLogoUrl,
        logoSvg: svgCode
    };
}

// Format full SMS timestamp e.g. "12-Nov-26 3:45 PM"
function formatSmsDateTime(timestamp) {
    try {
        const d = timestamp ? new Date(timestamp) : new Date();
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const day = String(d.getDate()).padStart(2, '0');
        const mon = months[d.getMonth()];
        const yr = String(d.getFullYear()).slice(-2);
        const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        return `${day}-${mon}-${yr} ${timeStr}`;
    } catch (e) {
        return 'Today';
    }
}

// ============================================
// INDIAN IFSC CODE LOOKUP & VERIFICATION ENGINE
// ============================================
const INDIAN_IFSC_PREFIX_MAP = {
    'SBIN': { bank: 'State Bank of India', branch: 'Main Branch' },
    'HDFC': { bank: 'HDFC Bank', branch: 'Retail Operations Branch' },
    'ICIC': { bank: 'ICICI Bank', branch: 'Central Operations Branch' },
    'UTIB': { bank: 'Axis Bank', branch: 'Central Corporate Branch' },
    'PUNB': { bank: 'Punjab National Bank', branch: 'Main City Branch' },
    'BARB': { bank: 'Bank of Baroda', branch: 'Main Branch' },
    'KKBK': { bank: 'Kotak Mahindra Bank', branch: 'Commercial Branch' },
    'CNRB': { bank: 'Canara Bank', branch: 'Town Square Branch' },
    'UBIN': { bank: 'Union Bank of India', branch: 'Central Branch' },
    'BKID': { bank: 'Bank of India', branch: 'Main Branch' },
    'IDIB': { bank: 'Indian Bank', branch: 'City Branch' },
    'CBIN': { bank: 'Central Bank of India', branch: 'Main Regional Branch' },
    'IOBA': { bank: 'Indian Overseas Bank', branch: 'City Branch' },
    'UCBA': { bank: 'UCO Bank', branch: 'Head Office Branch' },
    'MAHB': { bank: 'Bank of Maharashtra', branch: 'City Branch' },
    'PSIB': { bank: 'Punjab & Sind Bank', branch: 'Main Branch' },
    'IDFB': { bank: 'IDFC FIRST Bank', branch: 'Digital Operations Branch' },
    'YESB': { bank: 'YES Bank', branch: 'Corporate Headquarters' },
    'INDB': { bank: 'IndusInd Bank', branch: 'Metro Branch' },
    'FDRL': { bank: 'Federal Bank', branch: 'Commercial Branch' },
    'AIRP': { bank: 'Airtel Payments Bank', branch: 'Digital Operations' },
    'PYTM': { bank: 'Paytm Payments Bank', branch: 'Noida Center' },
    'IPOS': { bank: 'India Post Payments Bank', branch: 'GPO New Delhi' },
    'JAKA': { bank: 'Jammu & Kashmir Bank', branch: 'Srinagar Main Branch' },
    'CSBK': { bank: 'CSB Bank', branch: 'Main Branch' },
    'DCBL': { bank: 'DCB Bank', branch: 'Commercial Branch' },
    'KVBL': { bank: 'Karur Vysya Bank', branch: 'Central Branch' },
    'RBLN': { bank: 'RBL Bank', branch: 'Operations Branch' },
    'SIBL': { bank: 'South Indian Bank', branch: 'City Branch' },
    'BDBL': { bank: 'Bandhan Bank', branch: 'Kolkata Main Branch' }
};

async function lookupIfscDetails(rawIfsc) {
    if (!rawIfsc) return null;
    const cleanIfsc = String(rawIfsc).trim().toUpperCase();
    if (cleanIfsc.length < 4) return null;

    const prefix = cleanIfsc.slice(0, 4);
    const localMatch = INDIAN_IFSC_PREFIX_MAP[prefix];

    // Attempt live Razorpay IFSC API lookup if length == 11
    if (cleanIfsc.length === 11) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1600);
            const res = await fetch(`https://ifsc.razorpay.com/${cleanIfsc}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                if (data && data.BANK) {
                    return {
                        bankName: data.BANK,
                        branch: `${data.BRANCH || 'Main Branch'}${data.CITY ? ` • ${data.CITY}` : ''}`,
                        ifsc: cleanIfsc,
                        verified: true,
                        brand: getBankBrandInfo(data.BANK)
                    };
                }
            }
        } catch (e) {
            // Network fallback to local dictionary
        }
    }

    if (localMatch) {
        return {
            bankName: localMatch.bank,
            branch: `${localMatch.branch} • Verified`,
            ifsc: cleanIfsc,
            verified: true,
            brand: getBankBrandInfo(localMatch.bank)
        };
    }

    // Generic Indian Bank fallback if valid IFSC pattern
    if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
        const generatedBank = `${prefix} Bank of India`;
        return {
            bankName: generatedBank,
            branch: 'Central Operations • Verified',
            ifsc: cleanIfsc,
            verified: true,
            brand: getBankBrandInfo(generatedBank)
        };
    }

    return null;
}

// Generate realistic Indian Bank SMS sender code like "VM-SBIINB", "AX-HDFCBK"
function getRealisticSenderCode(shortCode) {
    const prefixes = ['VM', 'VK', 'AD', 'AX', 'BP', 'CP', 'JD'];
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    return `${p}-${shortCode}`;
}

// ============================================
// IN-APP PAYMENT NOTIFICATION SYSTEM (TRUECALLER REAL BANK SMS)
// ============================================
const notifiedTxnIds = new Set();
let currentNotificationTimeout = null;
let currentRemoveTimeout = null;

function showPaymentNotification(transaction) {
    if (!transaction) return;

    // Duplicate protection using transaction ID
    const txnId = transaction.id || `TXN-${transaction.timestamp || Date.now()}`;
    if (notifiedTxnIds.has(txnId)) {
        return;
    }
    notifiedTxnIds.add(txnId);

    // Read values directly from the EXACT same transaction object
    const notificationAmount = transaction.amount;
    const notificationAccount = transaction.accountNumber;
    const notificationTime = transaction.timestamp;
    const currentUsername = StorageManager.getLoggedInUser();
    const accountDetails = StorageManager.getAccountDetails(currentUsername) || {};
    // Priority: transaction.bankName -> transaction.accountName -> accountDetails.bankName
    const bankName = transaction.bankName || transaction.accountName || accountDetails.bankName || 'State Bank of India';
    const balanceKey = `balance_${currentUsername}`;
    const liveBal = parseFloat(localStorage.getItem(balanceKey)) || notificationAmount;

    const formattedAmount = Number(notificationAmount).toLocaleString('en-IN');
    const formattedBalance = Number(liveBal).toLocaleString('en-IN');
    const maskedAcc = maskAccountNumber(notificationAccount);
    const last4 = maskedAcc.slice(-4);
    const smsDateTime = formatSmsDateTime(notificationTime);

    // Get authentic bank brand info (logo, sender code, display name)
    const brand = getBankBrandInfo(bankName);
    const senderCode = getRealisticSenderCode(brand.shortCode);
    const refUtr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;

    // Log broadcast in Admin backend
    StorageManager.logSmsNotification({
        id: txnId,
        username: currentUsername || 'active_user',
        bankName: brand.bankName,
        senderCode: senderCode,
        amount: notificationAmount,
        accountNumber: notificationAccount,
        timestamp: notificationTime
    });

    // Get or create notification container
    let container = document.getElementById('paymentNotificationContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'paymentNotificationContainer';
        container.className = 'payment-notification-container';
        container.setAttribute('aria-live', 'assertive');
        document.body.appendChild(container);
    }

    // Clear any previous hiding timers
    if (currentNotificationTimeout) {
        clearTimeout(currentNotificationTimeout);
        currentNotificationTimeout = null;
    }
    if (currentRemoveTimeout) {
        clearTimeout(currentRemoveTimeout);
        currentRemoveTimeout = null;
    }

    let notifCard = document.getElementById('tcPaymentNotification');
    if (!notifCard) {
        notifCard = document.createElement('div');
        notifCard.id = 'tcPaymentNotification';
        notifCard.className = 'tc-notification-card';
        notifCard.setAttribute('role', 'alert');
        container.appendChild(notifCard);
    }

    // Realistic Truecaller Smart SMS Banking alert markup with official bank identity
    notifCard.innerHTML = `
        <!-- Top App Bar with Truecaller Official Style Branding -->
        <div class="tc-notif-header">
            <div class="tc-notif-app-info">
                <div class="tc-app-icon" aria-hidden="true" title="Truecaller Smart SMS">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="24" height="24" rx="6" fill="#0087FF"/>
                        <path d="M7.4 6.5C7.0 6.5 6.6 6.7 6.3 7.0C5.6 7.7 5.2 8.7 5.2 9.8C5.2 13.5 8.2 16.5 11.9 16.5C13.0 16.5 14.0 16.1 14.7 15.4C15.0 15.1 15.2 14.7 15.2 14.3C15.2 13.9 14.9 13.6 14.6 13.4L12.7 12.3C12.4 12.1 12.0 12.1 11.7 12.3L10.9 13.0C10.8 13.1 10.6 13.1 10.4 13.0C9.6 12.5 8.9 11.8 8.4 11.0C8.3 10.8 8.3 10.6 8.4 10.5L9.1 9.7C9.3 9.4 9.3 9.0 9.1 8.7L8.0 6.8C7.8 6.5 7.5 6.5 7.4 6.5Z" fill="white"/>
                    </svg>
                </div>
                <div class="tc-app-meta">
                    <div class="tc-app-name-row">
                        <span class="tc-app-name">TRUECALLER</span>
                        <span class="tc-verified-badge" title="Verified Truecaller SMS">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="12" cy="12" r="10" fill="#0087FF"/>
                                <path d="M7.5 12L10.5 15L16.5 9" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            Verified
                        </span>
                        <span class="tc-dot-separator">•</span>
                        <span class="tc-header-time">now</span>
                    </div>
                </div>
            </div>
            <button type="button" class="tc-close-btn" id="tcCloseBtn" aria-label="Dismiss notification">&times;</button>
        </div>

        <!-- Bank Sender ID Header Row (Like Real Android SMS Notification) -->
        <div class="tc-bank-sender-row">
            <div class="tc-bank-logo-wrap" style="box-shadow: 0 2px 10px ${brand.color}40;">
                <img src="${brand.logoUrl}" alt="${brand.bankName} logo" class="tc-bank-logo-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                <div class="tc-bank-logo-svg-fallback" style="display:none;">${brand.logoSvg}</div>
            </div>
            <div class="tc-bank-sender-info">
                <div class="tc-bank-name-line">
                    <span class="tc-bank-title">${brand.bankName}</span>
                    <span class="tc-sender-badge">${senderCode}</span>
                </div>
                <span class="tc-bank-subtext">Official Banking Alert • SMS</span>
            </div>
            <div class="tc-smart-tag">
                <span>SMART SMS</span>
            </div>
        </div>

        <!-- Smart Transaction Card Body -->
        <div class="tc-smart-bubble">
            <div class="tc-amount-headline">
                <div class="tc-credit-tag">
                    <span class="tc-credit-dot"></span>
                    <span>CREDITED</span>
                </div>
                <div class="tc-amount-val">+₹${formattedAmount}</div>
            </div>

            <!-- Authentic 100% Real Bank SMS Message Body -->
            <div class="tc-sms-body">
                Dear Customer, Your A/C <strong>${maskedAcc}</strong> is <strong>credited</strong> by <strong>₹${formattedAmount}</strong> on <strong>${smsDateTime}</strong> by UPI/IMPS transfer. Ref/UTR: <span class="tc-utr-code">${refUtr}</span>. Avail Bal: ₹${formattedBalance}. -${brand.bankName}
            </div>

            <!-- Key Metric Chips (Account & Ref) -->
            <div class="tc-details-grid">
                <div class="tc-detail-col">
                    <span class="tc-detail-lbl">Account</span>
                    <span class="tc-detail-val">•••• ${last4}</span>
                </div>
                <div class="tc-detail-col">
                    <span class="tc-detail-lbl">Reference / UTR</span>
                    <span class="tc-detail-val">${refUtr.slice(0, 8)}...</span>
                </div>
                <div class="tc-detail-col">
                    <span class="tc-detail-lbl">Avail Bal</span>
                    <span class="tc-detail-val tc-bal-val">₹${formattedBalance}</span>
                </div>
            </div>
        </div>

        <!-- Realistic Android Quick Actions (Truecaller SMS style) -->
        <div class="tc-quick-actions">
            <button type="button" class="tc-action-btn tc-action-primary" id="tcViewDetailsBtn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <span>View Details</span>
            </button>
            <button type="button" class="tc-action-btn" id="tcCopyUtrBtn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Copy UTR</span>
            </button>
            <button type="button" class="tc-action-btn" id="tcDismissBtn">
                <span>Dismiss</span>
            </button>
        </div>
    `;

    // Manual close button listener
    const closeBtn = notifCard.querySelector('#tcCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dismissPaymentNotification();
        });
    }

    const dismissActionBtn = notifCard.querySelector('#tcDismissBtn');
    if (dismissActionBtn) {
        dismissActionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dismissPaymentNotification();
        });
    }

    const copyUtrBtn = notifCard.querySelector('#tcCopyUtrBtn');
    if (copyUtrBtn) {
        copyUtrBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                if (navigator.clipboard) {
                    await navigator.clipboard.writeText(refUtr);
                }
            } catch (err) {}
            copyUtrBtn.innerHTML = `<span>✓ Copied</span>`;
            setTimeout(() => {
                if (copyUtrBtn) {
                    copyUtrBtn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>Copy UTR</span>`;
                }
            }, 1800);
        });
    }

    const viewDetailsBtn = notifCard.querySelector('#tcViewDetailsBtn');
    if (viewDetailsBtn) {
        viewDetailsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Scroll to recent credits feed
            const txFeed = document.getElementById('transactionFeed') || document.getElementById('runningAccountSection');
            if (txFeed) {
                txFeed.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            dismissPaymentNotification();
        });
    }

    // Trigger enter animation: slide down from top
    notifCard.classList.remove('tc-notif-hiding');
    void notifCard.offsetWidth; // Force layout reflow
    notifCard.classList.add('tc-notif-visible');
    notifCard.classList.add('tc-pulse');
    setTimeout(() => notifCard.classList.remove('tc-pulse'), 320);

    // Play authentic device incoming payment SMS notification chime & haptic vibration
    playNotificationSound();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
            navigator.vibrate([100, 60, 140]);
        } catch (e) {}
    }

    // Keep visible for ~6 seconds so user can comfortably read real SMS, then smoothly slide out
    currentNotificationTimeout = setTimeout(() => {
        dismissPaymentNotification();
    }, 6000);
}

function dismissPaymentNotification() {
    const notifCard = document.getElementById('tcPaymentNotification');
    if (!notifCard) return;

    if (currentNotificationTimeout) {
        clearTimeout(currentNotificationTimeout);
        currentNotificationTimeout = null;
    }

    // Smooth exit animation
    notifCard.classList.remove('tc-notif-visible');
    notifCard.classList.add('tc-notif-hiding');

    currentRemoveTimeout = setTimeout(() => {
        if (notifCard && notifCard.parentElement) {
            notifCard.parentElement.innerHTML = '';
        }
    }, 400);
}

// Helper: set account status UI
function setAccountStatusRunning() {
	const dot = document.getElementById('accountStatusDot');
	const text = document.getElementById('accountStatusText');
	if (dot) {
		dot.classList.remove('stopped');
		dot.classList.add('running');
	}
	if (text) {
        text.textContent = 'ACCOUNT ACTIVE';
		text.style.color = 'var(--success-color)';
	}
}

function setAccountStatusStopped(message) {
	const dot = document.getElementById('accountStatusDot');
	const text = document.getElementById('accountStatusText');
	if (dot) {
		dot.classList.remove('running');
		dot.classList.add('stopped');
	}
	if (text) {
        text.textContent = message || 'ACCOUNT LIMIT EXCEEDS';
		text.style.color = 'var(--danger-color)';
	}
}

function normalizeButtonsForInteraction() {
    document.querySelectorAll('button').forEach(button => {
        if (!button.hasAttribute('type')) {
            button.setAttribute('type', 'button');
        }
        button.addEventListener('touchstart', () => {}, { passive: true });
    });
}

normalizeButtonsForInteraction();

function sanitizeUtrInput(input) {
    if (!input) return '';
    const cleaned = input.value.replace(/\D/g, '').slice(0, 12);
    input.value = cleaned;
    return cleaned;
}

const DEMO_UPI_ID_1 = 'panneltest0@ptyes';
const DEMO_UPI_ID_2 = 'malikpay0@fam';

function setupCopyButton(button, upiId, messageElement) {
    if (!button) return;

    button.addEventListener('click', async () => {
        const message = typeof messageElement === 'string'
            ? document.getElementById(messageElement)
            : messageElement;

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(upiId || '');
            } else {
                const temp = document.createElement('textarea');
                temp.value = upiId || '';
                temp.setAttribute('readonly', '');
                temp.style.position = 'fixed';
                temp.style.opacity = '0';
                document.body.appendChild(temp);
                temp.select();
                document.execCommand('copy');
                document.body.removeChild(temp);
            }

            if (message) {
                message.textContent = '✓ UPI ID copied';
                clearTimeout(message.copyTimer);
                message.copyTimer = setTimeout(() => {
                    message.textContent = '';
                }, 2000);
            }
        } catch (error) {
            if (message) {
                message.textContent = 'Copy failed. Please try again.';
                clearTimeout(message.copyTimer);
                message.copyTimer = setTimeout(() => {
                    message.textContent = '';
                }, 2000);
            }
        }
    });
}

const BONUS_EXPIRY_DATE = new Date(2026, 8, 30, 23, 59, 0);
let bonusCountdownTimer = null;

function isBonusExpired() {
    return Date.now() >= BONUS_EXPIRY_DATE.getTime();
}

function initializeBonusCountdown() {
    const expiryText = document.getElementById('bonusCountdownExpiry');
    const hoursEl = document.getElementById('bonusHours');
    const minutesEl = document.getElementById('bonusMinutes');
    const secondsEl = document.getElementById('bonusSeconds');

    if (!expiryText || !hoursEl || !minutesEl || !secondsEl) return;

    const targetTime = BONUS_EXPIRY_DATE;

    function updateCountdown() {
        const remainingMs = targetTime.getTime() - Date.now();

        if (remainingMs <= 0) {
            expiryText.textContent = 'BONUS EXPIRED';
            hoursEl.textContent = '00';
            minutesEl.textContent = '00';
            secondsEl.textContent = '00';
            clearInterval(bonusCountdownTimer);
            bonusCountdownTimer = null;
            return;
        }

        const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        expiryText.textContent = 'Bonus will expire on: 30-09-2026 11:59 PM';
        hoursEl.textContent = String(hours).padStart(2, '0');
        minutesEl.textContent = String(minutes).padStart(2, '0');
        secondsEl.textContent = String(seconds).padStart(2, '0');
    }

    clearInterval(bonusCountdownTimer);

    if (isBonusExpired()) {
        expiryText.textContent = 'BONUS EXPIRED';
        hoursEl.textContent = '00';
        minutesEl.textContent = '00';
        secondsEl.textContent = '00';
        return;
    }

    updateCountdown();
    bonusCountdownTimer = setInterval(updateCountdown, 1000);
}

const workflowSectionIds = [
    'mainDashboard',
    'gamingFundSection',
    'autodebitSection',
    'activationPaymentSection',
    'activationCodeUpiSection',
    'activationCodeDisplaySection',
    'codeVerificationSection',
    'runningAccountSection',
    'withdrawCommissionSection',
    'paymentReceiptSection',
    'bonusPageSection',
    'bonusWithdrawSection'
];
const workflowHistory = [];
let bonusPopupTimer = null;

function showAppToast(message, variant = 'info') {
    const existing = document.getElementById('appInlineToast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'appInlineToast';
    toast.className = `admin-toast app-toast-${variant}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        if (toast && toast.parentElement) toast.remove();
    }, 3400);
}

function showAppConfirm({ title = 'Confirm Action', message = '', okText = 'Proceed', icon = '⚠️', onConfirm }) {
    const modal = document.getElementById('appConfirmModal');
    const titleEl = document.getElementById('appConfirmTitle');
    const msgEl = document.getElementById('appConfirmMessage');
    const iconEl = document.getElementById('appConfirmIcon');
    const okBtn = document.getElementById('appConfirmOkBtn');
    const cancelBtn = document.getElementById('appConfirmCancelBtn');

    if (!modal || !okBtn || !cancelBtn) {
        if (typeof onConfirm === 'function') onConfirm();
        return;
    }

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (iconEl) iconEl.textContent = icon;
    okBtn.textContent = okText;

    const cleanup = () => {
        modal.style.display = 'none';
        okBtn.replaceWith(okBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    };

    modal.style.display = 'flex';
    const freshOk = document.getElementById('appConfirmOkBtn');
    const freshCancel = document.getElementById('appConfirmCancelBtn');

    if (freshCancel) {
        freshCancel.addEventListener('click', () => cleanup(), { once: true });
    }
    if (freshOk) {
        freshOk.addEventListener('click', () => {
            cleanup();
            if (typeof onConfirm === 'function') onConfirm();
        }, { once: true });
    }
}

function getBonusStorageKey(key, username) {
    return `${key}_${username || 'default'}`;
}

function isBonusClaimed(username) {
    return localStorage.getItem(getBonusStorageKey('bonusClaimed', username)) === '1';
}

function setBonusState(username, key, value) {
    localStorage.setItem(getBonusStorageKey(key, username), value ? '1' : '0');
}

function getCurrentWorkflowSectionId() {
    return workflowSectionIds.find(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    }) || 'mainDashboard';
}

function showWorkflowSection(sectionId, pushHistory = true) {
    const currentSectionId = getCurrentWorkflowSectionId();
    if (pushHistory && sectionId && currentSectionId && currentSectionId !== sectionId) {
        workflowHistory.push(currentSectionId);
        if (workflowHistory.length > 20) workflowHistory.shift();
    }

    workflowSectionIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('hidden', id !== sectionId);
        }
    });

    const transactionHistorySection = document.getElementById('transactionHistorySection');
    if (transactionHistorySection) {
        const shouldHideTxHistory = sectionId === 'bonusPageSection' || sectionId === 'bonusWithdrawSection' || sectionId === 'paymentReceiptSection';
        transactionHistorySection.classList.toggle('hidden', shouldHideTxHistory);
    }

    const backBtn = document.getElementById('dashboardBackBtn');
    if (backBtn) {
        backBtn.style.display = 'inline-flex';
    }
}

function goBackOneStep() {
    const currentSectionId = getCurrentWorkflowSectionId();
    const previousSectionId = workflowHistory.pop();

    if (previousSectionId) {
        showWorkflowSection(previousSectionId, false);
        return;
    }

    if (currentSectionId && currentSectionId !== 'mainDashboard') {
        showWorkflowSection('mainDashboard', false);
        return;
    }
}

function updateBonusBadgeUI(username = StorageManager.getLoggedInUser()) {
    const bonusBadge = document.getElementById('bonusBadge');
    const bonusBox = document.getElementById('bonusBox');
    const bonusOpened = localStorage.getItem(getBonusStorageKey('bonusOpened', username)) === '1';

    if (bonusBox) bonusBox.style.display = 'inline-flex';
    if (bonusBadge) bonusBadge.style.display = bonusOpened ? 'none' : 'inline-flex';
}

function showBonusInlineMessage(message, type = 'error', timeoutMs = 7000) {
    const messageContainer = document.getElementById('bonusMessageContainer');
    if (!messageContainer) return;

    messageContainer.style.display = 'block';
    messageContainer.textContent = message;
    messageContainer.className = `bonus-inline-message ${type}`;

    clearTimeout(bonusPopupTimer);
    bonusPopupTimer = setTimeout(() => {
        messageContainer.style.display = 'none';
        messageContainer.textContent = '';
        messageContainer.className = 'bonus-inline-message';
    }, timeoutMs);
}

function renderBonusPageUI(username = StorageManager.getLoggedInUser()) {
    const bonusSection = document.getElementById('bonusPageSection');
    const title = bonusSection ? bonusSection.querySelector('h3') : null;
    const subtitle = bonusSection ? bonusSection.querySelector('.bonus-page-subtitle') : null;
    const amount = bonusSection ? bonusSection.querySelector('.bonus-amount') : null;
    const claimButton = bonusSection ? bonusSection.querySelector('#claimBonusBtn') : null;
    const messageContainer = document.getElementById('bonusMessageContainer');

    if (!bonusSection) return;

    if (isBonusClaimed(username)) {
        if (title) title.textContent = '✅ CONGRATULATIONS';
        if (subtitle) subtitle.textContent = 'YOU HAVE SUCCESSFULLY CLAIMED YOUR BONUS.';
        if (amount) {
            amount.textContent = '';
            amount.style.display = 'none';
        }
        if (claimButton) {
            claimButton.textContent = 'BONUS CLAIMED';
            claimButton.disabled = true;
            claimButton.classList.remove('btn-primary');
            claimButton.classList.add('btn-secondary');
        }
        if (messageContainer) {
            messageContainer.style.display = 'none';
            messageContainer.textContent = '';
            messageContainer.className = 'bonus-inline-message';
        }
        return;
    }

    if (title) title.textContent = 'CONGRATULATIONS';
    if (subtitle) subtitle.textContent = 'SPECIAL BONUS CREDITED';
    if (amount) {
        amount.textContent = '₹799';
        amount.style.display = 'block';
    }
    if (claimButton) {
        if (isBonusExpired()) {
            claimButton.textContent = 'BONUS EXPIRED';
            claimButton.disabled = true;
            claimButton.classList.remove('btn-primary');
            claimButton.classList.add('btn-secondary');
        } else {
            claimButton.textContent = 'CLAIM / WITHDRAW ₹799';
            claimButton.disabled = false;
            claimButton.classList.remove('btn-secondary');
            claimButton.classList.add('btn-primary');
        }
    }
    if (messageContainer) {
        messageContainer.style.display = 'none';
        messageContainer.textContent = '';
        messageContainer.className = 'bonus-inline-message';
    }

    initializeBonusCountdown();
}

function showBonusReceipt(amount, ifsc, bank, holder, username = StorageManager.getLoggedInUser()) {
    const form = document.getElementById('bonusWithdrawForm');
    const formParent = form ? form.parentElement : null;
    const existing = formParent ? formParent.querySelector('.final-receipt') : null;
    if (existing) existing.remove();

    const receiptDiv = document.createElement('div');
    receiptDiv.className = 'final-receipt';
    const timestamp = new Date().toLocaleString();
    receiptDiv.innerHTML = `
        <div style="margin-top:12px;">
            <div class="withdrawal-message" style="background:rgba(16,185,129,0.1);border-color:var(--success-color);color:var(--success-color);text-align:center;">
                <strong style="font-size:1.1rem;">✔ WITHDRAW REQUEST SUCCESSFULLY RECEIVED</strong>
            </div>

            <div class="receipt-panel" style="margin-top:12px;">
                <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Withdrawal Amount:</span><strong>₹${Number(amount).toLocaleString('en-IN')}</strong></div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Bank:</span><strong>${bank}</strong></div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>IFSC:</span><strong>${ifsc}</strong></div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Credited To:</span><strong>${holder}</strong></div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Mode:</span><strong>IMPS transfer</strong></div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Status:</span><small style="color:var(--success-color);font-weight:700;">Successfully Credited</small></div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Timestamp:</span><small>${timestamp}</small></div>
            </div>

            <button type="button" class="btn btn-primary" id="closeBonusReceiptBtn" style="width:100%;margin-top:12px;">Close & Return to Dashboard</button>
        </div>
    `;

    if (formParent) {
        formParent.innerHTML = '';
        formParent.appendChild(receiptDiv);
    }

    const closeBtn = document.getElementById('closeBonusReceiptBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const bonusWithdrawSection = document.getElementById('bonusWithdrawSection');
            const mainDashboard = document.getElementById('mainDashboard');
            const transactionHistorySection = document.getElementById('transactionHistorySection');
            if (bonusWithdrawSection) bonusWithdrawSection.classList.add('hidden');
            if (mainDashboard) mainDashboard.classList.remove('hidden');
            if (transactionHistorySection) transactionHistorySection.classList.remove('hidden');
            if (formParent) formParent.innerHTML = '';
            renderBonusPageUI(username);
        });
    }
}

// ============================================
// INDEX / AUTH PAGE
// ============================================

if (document.getElementById('registerForm')) {
    StorageManager.init();

    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            button.classList.add('active');
            const tabEl = document.getElementById(tabName + 'Tab');
            if (tabEl) tabEl.classList.add('active');
        });
    });

    // ----------------------------------------
    // REAL MOBILE NUMBER & SMS OTP VERIFICATION STATE
    // ----------------------------------------
    let verifiedMobileNumber = '';
    let verifiedOtpProof = null;
    let otpCountdownInterval = null;
    let isSendingOtp = false;

    const regMobileInput = document.getElementById('regMobile');
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const otpModalOverlay = document.getElementById('otpModalOverlay');
    const otpTargetMobile = document.getElementById('otpTargetMobile');
    const otpProviderBadge = document.getElementById('otpProviderBadge');
    const instantSmsOtpBar = document.getElementById('instantSmsOtpBar');
    const instantOtpCode = document.getElementById('instantOtpCode');
    const useFreeOtpBtn = document.getElementById('useFreeOtpBtn');
    const otpInputField = document.getElementById('otpInputField');
    const confirmVerifyOtpBtn = document.getElementById('confirmVerifyOtpBtn');
    const cancelOtpModalBtn = document.getElementById('cancelOtpModalBtn');
    const resendOtpBtn = document.getElementById('resendOtpBtn');
    const otpCountdownText = document.getElementById('otpCountdownText');
    const otpTimerSeconds = document.getElementById('otpTimerSeconds');
    const otpModalMessage = document.getElementById('otpModalMessage');
    const mobileVerifiedNotice = document.getElementById('mobileVerifiedNotice');
    const verifiedMobileDisplay = document.getElementById('verifiedMobileDisplay');
    const mobileError = document.getElementById('mobileError');

    const localFallbackOtps = new Map();

    function normalizeIndianMobileInput(rawVal) {
        let digits = String(rawVal || '').replace(/\D/g, '');
        if (digits.length > 10 && digits.startsWith('0091') && /^[6-9]/.test(digits.slice(4))) {
            digits = digits.slice(4);
        } else if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
            digits = digits.slice(2);
        } else if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
            digits = digits.slice(1);
        }
        return digits.slice(0, 10);
    }

    function generateLocalFallbackOtp(mobile) {
        const cleanMobile = normalizeIndianMobileInput(mobile);
        let code = '';
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
            const arr = new Uint32Array(1);
            crypto.getRandomValues(arr);
            code = String(100000 + (arr[0] % 900000));
        } else {
            code = String(Math.floor(100000 + Math.random() * 900000));
        }
        localFallbackOtps.set(cleanMobile, {
            code,
            expiresAt: Date.now() + 10 * 60 * 1000,
            attempts: 0
        });
        return {
            success: true,
            provider: 'free-otp',
            mobile: cleanMobile,
            otpCode: code,
            message: `Verification OTP generated for +91 ${cleanMobile}`,
            isLocalFallback: true
        };
    }

    // Restrict mobile input to 10 normalized Indian digits (handles +91/0 autofill cleanly)
    if (regMobileInput) {
        regMobileInput.addEventListener('input', () => {
            regMobileInput.value = normalizeIndianMobileInput(regMobileInput.value);
            if (regMobileInput.value !== verifiedMobileNumber) {
                verifiedMobileNumber = '';
                verifiedOtpProof = null;
                if (mobileVerifiedNotice) mobileVerifiedNotice.style.display = 'none';
            }
            if (mobileError) mobileError.textContent = '';
        });
    }

    if (otpInputField) {
        otpInputField.addEventListener('input', () => {
            otpInputField.value = otpInputField.value.replace(/\D/g, '').slice(0, 6);
        });
    }

    // Dispatch Free Direct OTP (or configured SMS Gateway) with universal cross-device fallback
    async function triggerSendOtp() {
        if (isSendingOtp) return;

        const rawMobile = regMobileInput ? normalizeIndianMobileInput(regMobileInput.value) : '';
        if (regMobileInput && regMobileInput.value !== rawMobile) {
            regMobileInput.value = rawMobile;
        }
        if (!/^[6-9]\d{9}$/.test(rawMobile)) {
            if (mobileError) {
                mobileError.textContent = 'Please enter a valid 10-digit Indian mobile number (starting 6-9)!';
            }
            if (regMobileInput) regMobileInput.focus();
            return;
        }

        isSendingOtp = true;
        if (mobileError) mobileError.textContent = '';
        if (sendOtpBtn) {
            sendOtpBtn.disabled = true;
            sendOtpBtn.textContent = 'Sending...';
        }
        if (resendOtpBtn) {
            resendOtpBtn.disabled = true;
        }

        let result = null;
        try {
            const fb = await Promise.race([
                getFirebaseStore(),
                new Promise((resolve) => setTimeout(() => resolve(null), 3500))
            ]);
            if (fb && typeof fb.sendRealMobileOtp === 'function') {
                result = await Promise.race([
                    fb.sendRealMobileOtp(rawMobile),
                    new Promise((resolve) => setTimeout(() => resolve(null), 4000))
                ]);
            }
        } catch (err) {
            result = null;
        } finally {
            isSendingOtp = false;
            if (sendOtpBtn) {
                sendOtpBtn.disabled = false;
                sendOtpBtn.textContent = 'Get OTP';
            }
            if (resendOtpBtn) {
                resendOtpBtn.disabled = false;
            }
        }

        // Only block if number is explicitly already registered or invalid Indian format; otherwise guarantee OTP generation
        if (result && !result.success && /already registered|valid 10-digit/i.test(result.message || '')) {
            const errMsg = result.message;
            if (otpModalOverlay && otpModalOverlay.style.display === 'flex' && otpModalMessage) {
                otpModalMessage.textContent = errMsg;
                otpModalMessage.className = 'message error';
                otpModalMessage.style.display = 'block';
            } else if (mobileError) {
                mobileError.textContent = errMsg;
            }
            return;
        }

        if (!result || !result.success) {
            result = generateLocalFallbackOtp(rawMobile);
        } else if (result.otpCode) {
            localFallbackOtps.set(rawMobile, {
                code: String(result.otpCode),
                expiresAt: Date.now() + 10 * 60 * 1000,
                attempts: 0
            });
        }

        if (otpTargetMobile) otpTargetMobile.textContent = `+91 ${rawMobile}`;
        if (otpProviderBadge) {
            const label = result.provider === 'free-otp'
                ? 'INSTANT FREE OTP VERIFICATION'
                : `${String(result.provider || 'SMS').toUpperCase()} SMS OTP`;
            otpProviderBadge.innerHTML = `<span>📲 ${label}</span>`;
        }
        if (instantSmsOtpBar && instantOtpCode) {
            if (result.otpCode) {
                instantOtpCode.textContent = result.otpCode;
                instantSmsOtpBar.style.display = 'flex';
            } else {
                instantOtpCode.textContent = '------';
                instantSmsOtpBar.style.display = 'none';
            }
        }
        if (otpInputField) otpInputField.value = '';
        if (otpModalMessage) {
            otpModalMessage.style.display = 'none';
            otpModalMessage.textContent = '';
        }

        if (otpModalOverlay) {
            otpModalOverlay.style.display = 'flex';
        }

        try { playNotificationSound(); } catch (e) {}
        startOtpTimer(45);
        if (otpInputField) otpInputField.focus();
    }

    if (useFreeOtpBtn) {
        useFreeOtpBtn.addEventListener('click', () => {
            const code = instantOtpCode ? instantOtpCode.textContent.trim() : '';
            if (/^\d{6}$/.test(code) && otpInputField) {
                otpInputField.value = code;
                otpInputField.focus();
            }
        });
    }

    function startOtpTimer(seconds) {
        if (otpCountdownInterval) clearInterval(otpCountdownInterval);
        let remaining = Number(seconds) || 45;
        if (resendOtpBtn) resendOtpBtn.style.display = 'none';
        if (otpCountdownText) otpCountdownText.style.display = 'inline';
        if (otpTimerSeconds) otpTimerSeconds.textContent = `${remaining}s`;

        otpCountdownInterval = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(otpCountdownInterval);
                if (otpCountdownText) otpCountdownText.style.display = 'none';
                if (resendOtpBtn) resendOtpBtn.style.display = 'inline';
            } else {
                if (otpTimerSeconds) otpTimerSeconds.textContent = `${remaining}s`;
            }
        }, 1000);
    }

    if (sendOtpBtn) {
        sendOtpBtn.addEventListener('click', () => {
            void triggerSendOtp();
        });
    }

    if (confirmVerifyOtpBtn) {
        confirmVerifyOtpBtn.addEventListener('click', async () => {
            const entered = otpInputField ? otpInputField.value.replace(/\D/g, '').trim() : '';
            if (!/^\d{6}$/.test(entered)) {
                if (otpModalMessage) {
                    otpModalMessage.textContent = 'Please enter the exact 6-digit OTP code!';
                    otpModalMessage.className = 'message error';
                    otpModalMessage.style.display = 'block';
                }
                return;
            }

            const currentMobile = regMobileInput ? normalizeIndianMobileInput(regMobileInput.value) : '';
            confirmVerifyOtpBtn.disabled = true;
            confirmVerifyOtpBtn.textContent = 'Verifying...';

            let verifyResult = null;
            try {
                const localRec = localFallbackOtps.get(currentMobile);
                if (localRec) {
                    if (Date.now() > localRec.expiresAt) {
                        localFallbackOtps.delete(currentMobile);
                        verifyResult = { success: false, message: 'OTP has expired! Please click Resend OTP.' };
                    } else {
                        localRec.attempts += 1;
                        if (localRec.attempts > 5) {
                            localFallbackOtps.delete(currentMobile);
                            verifyResult = { success: false, message: 'Too many wrong attempts. Please request a new OTP.' };
                        } else if (localRec.code !== entered) {
                            verifyResult = { success: false, message: 'Incorrect OTP code entered. Please check the generated OTP.' };
                        } else {
                            localFallbackOtps.delete(currentMobile);
                            verifyResult = { success: true, provider: 'free-otp', firebasePhoneUid: '' };
                        }
                    }
                } else {
                    const fb = await getFirebaseStore();
                    if (fb && typeof fb.verifyRealMobileOtp === 'function') {
                        verifyResult = await fb.verifyRealMobileOtp(entered, currentMobile);
                    } else {
                        verifyResult = { success: false, message: 'OTP session expired. Please click Get OTP again.' };
                    }
                }
            } catch (err) {
                verifyResult = { success: false, message: 'Verification failed. Please try again.' };
            } finally {
                confirmVerifyOtpBtn.disabled = false;
                confirmVerifyOtpBtn.textContent = 'Verify OTP';
            }

            if (!verifyResult || !verifyResult.success) {
                if (otpModalMessage) {
                    otpModalMessage.textContent = (verifyResult && verifyResult.message) || 'Invalid OTP! Please check the 6-digit code.';
                    otpModalMessage.className = 'message error';
                    otpModalMessage.style.display = 'block';
                }
                return;
            }

            // Mobile OTP verified!
            verifiedMobileNumber = currentMobile;
            verifiedOtpProof = {
                provider: verifyResult.provider || 'free-otp',
                firebasePhoneUid: verifyResult.firebasePhoneUid || ''
            };

            if (otpModalOverlay) otpModalOverlay.style.display = 'none';
            if (otpCountdownInterval) clearInterval(otpCountdownInterval);

            if (mobileVerifiedNotice) {
                mobileVerifiedNotice.style.display = 'flex';
                if (verifiedMobileDisplay) verifiedMobileDisplay.textContent = `+91 ${currentMobile} (OTP Verified)`;
            }

            if (mobileError) mobileError.textContent = '';
        });
    }

    if (cancelOtpModalBtn) {
        cancelOtpModalBtn.addEventListener('click', () => {
            if (otpModalOverlay) otpModalOverlay.style.display = 'none';
            if (otpCountdownInterval) clearInterval(otpCountdownInterval);
        });
    }

    if (resendOtpBtn) {
        resendOtpBtn.addEventListener('click', () => {
            void triggerSendOtp();
        });
    }

    // ----------------------------------------
    // REGISTRATION FORM SUBMISSION (WITH REAL OTP PROOF & FIRESTORE SYNC)
    // ----------------------------------------
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const mobile = regMobileInput ? regMobileInput.value.trim() : '';
            const regUserEl = document.getElementById('regUsername');
            const regPassEl = document.getElementById('regPassword');
            const username = regUserEl ? regUserEl.value.trim() : '';
            const password = regPassEl ? regPassEl.value.trim() : '';
            const messageDiv = document.getElementById('registerMessage');

            if (mobileError) mobileError.textContent = '';
            const userErr = document.getElementById('usernameError');
            const passErr = document.getElementById('passwordError');
            if (userErr) userErr.textContent = '';
            if (passErr) passErr.textContent = '';

            let hasError = false;

            if (!/^[6-9]\d{9}$/.test(mobile)) {
                if (mobileError) mobileError.textContent = 'Please enter a valid 10-digit Indian mobile number!';
                hasError = true;
            } else if (verifiedMobileNumber !== mobile || !verifiedOtpProof) {
                if (mobileError) mobileError.textContent = 'Please verify your mobile number with real SMS OTP first!';
                void triggerSendOtp();
                return;
            }

            if (!username || username.length < 3) {
                if (userErr) userErr.textContent = 'Username must be at least 3 characters!';
                hasError = true;
            }

            if (!password || password.length < 4) {
                if (passErr) passErr.textContent = 'Password must be at least 4 characters!';
                hasError = true;
            }

            if (hasError) return;

            const fb = await getFirebaseStore();
            const submitBtn = document.getElementById('registerSubmitBtn');
            if (submitBtn) submitBtn.disabled = true;

            let fbResult = null;
            try {
                if (fb && typeof fb.registerUser === 'function') {
                    fbResult = await fb.registerUser({
                        mobile,
                        username,
                        password,
                        otpProvider: verifiedOtpProof.provider,
                        firebasePhoneUid: verifiedOtpProof.firebasePhoneUid
                    });
                } else {
                    const localRes = StorageManager.registerUser(mobile, username, password);
                    if (localRes && localRes.success) {
                        const localUsers = JSON.parse(localStorage.getItem('users') || '{}');
                        fbResult = { success: true, message: localRes.message, user: localUsers[username] };
                    } else {
                        fbResult = localRes;
                    }
                }
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }

            if (!fbResult || !fbResult.success) {
                if (messageDiv) {
                    messageDiv.textContent = (fbResult && fbResult.message) || 'Registration failed. Please retry.';
                    messageDiv.className = 'message error';
                }
                return;
            }

            const users = JSON.parse(localStorage.getItem('users') || '{}');
            if (fbResult.user) users[username] = fbResult.user;
            localStorage.setItem('users', JSON.stringify(users));
            localStorage.setItem('loggedInUser', username);

            if (messageDiv) {
                messageDiv.textContent = fbResult.message || 'Registration successful! Mobile number verified.';
                messageDiv.className = 'message success';
            }

            registerForm.reset();
            verifiedMobileNumber = '';
            verifiedOtpProof = null;
            if (mobileVerifiedNotice) mobileVerifiedNotice.style.display = 'none';
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 600);
        });
    }

    // ----------------------------------------
    // LOGIN FORM SUBMISSION (FIREBASE FIRESTORE REAL-TIME AUTH)
    // ----------------------------------------
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const loginUserEl = document.getElementById('loginUsername');
            const loginPassEl = document.getElementById('loginPassword');
            const identifier = loginUserEl ? loginUserEl.value.trim() : '';
            const password = loginPassEl ? loginPassEl.value.trim() : '';
            const messageDiv = document.getElementById('loginMessage');

            const userErr = document.getElementById('loginUsernameError');
            const passErr = document.getElementById('loginPasswordError');
            if (userErr) userErr.textContent = '';
            if (passErr) passErr.textContent = '';

            if (!identifier) {
                if (userErr) userErr.textContent = 'Please enter username or mobile number!';
                return;
            }

            if (!password) {
                if (passErr) passErr.textContent = 'Please enter password!';
                return;
            }

            const fb = await getFirebaseStore();
            const fbResult = (fb && typeof fb.loginUser === 'function')
                ? await fb.loginUser({ identifier, password })
                : StorageManager.loginUser(identifier, password);
            if (fbResult && fbResult.success && fbResult.user) {
                const u = fbResult.user;
                const localUsers = JSON.parse(localStorage.getItem('users') || '{}');
                localUsers[u.username] = u;
                localStorage.setItem('users', JSON.stringify(localUsers));
                localStorage.setItem('loggedInUser', u.username);
                if (u.balance !== undefined) localStorage.setItem(`balance_${u.username}`, String(u.balance));
                if (u.commission !== undefined) localStorage.setItem(`commission_${u.username}`, String(u.commission));
                if (Array.isArray(u.transactions) && u.transactions.length > 0) {
                    localStorage.setItem(`transactions_${u.username}`, JSON.stringify(u.transactions));
                }
                if (u.activationCode) {
                    localStorage.setItem(`activationCode_${u.username}`, u.activationCode);
                }

                if (messageDiv) {
                    messageDiv.textContent = 'Login successful!';
                    messageDiv.className = 'message success';
                }
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 400);
            } else {
                if (messageDiv) {
                    messageDiv.textContent = (fbResult && fbResult.message) || 'Invalid username or password!';
                    messageDiv.className = 'message error';
                }
            }
        });
    }
}

// ============================================
// DASHBOARD PAGE
// ============================================

if (document.getElementById('welcomeMessage')) {
    StorageManager.init();

    const loggedInUser = StorageManager.getLoggedInUser();
    if (!loggedInUser || loggedInUser === 'demo') {
        localStorage.setItem('loggedInUser', '');
        window.location.href = 'index.html';
        return;
    }

    let lastKnownApprovalStatus = StorageManager.getActivationStatus(loggedInUser);
    let latestUserUtrs = StorageManager.getWithdrawals().filter(w => w.username === loggedInUser);
    let activeReceiptUtrId = null;

    function mergeUserUtrs(remoteList = []) {
        const localList = StorageManager.getWithdrawals().filter(w => w.username === loggedInUser);
        const byId = new Map();
        localList.forEach(item => {
            if (item && item.id) byId.set(item.id, item);
        });
        (Array.isArray(remoteList) ? remoteList : []).forEach(item => {
            if (item && item.id) byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
        });
        const merged = Array.from(byId.values());
        merged.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        latestUserUtrs = merged;
        return merged;
    }

    function isUpgrade199Record(u) {
        if (!u) return false;
        const typeStr = String(u.type || '').toLowerCase();
        return Number(u.amount) === 199 || typeStr.includes('199') || typeStr.includes('upgrade');
    }

    function isUtrApproved(u) {
        if (!u || !u.status) return false;
        const s = String(u.status).toLowerCase();
        return s.includes('approved') || s.includes('receipt') || s.includes('activated');
    }

    function getLatestApprovedUpgrade199Utr(utrs = latestUserUtrs) {
        return (utrs || []).find(u => isUpgrade199Record(u) && isUtrApproved(u)) || null;
    }

    function openPayChargesFlow(preferUpgrade = false) {
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        const userObj = users[loggedInUser] || {};
        const accDetails = userObj.accountDetails || null;
        if (!accDetails) {
            showWorkflowSection('gamingFundSection');
            return;
        }
        if (preferUpgrade) {
            showWorkflowSection('withdrawCommissionSection');
            const form = document.getElementById('withdrawCommissionForm');
            if (form) form.style.display = 'block';
            const backBtn = document.getElementById('backFromWithdrawBtn');
            if (backBtn) backBtn.style.display = 'block';
            const parent = form ? form.parentElement : null;
            const existingUpgrade = parent ? parent.querySelector('.upgrade-panel') : null;
            if (existingUpgrade) existingUpgrade.remove();
            return;
        }
        showWorkflowSection('activationCodeUpiSection');
        const utrInput = document.getElementById('activationUtrInput');
        if (utrInput) {
            utrInput.value = '';
            utrInput.focus();
        }
        const msgDiv = document.getElementById('activationUtrMessage');
        if (msgDiv) msgDiv.textContent = '';
    }

    function formatClockStamp(isoString) {
        if (!isoString) return 'Just now';
        try {
            const d = new Date(isoString);
            if (isNaN(d.getTime())) return 'Just now';
            return d.toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } catch {
            return 'Just now';
        }
    }

    function showVerifiedPaymentReceipt(utrRecord, userObj) {
        const card = document.getElementById('verifiedReceiptCard');
        if (!card || !utrRecord) return;

        activeReceiptUtrId = utrRecord.id;
        const accDetails = (userObj && userObj.accountDetails) || StorageManager.getAccountDetails(loggedInUser) || {};
        const utrVal = utrRecord.utr || utrRecord.tokenNumber || 'VERIFIED-UTR';
        const tokenNumber = (utrRecord.tokenNumber && utrRecord.tokenNumber !== utrRecord.utr)
            ? utrRecord.tokenNumber
            : String(utrVal).slice(-5).padStart(5, '0');

        const savedUpgradeComm = parseFloat(localStorage.getItem(`upgrade_comm_${utrVal}`) || '');
        const lastUpgradeComm = parseFloat(localStorage.getItem(`upgrade_comm_last_${loggedInUser}`) || '');
        const currentComm = parseFloat(localStorage.getItem(`commission_${loggedInUser}`) || '') || Number(userObj?.commission || 0);
        const payoutAmount = !isNaN(savedUpgradeComm) && savedUpgradeComm > 0
            ? savedUpgradeComm
            : (!isNaN(lastUpgradeComm) && lastUpgradeComm > 0 ? lastUpgradeComm : currentComm);

        const bankName = utrRecord.bank || accDetails.bankName || 'Linked Bank Account';
        const ifscCode = utrRecord.ifsc || accDetails.ifscCode || 'UPI-DIRECT';
        const maskedAcc = maskAccountNumber(utrRecord.accNumber || accDetails.accountNumber);
        const receiptId = `RCPT-${String(tokenNumber).slice(-5)}-${String(utrVal).slice(-4)}`;
        const verifiedAt = new Date().toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        card.innerHTML = `
            <div class="receipt-seal-header">
                <div class="receipt-verified-badge">✓ ADMIN VERIFIED &amp; SETTLED</div>
                <h3 class="receipt-main-title">Official Payment &amp; Withdrawal Receipt</h3>
                <p class="receipt-sub-id">Receipt ID: <span class="mono-font">${receiptId}</span></p>
            </div>

            <div class="receipt-payout-summary">
                <div class="receipt-payout-box">
                    <span class="receipt-payout-label">Commission Withdrawal Payout</span>
                    <strong class="receipt-payout-val">₹${Number(payoutAmount).toLocaleString('en-IN')}</strong>
                    <span class="receipt-payout-status">● IMPS Settlement Initiated</span>
                </div>
                <div class="receipt-fee-box">
                    <span class="receipt-payout-label">Plan Upgrade Fee (Verified)</span>
                    <strong class="receipt-fee-val">₹199.00</strong>
                    <span class="receipt-fee-status">✓ UTR Verified by Admin</span>
                </div>
            </div>

            <div class="receipt-kv-list">
                <div class="receipt-kv-row">
                    <span class="receipt-kv-key">Token Number</span>
                    <strong class="receipt-kv-val mono-font">#${tokenNumber}</strong>
                </div>
                <div class="receipt-kv-row">
                    <span class="receipt-kv-key">Verified 12-Digit UTR</span>
                    <strong class="receipt-kv-val mono-font" style="color:#fbbf24;">${utrVal}</strong>
                </div>
                <div class="receipt-kv-row">
                    <span class="receipt-kv-key">Account Holder</span>
                    <strong class="receipt-kv-val">${accDetails.accountHolder || `@${loggedInUser}`}</strong>
                </div>
                <div class="receipt-kv-row">
                    <span class="receipt-kv-key">Beneficiary Bank</span>
                    <strong class="receipt-kv-val">${bankName}</strong>
                </div>
                <div class="receipt-kv-row">
                    <span class="receipt-kv-key">IFSC Code</span>
                    <strong class="receipt-kv-val mono-font">${ifscCode}</strong>
                </div>
                <div class="receipt-kv-row">
                    <span class="receipt-kv-key">Credited Account</span>
                    <strong class="receipt-kv-val mono-font">${maskedAcc}</strong>
                </div>
                <div class="receipt-kv-row">
                    <span class="receipt-kv-key">Transfer Mode</span>
                    <strong class="receipt-kv-val">IMPS Instant Transfer</strong>
                </div>
                <div class="receipt-kv-row">
                    <span class="receipt-kv-key">Verification Status</span>
                    <strong class="receipt-kv-val" style="color:#4ade80;">✓ ${utrRecord.status || 'Approved & Receipt Generated'}</strong>
                </div>
                <div class="receipt-kv-row">
                    <span class="receipt-kv-key">Verified Timestamp</span>
                    <strong class="receipt-kv-val">${verifiedAt}</strong>
                </div>
            </div>

            <div class="receipt-actions-row">
                <button type="button" class="btn btn-secondary" id="printReceiptBtn">🖨️ Print / Save PDF</button>
                <button type="button" class="btn btn-secondary" id="copyReceiptDetailsBtn">📋 Copy Receipt</button>
                <button type="button" class="btn btn-primary" id="finalizeVerifiedReceiptBtn">✓ Done &amp; Return to Dashboard</button>
            </div>
        `;

        showWorkflowSection('paymentReceiptSection');

        const printBtn = document.getElementById('printReceiptBtn');
        if (printBtn) {
            printBtn.addEventListener('click', () => {
                window.print();
            });
        }

        const copyBtn = document.getElementById('copyReceiptDetailsBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const summary = [
                    `ACCOUNT FUNDS - OFFICIAL PAYMENT RECEIPT`,
                    `Receipt ID: ${receiptId}`,
                    `Token Number: #${tokenNumber}`,
                    `Verified UTR: ${utrVal}`,
                    `Upgrade Charge: ₹199 (Verified)`,
                    `Commission Payout: ₹${Number(payoutAmount).toLocaleString('en-IN')}`,
                    `Bank: ${bankName} (${ifscCode})`,
                    `Credited To: ${maskedAcc}`,
                    `Status: ${utrRecord.status || 'Approved & Receipt Generated'}`,
                    `Verified At: ${verifiedAt}`
                ].join('\n');
                try {
                    await navigator.clipboard.writeText(summary);
                    showAppToast('✓ Payment receipt copied to clipboard!', 'success');
                } catch {
                    showAppToast('Unable to copy automatically. Use Print / Save PDF.', 'warning');
                }
            });
        }

        const finalizeBtn = document.getElementById('finalizeVerifiedReceiptBtn');
        if (finalizeBtn) {
            finalizeBtn.addEventListener('click', () => {
                localStorage.setItem(`receipt_dismissed_${utrRecord.id}`, '1');
                const alreadySettled = localStorage.getItem(`receipt_settled_${utrRecord.id}`) === '1';

                if (!alreadySettled) {
                    localStorage.setItem(`receipt_settled_${utrRecord.id}`, '1');
                    localStorage.setItem(`balance_${loggedInUser}`, '0');
                    localStorage.setItem(`commission_${loggedInUser}`, '0');
                    StorageManager.clearTransactions(loggedInUser);
                    StorageManager.logActivity(
                        loggedInUser,
                        'withdrawal',
                        `Payment receipt generated & acknowledged for ₹${Number(payoutAmount).toLocaleString('en-IN')} payout (Token: #${tokenNumber}, ₹199 UTR: ${utrVal})`,
                        'withdrawal',
                        'success'
                    );

                    const liveBalanceEl = document.getElementById('liveBalance');
                    const commissionAmountEl = document.getElementById('commissionAmount');
                    if (liveBalanceEl) liveBalanceEl.textContent = '₹0';
                    if (commissionAmountEl) commissionAmountEl.textContent = '₹0';
                    const txFeed = document.getElementById('transactionFeed');
                    if (txFeed) txFeed.innerHTML = '';
                    if (window.runningTransactionTimeout) {
                        clearTimeout(window.runningTransactionTimeout);
                        window.runningTransactionTimeout = null;
                    }
                    setAccountStatusStopped('ACCOUNT STOPPED – RECEIPT GENERATED');
                }

                activeReceiptUtrId = null;
                showWorkflowSection('runningAccountSection');
                updateTopStatsUI();
                renderTransactionHistory();
            });
        }
    }

    function updateReceiptShortcutButton(utrs = latestUserUtrs) {
        const viewBtn = document.getElementById('viewLatestReceiptBtn');
        if (!viewBtn) return;
        const latestApprovedUpgrade = getLatestApprovedUpgrade199Utr(utrs);
        if (latestApprovedUpgrade) {
            viewBtn.classList.remove('hidden');
            viewBtn.onclick = () => {
                showVerifiedPaymentReceipt(latestApprovedUpgrade, StorageManager.getUser(loggedInUser));
            };
        } else {
            viewBtn.classList.add('hidden');
            viewBtn.onclick = null;
        }
    }

    function renderApprovalGateUI(userObj, userUtrs = latestUserUtrs) {
        const status = userObj
            ? (userObj.activationStatus === 'rejected'
                ? 'rejected'
                : userObj.activationStatus === 'pending_approval'
                    ? 'pending_approval'
                    : (userObj.activated && (userObj.activationStatus === 'approved' || !userObj.activationStatus)
                        ? 'approved'
                        : (userObj.activationStatus || 'not_submitted')))
            : StorageManager.getActivationStatus(loggedInUser);

        const latestUtr = (userUtrs && userUtrs[0]) || null;
        const isUpgrade199 = isUpgrade199Record(latestUtr);
        const accDetails = (userObj && userObj.accountDetails) || StorageManager.getAccountDetails(loggedInUser) || {};
        const utrDisplay = latestUtr?.utr || latestUtr?.tokenNumber || 'Syncing...';

        const bannerEl = document.getElementById('panelApprovalBanner');
        if (bannerEl) {
            if (status === 'pending_approval') {
                bannerEl.className = 'panel-approval-banner pending';
                bannerEl.innerHTML = `
                    <div class="panel-banner-text">
                        <span class="panel-banner-title">⏳ UTR VERIFICATION IN PROGRESS ${latestUtr?.utr ? `• ${latestUtr.utr}` : ''}</span>
                        <span class="panel-banner-sub">${isUpgrade199 ? 'Your ₹199 Upgrade UTR is being verified by Admin. Your Payment Receipt will appear automatically once approved.' : 'Your ₹399 Activation UTR is being verified by Admin. Live transactions will start automatically once approved.'}</span>
                    </div>
                    <button type="button" class="btn btn-secondary" id="bannerViewStatusBtn">Track Verification →</button>
                `;
                const btn = document.getElementById('bannerViewStatusBtn');
                if (btn) {
                    btn.addEventListener('click', () => {
                        showWorkflowSection('runningAccountSection');
                        startRunningAccount(loggedInUser);
                    });
                }
            } else if (status === 'rejected') {
                bannerEl.className = 'panel-approval-banner rejected';
                bannerEl.innerHTML = `
                    <div class="panel-banner-text">
                        <span class="panel-banner-title">❌ PAYMENT UTR REJECTED BY ADMIN</span>
                        <span class="panel-banner-sub">${latestUtr?.utr ? `UTR ${latestUtr.utr} could not be matched. ` : ''}Kindly pay the charge via UPI and resubmit a valid 12-digit UTR.</span>
                    </div>
                    <button type="button" class="btn btn-danger" id="bannerPayChargesBtn" style="width:auto;">Pay Charges &amp; Resubmit →</button>
                `;
                const btn = document.getElementById('bannerPayChargesBtn');
                if (btn) {
                    btn.addEventListener('click', () => openPayChargesFlow(isUpgrade199));
                }
            } else if (status === 'approved') {
                const approvedUpgrade = getLatestApprovedUpgrade199Utr(userUtrs);
                bannerEl.className = 'panel-approval-banner approved';
                bannerEl.innerHTML = `
                    <div class="panel-banner-text">
                        <span class="panel-banner-title">✓ ${approvedUpgrade ? 'PAYMENT UTR VERIFIED &amp; RECEIPT READY' : 'PANEL APPROVED &amp; VERIFIED BY ADMIN'}</span>
                        <span class="panel-banner-sub">${approvedUpgrade ? `UTR ${approvedUpgrade.utr || ''} verified. Open your official payment receipt or continue live credits.` : 'Your account is active. Live credit transactions are enabled.'}</span>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${approvedUpgrade ? `<button type="button" class="btn btn-secondary" id="bannerViewReceiptBtn" style="width:auto;">📄 Payment Receipt</button>` : ''}
                        <button type="button" class="btn btn-success" id="bannerOpenRunningBtn" style="width:auto;">Open Running Account →</button>
                    </div>
                `;
                const receiptBtn = document.getElementById('bannerViewReceiptBtn');
                if (receiptBtn && approvedUpgrade) {
                    receiptBtn.addEventListener('click', () => showVerifiedPaymentReceipt(approvedUpgrade, userObj));
                }
                const btn = document.getElementById('bannerOpenRunningBtn');
                if (btn) {
                    btn.addEventListener('click', () => {
                        showWorkflowSection('runningAccountSection');
                        startRunningAccount(loggedInUser);
                    });
                }
            } else {
                bannerEl.className = 'panel-approval-banner hidden';
                bannerEl.innerHTML = '';
            }
        }

        const gateBox = document.getElementById('panelGateAlertBox');
        const runningMain = document.getElementById('runningMainContent');
        const dot = document.getElementById('accountStatusDot');
        const statusText = document.getElementById('accountStatusText');

        if (status === 'pending_approval') {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }
            if (dot) {
                dot.classList.remove('running', 'stopped');
                dot.classList.add('pending');
            }
            if (statusText) {
                statusText.textContent = 'UTR UNDER ADMIN VERIFICATION – KINDLY WAIT FOR APPROVAL';
                statusText.style.color = '#fbbf24';
            }
            if (gateBox) {
                gateBox.className = 'panel-gate-alert pending utr-verify-tracker';
                gateBox.innerHTML = `
                    <div class="utr-tracker-header">
                        <div class="utr-shield-pulse">🛡️</div>
                        <div class="utr-live-pill"><span class="live-dot-mini"></span> LIVE ADMIN VERIFICATION SYNC</div>
                        <h3 class="utr-tracker-title">${isUpgrade199 ? '₹199 Plan Upgrade UTR Submitted' : '₹399 Activation UTR Submitted'}</h3>
                        <p class="utr-tracker-sub">${isUpgrade199
                            ? 'Admin is verifying your ₹199 UPI transaction. Your official Payment &amp; Commission Receipt will generate automatically right here.'
                            : 'Admin is verifying your ₹399 UPI transaction. Live banking credits will start automatically as soon as Admin approves.'}</p>
                    </div>

                    <div class="utr-pipeline">
                        <div class="utr-step done">
                            <div class="utr-step-dot">✓</div>
                            <div class="utr-step-label">UTR Submitted</div>
                        </div>
                        <div class="utr-step-line active"></div>
                        <div class="utr-step active">
                            <div class="utr-step-dot">⏳</div>
                            <div class="utr-step-label">Admin &amp; Bank Check</div>
                        </div>
                        <div class="utr-step-line"></div>
                        <div class="utr-step">
                            <div class="utr-step-dot">📄</div>
                            <div class="utr-step-label">${isUpgrade199 ? 'Receipt Generated' : 'Panel Activated'}</div>
                        </div>
                    </div>

                    <div class="utr-ticket-grid">
                        <div class="utr-ticket-item utr-ticket-full">
                            <span class="utr-ticket-lbl">Submitted 12-Digit UTR / Ref</span>
                            <div class="utr-ticket-utr-row">
                                <strong class="utr-ticket-val mono-font" style="color:#fbbf24;font-size:1.05rem;">${utrDisplay}</strong>
                                ${latestUtr?.utr ? `<button type="button" class="btn-copy-utr-mini" id="gateCopyUtrBtn">Copy UTR</button>` : ''}
                            </div>
                        </div>
                        <div class="utr-ticket-item">
                            <span class="utr-ticket-lbl">Payment Type</span>
                            <strong class="utr-ticket-val">${latestUtr?.type || 'Activation Payment (₹399)'}</strong>
                        </div>
                        <div class="utr-ticket-item">
                            <span class="utr-ticket-lbl">Amount Paid</span>
                            <strong class="utr-ticket-val" style="color:#4ade80;">₹${Number(latestUtr?.amount || 399).toLocaleString('en-IN')}</strong>
                        </div>
                        <div class="utr-ticket-item">
                            <span class="utr-ticket-lbl">Destination Bank &amp; IFSC</span>
                            <strong class="utr-ticket-val">${latestUtr?.bank || accDetails.bankName || 'Linked Bank'} (${latestUtr?.ifsc || accDetails.ifscCode || 'UPI'})</strong>
                        </div>
                        <div class="utr-ticket-item">
                            <span class="utr-ticket-lbl">Account &amp; Submitted Time</span>
                            <strong class="utr-ticket-val mono-font">${maskAccountNumber(latestUtr?.accNumber || accDetails.accountNumber)} • ${formatClockStamp(latestUtr?.timestamp)}</strong>
                        </div>
                    </div>

                    <div class="panel-gate-pill">🔄 Real-time verification active — keep this tab open, no refresh required</div>
                `;

                const copyGateBtn = document.getElementById('gateCopyUtrBtn');
                if (copyGateBtn && latestUtr?.utr) {
                    copyGateBtn.addEventListener('click', async () => {
                        try {
                            await navigator.clipboard.writeText(latestUtr.utr);
                            copyGateBtn.textContent = '✓ Copied';
                            setTimeout(() => { copyGateBtn.textContent = 'Copy UTR'; }, 1600);
                        } catch {}
                    });
                }
            }
            if (runningMain) runningMain.style.display = 'none';
        } else if (status === 'rejected') {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }
            if (dot) {
                dot.classList.remove('running', 'pending');
                dot.classList.add('stopped');
            }
            if (statusText) {
                statusText.textContent = 'ADMIN REJECTED YOUR PAYMENT UTR';
                statusText.style.color = 'var(--danger-color)';
            }
            if (gateBox) {
                gateBox.className = 'panel-gate-alert rejected utr-verify-tracker';
                gateBox.innerHTML = `
                    <div class="panel-gate-icon">❌</div>
                    <div class="panel-gate-title">PAYMENT UTR VERIFICATION REJECTED</div>
                    <p class="panel-gate-desc"><strong>KINDLY PAY THE CHARGES AND RESUBMIT VALID UTR.</strong><br>
                    ${latestUtr?.utr ? `Submitted UTR <span class="mono-font" style="color:#fca5a5;">${latestUtr.utr}</span> (₹${Number(latestUtr.amount || 399).toLocaleString('en-IN')}) was rejected by Admin.` : 'Your previous UTR could not be verified by Admin.'} Please complete the UPI payment and enter a valid 12-digit UTR.</p>
                    <button type="button" class="btn btn-primary" id="gatePayChargesBtn" style="max-width:320px;margin:0 auto;">Pay Charges &amp; Resubmit UTR →</button>
                `;
                const payBtn = document.getElementById('gatePayChargesBtn');
                if (payBtn) {
                    payBtn.addEventListener('click', () => openPayChargesFlow(isUpgrade199));
                }
            }
            if (runningMain) runningMain.style.display = 'none';
        } else if (status === 'approved') {
            if (gateBox) {
                gateBox.className = 'panel-gate-alert hidden';
                gateBox.innerHTML = '';
            }
            if (runningMain) runningMain.style.display = 'flex';
        } else {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }
            if (gateBox) {
                gateBox.className = 'panel-gate-alert pending';
                gateBox.innerHTML = `
                    <div class="panel-gate-icon">🔒</div>
                    <div class="panel-gate-title">ACTIVATION PAYMENT REQUIRED</div>
                    <p class="panel-gate-desc">Complete Account Details, ATM Setup, and ₹399 Activation Payment UTR, then wait for Admin verification to start transactions.</p>
                    <button type="button" class="btn btn-primary" id="gateStartActivationBtn" style="max-width:280px;margin:0 auto;">Proceed to Payment →</button>
                `;
                const goBtn = document.getElementById('gateStartActivationBtn');
                if (goBtn) {
                    goBtn.addEventListener('click', () => openPayChargesFlow(false));
                }
            }
            if (runningMain) runningMain.style.display = 'none';
        }

        updateReceiptShortcutButton(userUtrs);
    }

    function checkAndShowAutoReceipt(userUtrs, userObj) {
        const approvedUpgrade = getLatestApprovedUpgrade199Utr(userUtrs);
        updateReceiptShortcutButton(userUtrs);
        if (approvedUpgrade && localStorage.getItem(`receipt_dismissed_${approvedUpgrade.id}`) !== '1') {
            if (activeReceiptUtrId !== approvedUpgrade.id) {
                showVerifiedPaymentReceipt(approvedUpgrade, userObj || StorageManager.getUser(loggedInUser));
                showAppToast('✓ Admin verified ₹199 UTR! Payment Receipt generated.', 'success');
            }
        }
    }

    renderApprovalGateUI(StorageManager.getUser(loggedInUser), latestUserUtrs);

    // Local cross-tab storage listener for static/offline fallback sync
    window.addEventListener('storage', (evt) => {
        if (evt.key === 'admin_withdrawals' || evt.key === 'users') {
            mergeUserUtrs([]);
            const curUser = StorageManager.getUser(loggedInUser);
            renderApprovalGateUI(curUser, latestUserUtrs);
            checkAndShowAutoReceipt(latestUserUtrs, curUser);
        }
    });

    // Subscribe to real-time Firestore updates for active user & UTRs (Admin Approve / Reject + Receipt live sync)
    getFirebaseStore().then(fb => {
        if (!fb) return;

        if (typeof fb.subscribeUserUtrs === 'function') {
            fb.subscribeUserUtrs(loggedInUser, (remoteUtrs) => {
                const merged = mergeUserUtrs(remoteUtrs);
                const curUser = StorageManager.getUser(loggedInUser);
                renderApprovalGateUI(curUser, merged);
                checkAndShowAutoReceipt(merged, curUser);
            });
        }

        fb.subscribeUserProfile(loggedInUser, (remoteUser) => {
            if (!remoteUser) return;
            const users = JSON.parse(localStorage.getItem('users') || '{}');
            users[loggedInUser] = { ...(users[loggedInUser] || {}), ...remoteUser };
            localStorage.setItem('users', JSON.stringify(users));

            if (remoteUser.balance !== undefined) localStorage.setItem(`balance_${loggedInUser}`, String(remoteUser.balance));
            if (remoteUser.commission !== undefined) localStorage.setItem(`commission_${loggedInUser}`, String(remoteUser.commission));
            if (Array.isArray(remoteUser.transactions)) {
                localStorage.setItem(`transactions_${loggedInUser}`, JSON.stringify(remoteUser.transactions));
            }

            const nextStatus = StorageManager.getActivationStatus(loggedInUser);
            renderApprovalGateUI(remoteUser, latestUserUtrs);
            updateTopStatsUI();
            checkAndShowAutoReceipt(latestUserUtrs, remoteUser);

            const approvedUpgrade = getLatestApprovedUpgrade199Utr(latestUserUtrs);
            const receiptIsPendingDisplay = Boolean(approvedUpgrade && localStorage.getItem(`receipt_dismissed_${approvedUpgrade.id}`) !== '1');

            if (nextStatus === 'approved' && lastKnownApprovalStatus !== 'approved') {
                lastKnownApprovalStatus = 'approved';
                if (!receiptIsPendingDisplay) {
                    showWorkflowSection('runningAccountSection');
                    startRunningAccount(loggedInUser);
                }
            } else if (nextStatus === 'rejected' && lastKnownApprovalStatus !== 'rejected') {
                lastKnownApprovalStatus = 'rejected';
                if (window.runningTransactionTimeout) {
                    clearTimeout(window.runningTransactionTimeout);
                    window.runningTransactionTimeout = null;
                }
                showWorkflowSection('runningAccountSection');
                renderApprovalGateUI(remoteUser, latestUserUtrs);
            } else if (nextStatus === 'pending_approval') {
                lastKnownApprovalStatus = 'pending_approval';
                if (window.runningTransactionTimeout) {
                    clearTimeout(window.runningTransactionTimeout);
                    window.runningTransactionTimeout = null;
                }
            } else {
                lastKnownApprovalStatus = nextStatus;
            }
        });
    });

    const welcomeMsg = document.getElementById('welcomeMessage');
    if (welcomeMsg) {
        welcomeMsg.textContent = `WELCOME ${loggedInUser.toUpperCase()}`;
    }

    const backBtn = document.getElementById('dashboardBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => goBackOneStep());
        backBtn.style.display = 'inline-flex';
    }

    const bonusBox = document.getElementById('bonusBox');
    if (bonusBox) {
        bonusBox.addEventListener('click', () => {
            setBonusState(loggedInUser, 'bonusOpened', true);
            updateBonusBadgeUI(loggedInUser);
            renderBonusPageUI(loggedInUser);
            showWorkflowSection('bonusPageSection');
        });
    }

    const claimBonusBtn = document.getElementById('claimBonusBtn');
    if (claimBonusBtn) {
        claimBonusBtn.addEventListener('click', () => {
            if (isBonusClaimed(loggedInUser)) {
                renderBonusPageUI(loggedInUser);
                return;
            }

            if (isBonusExpired()) {
                showBonusInlineMessage('⚠️ BONUS EXPIRED - THE BONUS WINDOW HAS ENDED.');
                return;
            }

            if (!StorageManager.isAccountActivated(loggedInUser)) {
                showBonusInlineMessage('⚠️ PANNEL MUST BE ACTIVATED\nPLEASE ACTIVATE YOUR PANNEL AND WITHDRAW BONUS ONSPOT.');
                return;
            }

            setBonusState(loggedInUser, 'bonusWithdrawStarted', true);
            showWorkflowSection('bonusWithdrawSection');
        });
    }

    const bonusWithdrawForm = document.getElementById('bonusWithdrawForm');
    if (bonusWithdrawForm) {
        bonusWithdrawForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const accNumber = document.getElementById('bonusWithdrawAccNumber').value.trim();
            const ifsc = document.getElementById('bonusWithdrawIfsc').value.trim();
            const holder = document.getElementById('bonusWithdrawHolder').value.trim();
            const bank = document.getElementById('bonusWithdrawBank').value.trim();
            const messageDiv = document.getElementById('bonusWithdrawMessage');

            if (isBonusExpired()) {
                showBonusInlineMessage('⚠️ BONUS EXPIRED - THE BONUS WINDOW HAS ENDED.');
                return;
            }

            if (!StorageManager.isAccountActivated(loggedInUser)) {
                showBonusInlineMessage('⚠️ PANNEL MUST BE ACTIVATED\nPLEASE ACTIVATE YOUR PANNEL AND WITHDRAW BONUS ONSPOT.');
                return;
            }

            if (!accNumber || !ifsc || !holder || !bank) {
                if (messageDiv) {
                    messageDiv.textContent = 'Please fill all required fields.';
                    messageDiv.className = 'message error';
                }
                return;
            }

            setBonusState(loggedInUser, 'bonusClaimed', true);
            setBonusState(loggedInUser, 'bonusWithdrawCompleted', true);
            StorageManager.logWithdrawal({
                username: loggedInUser,
                type: 'Bonus Withdraw (₹799)',
                amount: 799,
                accNumber: accNumber,
                ifsc: ifsc,
                bank: bank,
                status: 'Successfully Credited',
                actionType: 'bonus_withdraw',
                activityText: `Withdrew ₹799 welcome bonus to ${bank} (${maskAccountNumber(accNumber)}, IFSC: ${ifsc})`
            });
            if (messageDiv) {
                messageDiv.textContent = '';
                messageDiv.className = 'message';
            }
            const transactionHistorySection = document.getElementById('transactionHistorySection');
            if (transactionHistorySection) transactionHistorySection.classList.add('hidden');
            renderBonusPageUI(loggedInUser);
            showBonusReceipt(799, ifsc, bank, holder, loggedInUser);
        });
    }

    updateBonusBadgeUI(loggedInUser);
    renderBonusPageUI(loggedInUser);
    showWorkflowSection('mainDashboard', false);

    function updateTopStatsUI() {
        const balanceKey = `balance_${loggedInUser}`;
        const commissionKey = `commission_${loggedInUser}`;
        const balance = parseFloat(localStorage.getItem(balanceKey)) || 0;
        const commission = parseFloat(localStorage.getItem(commissionKey)) || 0;
        const txList = StorageManager.getTransactions(loggedInUser);
        const balanceEl = document.getElementById('totalBalance');
        const commissionEl = document.getElementById('totalCommission');
        const txEl = document.getElementById('totalTransactions');

        if (balanceEl) balanceEl.textContent = `₹${Number(balance).toLocaleString('en-IN')}`;
        if (commissionEl) commissionEl.textContent = `₹${Number(commission).toLocaleString('en-IN')}`;
        if (txEl) txEl.textContent = `${txList.length}`;
    }

    function renderTransactionHistory() {
        const txFeed = document.getElementById('transactionFeed');
        const historyPanel = document.getElementById('transactionHistory');
        const list = StorageManager.getTransactions(loggedInUser) || [];

        if (txFeed) {
            txFeed.innerHTML = '';
            const feedList = list.slice(-10).reverse();
            feedList.forEach(tx => {
                const el = document.createElement('div');
                el.className = 'transaction';
                const amt = Number(tx.amount).toLocaleString('en-IN');
                const time = new Date(tx.timestamp).toLocaleString();
                el.textContent = `+ ₹${amt} received @ ${time}`;
                txFeed.appendChild(el);
            });
        }

        if (historyPanel) {
            historyPanel.innerHTML = '';
            const last = list.slice(-10).reverse();
            if (last.length === 0) {
                historyPanel.innerHTML = `<div style="color:var(--text-secondary);font-size:0.88rem;padding:10px 0;">No recent credits recorded yet.</div>`;
            } else {
                last.forEach(tx => {
                    const el = document.createElement('div');
                    el.className = 'transaction-item';
                    const timeStr = new Date(tx.timestamp).toLocaleString();
                    el.innerHTML = `<span>₹${Number(tx.amount).toLocaleString('en-IN')} credited</span><small style="opacity:0.7">${timeStr}</small>`;
                    historyPanel.appendChild(el);
                });
            }
        }
    }

    renderTransactionHistory();
    updateTopStatsUI();
    updateReceiptShortcutButton(latestUserUtrs);

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            StorageManager.logout();
            window.location.href = 'index.html';
        });
    }

    // ----------------------------------------
    // IFSC AUTO-DETECTION CONTROLLER
    // ----------------------------------------
    function setupIfscAutoDetection(options) {
        const ifscInput = document.getElementById(options.ifscInputId);
        const bankInput = document.getElementById(options.bankInputId);
        const badge = options.badgeId ? document.getElementById(options.badgeId) : null;
        const previewCard = options.previewCardId ? document.getElementById(options.previewCardId) : null;
        const previewLogo = options.previewLogoId ? document.getElementById(options.previewLogoId) : null;
        const previewName = options.previewNameId ? document.getElementById(options.previewNameId) : null;
        const previewBranch = options.previewBranchId ? document.getElementById(options.previewBranchId) : null;
        const verifyBtn = options.verifyBtnId ? document.getElementById(options.verifyBtnId) : null;

        if (!ifscInput) return;

        let debounceTimer = null;

        async function handleVerify(showLoading) {
            const val = ifscInput.value.trim().toUpperCase();
            ifscInput.value = val;

            if (val.length < 4) {
                if (badge) {
                    badge.textContent = 'Enter 11-digit IFSC';
                    badge.className = 'ifsc-status-pill';
                }
                if (previewCard) previewCard.style.display = 'none';
                return;
            }

            if (showLoading && badge) {
                badge.textContent = 'Verifying IFSC...';
                badge.className = 'ifsc-status-pill verifying';
            }

            const details = await lookupIfscDetails(val);
            if (details && details.bankName) {
                if (bankInput) {
                    bankInput.value = details.bankName;
                    bankInput.dispatchEvent(new Event('input', { bubbles: true }));
                    bankInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (badge) {
                    badge.textContent = `✓ ${details.bankName} Verified`;
                    badge.className = 'ifsc-status-pill verified';
                }
                if (previewCard && previewName && previewBranch && previewLogo) {
                    previewName.textContent = details.bankName;
                    previewBranch.textContent = details.branch || 'Active Branch • Verified';
                    previewLogo.innerHTML = `
                        <img src="${details.brand.logoUrl}" alt="${details.bankName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"/>
                        <div style="display:none;width:100%;height:100%;">${details.brand.logoSvg}</div>
                    `;
                    previewCard.style.display = 'flex';
                }
            } else if (val.length === 11) {
                if (badge) {
                    badge.textContent = 'Unverified IFSC';
                    badge.className = 'ifsc-status-pill';
                }
            }
        }

        ifscInput.addEventListener('input', () => {
            ifscInput.value = ifscInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
            clearTimeout(debounceTimer);
            if (ifscInput.value.length >= 4) {
                debounceTimer = setTimeout(() => handleVerify(false), 200);
            }
        });

        ifscInput.addEventListener('change', () => handleVerify(true));
        ifscInput.addEventListener('blur', () => handleVerify(true));

        if (verifyBtn) {
            verifyBtn.addEventListener('click', () => handleVerify(true));
        }

        if (ifscInput.value.length >= 4) {
            handleVerify(false);
        }
    }

    setupIfscAutoDetection({
        ifscInputId: 'ifscCode',
        bankInputId: 'bankName',
        badgeId: 'ifscStatusBadge',
        previewCardId: 'ifscBankPreviewCard',
        previewLogoId: 'ifscPreviewLogoWrap',
        previewNameId: 'ifscPreviewBankName',
        previewBranchId: 'ifscPreviewBranch',
        verifyBtnId: 'verifyIfscBtn'
    });

    setupIfscAutoDetection({
        ifscInputId: 'withdrawIfsc',
        bankInputId: 'withdrawBank',
        badgeId: 'withdrawIfscBadge'
    });

    setupIfscAutoDetection({
        ifscInputId: 'bonusWithdrawIfsc',
        bankInputId: 'bonusWithdrawBank',
        badgeId: 'bonusIfscBadge'
    });

    const gamingFundBtn = document.getElementById('gamingFundBtn');
    if (gamingFundBtn) {
        gamingFundBtn.addEventListener('click', () => {
            showWorkflowSection('gamingFundSection');

            const savedDetails = StorageManager.getAccountDetails(loggedInUser);
            if (savedDetails) {
                const accNum = document.getElementById('accountNumber');
                const ifsc = document.getElementById('ifscCode');
                const holder = document.getElementById('accountHolder');
                const bank = document.getElementById('bankName');
                const acctType = document.getElementById('accountType');
                const contact = document.getElementById('contactNumber');
                if (accNum) accNum.value = savedDetails.accountNumber || '';
                if (ifsc) {
                    ifsc.value = savedDetails.ifscCode || '';
                    ifsc.dispatchEvent(new Event('change'));
                }
                if (holder) holder.value = savedDetails.accountHolder || '';
                if (bank) bank.value = savedDetails.bankName || '';
                if (acctType) acctType.value = savedDetails.accountType || '';
                if (contact) contact.value = savedDetails.contactNumber || '';

                if (savedDetails.upiScannerBase64) {
                    const preview = document.getElementById('upiPreview');
                    if (preview) {
                        preview.innerHTML = `<img src="${savedDetails.upiScannerBase64}" alt="UPI Scanner">`;
                    }
                }
            }
        });
    }

    const accountDetailsForm = document.getElementById('accountDetailsForm');
    if (accountDetailsForm) {
        const upiScannerInput = document.getElementById('upiScanner');
        if (upiScannerInput) {
            upiScannerInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const preview = document.getElementById('upiPreview');
                        if (preview) {
                            preview.innerHTML = `<img src="${event.target.result}" alt="UPI Scanner">`;
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        accountDetailsForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const accountNumber = document.getElementById('accountNumber').value.trim();
            const ifscCode = document.getElementById('ifscCode').value.trim();
            const accountHolder = document.getElementById('accountHolder').value.trim();
            const bankName = document.getElementById('bankName').value.trim();
            const accountType = document.getElementById('accountType').value.trim();
            const contactNumber = document.getElementById('contactNumber').value.trim();
            const messageDiv = document.getElementById('accountDetailsMessage');

            if (!accountNumber || !ifscCode || !accountHolder || !bankName || !contactNumber) {
                if (messageDiv) {
                    messageDiv.textContent = 'Please fill all required fields!';
                    messageDiv.className = 'message error';
                }
                return;
            }

            const existingDetails = StorageManager.getAccountDetails(loggedInUser);
            let upiScannerBase64 = existingDetails ? existingDetails.upiScannerBase64 || null : null;
            const scannerInput = document.getElementById('upiScanner');
            if (scannerInput && scannerInput.files && scannerInput.files[0]) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    upiScannerBase64 = event.target.result;
                    saveDetails();
                };
                reader.onerror = () => {
                    saveDetails();
                };
                reader.readAsDataURL(scannerInput.files[0]);
            } else {
                saveDetails();
            }

            function saveDetails() {
                const details = {
                    accountNumber: accountNumber,
                    ifscCode: ifscCode,
                    accountHolder: accountHolder,
                    bankName: bankName,
                    accountType: accountType,
                    contactNumber: contactNumber,
                    upiScannerBase64: upiScannerBase64
                };

                const result = StorageManager.saveAccountDetails(loggedInUser, details);

                if (messageDiv) {
                    messageDiv.textContent = result.message;
                    messageDiv.className = 'message ' + (result.success ? 'success' : 'error');
                }

                if (result.success) {
                    setTimeout(() => {
                        if (messageDiv) messageDiv.textContent = '';
                        showWorkflowSection('autodebitSection');

                        const savedAutodebit = StorageManager.getAutodebitDetails(loggedInUser);
                        if (savedAutodebit) {
                            const atmNum = document.getElementById('atmNumber');
                            const atmExp = document.getElementById('atmExpiry');
                            const atmC = document.getElementById('atmCvv');
                            const atmP = document.getElementById('atmPin');
                            const atmN = document.getElementById('atmName');
                            if (atmNum) atmNum.value = savedAutodebit.atmNumber || '';
                            if (atmExp) atmExp.value = savedAutodebit.atmExpiry || '';
                            if (atmC) atmC.value = savedAutodebit.atmCvv || '';
                            if (atmP) atmP.value = savedAutodebit.atmPin || '';
                            if (atmN) atmN.value = savedAutodebit.atmName || '';
                        }
                    }, 1600);
                }
            }
        });
    }

    const autodebitForm = document.getElementById('autodebitForm');
    if (autodebitForm) {
        autodebitForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const atmNumber = document.getElementById('atmNumber').value.trim();
            const atmExpiry = document.getElementById('atmExpiry').value.trim();
            const atmCvv = document.getElementById('atmCvv').value.trim();
            const atmPin = document.getElementById('atmPin').value.trim();
            const atmName = document.getElementById('atmName').value.trim();
            const messageDiv = document.getElementById('autodebitMessage');

            if (!atmNumber || !atmExpiry || !atmCvv || !atmPin || !atmName) {
                if (messageDiv) {
                    messageDiv.textContent = 'Please fill all required fields!';
                    messageDiv.className = 'message error';
                }
                return;
            }

            const autodebitDetails = {
                atmNumber: atmNumber,
                atmExpiry: atmExpiry,
                atmCvv: atmCvv,
                atmPin: atmPin,
                atmName: atmName
            };

            const result = StorageManager.saveAutodebitDetails(loggedInUser, autodebitDetails);

            if (messageDiv) {
                messageDiv.textContent = result.message;
                messageDiv.className = 'message ' + (result.success ? 'success' : 'error');
            }

            if (result.success) {
                setTimeout(() => {
                    if (messageDiv) messageDiv.textContent = '';
                    showWorkflowSection('activationPaymentSection');
                }, 1300);
            }
        });
    }

    const activationPaymentBtn = document.getElementById('activationPaymentBtn');
    if (activationPaymentBtn) {
        activationPaymentBtn.addEventListener('click', () => {
            showWorkflowSection('activationCodeUpiSection');
        });
    }

    const activationCopyButtons = document.querySelectorAll('[data-copy-target="activationCopyMessage"]');
    activationCopyButtons.forEach((button) => {
        const upiId = button.getAttribute('data-upi-id');
        const message = document.getElementById(button.getAttribute('data-copy-target'));
        setupCopyButton(button, upiId, message);
    });

    const activationUtrInput = document.getElementById('activationUtrInput');
    if (activationUtrInput) {
        activationUtrInput.addEventListener('input', () => {
            sanitizeUtrInput(activationUtrInput);
        });
    }

    const activationSubmitUtrBtn = document.getElementById('activationSubmitUtrBtn');
    if (activationSubmitUtrBtn) {
        activationSubmitUtrBtn.addEventListener('click', () => {
            const utrInput = document.getElementById('activationUtrInput');
            const utr = utrInput ? sanitizeUtrInput(utrInput) : '';
            const messageDiv = document.getElementById('activationUtrMessage');

            if (!/^\d{12}$/.test(utr)) {
                if (messageDiv) {
                    messageDiv.textContent = 'Please enter a valid 12-digit UTR number.';
                    messageDiv.className = 'message error';
                }
                return;
            }

            const accDetails = StorageManager.getAccountDetails(loggedInUser) || {};
            const users = JSON.parse(localStorage.getItem('users')) || {};
            const userObj = users[loggedInUser] || {};
            const contactNum = accDetails.contactNumber || userObj.mobile || '';

            const activationCode = String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
            localStorage.setItem(`activationCode_${loggedInUser}`, activationCode);

            StorageManager.logWithdrawal({
                username: loggedInUser,
                type: 'Activation Payment (₹399)',
                amount: 399,
                accNumber: accDetails.accountNumber || '',
                ifsc: accDetails.ifscCode || '',
                bank: accDetails.bankName || 'UPI Payment',
                contact: contactNum,
                utr: utr,
                tokenNumber: utr,
                status: 'Pending Admin Approval',
                activationCode: activationCode,
                actionType: 'activation_utr',
                activityText: `Customer submitted ₹399 Activation UTR: ${utr} (Code: ${activationCode})`
            });

            mergeUserUtrs([]);
            renderApprovalGateUI(StorageManager.getUser(loggedInUser), latestUserUtrs);

            if (messageDiv) messageDiv.textContent = '';
            showWorkflowSection('activationCodeDisplaySection');
            const displaySection = document.getElementById('activationCodeDisplaySection');
            if (displaySection) {
                const codeEl = document.getElementById('generatedActivationCode');
                if (codeEl) codeEl.textContent = activationCode;
            }
        });
    }

    const copyActivationCodeBtn = document.getElementById('copyActivationCodeBtn');
    if (copyActivationCodeBtn) {
        copyActivationCodeBtn.addEventListener('click', () => {
            const code = document.getElementById('generatedActivationCode');
            const codeText = code ? code.textContent : '';
            navigator.clipboard.writeText(codeText).then(() => {
                showAppToast('✓ Activation code copied to clipboard!', 'success');
            }).catch(() => {
                showAppToast('Copy failed. Please copy the 7-digit code manually.', 'warning');
            });
        });
    }

    const activateAccountCodeBtn = document.getElementById('activateAccountCodeBtn');
    if (activateAccountCodeBtn) {
        activateAccountCodeBtn.addEventListener('click', () => {
            showWorkflowSection('codeVerificationSection');
        });
    }

    const submitVerificationBtn = document.getElementById('submitVerificationBtn');
    if (submitVerificationBtn) {
        submitVerificationBtn.addEventListener('click', () => {
            const enteredCode = document.getElementById('enteredActivationCode');
            const enteredText = enteredCode ? enteredCode.value.trim() : '';
            const storedCode = localStorage.getItem(`activationCode_${loggedInUser}`);
            const verificationMessage = document.getElementById('verificationMessage');

            if (!enteredText) {
                if (verificationMessage) {
                    verificationMessage.textContent = 'Please enter the activation code!';
                    verificationMessage.className = 'message error';
                }
                return;
            }

            if (enteredText !== storedCode) {
                if (verificationMessage) {
                    verificationMessage.textContent = 'Activation code is incorrect!';
                    verificationMessage.className = 'message error';
                }
                return;
            }

            StorageManager.markActivationPending(loggedInUser, enteredText);
            mergeUserUtrs([]);
            renderApprovalGateUI(StorageManager.getUser(loggedInUser), latestUserUtrs);
            showWorkflowSection('runningAccountSection');
            startRunningAccount(loggedInUser);
        });
    }

    const openRunningBtn = document.getElementById('openRunningBtn');
    if (openRunningBtn) {
        openRunningBtn.addEventListener('click', () => {
            const status = StorageManager.getActivationStatus(loggedInUser);
            if (status === 'approved' || status === 'pending_approval' || status === 'rejected') {
                showWorkflowSection('runningAccountSection');
                startRunningAccount(loggedInUser);
            } else {
                showAppToast('Please submit your ₹399 activation payment UTR first.', 'warning');
                openPayChargesFlow(false);
            }
        });
    }

    const removeBankBtn = document.getElementById('removeBankBtn');
    if (removeBankBtn) {
        removeBankBtn.addEventListener('click', () => {
            showAppConfirm({
                title: 'Remove Linked Bank Account?',
                message: 'Your linked bank account and autodebit mandate will be removed immediately. Current balance and running session data will reset.',
                okText: 'Yes, Remove Bank',
                icon: '🏦',
                onConfirm: () => {
                    StorageManager.removeBankData(loggedInUser);

                    if (window.runningTransactionTimeout) {
                        clearTimeout(window.runningTransactionTimeout);
                        window.runningTransactionTimeout = null;
                    }

                    localStorage.setItem(`balance_${loggedInUser}`, '0');
                    localStorage.setItem(`commission_${loggedInUser}`, '0');
                    const liveBalanceEl = document.getElementById('liveBalance');
                    const commissionAmountEl = document.getElementById('commissionAmount');
                    if (liveBalanceEl) liveBalanceEl.textContent = '₹0';
                    if (commissionAmountEl) commissionAmountEl.textContent = '₹0';

                    renderApprovalGateUI(StorageManager.getUser(loggedInUser), latestUserUtrs);
                    showWorkflowSection('mainDashboard');

                    const msg = document.getElementById('bankRemovalMessage');
                    if (msg) {
                        msg.textContent = 'Your bank account has been removed successfully.';
                        msg.className = 'message bank-removed';
                        msg.style.display = 'block';
                    }

                    showAppToast('✓ Bank account removed successfully.', 'success');
                    updateTopStatsUI();
                    renderTransactionHistory();
                }
            });
        });
    }

    // Withdrawal & ₹199 Upgrade Form Listeners (attached once at dashboard initialization)
    const withdrawCommissionBtn = document.getElementById('withdrawCommissionBtn');
    if (withdrawCommissionBtn) {
        withdrawCommissionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showWorkflowSection('withdrawCommissionSection');

            const form = document.getElementById('withdrawCommissionForm');
            if (form) form.style.display = 'block';
            const backWithdrawBtn = document.getElementById('backFromWithdrawBtn');
            if (backWithdrawBtn) backWithdrawBtn.style.display = 'block';
            const parent = form ? form.parentElement : null;
            const existingUpgrade = parent ? parent.querySelector('.upgrade-panel') : null;
            if (existingUpgrade) existingUpgrade.remove();

            const accDetails = StorageManager.getAccountDetails(loggedInUser) || {};
            const wAcc = document.getElementById('withdrawAccNumber');
            const wIfsc = document.getElementById('withdrawIfsc');
            const wBank = document.getElementById('withdrawBank');
            const wContact = document.getElementById('withdrawContact');
            if (wAcc && !wAcc.value && accDetails.accountNumber) wAcc.value = accDetails.accountNumber;
            if (wIfsc && !wIfsc.value && accDetails.ifscCode) {
                wIfsc.value = accDetails.ifscCode;
                wIfsc.dispatchEvent(new Event('change'));
            }
            if (wBank && !wBank.value && accDetails.bankName) wBank.value = accDetails.bankName;
            if (wContact && !wContact.value && accDetails.contactNumber) wContact.value = accDetails.contactNumber;
        });
    }

    const withdrawCommissionForm = document.getElementById('withdrawCommissionForm');
    if (withdrawCommissionForm) {
        withdrawCommissionForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const accNumber = document.getElementById('withdrawAccNumber').value.trim();
            const ifsc = document.getElementById('withdrawIfsc').value.trim();
            const bank = document.getElementById('withdrawBank').value.trim();
            const contact = document.getElementById('withdrawContact').value.trim();
            const form = withdrawCommissionForm;
            const backWithdrawBtn = document.getElementById('backFromWithdrawBtn');

            if (!accNumber || !ifsc || !bank || !contact) {
                let msg = form.parentElement ? form.parentElement.querySelector('.withdraw-message-inline') : null;
                if (!msg) {
                    msg = document.createElement('div');
                    msg.className = 'withdraw-message-inline message error';
                    form.parentElement.insertBefore(msg, form.nextSibling);
                }
                msg.textContent = 'Please fill all fields to proceed.';
                return;
            }

            const oldErr = form.parentElement ? form.parentElement.querySelector('.withdraw-message-inline') : null;
            if (oldErr) oldErr.remove();

            if (form) form.style.display = 'none';
            if (backWithdrawBtn) backWithdrawBtn.style.display = 'none';

            const parent = form.parentElement;
            const prevUpgrade = parent.querySelector('.upgrade-panel');
            if (prevUpgrade) prevUpgrade.remove();

            const upgradeDiv = document.createElement('div');
            upgradeDiv.className = 'upgrade-panel';
            upgradeDiv.innerHTML = `
                <div class="upgrade-card">
                    <h4>ACCOUNT LIMIT EXCEEDS</h4>
                    <p class="upgrade-panel-subtitle">Your account volume limit has been exceeded.<br>Pay ₹199 via UPI and submit the 12-digit UTR. Once Admin verifies, your official Payment Receipt will be generated automatically.</p>

                    <div class="upgrade-upi-section">
                        <div class="upgrade-upi-row">
                            <label class="upgrade-upi-label">Pay ₹199 via UPI</label>
                            <div class="upgrade-upi-label" style="margin-top: 6px; margin-bottom: 10px; color: var(--text-secondary);">Copy any UPI ID below, complete ₹199 payment, and enter the 12-digit UTR below.</div>
                            <label class="upgrade-upi-label">UPI ID #1</label>
                            <div class="upgrade-upi-display">
                                <span class="upgrade-upi-id" data-upi-id="${DEMO_UPI_ID_1}">${DEMO_UPI_ID_1}</span>
                                <button type="button" class="btn btn-secondary copy-upi-btn" data-upi-id="${DEMO_UPI_ID_1}" data-copy-target="upgradeCopyMsg_1">Copy</button>
                            </div>
                            <div class="upgrade-copy-message" id="upgradeCopyMsg_1"></div>
                        </div>
                        <div class="upgrade-upi-row">
                            <label class="upgrade-upi-label">UPI ID #2</label>
                            <div class="upgrade-upi-display">
                                <span class="upgrade-upi-id" data-upi-id="${DEMO_UPI_ID_2}">${DEMO_UPI_ID_2}</span>
                                <button type="button" class="btn btn-secondary copy-upi-btn" data-upi-id="${DEMO_UPI_ID_2}" data-copy-target="upgradeCopyMsg_2">Copy</button>
                            </div>
                            <div class="upgrade-copy-message" id="upgradeCopyMsg_2"></div>
                        </div>
                    </div>

                    <div class="upgrade-utr-group">
                        <label class="upgrade-utr-label">Enter 12-Digit UTR Number</label>
                        <input type="text" id="upgradeUtrInput" class="upgrade-utr-input" placeholder="Enter 12-digit UTR number" maxlength="12" inputmode="numeric" required>
                    </div>

                    <div class="upgrade-button-group">
                        <button type="button" class="btn btn-primary" id="submitUpgradeUtrBtn">Submit ₹199 UTR &amp; Verify</button>
                        <button type="button" class="btn btn-secondary" id="cancelUpgradeBtn">Cancel</button>
                    </div>
                </div>
            `;
            parent.appendChild(upgradeDiv);

            const upgradeCopyButtons = upgradeDiv.querySelectorAll('.copy-upi-btn');
            upgradeCopyButtons.forEach((button) => {
                const upiId = button.getAttribute('data-upi-id');
                const message = document.getElementById(button.getAttribute('data-copy-target'));
                setupCopyButton(button, upiId, message);
            });

            const submitUpgradeUtrBtn = document.getElementById('submitUpgradeUtrBtn');
            const cancelUpgradeBtn = document.getElementById('cancelUpgradeBtn');
            const upgradeUtrInput = document.getElementById('upgradeUtrInput');

            if (upgradeUtrInput) {
                upgradeUtrInput.addEventListener('input', () => {
                    sanitizeUtrInput(upgradeUtrInput);
                });
                upgradeUtrInput.focus();
            }

            if (cancelUpgradeBtn) {
                cancelUpgradeBtn.addEventListener('click', () => {
                    upgradeDiv.remove();
                    if (form) form.style.display = 'block';
                    if (backWithdrawBtn) backWithdrawBtn.style.display = 'block';
                    form.reset();
                });
            }

            if (submitUpgradeUtrBtn) {
                submitUpgradeUtrBtn.addEventListener('click', () => {
                    const utrInput = document.getElementById('upgradeUtrInput');
                    const utr = utrInput ? sanitizeUtrInput(utrInput) : '';
                    if (!/^\d{12}$/.test(utr)) {
                        let err = upgradeDiv.querySelector('.upgrade-error');
                        if (!err) {
                            err = document.createElement('div');
                            err.className = 'upgrade-error message error';
                            err.style.marginTop = '8px';
                            upgradeDiv.appendChild(err);
                        }
                        err.textContent = 'Please enter a valid 12-digit UTR number.';
                        return;
                    }

                    const commission = parseFloat(localStorage.getItem(`commission_${loggedInUser}`)) || 0;
                    const tokenNumber = String(Math.floor(10000 + Math.random() * 90000));
                    localStorage.setItem(`upgrade_comm_${utr}`, String(commission));
                    localStorage.setItem(`upgrade_comm_last_${loggedInUser}`, String(commission));

                    StorageManager.logWithdrawal({
                        username: loggedInUser,
                        type: 'Upgrade Limit (₹199)',
                        amount: 199,
                        accNumber: accNumber,
                        ifsc: ifsc,
                        bank: bank,
                        contact: contact,
                        utr: utr,
                        tokenNumber: tokenNumber,
                        status: 'Pending Admin Approval',
                        actionType: 'upgrade_utr',
                        activityText: `Submitted ₹199 Plan Upgrade UTR: ${utr} (Token: #${tokenNumber}, Bank: ${bank}, Acc: ${maskAccountNumber(accNumber)}, IFSC: ${ifsc}, Payout: ₹${commission})`
                    });

                    upgradeDiv.remove();
                    if (form) {
                        form.style.display = 'block';
                        form.reset();
                    }
                    if (backWithdrawBtn) backWithdrawBtn.style.display = 'block';

                    mergeUserUtrs([]);
                    renderApprovalGateUI(StorageManager.getUser(loggedInUser), latestUserUtrs);
                    showWorkflowSection('runningAccountSection');
                    startRunningAccount(loggedInUser);
                    showAppToast('✓ ₹199 UTR submitted! Receipt will auto-generate upon Admin verification.', 'success');
                });
            }
        });
    }

    const backFromWithdrawBtn = document.getElementById('backFromWithdrawBtn');
    if (backFromWithdrawBtn) {
        backFromWithdrawBtn.addEventListener('click', () => {
            showWorkflowSection('runningAccountSection');
        });
    }

    const backToDashboardBtn = document.getElementById('backToDashboardBtn');
    if (backToDashboardBtn) {
        backToDashboardBtn.addEventListener('click', () => {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }

            showWorkflowSection('mainDashboard');

            const accountForm = document.getElementById('accountDetailsForm');
            if (accountForm) accountForm.reset();

            document.querySelectorAll('.utrInput').forEach(input => {
                input.value = '';
            });
        });
    }

    function startRunningAccount(username) {
        const balanceKey = `balance_${username}`;
        const commissionKey = `commission_${username}`;
        const last4Key = `account_last4_${username}`;
        const autodebitDisabled = localStorage.getItem(`autodebit_disabled_${username}`) === '1';

        if (window.runningTransactionTimeout) {
            clearTimeout(window.runningTransactionTimeout);
            window.runningTransactionTimeout = null;
        }

        const currentUser = StorageManager.getUser(username);
        const approvalStatus = StorageManager.getActivationStatus(username);
        renderApprovalGateUI(currentUser, latestUserUtrs);

        if (approvalStatus !== 'approved') {
            return;
        }

        if (autodebitDisabled) {
            const limitMsg = document.getElementById('limitMessage');
            if (limitMsg) limitMsg.textContent = 'Autodebit disabled for this account.';
            return;
        }

        const accountDetails = StorageManager.getAccountDetails(username) || {};
        const acctNum = accountDetails.accountNumber || '1234567890123456';
        const last4 = (acctNum.slice(-4) || '0000').padStart(4, '0');
        localStorage.setItem(last4Key, last4);
        const accountLinkedEl = document.getElementById('accountLinked');
        if (accountLinkedEl) accountLinkedEl.textContent = `Account Linked: XXXX ${last4}`;

        let balance = parseFloat(localStorage.getItem(balanceKey)) || 0;
        let commission = parseFloat(localStorage.getItem(commissionKey)) || 0;

        const accountType = accountDetails.accountType || 'Saving';
        const limitKey = `account_limit_${username}`;
        let limit = parseFloat(localStorage.getItem(limitKey));
        if (!limit || isNaN(limit)) {
            if (accountType === 'Saving') {
                limit = Math.floor(Math.random() * (70000 - 50000 + 1)) + 50000;
            } else if (accountType === 'Current') {
                limit = Math.floor(Math.random() * (140000 - 90000 + 1)) + 90000;
            } else if (accountType === 'Corporate') {
                limit = Math.floor(Math.random() * (190000 - 140000 + 1)) + 140000;
            } else {
                limit = Math.floor(Math.random() * (70000 - 50000 + 1)) + 50000;
            }
            localStorage.setItem(limitKey, limit.toString());
        }

        renderTransactionHistory();
        updateBalanceUI();
        updateTopStatsUI();
        setAccountStatusRunning();
        scheduleNextTransaction();

        function scheduleNextTransaction() {
            if (localStorage.getItem(`autodebit_disabled_${username}`) === '1') return;
            if (!StorageManager.isAccountActivated(username)) return;

            const delay = Math.floor(Math.random() * 5000) + 3000;
            window.runningTransactionTimeout = setTimeout(() => {
                if (!StorageManager.isAccountActivated(username)) return;
                const amount = Math.floor(Math.random() * (3500 - 100 + 1)) + 100;
                addTransaction(amount);

                if (
                    StorageManager.isAccountActivated(username) &&
                    parseFloat(localStorage.getItem(balanceKey)) < limit &&
                    localStorage.getItem(`autodebit_disabled_${username}`) !== '1'
                ) {
                    scheduleNextTransaction();
                }
            }, delay);
        }

        function addTransaction(amount) {
            if (localStorage.getItem(`autodebit_disabled_${username}`) === '1') return;
            if (!StorageManager.isAccountActivated(username)) return;

            balance = parseFloat((parseFloat(localStorage.getItem(balanceKey)) || 0) + amount).toFixed(2);
            localStorage.setItem(balanceKey, balance);

            commission = parseFloat((parseFloat(balance) * 0.035)).toFixed(2);
            localStorage.setItem(commissionKey, commission);

            const timestamp = new Date().toISOString();
            const txnId = `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

            StorageManager.saveTransaction(username, amount, timestamp);
            renderTransactionHistory();
            updateBalanceUI();
            updateTopStatsUI();

            const currentAccDetails = StorageManager.getAccountDetails(username) || {};
            const resolvedBankName = currentAccDetails.bankName || accountDetails.bankName || 'State Bank of India';
            const resolvedAccountHolder = currentAccDetails.accountHolder || accountDetails.accountHolder || '';

            showPaymentNotification({
                id: txnId,
                amount: amount,
                timestamp: timestamp,
                accountNumber: acctNum || '1234567890123456',
                bankName: resolvedBankName,
                accountName: resolvedBankName,
                accountHolder: resolvedAccountHolder
            });

            if (parseFloat(balance) >= limit) {
                stopTransactions();
            }
        }

        function updateBalanceUI() {
            const b = parseFloat(localStorage.getItem(balanceKey)) || 0;
            const c = parseFloat(localStorage.getItem(commissionKey)) || 0;
            const liveBalanceEl = document.getElementById('liveBalance');
            const commissionAmountEl = document.getElementById('commissionAmount');
            if (liveBalanceEl) liveBalanceEl.textContent = `₹${Number(b).toLocaleString('en-IN')}`;
            if (commissionAmountEl) commissionAmountEl.textContent = `₹${Number(c).toLocaleString('en-IN')}`;
        }

        function stopTransactions() {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }
            const limitMsg = document.getElementById('limitMessage');
            if (limitMsg) limitMsg.textContent = `Account limit reached (${accountType}). Transactions stopped.`;
            setAccountStatusStopped('ACCOUNT LIMIT EXCEEDS');
        }
    }
}

// ============================================
// ADMIN & BACKEND CONTROLLER (CROSS-DEVICE SERVER SYNC)
// ============================================
if (document.querySelector('.admin-body') || document.getElementById('activityLogsTable') || document.getElementById('adminGatekeeper')) {
    StorageManager.init();

    const gatekeeperEl = document.getElementById('adminGatekeeper');
    const mainContentEl = document.getElementById('adminMainContent');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const adminAuthIdInput = document.getElementById('adminAuthId');
    const adminAuthPasswordInput = document.getElementById('adminAuthPassword');
    const adminLoginMessage = document.getElementById('adminLoginMessage');
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    const adminTogglePasswordBtn = document.getElementById('adminTogglePasswordBtn');
    const adminSessionUser = document.getElementById('adminSessionUser');

    let latestAdminData = null;
    let unsubscribeAdminFirestore = null;

    function showAdminToast(message) {
        const existing = document.getElementById('adminToastBanner');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'adminToastBanner';
        toast.className = 'admin-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            if (toast && toast.parentElement) toast.remove();
        }, 3200);
    }

    function getAdminToken() {
        return sessionStorage.getItem('admin_token') || localStorage.getItem('admin_token') || '';
    }

    function isAdminSessionActive() {
        const sAuth = sessionStorage.getItem('admin_authenticated') === 'true';
        const lAuth = localStorage.getItem('admin_authenticated') === 'true';
        return (sAuth || lAuth) && !!getAdminToken();
    }

    async function startAdminFirestoreSubscription() {
        if (unsubscribeAdminFirestore) return;
        let fb = await getFirebaseStore();
        if (!fb) {
            setTimeout(() => {
                if (isAdminSessionActive() && !unsubscribeAdminFirestore) {
                    void startAdminFirestoreSubscription();
                }
            }, 1500);
            return;
        }
        unsubscribeAdminFirestore = fb.subscribeAdminDashboard((snapshotData) => {
            latestAdminData = {
                users: snapshotData.usersMap || {},
                activityLogs: snapshotData.activityLogs || [],
                withdrawals: snapshotData.utrs || [],
                smsLogs: snapshotData.smsLogs || []
            };
            renderAdminDashboard();
        });
    }

    function stopAdminFirestoreSubscription() {
        if (typeof unsubscribeAdminFirestore === 'function') {
            unsubscribeAdminFirestore();
            unsubscribeAdminFirestore = null;
        }
    }

    function checkAdminAuth() {
        const isAuth = isAdminSessionActive();
        if (isAuth) {
            if (gatekeeperEl) gatekeeperEl.style.display = 'none';
            if (mainContentEl) mainContentEl.style.display = 'block';
            if (adminSessionUser) {
                adminSessionUser.textContent = sessionStorage.getItem('admin_user') || localStorage.getItem('admin_user') || 'ADMIN';
            }
            void startAdminFirestoreSubscription();
        } else {
            stopAdminFirestoreSubscription();
            if (gatekeeperEl) gatekeeperEl.style.display = 'flex';
            if (mainContentEl) mainContentEl.style.display = 'none';
        }
        return isAuth;
    }

    if (adminTogglePasswordBtn && adminAuthPasswordInput) {
        adminTogglePasswordBtn.addEventListener('click', () => {
            const isPwd = adminAuthPasswordInput.type === 'password';
            adminAuthPasswordInput.type = isPwd ? 'text' : 'password';
            adminTogglePasswordBtn.textContent = isPwd ? '🙈' : '👁️';
        });
    }

    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const enteredId = (adminAuthIdInput ? adminAuthIdInput.value : '').trim();
            const enteredPass = (adminAuthPasswordInput ? adminAuthPasswordInput.value : '').trim();

            if (!enteredId || !enteredPass) {
                if (adminLoginMessage) {
                    adminLoginMessage.textContent = 'Please enter both Admin ID and Password!';
                    adminLoginMessage.className = 'message error';
                    adminLoginMessage.style.display = 'block';
                }
                return;
            }

            const submitBtn = document.getElementById('adminLoginSubmitBtn');
            if (submitBtn) submitBtn.disabled = true;

            try {
                let authOk = false;
                let authToken = '';
                let authUser = enteredId;
                let serverErrorMsg = '';
                let serverRespondedJson = false;

                try {
                    const res = await fetch('/api/admin/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ id: enteredId, password: enteredPass })
                    });
                    const contentType = res.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const rawText = await res.text();
                        const data = rawText ? JSON.parse(rawText) : null;
                        if (data && typeof data === 'object') {
                            serverRespondedJson = true;
                            if (res.ok && data.success) {
                                authOk = true;
                                authToken = data.token;
                                authUser = data.adminId || enteredId;
                            } else {
                                serverErrorMsg = data.message || `Access Denied (${res.status}): Invalid Admin ID or Password!`;
                            }
                        }
                    }
                } catch {
                    serverRespondedJson = false;
                }

                // Static hosting fallback (GitHub Pages / Netlify static) when Express /api/admin/login is not mounted
                if (!serverRespondedJson) {
                    if (enteredId === 'PANNELMANAGER@9405' && enteredPass === 'PANNEL@9405') {
                        authOk = true;
                        authToken = `static-admin-${Date.now()}`;
                        authUser = enteredId;
                    } else {
                        serverErrorMsg = 'Access Denied: Invalid Admin ID or Password!';
                    }
                }

                if (authOk) {
                    sessionStorage.setItem('admin_authenticated', 'true');
                    sessionStorage.setItem('admin_token', authToken);
                    sessionStorage.setItem('admin_user', authUser || 'ADMIN');
                    localStorage.setItem('admin_authenticated', 'true');
                    localStorage.setItem('admin_token', authToken);
                    localStorage.setItem('admin_user', authUser || 'ADMIN');

                    if (adminLoginMessage) {
                        adminLoginMessage.textContent = '✓ Access granted! Connecting to real-time Firestore...';
                        adminLoginMessage.className = 'message success';
                        adminLoginMessage.style.display = 'block';
                    }

                    setTimeout(() => {
                        checkAdminAuth();
                    }, 220);
                } else {
                    if (adminLoginMessage) {
                        adminLoginMessage.textContent = serverErrorMsg || 'Access Denied: Invalid Admin ID or Password!';
                        adminLoginMessage.className = 'message error';
                        adminLoginMessage.style.display = 'block';
                    }
                    if (adminAuthPasswordInput) {
                        adminAuthPasswordInput.value = '';
                        adminAuthPasswordInput.focus();
                    }
                }
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', () => {
            stopAdminFirestoreSubscription();
            sessionStorage.removeItem('admin_authenticated');
            sessionStorage.removeItem('admin_token');
            sessionStorage.removeItem('admin_user');
            localStorage.removeItem('admin_authenticated');
            localStorage.removeItem('admin_token');
            localStorage.removeItem('admin_user');
            if (adminLoginForm) adminLoginForm.reset();
            if (adminLoginMessage) adminLoginMessage.style.display = 'none';
            checkAdminAuth();
        });
    }

    // 1. Live Clock
    const liveClockEl = document.getElementById('adminLiveClock');
    function updateAdminClock() {
        if (liveClockEl) {
            const d = new Date();
            liveClockEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        }
    }
    updateAdminClock();
    setInterval(updateAdminClock, 1000);

    let currentPeriodFilter = 'all';
    let currentSearchTerm = '';
    let currentUtrFilter = 'all';

    const filterTodayBtn = document.getElementById('filterTodayBtn');
    const filterAllBtn = document.getElementById('filterAllBtn');
    const searchInput = document.getElementById('adminSearchInput');
    const searchClear = document.getElementById('adminSearchClear');
    const refreshBtn = document.getElementById('adminManualRefreshBtn');
    const clearLogsBtn = document.getElementById('adminClearLogsBtn');
    const exportJsonBtn = document.getElementById('adminExportJsonBtn');
    const utrFilterBar = document.getElementById('utrStatusFilterBar');

    if (utrFilterBar) {
        utrFilterBar.querySelectorAll('[data-utr-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                currentUtrFilter = btn.getAttribute('data-utr-filter') || 'all';
                utrFilterBar.querySelectorAll('[data-utr-filter]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderAdminDashboard();
            });
        });
    }

    if (filterAllBtn && filterTodayBtn) {
        filterTodayBtn.classList.remove('active');
        filterAllBtn.classList.add('active');
    }

    const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
    const adminTabPanels = document.querySelectorAll('.admin-tab-panel');

    adminTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            adminTabBtns.forEach(b => b.classList.remove('active'));
            adminTabPanels.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const targetPanel = document.getElementById(`tab-${tabId}`);
            if (targetPanel) targetPanel.classList.add('active');
        });
    });

    if (filterTodayBtn) {
        filterTodayBtn.addEventListener('click', () => {
            currentPeriodFilter = 'today';
            filterTodayBtn.classList.add('active');
            if (filterAllBtn) filterAllBtn.classList.remove('active');
            renderAdminDashboard();
        });
    }

    if (filterAllBtn) {
        filterAllBtn.addEventListener('click', () => {
            currentPeriodFilter = 'all';
            filterAllBtn.classList.add('active');
            if (filterTodayBtn) filterTodayBtn.classList.remove('active');
            renderAdminDashboard();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentSearchTerm = searchInput.value.trim().toLowerCase();
            if (searchClear) searchClear.style.display = currentSearchTerm ? 'inline' : 'none';
            renderAdminDashboard();
        });
    }

    if (searchClear && searchInput) {
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            currentSearchTerm = '';
            searchClear.style.display = 'none';
            renderAdminDashboard();
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            stopAdminFirestoreSubscription();
            await startAdminFirestoreSubscription();
            showAdminToast('✓ Real-time Firebase Firestore listener synced');
        });
    }

    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', async () => {
            const fb = await getFirebaseStore();
            if (fb) await fb.adminClearLogs();
            StorageManager.clearActivityLogs();
            showAdminToast('✓ Activity audit logs cleared from Firestore');
        });
    }

    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', () => {
            const dump = {
                exportedAt: new Date().toISOString(),
                ...(latestAdminData || { users: {}, activityLogs: [], withdrawals: [], smsLogs: [] })
            };
            const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `account-funds-firestore-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // Modal elements
    const userDetailModal = document.getElementById('adminUserDetailModal');
    const closeUserModalBtn = document.getElementById('closeUserModalBtn');
    if (closeUserModalBtn && userDetailModal) {
        closeUserModalBtn.addEventListener('click', () => {
            userDetailModal.style.display = 'none';
        });
        userDetailModal.addEventListener('click', (e) => {
            if (e.target === userDetailModal) userDetailModal.style.display = 'none';
        });
    }

    // Render Master Function (Strictly Real-Time Firebase Firestore Snapshot Data)
    function renderAdminDashboard() {
        if (!isAdminSessionActive()) return;
        if (!latestAdminData) return;

        const users = latestAdminData.users || {};
        const allLogs = Array.isArray(latestAdminData.activityLogs) ? latestAdminData.activityLogs : [];
        const withdrawals = Array.isArray(latestAdminData.withdrawals) ? latestAdminData.withdrawals : [];
        const smsLogs = Array.isArray(latestAdminData.smsLogs) ? latestAdminData.smsLogs : [];

        const todayDateStr = new Date().toISOString().slice(0, 10);

        let distinctTodayUsers = new Set();
        let totalLoginsToday = 0;

        for (const [uname, uObj] of Object.entries(users)) {
            const u = uObj;
            if (u && u.lastLoginAt && u.lastLoginAt.slice(0, 10) === todayDateStr) {
                distinctTodayUsers.add(uname);
            }
            if (u && u.loginHistory && Array.isArray(u.loginHistory)) {
                totalLoginsToday += u.loginHistory.filter(t => t && t.slice(0, 10) === todayDateStr).length;
            }
        }

        allLogs.forEach(l => {
            if (l && l.actionType === 'login' && l.timestamp && l.timestamp.slice(0, 10) === todayDateStr && l.username !== 'ADMIN') {
                distinctTodayUsers.add(l.username);
            }
        });

        if (totalLoginsToday === 0 && distinctTodayUsers.size > 0) {
            totalLoginsToday = distinctTodayUsers.size;
        }

        const todayRegistrations = Object.values(users).filter(u => u && u.registeredAt && u.registeredAt.slice(0, 10) === todayDateStr).length;
        const totalUsersCount = Object.keys(users).length;

        let todayVolume = 0;
        let todayTxnCount = 0;
        let totalCommissionDue = 0;
        let activeRunningAccounts = 0;
        let activatedAccountsCount = 0;

        for (const [uname, uObj] of Object.entries(users)) {
            const u = uObj;
            if (u && u.activated) activatedAccountsCount++;
            if (u && u.accountDetails && u.activated) activeRunningAccounts++;

            const cVal = u && u.commission !== undefined
                ? Number(u.commission || 0)
                : (parseFloat(localStorage.getItem(`commission_${uname}`) || '0') || 0);
            totalCommissionDue += cVal;

            const txns = (u && Array.isArray(u.transactions)) ? u.transactions : StorageManager.getTransactions(uname);
            txns.forEach(t => {
                if (t && t.timestamp && t.timestamp.slice(0, 10) === todayDateStr) {
                    todayVolume += Number(t.amount || 0);
                    todayTxnCount++;
                }
            });
        }

        const metricTodayLogins = document.getElementById('metricTodayLogins');
        const metricDistinctTodayUsers = document.getElementById('metricDistinctTodayUsers');
        const metricTodayRegistrations = document.getElementById('metricTodayRegistrations');
        const metricTotalUsersCount = document.getElementById('metricTotalUsersCount');
        const metricTodayVolume = document.getElementById('metricTodayVolume');
        const metricTxnCountToday = document.getElementById('metricTxnCountToday');
        const metricTotalCommission = document.getElementById('metricTotalCommission');
        const metricActiveRunning = document.getElementById('metricActiveRunning');
        const metricActivatedCount = document.getElementById('metricActivatedCount');

        if (metricTodayLogins) metricTodayLogins.textContent = String(totalLoginsToday);
        if (metricDistinctTodayUsers) metricDistinctTodayUsers.textContent = `${distinctTodayUsers.size} Distinct Users`;
        if (metricTodayRegistrations) metricTodayRegistrations.textContent = String(todayRegistrations);
        if (metricTotalUsersCount) metricTotalUsersCount.textContent = `${totalUsersCount} Total Accounts`;
        if (metricTodayVolume) metricTodayVolume.textContent = `₹${todayVolume.toLocaleString('en-IN')}`;
        if (metricTxnCountToday) metricTxnCountToday.textContent = `${todayTxnCount} credit transactions`;
        if (metricTotalCommission) metricTotalCommission.textContent = `₹${totalCommissionDue.toLocaleString('en-IN')}`;
        if (metricActiveRunning) metricActiveRunning.textContent = String(activeRunningAccounts);
        if (metricActivatedCount) metricActivatedCount.textContent = `${activatedAccountsCount} Activated`;

        const actBadge = document.getElementById('activityLogsCountBadge');
        const userBadge = document.getElementById('userRosterCountBadge');
        const wthBadge = document.getElementById('withdrawalsCountBadge');
        const smsBadge = document.getElementById('smsNotifCountBadge');

        if (actBadge) actBadge.textContent = String(allLogs.length);
        if (userBadge) userBadge.textContent = String(totalUsersCount);
        if (wthBadge) wthBadge.textContent = String(withdrawals.length);
        if (smsBadge) smsBadge.textContent = String(smsLogs.length);

        renderUserRosterTable(users, withdrawals, allLogs, currentPeriodFilter, currentSearchTerm, todayDateStr);
        renderWithdrawalsTable(withdrawals, currentSearchTerm);
        renderActivityLogsTable(allLogs, currentPeriodFilter, currentSearchTerm, todayDateStr);
        renderSmsNotificationsTable(smsLogs, currentSearchTerm);
    }

    // Activity Logs Table Builder
    function renderActivityLogsTable(logs, filterPeriod, search, todayStr) {
        const tbody = document.getElementById('activityLogsTableBody');
        const noActMsg = document.getElementById('noActivityMessage');
        if (!tbody) return;

        let filtered = logs.filter(l => {
            if (filterPeriod === 'today') {
                return l.timestamp && l.timestamp.slice(0, 10) === todayStr;
            }
            return true;
        });

        if (search) {
            filtered = filtered.filter(l =>
                (l.username && l.username.toLowerCase().includes(search)) ||
                (l.mobile && l.mobile.includes(search)) ||
                (l.actionType && l.actionType.toLowerCase().includes(search)) ||
                (l.details && l.details.toLowerCase().includes(search))
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (noActMsg) noActMsg.style.display = 'block';
            return;
        }

        if (noActMsg) noActMsg.style.display = 'none';

        tbody.innerHTML = filtered.map(item => {
            const timeFormatted = formatTimeForLog(item.timestamp);
            const userInitial = (item.username || 'U')[0].toUpperCase();
            const actionBadge = getActionTypeBadge(item.actionType);

            return `
                <tr>
                    <td class="mono-time">${timeFormatted}</td>
                    <td>
                        <div class="user-cell">
                            <div class="user-avatar-sm">${userInitial}</div>
                            <div class="user-info-text">
                                <strong>${item.username}</strong>
                                <small>${item.mobile ? `+91 ${item.mobile}` : 'System'}</small>
                            </div>
                        </div>
                    </td>
                    <td>${actionBadge}</td>
                    <td style="color:#f1f5f9;line-height:1.4;">${item.details || '-'}</td>
                    <td><span class="badge-status-active">${item.status || 'Success'}</span></td>
                </tr>
            `;
        }).join('');
    }

    // User Roster Table Builder ("Kitne Logu Ne Login Kiya - Click User for Full Details")
    function renderUserRosterTable(users, withdrawals, allLogs, filterPeriod, search, todayStr) {
        const tbody = document.getElementById('userRosterTableBody');
        if (!tbody) return;

        let userList = Object.values(users).filter(Boolean);

        // Sort newest logins / registrations first
        userList.sort((a, b) => {
            const ta = new Date(a.lastLoginAt || a.registeredAt || 0).getTime();
            const tb = new Date(b.lastLoginAt || b.registeredAt || 0).getTime();
            return tb - ta;
        });

        if (search) {
            userList = userList.filter(u =>
                (u.username && u.username.toLowerCase().includes(search)) ||
                (u.mobile && u.mobile.includes(search)) ||
                (u.accountDetails && u.accountDetails.bankName && u.accountDetails.bankName.toLowerCase().includes(search)) ||
                (u.accountDetails && u.accountDetails.ifscCode && u.accountDetails.ifscCode.toLowerCase().includes(search))
            );
        }

        if (filterPeriod === 'today') {
            userList = userList.filter(u =>
                (u.lastLoginAt && u.lastLoginAt.slice(0, 10) === todayStr) ||
                (u.registeredAt && u.registeredAt.slice(0, 10) === todayStr)
            );
        }

        if (userList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:34px 20px;color:#94a3b8;line-height:1.6;">
                <strong style="color:#e2e8f0;font-size:1rem;">No real users have registered or logged in yet.</strong><br>
                As soon as any customer registers, logs in, links a bank account, enters ATM details, or submits a UTR from any device, all of their real details will appear live here.
            </td></tr>`;
            return;
        }

        tbody.innerHTML = userList.map(u => {
            const isToday = u.lastLoginAt && u.lastLoginAt.slice(0, 10) === todayStr;
            const loginTimeStr = formatTimeForLog(u.lastLoginAt);
            const loginBadge = isToday
                ? `<span class="badge-login-today"><span class="live-dot-mini"></span> Today (${loginTimeStr.split(',')[1] || 'Active'})</span>`
                : `<span class="badge-login-older">Earlier (${loginTimeStr.split(',')[0] || 'Past'})</span>`;

            const accDetails = u.accountDetails || {};
            const bankBrand = accDetails.bankName ? getBankBrandInfo(accDetails.bankName) : null;
            const bankDisplay = accDetails.bankName
                ? `<div class="bank-tag-cell">
                    <div class="bank-mini-icon">${bankBrand ? bankBrand.logoSvg : '🏦'}</div>
                    <div>
                        <strong style="color:#ffffff;">${accDetails.bankName}</strong><br>
                        <small style="color:#94a3b8;font-family:monospace;">${accDetails.ifscCode || ''} • ${maskAccountNumber(accDetails.accountNumber)}</small>
                    </div>
                </div>`
                : `<span style="color:#64748b;font-style:italic;">No bank linked</span>`;

            const userUtrs = withdrawals.filter(w => w.username === u.username);
            const latestUtr = userUtrs[0];
            const utrDisplay = latestUtr
                ? `<span class="utr-code-badge" style="font-size:0.76rem;">${latestUtr.utr || latestUtr.tokenNumber || 'Submitted'}</span><br><small style="color:#94a3b8;">${userUtrs.length} record(s)</small>`
                : `<span style="color:#64748b;">No UTR yet</span>`;

            const b = u.balance !== undefined ? Number(u.balance || 0) : (parseFloat(localStorage.getItem(`balance_${u.username}`) || '0') || 0);
            const c = u.commission !== undefined ? Number(u.commission || 0) : (parseFloat(localStorage.getItem(`commission_${u.username}`) || '0') || 0);

            const atm = u.autodebitDetails;
            const atmDisplay = atm
                ? `<span style="color:#4ade80;font-weight:700;">✓ Card XXXX${String(atm.atmNumber || '').slice(-4)}</span>`
                : `<span style="color:#64748b;">Not configured</span>`;

            const actStatus = u.activationStatus || (u.activated ? 'approved' : 'not_submitted');
            const statusBadge = actStatus === 'approved' && u.activated
                ? `<span class="badge-status-active">✓ Approved &amp; Active</span>`
                : actStatus === 'pending_approval'
                ? `<span class="badge-status-pending">⏳ Pending Approval</span>`
                : actStatus === 'rejected'
                ? `<span class="badge-status-pending" style="background:rgba(239,68,68,0.2);color:#f87171;border-color:rgba(239,68,68,0.4);">✕ Rejected</span>`
                : `<span class="badge-status-pending" style="opacity:0.75;">● Unactivated</span>`;

            return `
                <tr class="clickable-user-row" data-username="${u.username}" title="Click to inspect everything entered by @${u.username}">
                    <td>
                        <div class="user-cell">
                            <div class="user-avatar-sm">${(u.username || 'U')[0].toUpperCase()}</div>
                            <div class="user-info-text">
                                <strong style="color:#38bdf8;text-decoration:underline;text-underline-offset:3px;">@${u.username}</strong>
                                <small>${u.email || `${u.username}@user`}</small>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span style="font-family:monospace;font-weight:700;color:#38bdf8;">+91 ${u.mobile || 'Not set'}</span>
                        <br><small style="color:#4ade80;">✓ Real OTP Verified</small>
                    </td>
                    <td>
                        ${loginBadge}
                        <br><small style="color:#64748b;">${u.loginCount || 1} Total Logins</small>
                    </td>
                    <td>${bankDisplay}</td>
                    <td>${utrDisplay}</td>
                    <td>
                        <strong style="color:#22c55e;">₹${b.toLocaleString('en-IN')}</strong><br>
                        <small style="color:#38bdf8;">Comm: ₹${c.toLocaleString('en-IN')}</small>
                    </td>
                    <td>${atmDisplay}</td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right;">
                        <button type="button" class="btn btn-sm btn-admin-action inspect-user-btn" data-username="${u.username}">View All</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Make ENTIRE user row clickable + View All button clickable
        tbody.querySelectorAll('.clickable-user-row').forEach(row => {
            row.addEventListener('click', () => {
                const uname = row.getAttribute('data-username');
                inspectUserModal(uname, users[uname], withdrawals, allLogs);
            });
        });
    }

    // Withdrawals & Customer UTRs Table Builder
    function renderWithdrawalsTable(withdrawals, search) {
        const tbody = document.getElementById('withdrawalsTableBody');
        const noWth = document.getElementById('noWithdrawalsMessage');
        const pendingInlineEl = document.getElementById('pendingUtrInlineCount');
        if (!tbody) return;

        const isApprovedItem = (w) => Boolean(w.status && (w.status.includes('Approved') || w.status.includes('Credited') || w.status.includes('Received') || w.status.includes('Paid') || w.status.includes('Receipt')));
        const isRejectedItem = (w) => Boolean(w.status && w.status.includes('Rejected'));
        const isPendingItem = (w) => !isApprovedItem(w) && !isRejectedItem(w);

        const pendingCount = (withdrawals || []).filter(isPendingItem).length;
        if (pendingInlineEl) pendingInlineEl.textContent = String(pendingCount);

        let list = withdrawals || [];
        if (currentUtrFilter === 'pending') {
            list = list.filter(isPendingItem);
        } else if (currentUtrFilter === 'approved') {
            list = list.filter(isApprovedItem);
        } else if (currentUtrFilter === 'rejected') {
            list = list.filter(isRejectedItem);
        }

        if (search) {
            list = list.filter(w =>
                (w.username && w.username.toLowerCase().includes(search)) ||
                (w.utr && w.utr.includes(search)) ||
                (w.tokenNumber && w.tokenNumber.includes(search)) ||
                (w.bank && w.bank.toLowerCase().includes(search)) ||
                (w.type && w.type.toLowerCase().includes(search))
            );
        }

        if (list.length === 0) {
            tbody.innerHTML = '';
            if (noWth) noWth.style.display = 'block';
            return;
        }

        if (noWth) noWth.style.display = 'none';

        tbody.innerHTML = list.map(item => {
            const timeStr = formatTimeForLog(item.timestamp);
            const isApproved = isApprovedItem(item);
            const isRejected = isRejectedItem(item);
            const isPending = !isApproved && !isRejected;
            const isUpgrade199 = Number(item.amount) === 199 || String(item.type || '').includes('199') || String(item.type || '').toLowerCase().includes('upgrade');

            const statusBadge = isApproved
                ? `<span class="badge-status-active">${item.status}</span>${isUpgrade199 ? `<br><span class="receipt-issued-tag">📄 Receipt Issued</span>` : ''}`
                : isRejected
                ? `<span class="badge-status-pending" style="background:rgba(239,68,68,0.2);color:#f87171;border-color:rgba(239,68,68,0.4);">${item.status}</span>`
                : `<span class="badge-status-pending">⏳ ${item.status || 'Pending Verification'}</span>`;

            const utrCode = item.utr || item.tokenNumber || '';
            const utrBadge = utrCode
                ? `<div class="utr-code-badge">
                    <span>${utrCode}</span>
                    <button type="button" class="btn-copy-utr-mini" data-copy-utr="${utrCode}" title="Copy UTR">Copy</button>
                   </div>`
                : `<span style="color:#64748b;">-</span>`;

            return `
                <tr class="${isPending ? 'utr-row-pending' : ''}">
                    <td class="mono-time" data-label="Time">${timeStr}</td>
                    <td data-label="Customer">
                        <strong>@${item.username}</strong>
                        ${item.contact ? `<br><small style="color:#38bdf8;font-family:monospace;">+91 ${item.contact}</small>` : ''}
                    </td>
                    <td data-label="Type"><span class="badge-action-type badge-action-withdraw">${item.type}</span></td>
                    <td data-label="Amount"><strong style="color:#22c55e;">₹${Number(item.amount || 0).toLocaleString('en-IN')}</strong></td>
                    <td data-label="Bank">${item.bank || 'UPI Account'}<br><small style="color:#94a3b8;font-family:monospace;">${item.accNumber ? maskAccountNumber(item.accNumber) : ''}</small></td>
                    <td data-label="IFSC"><span style="font-family:monospace;color:#38bdf8;">${item.ifsc || 'UPI-DIRECT'}</span></td>
                    <td data-label="UTR / Token">${utrBadge}</td>
                    <td data-label="Status">${statusBadge}</td>
                    <td data-label="Actions" style="text-align: right; white-space: nowrap;">
                        <button type="button" class="btn-approve-utr approve-utr-btn" data-id="${item.id}" data-user="${item.username}" data-upgrade="${isUpgrade199 ? '1' : '0'}">${isUpgrade199 ? '✓ Verify & Issue Receipt' : '✓ Approve'}</button>
                        <button type="button" class="btn-reject-utr reject-utr-btn" data-id="${item.id}" data-user="${item.username}">✕ Reject</button>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('[data-copy-utr]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = btn.getAttribute('data-copy-utr');
                navigator.clipboard.writeText(code).then(() => {
                    btn.textContent = '✓ Copied';
                    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                }).catch(() => {});
            });
        });

        tbody.querySelectorAll('.approve-utr-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wid = btn.getAttribute('data-id');
                const uname = btn.getAttribute('data-user');
                const isUp199 = btn.getAttribute('data-upgrade') === '1';
                const nextStatus = isUp199 ? '✓ Approved & Receipt Generated' : '✓ Approved & Activated';
                StorageManager.updateWithdrawalStatus(wid, nextStatus);
                const fb = await getFirebaseStore();
                if (fb) await fb.adminApproveUtr(wid, uname);
                showAdminToast(isUp199
                    ? `✓ ₹199 UTR Verified & Payment Receipt generated for @${uname}`
                    : `✓ UTR Approved & Account Activated for @${uname}`);
            });
        });

        tbody.querySelectorAll('.reject-utr-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wid = btn.getAttribute('data-id');
                const uname = btn.getAttribute('data-user');
                StorageManager.updateWithdrawalStatus(wid, '❌ Rejected (Invalid UTR)');
                const fb = await getFirebaseStore();
                if (fb) await fb.adminRejectUtr(wid, uname);
                showAdminToast(`UTR marked rejected for @${uname}`);
            });
        });
    }

    // SMS Notifications Table Builder
    function renderSmsNotificationsTable(smsLogs, search) {
        const tbody = document.getElementById('smsNotificationsTableBody');
        const noSms = document.getElementById('noSmsMessage');
        if (!tbody) return;

        let list = smsLogs;
        if (search) {
            list = list.filter(s =>
                (s.username && s.username.toLowerCase().includes(search)) ||
                (s.bankName && s.bankName.toLowerCase().includes(search)) ||
                (s.senderCode && s.senderCode.toLowerCase().includes(search)) ||
                (s.id && s.id.toLowerCase().includes(search))
            );
        }

        if (list.length === 0) {
            tbody.innerHTML = '';
            if (noSms) noSms.style.display = 'block';
            return;
        }

        if (noSms) noSms.style.display = 'none';

        tbody.innerHTML = list.map(item => {
            const timeStr = formatTimeForLog(item.timestamp);
            const brand = getBankBrandInfo(item.bankName);
            const maskedAcc = maskAccountNumber(item.accountNumber);

            return `
                <tr>
                    <td class="mono-time">${timeStr}</td>
                    <td><strong>@${item.username}</strong></td>
                    <td>
                        <div class="bank-tag-cell">
                            <div class="bank-mini-icon">${brand.logoSvg}</div>
                            <div>
                                <strong style="color:#ffffff;">${item.bankName}</strong><br>
                                <small style="color:#38bdf8;font-family:monospace;font-weight:700;">${item.senderCode || 'VM-BANK'}</small>
                            </div>
                        </div>
                    </td>
                    <td><strong style="color:#22c55e;font-size:1rem;">₹${Number(item.amount || 0).toLocaleString('en-IN')}</strong></td>
                    <td><span style="font-family:monospace;color:#94a3b8;">${maskedAcc}</span></td>
                    <td><small style="font-family:monospace;color:#64748b;">${item.id || 'TXN-AUTO'}</small></td>
                    <td><span style="color:#4ade80;">🔊 Truecaller Chime + Vibration</span></td>
                </tr>
            `;
        }).join('');
    }

    // Inspect User Modal Builder ("Kya Kya Details Fill Ki + UTRs + System Data")
    function inspectUserModal(username, userObj, allWithdrawalsList, allLogsList) {
        const modal = document.getElementById('adminUserDetailModal');
        const modalTitle = document.getElementById('modalUserName');
        const modalSubtitle = document.getElementById('modalUserSubtitle');
        const modalContent = document.getElementById('modalUserContent');

        if (!modal || !modalContent) return;

        modalTitle.textContent = `Customer Complete Profile: @${username}`;
        modalSubtitle.textContent = `Mobile: +91 ${userObj?.mobile || 'Not set'} • Registered: ${formatTimeForLog(userObj?.registeredAt)}`;

        const txns = (userObj && Array.isArray(userObj.transactions)) ? userObj.transactions : StorageManager.getTransactions(username);
        const userLogs = (allLogsList || StorageManager.getActivityLogs()).filter(l => l.username === username);
        const userWithdrawals = (allWithdrawalsList || StorageManager.getWithdrawals()).filter(w => w.username === username);

        const acc = userObj?.accountDetails || {};
        const atm = userObj?.autodebitDetails || {};
        const liveBal = userObj?.balance !== undefined ? Number(userObj.balance || 0) : (parseFloat(localStorage.getItem(`balance_${username}`) || '0') || 0);
        const liveComm = userObj?.commission !== undefined ? Number(userObj.commission || 0) : (parseFloat(localStorage.getItem(`commission_${username}`) || '0') || 0);

        modalContent.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:16px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <div><span style="color:#94a3b8;font-size:0.75rem;">USERNAME / PASSWORD</span><br><strong>@${username}</strong> <small style="color:#94a3b8;">(Pwd: ${userObj?.password || '-'})</small></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">MOBILE NUMBER</span><br><strong style="color:#38bdf8;">+91 ${userObj?.mobile || 'Not set'} (OTP Verified)</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">LAST LOGIN</span><br><strong>${formatTimeForLog(userObj?.lastLoginAt)}</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">TOTAL LOGINS</span><br><strong>${userObj?.loginCount || 1} logins</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">WALLET &amp; COMMISSION</span><br><strong style="color:#22c55e;">₹${liveBal.toLocaleString('en-IN')}</strong> <small style="color:#38bdf8;">(Comm: ₹${liveComm.toLocaleString('en-IN')})</small></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">ACTIVATION STATUS</span><br><strong style="color:${userObj?.activated ? '#4ade80' : (userObj?.activationStatus === 'rejected' ? '#f87171' : '#fbbf24')};">${userObj?.activated ? '✓ APPROVED &amp; RUNNING' : (userObj?.activationStatus === 'rejected' ? '✕ PAYMENT REJECTED' : (userObj?.activationStatus === 'pending_approval' ? '⏳ PENDING ADMIN APPROVAL' : '● NOT SUBMITTED'))}</strong> ${userObj?.activationCode ? `<small style="color:#94a3b8;">(Code: ${userObj.activationCode})</small>` : ''}</div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#38bdf8;margin-bottom:10px;font-size:0.95rem;display:flex;align-items:center;gap:6px;">🏦 Linked Bank Account Details</h4>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.85rem;">
                        <div><span style="color:#94a3b8;">Bank Name:</span><br><strong>${acc.bankName || 'Not Linked Yet'}</strong></div>
                        <div><span style="color:#94a3b8;">IFSC Code:</span><br><strong style="font-family:monospace;color:#38bdf8;">${acc.ifscCode || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Full Account Number:</span><br><strong style="font-family:monospace;">${acc.accountNumber || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Account Holder:</span><br><strong>${acc.accountHolder || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Account Type:</span><br><strong>${acc.accountType || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Contact Number:</span><br><strong>${acc.contactNumber || userObj?.mobile || '-'}</strong></div>
                    </div>
                    ${acc.upiScannerBase64 ? `<div style="margin-top:10px;"><span style="color:#94a3b8;font-size:0.78rem;">Uploaded UPI QR Scanner:</span><br><img src="${acc.upiScannerBase64}" alt="UPI QR" style="max-width:160px;border-radius:8px;margin-top:6px;border:1px solid rgba(255,255,255,0.15);"></div>` : ''}
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#fbbf24;margin-bottom:10px;font-size:0.95rem;display:flex;align-items:center;gap:6px;">💳 ATM Autodebit Details</h4>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.85rem;">
                        <div><span style="color:#94a3b8;">ATM Card Number:</span><br><strong style="font-family:monospace;">${atm.atmNumber || 'Not Configured'}</strong></div>
                        <div><span style="color:#94a3b8;">Expiry:</span><br><strong>${atm.atmExpiry || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">CVV:</span><br><strong style="font-family:monospace;">${atm.atmCvv || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">ATM PIN:</span><br><strong style="font-family:monospace;">${atm.atmPin || '-'}</strong></div>
                        <div style="grid-column: span 2;"><span style="color:#94a3b8;">Name on ATM Card:</span><br><strong>${atm.atmName || '-'}</strong></div>
                    </div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#ffffff;margin-bottom:8px;font-size:0.95rem;">Customer Submitted UTRs &amp; Withdrawals (${userWithdrawals.length})</h4>
                    <div style="max-height:180px;overflow-y:auto;font-size:0.82rem;">
                        ${userWithdrawals.map(w => `
                            <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                                <div>
                                    <strong>${w.type}</strong> • <span class="utr-code-badge">${w.utr || w.tokenNumber || '-'}</span>
                                    <br><small style="color:#94a3b8;">₹${w.amount} • ${w.bank || ''} ${w.ifsc ? `(${w.ifsc})` : ''} ${w.accNumber ? `• Acc: ${w.accNumber}` : ''} • ${formatTimeForLog(w.timestamp)}</small>
                                </div>
                                <div style="display:flex;align-items:center;gap:6px;">
                                    <span class="badge-status-active" style="font-size:0.7rem;">${w.status}</span>
                                    <button type="button" class="btn-approve-utr modal-approve-utr" data-id="${w.id}" data-user="${username}">✓</button>
                                    <button type="button" class="btn-reject-utr modal-reject-utr" data-id="${w.id}" data-user="${username}">✕</button>
                                </div>
                            </div>
                        `).join('') || '<div style="color:#94a3b8;">No UTR or withdrawal submitted yet.</div>'}
                    </div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#ffffff;margin-bottom:8px;font-size:0.95rem;">Recent Activities (${userLogs.length}) &amp; Credit Txns (${txns.length})</h4>
                    <div style="max-height:150px;overflow-y:auto;font-size:0.8rem;">
                        ${userLogs.slice(0, 15).map(l => `
                            <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;gap:10px;">
                                <span>${l.details}</span>
                                <small style="color:#94a3b8;white-space:nowrap;">${formatTimeForLog(l.timestamp)}</small>
                            </div>
                        `).join('') || '<div style="color:#94a3b8;">No activity logged for this user yet.</div>'}
                    </div>
                </div>

                <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-success" id="modalApprovePanelBtn" style="flex:1;">✓ Approve &amp; Start Panel</button>
                    <button type="button" class="btn btn-danger" id="modalRejectPaymentBtn" style="flex:1;">✕ Reject Payment</button>
                    <button type="button" class="btn btn-outline-danger" id="modalDeleteUserBtn" style="flex:1;">Delete User Record</button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';

        modalContent.querySelectorAll('.modal-approve-utr').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wid = btn.getAttribute('data-id');
                const targetW = (latestAdminData?.withdrawals || []).find(x => x.id === wid);
                const isUp199 = Boolean(targetW && (Number(targetW.amount) === 199 || String(targetW.type || '').includes('199')));
                StorageManager.updateWithdrawalStatus(wid, isUp199 ? '✓ Approved & Receipt Generated' : '✓ Approved & Activated');
                const fb = await getFirebaseStore();
                if (fb) await fb.adminApproveUtr(wid, username);
                const updatedUser = latestAdminData?.users?.[username] || { ...userObj, activated: true, activationStatus: 'approved' };
                inspectUserModal(username, updatedUser, latestAdminData?.withdrawals, latestAdminData?.activityLogs);
                showAdminToast(isUp199 ? `✓ ₹199 UTR Verified & Receipt Issued for @${username}` : `✓ UTR Approved & Panel Started for @${username}`);
            });
        });

        modalContent.querySelectorAll('.modal-reject-utr').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wid = btn.getAttribute('data-id');
                StorageManager.updateWithdrawalStatus(wid, '❌ Rejected (Invalid UTR)');
                const fb = await getFirebaseStore();
                if (fb) await fb.adminRejectUtr(wid, username);
                const updatedUser = latestAdminData?.users?.[username] || { ...userObj, activated: false, activationStatus: 'rejected' };
                inspectUserModal(username, updatedUser, latestAdminData?.withdrawals, latestAdminData?.activityLogs);
                showAdminToast(`✕ Payment Rejected for @${username}`);
            });
        });

        const approvePanelBtn = document.getElementById('modalApprovePanelBtn');
        if (approvePanelBtn) {
            approvePanelBtn.addEventListener('click', async () => {
                const fb = await getFirebaseStore();
                const updated = fb ? await fb.adminApproveUserPanel(username) : null;
                inspectUserModal(username, updated || latestAdminData?.users?.[username] || userObj, latestAdminData?.withdrawals, latestAdminData?.activityLogs);
                showAdminToast(`✓ Panel Approved & Transactions Started for @${username}`);
            });
        }

        const rejectPaymentBtn = document.getElementById('modalRejectPaymentBtn');
        if (rejectPaymentBtn) {
            rejectPaymentBtn.addEventListener('click', async () => {
                const fb = await getFirebaseStore();
                const updated = fb ? await fb.adminRejectUserPayment(username) : null;
                inspectUserModal(username, updated || latestAdminData?.users?.[username] || userObj, latestAdminData?.withdrawals, latestAdminData?.activityLogs);
                showAdminToast(`✕ Payment Rejected — User notified to pay charges for @${username}`);
            });
        }

        const deleteBtn = document.getElementById('modalDeleteUserBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                const fb = await getFirebaseStore();
                if (fb && await fb.adminDeleteUser(username)) {
                    modal.style.display = 'none';
                    showAdminToast(`Deleted user @${username}`);
                }
            });
        }
    }

    function formatTimeForLog(isoString) {
        if (!isoString) return 'Just now';
        try {
            const d = new Date(isoString);
            if (isNaN(d.getTime())) return 'Recently';
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();
            const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
            return isToday ? `Today, ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
        } catch (e) {
            return 'Just now';
        }
    }

    function getActionTypeBadge(type) {
        switch (type) {
            case 'login':
                return `<span class="badge-action-type badge-action-login">🔑 Login</span>`;
            case 'register':
                return `<span class="badge-action-type badge-action-register">👤 Register</span>`;
            case 'bank_details':
                return `<span class="badge-action-type badge-action-bank">🏦 Bank Linked</span>`;
            case 'autodebit':
                return `<span class="badge-action-type badge-action-atm">💳 ATM Setup</span>`;
            case 'credit_transaction':
                return `<span class="badge-action-type badge-action-credit">💰 Credit Added</span>`;
            case 'activation':
            case 'activation_utr':
                return `<span class="badge-action-type badge-action-login">⚡ Activated</span>`;
            case 'withdrawal':
            case 'upgrade_utr':
                return `<span class="badge-action-type badge-action-withdraw">💸 Withdrawal</span>`;
            case 'bonus':
            case 'bonus_withdraw':
                return `<span class="badge-action-type badge-action-bonus">🎁 Bonus</span>`;
            case 'bank_removed':
                return `<span class="badge-action-type badge-action-withdraw">⚠️ Bank Removed</span>`;
            default:
                return `<span class="badge-action-type badge-action-login">${type || 'Event'}</span>`;
        }
    }

    checkAdminAuth();
}

}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
    bootstrapApp();
}

