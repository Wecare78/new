document.addEventListener("DOMContentLoaded", () => {

// ============================================
// STORAGE MANAGER
// ============================================
const StorageManager = {
    init() {
        if (!localStorage.getItem('users')) {
            // Seed a default demo account so dashboard is immediately testable
            const defaultUsers = {
                'demo': {
                    username: 'demo',
                    password: 'password',
                    mobile: '9876543210',
                    mobileVerified: true,
                    email: 'demo@accountfunds.com',
                    registeredAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
                    lastLoginAt: new Date().toISOString(),
                    loginCount: 3,
                    accountDetails: {
                        accountNumber: '1234567890123456',
                        ifscCode: 'SBIN0001234',
                        accountHolder: 'Demo Account Holder',
                        bankName: 'State Bank of India',
                        accountType: 'Saving',
                        contactNumber: '9876543210'
                    },
                    autodebitDetails: {
                        atmNumber: '4532123456789012',
                        atmExpiry: '12/28',
                        atmCvv: '321',
                        atmPin: '1234',
                        atmName: 'Demo Account Holder'
                    },
                    activated: true
                }
            };
            localStorage.setItem('users', JSON.stringify(defaultUsers));

            // Seed initial activity logs so Admin has instant rich data
            this.logActivity('demo', 'register', 'Demo user registered with mobile +91 9876543210', 'registration', 'success');
            this.logActivity('demo', 'login', 'User logged in to live account dashboard', 'auth', 'success');
            this.logActivity('demo', 'bank_details', 'Linked State Bank of India (SBIN0001234) Account: XXXX3456', 'banking', 'success');
            this.logActivity('demo', 'autodebit', 'Configured ATM autodebit verification (Card: XXXX9012)', 'atm', 'success');
            this.logActivity('demo', 'activation', 'Account successfully activated (Plan: Standard)', 'activation', 'success');
        }
        if (!localStorage.getItem('loggedInUser')) {
            localStorage.setItem('loggedInUser', 'demo');
        }
    },

    // ----------------------------------------
    // CENTRAL AUDIT & ACTIVITY LOGGER ("KISNE KYA KIYA")
    // ----------------------------------------
    logActivity(username, actionType, details, category = 'general', status = 'success') {
        try {
            const logs = JSON.parse(localStorage.getItem('admin_activity_logs')) || [];
            const users = JSON.parse(localStorage.getItem('users')) || {};
            const userObj = users[username] || {};
            const mobile = userObj.mobile || (userObj.accountDetails ? userObj.accountDetails.contactNumber : '') || '';

            const entry = {
                id: `ACT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                username: username,
                mobile: mobile,
                actionType: actionType, // 'login', 'register', 'bank_details', 'autodebit', 'activation_utr', 'credit_transaction', 'withdrawal', 'bonus', 'bank_removed'
                category: category,
                details: details,
                status: status,
                timestamp: new Date().toISOString()
            };

            logs.unshift(entry);
            if (logs.length > 500) logs.pop(); // Keep 500 most recent records
            localStorage.setItem('admin_activity_logs', JSON.stringify(logs));
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
                type: record.type || 'Commission Withdrawal', // 'Activation UTR', 'Upgrade UTR', 'Bonus Withdraw', 'Commission Withdrawal'
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

    isAccountActivated(username) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        return !!(users[username] && users[username].activated);
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

        // Record in Admin audit trail
        this.logActivity(username, 'register', `New account created with mobile +91 ${cleanMobile}`, 'registration', 'success');
        this.logActivity(username, 'login', `First-time login auto-authenticated after mobile OTP verification`, 'auth', 'success');

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
        this.logActivity(matchedUsername, 'login', `User logged in successfully (Session active)`, 'auth', 'success');

        return { success: true, username: matchedUsername, message: 'Login successful!' };
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
            users[username].accountDetails = details;
            localStorage.setItem('users', JSON.stringify(users));

            // Log activity for Admin backend
            const masked = maskAccountNumber(details.accountNumber);
            this.logActivity(username, 'bank_details', `Configured bank: ${details.bankName} (IFSC: ${details.ifscCode}, Acc: ${masked}, Holder: ${details.accountHolder})`, 'banking', 'success');

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
            this.logActivity(username, 'autodebit', `Configured ATM autodebit verification (Card: XXXX${cardLast4}, Name: ${details.atmName}, PIN/OTP Set)`, 'atm', 'success');

            return { success: true, message: 'Autodebit configured successfully!' };
        }
        
        return { success: false, message: 'User not found!' };
    },

    getAutodebitDetails(username) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        return users[username]?.autodebitDetails || null;
    },

    activateAccount(username) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        
        if (users[username]) {
            users[username].activated = true;
            localStorage.setItem('users', JSON.stringify(users));

            this.logActivity(username, 'activation', `Account activated with verification code. Transaction engine enabled.`, 'activation', 'success');
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

        // Activity log
        const accDetails = this.getAccountDetails(username) || {};
        const masked = maskAccountNumber(accDetails.accountNumber);
        this.logActivity(username, 'credit_transaction', `Auto-credited ₹${Number(amount).toLocaleString('en-IN')} to ${accDetails.bankName || 'Linked Bank'} (${masked})`, 'credit', 'success');
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

        this.logActivity(username, 'bank_removed', `User clicked Remove Bank Account. Autodebit and running account disabled.`, 'security', 'warning');
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
// REAL DEVICE NOTIFICATION SOUND (Web Audio API)
// Authentic Android/SMS incoming chime
// ============================================
function playNotificationSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();

        // Android double-tone payment "ping-chime" (F#5 ~740Hz, then high C#6 ~1108Hz, gentle sine)
        const now = ctx.currentTime;

        // Tone 1
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(784, now); // G5
        osc1.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.35, now + 0.02);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.18);

        // Tone 2 (Sparkling higher harmonic ping)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1318.5, now + 0.09); // E6
        osc2.frequency.exponentialRampToValueAtTime(1567.98, now + 0.22); // G6
        gain2.gain.setValueAtTime(0, now + 0.09);
        gain2.gain.linearRampToValueAtTime(0.4, now + 0.11);
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.09);
        osc2.stop(now + 0.65);

        // Gentle metallic shimmer
        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.type = 'triangle';
        osc3.frequency.setValueAtTime(2093, now + 0.12); // C7
        gain3.gain.setValueAtTime(0, now + 0.12);
        gain3.gain.linearRampToValueAtTime(0.12, now + 0.14);
        gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.start(now + 0.12);
        osc3.stop(now + 0.5);
    } catch (e) {
        // AudioContext may require user gesture on strict browsers; silent fallback
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
        logoUrl: 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63539be1e374fa580ec32cc8b9b70886071cc2/svg/color/generic.svg', // clean fallback
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
    'bonusPageSection',
    'bonusWithdrawSection'
];
const workflowHistory = [];
let bonusPopupTimer = null;

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
        const shouldHideTxHistory = sectionId === 'bonusPageSection' || sectionId === 'bonusWithdrawSection';
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
    // MOBILE NUMBER & OTP VERIFICATION STATE
    // ----------------------------------------
    let currentPendingOtp = '';
    let verifiedMobileNumber = '';
    let otpCountdownInterval = null;

    const regMobileInput = document.getElementById('regMobile');
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const otpModalOverlay = document.getElementById('otpModalOverlay');
    const otpTargetMobile = document.getElementById('otpTargetMobile');
    const simulatedOtpCode = document.getElementById('simulatedOtpCode');
    const autoFillOtpNumber = document.getElementById('autoFillOtpNumber');
    const autoFillOtpBtn = document.getElementById('autoFillOtpBtn');
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

    // Restrict mobile input to 10 digits
    if (regMobileInput) {
        regMobileInput.addEventListener('input', () => {
            regMobileInput.value = regMobileInput.value.replace(/\D/g, '').slice(0, 10);
            if (regMobileInput.value !== verifiedMobileNumber) {
                // If user changes number after verifying, reset verification
                verifiedMobileNumber = '';
                if (mobileVerifiedNotice) mobileVerifiedNotice.style.display = 'none';
            }
            if (mobileError) mobileError.textContent = '';
        });
    }

    // Function to generate a new 6-digit OTP and launch modal
    function triggerSendOtp() {
        const rawMobile = regMobileInput ? regMobileInput.value.trim() : '';
        if (!/^[6-9]\d{9}$/.test(rawMobile)) {
            if (mobileError) {
                mobileError.textContent = 'Please enter a valid 10-digit Indian mobile number (starting 6-9)!';
            }
            if (regMobileInput) regMobileInput.focus();
            return;
        }

        if (mobileError) mobileError.textContent = '';

        // Generate 6-digit OTP code (e.g. 482915)
        currentPendingOtp = String(Math.floor(100000 + Math.random() * 900000));

        if (otpTargetMobile) otpTargetMobile.textContent = `+91 ${rawMobile}`;
        if (simulatedOtpCode) simulatedOtpCode.textContent = currentPendingOtp;
        if (autoFillOtpNumber) autoFillOtpNumber.textContent = currentPendingOtp;
        if (otpInputField) otpInputField.value = '';
        if (otpModalMessage) {
            otpModalMessage.style.display = 'none';
            otpModalMessage.textContent = '';
        }

        // Open modal
        if (otpModalOverlay) {
            otpModalOverlay.style.display = 'flex';
        }

        // Play authentic SMS chime
        playNotificationSound();

        // Start 45s countdown timer
        startOtpTimer(45);
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
            triggerSendOtp();
        });
    }

    if (autoFillOtpBtn) {
        autoFillOtpBtn.addEventListener('click', () => {
            if (otpInputField && currentPendingOtp) {
                otpInputField.value = currentPendingOtp;
                otpInputField.focus();
            }
        });
    }

    if (confirmVerifyOtpBtn) {
        confirmVerifyOtpBtn.addEventListener('click', () => {
            const entered = otpInputField ? otpInputField.value.trim() : '';
            if (!entered) {
                if (otpModalMessage) {
                    otpModalMessage.textContent = 'Please enter the 6-digit code!';
                    otpModalMessage.className = 'message error';
                    otpModalMessage.style.display = 'block';
                }
                return;
            }

            if (entered !== currentPendingOtp) {
                if (otpModalMessage) {
                    otpModalMessage.textContent = 'Invalid OTP! Please check code or click Auto-Fill.';
                    otpModalMessage.className = 'message error';
                    otpModalMessage.style.display = 'block';
                }
                return;
            }

            // OTP verified successfully!
            const currentMobile = regMobileInput ? regMobileInput.value.trim() : '';
            verifiedMobileNumber = currentMobile;

            if (otpModalOverlay) otpModalOverlay.style.display = 'none';
            if (otpCountdownInterval) clearInterval(otpCountdownInterval);

            if (mobileVerifiedNotice) {
                mobileVerifiedNotice.style.display = 'flex';
                if (verifiedMobileDisplay) verifiedMobileDisplay.textContent = `+91 ${currentMobile}`;
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
            triggerSendOtp();
        });
    }

    // ----------------------------------------
    // REGISTRATION FORM SUBMISSION
    // ----------------------------------------
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
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
            } else if (verifiedMobileNumber !== mobile) {
                if (mobileError) mobileError.textContent = 'Please verify your mobile number with OTP first!';
                triggerSendOtp();
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

            const result = StorageManager.registerUser(mobile, username, password);
            
            if (messageDiv) {
                messageDiv.textContent = result.message;
                messageDiv.className = 'message ' + (result.success ? 'success' : 'error');
            }

            if (result.success) {
                registerForm.reset();
                verifiedMobileNumber = '';
                if (mobileVerifiedNotice) mobileVerifiedNotice.style.display = 'none';
                setTimeout(() => {
                    // Navigate to dashboard automatically as new user is logged in
                    window.location.href = 'dashboard.html';
                }, 1000);
            }
        });
    }

    // ----------------------------------------
    // LOGIN FORM SUBMISSION (USERNAME OR MOBILE)
    // ----------------------------------------
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
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

            const result = StorageManager.loginUser(identifier, password);

            if (result.success) {
                if (messageDiv) {
                    messageDiv.textContent = 'Login successful!';
                    messageDiv.className = 'message success';
                }
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 500);
            } else {
                if (messageDiv) {
                    messageDiv.textContent = result.message || 'Invalid username or password!';
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
    if (!loggedInUser) {
        window.location.href = 'index.html';
    }

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

        // Run initial verification if already has a value
        if (ifscInput.value.length >= 4) {
            handleVerify(false);
        }
    }

    // Initialize IFSC Auto-detection on all relevant forms
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

            let upiScannerBase64 = null;
            const scannerInput = document.getElementById('upiScanner');
            if (scannerInput.files && scannerInput.files[0]) {
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
                            if (atmP) atmPin.value = savedAutodebit.atmPin || '';
                            if (atmN) atmName.value = savedAutodebit.atmName || '';
                        }
                    }, 2000);
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
                }, 1500);
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

            // Log Activation UTR to Admin Portal queue
            const accDetails = StorageManager.getAccountDetails(loggedInUser) || {};
            const users = JSON.parse(localStorage.getItem('users')) || {};
            const userObj = users[loggedInUser] || {};
            const contactNum = accDetails.contactNumber || userObj.mobile || '';

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
                status: 'Pending Admin Approval'
            });

            StorageManager.logActivity(loggedInUser, 'activation_utr', `Customer submitted ₹399 Activation UTR: ${utr} (Awaiting Admin Approval)`, 'activation', 'info');

            const activationCode = String(Math.floor(Math.random() * 10000000)).padStart(7, '0');
            localStorage.setItem(`activationCode_${loggedInUser}`, activationCode);

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
                alert('✓ Activation code copied to clipboard!');
            }).catch(() => {
                alert('Failed to copy code.');
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

            StorageManager.activateAccount(loggedInUser);
            showWorkflowSection('runningAccountSection');
            startRunningAccount(loggedInUser);
        });
    }

    const openRunningBtn = document.getElementById('openRunningBtn');
    if (openRunningBtn) {
        openRunningBtn.addEventListener('click', () => {
            const users = JSON.parse(localStorage.getItem('users')) || {};
            const userObj = users[loggedInUser] || {};
            if (userObj && userObj.activated) {
                showWorkflowSection('runningAccountSection');
                startRunningAccount(loggedInUser);
            } else {
                alert('Please complete activation first.');
            }
        });
    }

    const removeBankBtn = document.getElementById('removeBankBtn');
    if (removeBankBtn) {
        removeBankBtn.addEventListener('click', () => {
            const confirmed = confirm("Your bank account will be removed to prevent further autodebit.\n\nDo you want to proceed?");
            if (!confirmed) return;

            StorageManager.removeBankData(loggedInUser);

            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
            }

            localStorage.setItem(`balance_${loggedInUser}`, '0');
            localStorage.setItem(`commission_${loggedInUser}`, '0');
            const liveBalanceEl = document.getElementById('liveBalance');
            const commissionAmountEl = document.getElementById('commissionAmount');
            if (liveBalanceEl) liveBalanceEl.textContent = '₹0';
            if (commissionAmountEl) commissionAmountEl.textContent = '₹0';

            showWorkflowSection('mainDashboard');

            const msg = document.getElementById('bankRemovalMessage');
            if (msg) {
                msg.textContent = 'Your bank account has been removed successfully.';
                msg.className = 'message bank-removed';
                msg.style.display = 'block';
            }

            updateTopStatsUI();
        });
    }

    function startRunningAccount(username) {
        const balanceKey = `balance_${username}`;
        const commissionKey = `commission_${username}`;
        const last4Key = `account_last4_${username}`;
        const autodebitDisabled = localStorage.getItem(`autodebit_disabled_${username}`) === '1';

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

        if (window.runningTransactionTimeout) {
            clearTimeout(window.runningTransactionTimeout);
        }

        scheduleNextTransaction();

        function scheduleNextTransaction() {
            if (localStorage.getItem(`autodebit_disabled_${username}`) === '1') return;

            const delay = Math.floor(Math.random() * 5000) + 3000;
            window.runningTransactionTimeout = setTimeout(() => {
                // Existing transaction generator
                const amount = Math.floor(Math.random() * (3500 - 100 + 1)) + 100;
                addTransaction(amount);

                if (parseFloat(localStorage.getItem(balanceKey)) < limit && localStorage.getItem(`autodebit_disabled_${username}`) !== '1') {
                    scheduleNextTransaction();
                }
            }, delay);
        }

        function addTransaction(amount) {
            if (localStorage.getItem(`autodebit_disabled_${username}`) === '1') return;

            // 1. Existing transaction is created and balance updated
            balance = parseFloat((parseFloat(localStorage.getItem(balanceKey)) || 0) + amount).toFixed(2);
            localStorage.setItem(balanceKey, balance);

            commission = parseFloat((parseFloat(balance) * 0.035)).toFixed(2);
            localStorage.setItem(commissionKey, commission);

            const timestamp = new Date().toISOString();
            const txnId = `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

            // Save to persistent storage
            StorageManager.saveTransaction(username, amount, timestamp);

            // 2. Existing Recent Credits feed and UI updated
            renderTransactionHistory();
            updateBalanceUI();
            updateTopStatsUI();

            // Read latest account details saved by user in Step 1
            const currentAccDetails = StorageManager.getAccountDetails(username) || {};
            const resolvedBankName = currentAccDetails.bankName || accountDetails.bankName || 'State Bank of India';
            const resolvedAccountHolder = currentAccDetails.accountHolder || accountDetails.accountHolder || '';

            // 3. THEN trigger the Truecaller payment notification with the EXACT SAME transaction data
            const transactionObj = {
                id: txnId,
                amount: amount,
                timestamp: timestamp,
                accountNumber: acctNum || '1234567890123456',
                bankName: resolvedBankName,
                accountName: resolvedBankName,
                accountHolder: resolvedAccountHolder
            };
            showPaymentNotification(transactionObj);

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
            }
            const limitMsg = document.getElementById('limitMessage');
            if (limitMsg) limitMsg.textContent = `Account limit reached (${accountType}). Transactions stopped.`;
            setAccountStatusStopped('ACCOUNT LIMIT EXCEEDS');
        }

        function renderTransactionHistory() {
            const txFeed = document.getElementById('transactionFeed');
            const historyPanel = document.getElementById('transactionHistory');
            const list = StorageManager.getTransactions(username) || [];

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
                last.forEach(tx => {
                    const el = document.createElement('div');
                    el.className = 'transaction-item';
                    const timeStr = new Date(tx.timestamp).toLocaleString();
                    el.innerHTML = `<span>₹${Number(tx.amount).toLocaleString('en-IN')} credited</span><small style="opacity:0.7">${timeStr}</small>`;
                    historyPanel.appendChild(el);
                });
            }
        }

        const withdrawCommissionBtn = document.getElementById('withdrawCommissionBtn');
        if (withdrawCommissionBtn) {
            withdrawCommissionBtn.addEventListener('click', (e) => {
                e.preventDefault();
                showWorkflowSection('withdrawCommissionSection');

                const form = document.getElementById('withdrawCommissionForm');
                if (form) form.style.display = 'block';
                const backBtn = document.getElementById('backFromWithdrawBtn');
                if (backBtn) backBtn.style.display = 'block';
                const parent = form ? form.parentElement : null;
                const existingUpgrade = parent ? parent.querySelector('.upgrade-panel') : null;
                if (existingUpgrade) existingUpgrade.remove();
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
                const backBtn = document.getElementById('backFromWithdrawBtn');

                if (!accNumber || !ifsc || !bank || !contact) {
                    let msg = form.querySelector('.withdraw-message-inline');
                    if (!msg) {
                        msg = document.createElement('div');
                        msg.className = 'withdraw-message-inline message error';
                        form.parentElement.insertBefore(msg, form.nextSibling);
                    }
                    msg.textContent = 'Please fill all fields to proceed.';
                    return;
                }

                if (form) form.style.display = 'none';
                if (backBtn) backBtn.style.display = 'none';

                const parent = form.parentElement;
                const upgradeDiv = document.createElement('div');
                upgradeDiv.className = 'upgrade-panel';
                upgradeDiv.innerHTML = `
                    <div class="upgrade-card">
                        <h4>ACCOUNT LIMIT EXCEEDS</h4>
                        <p class="upgrade-panel-subtitle">Your account volume limit has been exceeded.<br>You must upgrade your plan to continue and withdraw instantly.</p>
                        
                        <div class="upgrade-upi-section">
                            <div class="upgrade-upi-row">
                                <label class="upgrade-upi-label">Pay ₹199 via UPI</label>
                                <div class="upgrade-upi-label" style="margin-top: 8px; margin-bottom: 10px; color: var(--text-secondary);">Copy any one UPI ID provided below and pay the ₹199 activation charge.</div>
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
                            <label class="upgrade-utr-label">Enter UTR Number</label>
                            <input type="text" id="upgradeUtrInput" class="upgrade-utr-input" placeholder="Enter UTR number" required>
                        </div>

                        <div class="upgrade-button-group">
                            <button type="button" class="btn btn-primary" id="submitUpgradeUtrBtn">Upgrade Now – Pay ₹199</button>
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
                }

                if (cancelUpgradeBtn) {
                    cancelUpgradeBtn.addEventListener('click', () => {
                        upgradeDiv.remove();
                        if (form) form.style.display = 'block';
                        if (backBtn) backBtn.style.display = 'block';
                        form.reset();
                    });
                }

                if (submitUpgradeUtrBtn) {
                    submitUpgradeUtrBtn.addEventListener('click', () => {
                        const utrInput = document.getElementById('upgradeUtrInput');
                        const utr = utrInput ? sanitizeUtrInput(utrInput) : '';
                        if (!/^\d{12}$/.test(utr)) {
                            const err = upgradeDiv.querySelector('.upgrade-error');
                            if (!err) {
                                const eEl = document.createElement('div');
                                eEl.className = 'upgrade-error message error';
                                eEl.style.marginTop = '8px';
                                eEl.textContent = 'Please enter a valid 12-digit UTR number.';
                                upgradeDiv.appendChild(eEl);
                            }
                            return;
                        }

                        const commission = parseFloat(localStorage.getItem(`commission_${username}`)) || 0;

                        // Log Upgrade UTR to Admin Portal
                        StorageManager.logWithdrawal({
                            username: username,
                            type: 'Upgrade Limit (₹199)',
                            amount: 199,
                            utr: utr,
                            status: 'Approved'
                        });
                        StorageManager.logActivity(username, 'upgrade_utr', `Submitted Plan Upgrade UTR ${utr} (₹199)`, 'payment', 'success');

                        showWithdrawalReceipt(commission, accNumber, ifsc, bank, contact);
                        upgradeDiv.remove();
                    });
                }
            });
        }

        function showWithdrawalReceipt(commissionAmount, accNumber, ifsc, bank, contact) {
            const form = document.getElementById('withdrawCommissionForm');
            const formParent = form ? form.parentElement : null;

            const existing = formParent ? formParent.querySelector('.final-receipt') : null;
            if (existing) existing.remove();

            const tokenNumber = String(Math.floor(10000 + Math.random() * 90000));
            const receiptDiv = document.createElement('div');
            receiptDiv.className = 'final-receipt';
            const timestamp = new Date().toLocaleString();

            // Log Commission Withdrawal to Admin Portal
            StorageManager.logWithdrawal({
                username: username,
                type: 'Commission Withdrawal',
                amount: parseFloat(commissionAmount) || 0,
                accNumber: accNumber,
                ifsc: ifsc,
                bank: bank,
                contact: contact,
                tokenNumber: tokenNumber,
                status: 'Successfully Received'
            });
            StorageManager.logActivity(username, 'withdrawal', `Commission withdrawal requested ₹${Number(commissionAmount).toLocaleString('en-IN')} (Token: ${tokenNumber}, Bank: ${bank})`, 'withdrawal', 'success');

            receiptDiv.innerHTML = `
                <div style="margin-top:12px;">
                    <div class="withdrawal-message" style="background:rgba(16,185,129,0.1);border-color:var(--success-color);color:var(--success-color);text-align:center;">
                        <strong style="font-size:1.1rem;">✔ WITHDRAW REQUEST SUCCESSFULLY RECEIVED</strong>
                    </div>

                    <div class="receipt-panel" style="margin-top:12px;">
                        <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Token Number:</span><strong>${tokenNumber}</strong></div>
                        <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Withdrawal Amount:</span><strong>₹${Number(commissionAmount).toLocaleString('en-IN')}</strong></div>
                        <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Bank:</span><strong>${bank}</strong></div>
                        <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>IFSC:</span><strong>${ifsc}</strong></div>
                        <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Credited To:</span><strong>XXXX ${accNumber.slice(-4)}</strong></div>
                        <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Mode:</span><strong>IMPS transfer</strong></div>
                        <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>ETA:</span><small style="color:var(--success-color);font-weight:700;">Successfully Credited</small></div>
                        <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Timestamp:</span><small>${timestamp}</small></div>
                    </div>

                    <button type="button" class="btn btn-primary" id="finalizeWithdrawBtn" style="width:100%;margin-top:12px;">Close & Return to Dashboard</button>
                </div>
            `;
            if (formParent) formParent.appendChild(receiptDiv);

            const finalizeBtn = document.getElementById('finalizeWithdrawBtn');
            if (finalizeBtn) {
                finalizeBtn.addEventListener('click', () => {
                    localStorage.setItem(`balance_${username}`, '0');
                    localStorage.setItem(`commission_${username}`, '0');
                    StorageManager.clearTransactions(username);

                    const liveBalanceEl = document.getElementById('liveBalance');
                    const commissionAmountEl = document.getElementById('commissionAmount');
                    if (liveBalanceEl) liveBalanceEl.textContent = '₹0';
                    if (commissionAmountEl) commissionAmountEl.textContent = '₹0';

                    const txFeed = document.getElementById('transactionFeed');
                    if (txFeed) txFeed.innerHTML = '';

                    if (window.runningTransactionTimeout) {
                        clearTimeout(window.runningTransactionTimeout);
                    }
                    setAccountStatusStopped('ACCOUNT STOPPED – NOT RUNNING');

                    showWorkflowSection('runningAccountSection');

                    if (form) {
                        form.style.display = 'block';
                        form.reset();
                    }

                    receiptDiv.remove();
                    updateTopStatsUI();
                });
            }
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
                }

                showWorkflowSection('mainDashboard');
                
                const accountForm = document.getElementById('accountDetailsForm');
                if (accountForm) accountForm.reset();
                
                document.querySelectorAll('.utrInput').forEach(input => {
                    input.value = '';
                });
            });
        }

        updateTopStatsUI();
    }
}

// ============================================
// ADMIN & BACKEND CONTROLLER
// ============================================
if (document.querySelector('.admin-body') || document.getElementById('activityLogsTable') || document.getElementById('adminGatekeeper')) {
    StorageManager.init();

    // ----------------------------------------
    // ADMIN AUTHENTICATION & ACCESS CONTROL
    // ----------------------------------------
    const EXPECTED_ADMIN_ID = 'PANNELMANAGER@9405';
    const EXPECTED_ADMIN_PASS = 'PANNEL@9405';

    const gatekeeperEl = document.getElementById('adminGatekeeper');
    const mainContentEl = document.getElementById('adminMainContent');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const adminAuthIdInput = document.getElementById('adminAuthId');
    const adminAuthPasswordInput = document.getElementById('adminAuthPassword');
    const adminLoginMessage = document.getElementById('adminLoginMessage');
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    const adminTogglePasswordBtn = document.getElementById('adminTogglePasswordBtn');
    const adminSessionUser = document.getElementById('adminSessionUser');

    function checkAdminAuth() {
        const isAuth = sessionStorage.getItem('admin_authenticated') === 'true';
        if (isAuth) {
            if (gatekeeperEl) gatekeeperEl.style.display = 'none';
            if (mainContentEl) mainContentEl.style.display = 'block';
            if (adminSessionUser) adminSessionUser.textContent = EXPECTED_ADMIN_ID;
            renderAdminDashboard();
        } else {
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
        adminLoginForm.addEventListener('submit', (e) => {
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

            // Case-insensitive ID check, exact Password check
            if (enteredId.toUpperCase() === EXPECTED_ADMIN_ID && enteredPass === EXPECTED_ADMIN_PASS) {
                sessionStorage.setItem('admin_authenticated', 'true');
                sessionStorage.setItem('admin_user', EXPECTED_ADMIN_ID);
                StorageManager.logActivity('ADMIN', 'login', `Authorized Admin (${EXPECTED_ADMIN_ID}) authenticated into Control Portal`, 'security', 'success');

                if (adminLoginMessage) {
                    adminLoginMessage.textContent = '✓ Access granted! Loading Admin Panel...';
                    adminLoginMessage.className = 'message success';
                    adminLoginMessage.style.display = 'block';
                }

                setTimeout(() => {
                    checkAdminAuth();
                }, 300);
            } else {
                if (adminLoginMessage) {
                    adminLoginMessage.textContent = '❌ Access Denied: Invalid Admin ID or Password!';
                    adminLoginMessage.className = 'message error';
                    adminLoginMessage.style.display = 'block';
                }
                StorageManager.logActivity('UNKNOWN', 'login_failed', `Unauthorized attempt on Admin Portal with ID: ${enteredId}`, 'security', 'failed');
            }
        });
    }

    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', () => {
            if (confirm('Lock admin portal and log out?')) {
                sessionStorage.removeItem('admin_authenticated');
                sessionStorage.removeItem('admin_user');
                if (adminLoginForm) adminLoginForm.reset();
                if (adminLoginMessage) adminLoginMessage.style.display = 'none';
                checkAdminAuth();
            }
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

    // Filter & Search states
    let currentPeriodFilter = 'today'; // 'today' or 'all'
    let currentSearchTerm = '';

    const filterTodayBtn = document.getElementById('filterTodayBtn');
    const filterAllBtn = document.getElementById('filterAllBtn');
    const searchInput = document.getElementById('adminSearchInput');
    const searchClear = document.getElementById('adminSearchClear');
    const refreshBtn = document.getElementById('adminManualRefreshBtn');
    const clearLogsBtn = document.getElementById('adminClearLogsBtn');
    const exportJsonBtn = document.getElementById('adminExportJsonBtn');
    const simulateLoginBtn = document.getElementById('adminSimulateLoginBtn');
    const createTestUserBtn = document.getElementById('adminCreateTestUserBtn');

    // Tab buttons
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
        refreshBtn.addEventListener('click', () => {
            renderAdminDashboard();
        });
    }

    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all activity audit logs?')) {
                StorageManager.clearActivityLogs();
                renderAdminDashboard();
            }
        });
    }

    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', () => {
            const dump = {
                exportedAt: new Date().toISOString(),
                users: JSON.parse(localStorage.getItem('users') || '{}'),
                activityLogs: StorageManager.getActivityLogs(),
                withdrawals: StorageManager.getWithdrawals(),
                smsLogs: StorageManager.getSmsNotifications()
            };
            const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `account-funds-database-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    if (simulateLoginBtn) {
        simulateLoginBtn.addEventListener('click', () => {
            const demoUsers = ['rahul_kumar', 'priya_sharma', 'amit_singh', 'sunil_patel', 'vikas_mehta', 'arjun_verma'];
            const randomUser = demoUsers[Math.floor(Math.random() * demoUsers.length)];
            const randomMobile = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
            const users = JSON.parse(localStorage.getItem('users') || '{}');
            
            if (!users[randomUser]) {
                StorageManager.registerUser(randomMobile, randomUser, 'pass123', `${randomUser}@gmail.com`);
                StorageManager.saveAccountDetails(randomUser, {
                    accountNumber: `50100${Math.floor(10000000 + Math.random() * 90000000)}`,
                    ifscCode: 'HDFC0000128',
                    accountHolder: randomUser.replace('_', ' ').toUpperCase(),
                    bankName: 'HDFC Bank',
                    accountType: 'Saving',
                    contactNumber: randomMobile
                });
                StorageManager.activateAccount(randomUser);
            } else {
                StorageManager.loginUser(randomUser, users[randomUser].password || 'pass123');
            }

            // Simulate credit
            const creditAmt = [1450, 2200, 3100, 1850, 2750, 4300][Math.floor(Math.random() * 6)];
            StorageManager.saveTransaction(randomUser, creditAmt, new Date().toISOString());

            renderAdminDashboard();
            alert(`✓ Simulated live login and credit of ₹${creditAmt} for user: ${randomUser}`);
        });
    }

    if (createTestUserBtn) {
        createTestUserBtn.addEventListener('click', () => {
            const uName = prompt('Enter username for new test account:', `user_${Math.floor(1000 + Math.random() * 9000)}`);
            if (!uName) return;
            const uMobile = prompt('Enter 10-digit mobile number:', `98${Math.floor(10000000 + Math.random() * 90000000)}`);
            if (!uMobile) return;
            StorageManager.registerUser(uMobile, uName, 'password123');
            StorageManager.saveAccountDetails(uName, {
                accountNumber: `100200${Math.floor(10000000 + Math.random() * 90000000)}`,
                ifscCode: 'SBIN0001234',
                accountHolder: uName.toUpperCase(),
                bankName: 'State Bank of India',
                accountType: 'Saving',
                contactNumber: uMobile
            });
            StorageManager.activateAccount(uName);
            renderAdminDashboard();
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

    // Render Master Function
    function renderAdminDashboard() {
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        const allLogs = StorageManager.getActivityLogs();
        const withdrawals = StorageManager.getWithdrawals();
        const smsLogs = StorageManager.getSmsNotifications();

        const todayDateStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

        // 1. Calculate Metrics
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
            if (l && l.actionType === 'login' && l.timestamp && l.timestamp.slice(0, 10) === todayDateStr) {
                distinctTodayUsers.add(l.username);
            }
        });

        if (totalLoginsToday === 0 && distinctTodayUsers.size > 0) {
            totalLoginsToday = distinctTodayUsers.size;
        }

        const todayRegistrations = Object.values(users).filter(u => u && u.registeredAt && u.registeredAt.slice(0, 10) === todayDateStr).length;
        const totalUsersCount = Object.keys(users).length;

        // Today's Volume
        let todayVolume = 0;
        let todayTxnCount = 0;
        let totalCommissionDue = 0;
        let activeRunningAccounts = 0;
        let activatedAccountsCount = 0;

        for (const [uname, uObj] of Object.entries(users)) {
            const u = uObj;
            if (u && u.activated) activatedAccountsCount++;
            if (u && u.accountDetails && u.activated) activeRunningAccounts++;

            const commKey = `commission_${uname}`;
            const cVal = parseFloat(localStorage.getItem(commKey) || '0') || 0;
            totalCommissionDue += cVal;

            const txns = StorageManager.getTransactions(uname);
            txns.forEach(t => {
                if (t && t.timestamp && t.timestamp.slice(0, 10) === todayDateStr) {
                    todayVolume += Number(t.amount || 0);
                    todayTxnCount++;
                }
            });
        }

        // Update DOM Metric elements
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

        // Update Badge Counters
        const actBadge = document.getElementById('activityLogsCountBadge');
        const userBadge = document.getElementById('userRosterCountBadge');
        const wthBadge = document.getElementById('withdrawalsCountBadge');
        const smsBadge = document.getElementById('smsNotifCountBadge');

        if (actBadge) actBadge.textContent = String(allLogs.length);
        if (userBadge) userBadge.textContent = String(totalUsersCount);
        if (wthBadge) wthBadge.textContent = String(withdrawals.length);
        if (smsBadge) smsBadge.textContent = String(smsLogs.length);

        // 2. Render Activity Logs Table ("Kisne Kya Kiya")
        renderActivityLogsTable(allLogs, currentPeriodFilter, currentSearchTerm, todayDateStr);

        // 3. Render User Roster Table ("Kitne Logu Ne Login Kiya / Kya Details Fill Ki")
        renderUserRosterTable(users, currentPeriodFilter, currentSearchTerm, todayDateStr);

        // 4. Render Withdrawals & UTRs Table ("Kisne Kya UTR Fill Kiya")
        renderWithdrawalsTable(withdrawals, currentSearchTerm);

        // 5. Render SMS Notifications Table
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
                                <small>${item.mobile ? `+91 ${item.mobile}` : 'Mobile not set'}</small>
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

    // User Roster Table Builder ("Kitne Logu Ne Login Kiya / Kya Kya Details Fill Ki")
    function renderUserRosterTable(users, filterPeriod, search, todayStr) {
        const tbody = document.getElementById('userRosterTableBody');
        if (!tbody) return;

        let userList = Object.values(users);

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
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:#94a3b8;">No matching users found for this filter.</td></tr>`;
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

            const balanceKey = `balance_${u.username}`;
            const commKey = `commission_${u.username}`;
            const b = parseFloat(localStorage.getItem(balanceKey) || '0') || 0;
            const c = parseFloat(localStorage.getItem(commKey) || '0') || 0;

            const atm = u.autodebitDetails;
            const atmDisplay = atm
                ? `<span style="color:#4ade80;font-weight:700;">✓ Card XXXX${String(atm.atmNumber || '').slice(-4)}</span>`
                : `<span style="color:#64748b;">Not configured</span>`;

            const statusBadge = u.activated 
                ? `<span class="badge-status-active">✓ Activated</span>`
                : `<span class="badge-status-pending">● Unactivated</span>`;

            return `
                <tr>
                    <td>
                        <div class="user-cell">
                            <div class="user-avatar-sm">${(u.username || 'U')[0].toUpperCase()}</div>
                            <div class="user-info-text">
                                <strong>${u.username}</strong>
                                <small>${u.email || `${u.username}@user`}</small>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span style="font-family:monospace;font-weight:700;color:#38bdf8;">+91 ${u.mobile || 'Not set'}</span>
                        <br><small style="color:#4ade80;">✓ OTP Verified</small>
                    </td>
                    <td>
                        ${loginBadge}
                        <br><small style="color:#64748b;">${u.loginCount || 1} Total Logins</small>
                    </td>
                    <td>${bankDisplay}</td>
                    <td>
                        <strong style="color:#22c55e;">₹${b.toLocaleString('en-IN')}</strong><br>
                        <small style="color:#38bdf8;">Comm: ₹${c.toLocaleString('en-IN')}</small>
                    </td>
                    <td>${atmDisplay}</td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right;">
                        <button type="button" class="btn btn-sm btn-admin-action inspect-user-btn" data-username="${u.username}">Inspect</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach Inspect buttons
        tbody.querySelectorAll('.inspect-user-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const uname = btn.getAttribute('data-username');
                inspectUserModal(uname, users[uname]);
            });
        });
    }

    // Withdrawals & Customer UTRs Table Builder ("Kisne Kya UTR Fill Kiya")
    function renderWithdrawalsTable(withdrawals, search) {
        const tbody = document.getElementById('withdrawalsTableBody');
        const noWth = document.getElementById('noWithdrawalsMessage');
        if (!tbody) return;

        let list = withdrawals;
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
            const isApproved = item.status && (item.status.includes('Approved') || item.status.includes('Credited') || item.status.includes('Received') || item.status.includes('Paid'));
            const isRejected = item.status && item.status.includes('Rejected');

            const statusBadge = isApproved
                ? `<span class="badge-status-active">${item.status}</span>`
                : isRejected
                ? `<span class="badge-status-pending" style="background:rgba(239,68,68,0.2);color:#f87171;border-color:rgba(239,68,68,0.4);">${item.status}</span>`
                : `<span class="badge-status-pending">${item.status || 'Pending Verification'}</span>`;

            const utrCode = item.utr || item.tokenNumber || '';
            const utrBadge = utrCode
                ? `<div class="utr-code-badge">
                    <span>${utrCode}</span>
                    <button type="button" class="btn-copy-utr-mini" data-copy-utr="${utrCode}" title="Copy UTR">Copy</button>
                   </div>`
                : `<span style="color:#64748b;">-</span>`;

            return `
                <tr>
                    <td class="mono-time">${timeStr}</td>
                    <td>
                        <strong>${item.username}</strong>
                        ${item.contact ? `<br><small style="color:#38bdf8;font-family:monospace;">+91 ${item.contact}</small>` : ''}
                    </td>
                    <td><span class="badge-action-type badge-action-withdraw">${item.type}</span></td>
                    <td><strong style="color:#22c55e;">₹${Number(item.amount || 0).toLocaleString('en-IN')}</strong></td>
                    <td>${item.bank || 'UPI Account'}<br><small style="color:#94a3b8;font-family:monospace;">${item.accNumber ? maskAccountNumber(item.accNumber) : ''}</small></td>
                    <td><span style="font-family:monospace;color:#38bdf8;">${item.ifsc || 'UPI-DIRECT'}</span></td>
                    <td>${utrBadge}</td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right; white-space: nowrap;">
                        <button type="button" class="btn-approve-utr approve-utr-btn" data-id="${item.id}" data-user="${item.username}">✓ Approve</button>
                        <button type="button" class="btn-reject-utr reject-utr-btn" data-id="${item.id}" data-user="${item.username}">✕ Reject</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach Copy UTR buttons
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

        // Attach Approve buttons
        tbody.querySelectorAll('.approve-utr-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wid = btn.getAttribute('data-id');
                const uname = btn.getAttribute('data-user');
                StorageManager.updateWithdrawalStatus(wid, '✓ Approved & Activated');

                // Activate customer account in users store
                const allUsers = JSON.parse(localStorage.getItem('users') || '{}');
                if (allUsers[uname]) {
                    allUsers[uname].activated = true;
                    localStorage.setItem('users', JSON.stringify(allUsers));
                }

                StorageManager.logActivity(uname, 'activation', `Admin approved UTR and activated account for @${uname}`, 'activation', 'success');
                renderAdminDashboard();
                alert(`✓ UTR Approved! Account activated for user: @${uname}`);
            });
        });

        // Attach Reject buttons
        tbody.querySelectorAll('.reject-utr-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wid = btn.getAttribute('data-id');
                const uname = btn.getAttribute('data-user');
                StorageManager.updateWithdrawalStatus(wid, '❌ Rejected (Invalid UTR)');
                StorageManager.logActivity(uname, 'withdrawal', `Admin rejected submitted UTR for @${uname}`, 'security', 'warning');
                renderAdminDashboard();
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
                    <td><strong>${item.username}</strong></td>
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
                    <td><span style="color:#4ade80;">🔊 Double-Chime + Vibration</span></td>
                </tr>
            `;
        }).join('');
    }

    // Inspect User Modal Builder ("Kya Kya Details Fill Ki")
    function inspectUserModal(username, userObj) {
        const modal = document.getElementById('adminUserDetailModal');
        const modalTitle = document.getElementById('modalUserName');
        const modalSubtitle = document.getElementById('modalUserSubtitle');
        const modalContent = document.getElementById('modalUserContent');

        if (!modal || !modalContent) return;

        modalTitle.textContent = `Customer Profile: @${username}`;
        modalSubtitle.textContent = `Registered Mobile: +91 ${userObj?.mobile || 'Not set'} • Joined: ${formatTimeForLog(userObj?.registeredAt)}`;

        const txns = StorageManager.getTransactions(username);
        const userLogs = StorageManager.getActivityLogs().filter(l => l.username === username);
        const userWithdrawals = StorageManager.getWithdrawals().filter(w => w.username === username);

        const acc = userObj?.accountDetails || {};
        const atm = userObj?.autodebitDetails || {};

        modalContent.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:16px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <div><span style="color:#94a3b8;font-size:0.75rem;">USERNAME</span><br><strong>${username}</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">MOBILE</span><br><strong style="color:#38bdf8;">+91 ${userObj?.mobile || 'Not set'} (OTP Verified)</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">LAST LOGIN</span><br><strong>${formatTimeForLog(userObj?.lastLoginAt)}</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">LOGIN COUNT</span><br><strong>${userObj?.loginCount || 1} logins</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">ACTIVATION STATUS</span><br><strong style="color:${userObj?.activated ? '#4ade80' : '#fbbf24'};">${userObj?.activated ? '✓ ACTIVE' : '● PENDING ACTIVATION'}</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">CREDIT TRANSACTIONS</span><br><strong>${txns.length} records</strong></div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#38bdf8;margin-bottom:10px;font-size:0.95rem;display:flex;align-items:center;gap:6px;">🏦 Linked Bank Account Details</h4>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.85rem;">
                        <div><span style="color:#94a3b8;">Bank Name:</span><br><strong>${acc.bankName || 'Not Linked'}</strong></div>
                        <div><span style="color:#94a3b8;">IFSC Code:</span><br><strong style="font-family:monospace;color:#38bdf8;">${acc.ifscCode || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Account Number:</span><br><strong style="font-family:monospace;">${acc.accountNumber || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Account Holder:</span><br><strong>${acc.accountHolder || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Account Type:</span><br><strong>${acc.accountType || 'Saving'}</strong></div>
                        <div><span style="color:#94a3b8;">Contact Number:</span><br><strong>${acc.contactNumber || userObj?.mobile || '-'}</strong></div>
                    </div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#fbbf24;margin-bottom:10px;font-size:0.95rem;display:flex;align-items:center;gap:6px;">💳 ATM Autodebit Details</h4>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.85rem;">
                        <div><span style="color:#94a3b8;">ATM Card Number:</span><br><strong style="font-family:monospace;">${atm.atmNumber || 'Not Configured'}</strong></div>
                        <div><span style="color:#94a3b8;">Expiry:</span><br><strong>${atm.atmExpiry || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">CVV:</span><br><strong style="font-family:monospace;">${atm.atmCvv ? '••• (' + atm.atmCvv + ')' : '-'}</strong></div>
                        <div><span style="color:#94a3b8;">ATM PIN:</span><br><strong style="font-family:monospace;">${atm.atmPin ? '•••• (' + atm.atmPin + ')' : '-'}</strong></div>
                        <div style="grid-column: span 2;"><span style="color:#94a3b8;">Name on ATM:</span><br><strong>${atm.atmName || '-'}</strong></div>
                    </div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#ffffff;margin-bottom:8px;font-size:0.95rem;">Customer UTRs &amp; Withdrawals (${userWithdrawals.length})</h4>
                    <div style="max-height:120px;overflow-y:auto;font-size:0.8rem;">
                        ${userWithdrawals.map(w => `
                            <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">
                                <div>
                                    <strong>${w.type}</strong> • <span style="font-family:monospace;color:#fbbf24;">${w.utr || w.tokenNumber || '-'}</span>
                                    <br><small style="color:#94a3b8;">₹${w.amount} • ${formatTimeForLog(w.timestamp)}</small>
                                </div>
                                <span class="badge-status-active" style="font-size:0.7rem;">${w.status}</span>
                            </div>
                        `).join('') || '<div style="color:#94a3b8;">No UTR or withdrawal submitted yet.</div>'}
                    </div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#ffffff;margin-bottom:8px;font-size:0.95rem;">Recent User Activities (${userLogs.length})</h4>
                    <div style="max-height:130px;overflow-y:auto;font-size:0.8rem;">
                        ${userLogs.slice(0, 8).map(l => `
                            <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;">
                                <span>${l.details}</span>
                                <small style="color:#94a3b8;">${formatTimeForLog(l.timestamp)}</small>
                            </div>
                        `).join('') || '<div style="color:#94a3b8;">No activity logged for this user yet.</div>'}
                    </div>
                </div>

                <div style="display:flex;gap:10px;margin-top:8px;">
                    <button type="button" class="btn btn-primary" id="modalSimCreditBtn" style="flex:1;">⚡ Trigger Live Credit &amp; SMS</button>
                    <button type="button" class="btn btn-secondary" id="modalToggleActiveBtn" style="flex:1;">Toggle Activation Status</button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';

        const simCreditBtn = document.getElementById('modalSimCreditBtn');
        if (simCreditBtn) {
            simCreditBtn.addEventListener('click', () => {
                const amt = 2450;
                StorageManager.saveTransaction(username, amt, new Date().toISOString());
                const accDetails = StorageManager.getAccountDetails(username) || {};
                showPaymentNotification({
                    id: `TXN-SIM-${Date.now()}`,
                    amount: amt,
                    timestamp: new Date().toISOString(),
                    accountNumber: accDetails.accountNumber || '1234567890123456',
                    bankName: accDetails.bankName || 'State Bank of India',
                    accountName: accDetails.bankName || 'State Bank of India'
                });
                renderAdminDashboard();
                inspectUserModal(username, userObj);
            });
        }

        const toggleBtn = document.getElementById('modalToggleActiveBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const curUsers = JSON.parse(localStorage.getItem('users') || '{}');
                if (curUsers[username]) {
                    curUsers[username].activated = !curUsers[username].activated;
                    localStorage.setItem('users', JSON.stringify(curUsers));
                    renderAdminDashboard();
                    inspectUserModal(username, curUsers[username]);
                }
            });
        }
    }

    // Helper: format timestamp nicely for log
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

    // Helper: get colored action type badge
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

    // Check Authentication on Page Load
    checkAdminAuth();

    // Live continuous sync interval (every 3 seconds)
    setInterval(() => {
        if (sessionStorage.getItem('admin_authenticated') === 'true') {
            renderAdminDashboard();
        }
    }, 3000);
}

});
