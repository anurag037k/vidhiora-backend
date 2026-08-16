const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

// --- 1. SECURE CONFIGURATION ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'your_new_admin_password'; 
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || 'your_new_staff_password';
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI || 'mongodb://127.0.0.1:27017/lexova_db')
    .then(() => console.log("MongoDB Connected to Cloud"))
    .catch(err => console.error("MongoDB Connection Error:", err));

// --- 2. EMAIL CONFIGURATION ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'vidhiora.official@gmail.com', 
        pass: process.env.EMAIL_PASS 
    }
});

const supportFooter = `
---
Need Help or Have Queries?
📞 Technical & Payment Issues: Anurag Kumar (+91 76449 35111)
📞 Competition Queries: Pragati Kumari (+91 62991 50584)
✉️ Official Support: vidhiora.official@gmail.com
`;

// --- 3. SECURITY MIDDLEWARE ---
const verifyAdmin = (req, res, next) => {
    const adminPass = req.headers['x-admin-password'];
    if (adminPass === ADMIN_PASSWORD) { next(); } 
    else { res.status(401).json({ error: "Unauthorized: Invalid Admin Password" }); }
};

const verifyStaff = (req, res, next) => {
    const staffPass = req.headers['x-staff-password'];
    if (staffPass === STAFF_PASSWORD || staffPass === ADMIN_PASSWORD) { next(); } 
    else { res.status(401).json({ error: "Unauthorized: Invalid Staff Password" }); }
};

// --- 4. DATABASE SCHEMA ---
const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    qualification: { type: String, required: true },
    courseYear: { type: String, required: true },
    college: { type: String, required: true },
    accountType: { type: String, default: 'Student' },
    referralId: { type: String, default: null }, 
    referredBy: { type: String, default: null },
    walletBalance: { type: Number, default: 0 }, 
    amountPaid: { type: Number, default: 0 },
    utrNumber: { type: String, unique: true, sparse: true }, 
    paymentProof: { type: String, default: null }, 
    paymentStatus: { type: String, default: 'Pending' } 
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
User.collection.dropIndex("referralId_1").catch(() => {});

// --- 5. API ROUTES ---

// Login Routes
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) { res.json({ success: true }); } 
    else { res.status(401).json({ error: "Incorrect Admin Password" }); }
});

app.post('/api/staff/login', (req, res) => {
    const { password } = req.body;
    if (password === STAFF_PASSWORD) { res.json({ success: true }); } 
    else { res.status(401).json({ error: "Incorrect Staff Password" }); }
});

// Registration Routes
app.post('/api/verify-code', async (req, res) => {
    const { code } = req.body;
    const referrer = await User.findOne({ referralId: code.toUpperCase() });
    if (referrer) { res.json({ valid: true, discountPercent: 15, basePrice: 169 }); } 
    else { res.json({ valid: false }); }
});

app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, phone, qualification, courseYear, college, referredBy, utrNumber, accountType, paymentProof } = req.body;
        
        const existingUtr = await User.findOne({ utrNumber });
        if (existingUtr) return res.status(400).json({ error: "UTR already used." });

        let finalPrice = 169;
        if (accountType === 'Ambassador') finalPrice = 84.50;
        else if (referredBy) finalPrice = 169 - (169 * 0.15);

        const newUser = new User({
            fullName, email, phone, qualification, courseYear, college,
            accountType: accountType || 'Student', referralId: null,
            referredBy: referredBy ? referredBy.toUpperCase() : null,
            amountPaid: finalPrice, utrNumber, paymentProof: paymentProof || null, paymentStatus: 'Pending'
        });

        await newUser.save();
        res.status(201).json({ message: "Pending Verification" });
    } catch (error) { res.status(500).json({ error: "CRASH: " + error.message }); }
});

// Admin Actions
app.post('/api/admin/approve-payment', verifyAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);

        if (!user || user.paymentStatus === 'Approved') return res.status(400).json({ error: "Invalid or already approved." });

        user.paymentStatus = 'Approved';
        if (user.accountType === 'Ambassador' && !user.referralId) {
            user.referralId = `VIP-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        }
        await user.save();

        if (user.referredBy) {
            const referrer = await User.findOne({ referralId: user.referredBy });
            if (referrer) {
                const totalReferrals = await User.countDocuments({ referredBy: user.referredBy, paymentStatus: 'Approved' });
                
                if (totalReferrals > 2) {
                    referrer.walletBalance += 40; await referrer.save();
                    transporter.sendMail({
                        from: 'vidhiora.official@gmail.com', 
                        to: referrer.email,
                        subject: '🎉 You earned ₹40 on Vidhiora!',
                        text: `Great job! Referral #${totalReferrals} verified. ₹40 added to your wallet.\nTotal Balance: ₹${referrer.walletBalance}${supportFooter}`
                    });
                }
            }
        }

        const waGroupLink = "https://chat.whatsapp.com/EfOiDMFflgMBTf7ebsUAYs?s=cl&p=i&mlu=0&ilr=0";
        const welcomeMessage = user.accountType === 'Ambassador' 
            ? `Welcome to the Ambassador Program!\nYour unique referral code is: ${user.referralId}\nNote: Your first 2 referrals are unpaid. Earnings (₹40/student) unlock on your 3rd referral!\n\nJoin our Official Community Group: ${waGroupLink}`
            : `Welcome to the Vidhiora National Competition!\nYou can now access your resources.\n\nJoin the Official WhatsApp Group here: ${waGroupLink}`;

        transporter.sendMail({
            from: 'vidhiora.official@gmail.com', 
            to: user.email,
            subject: 'Payment Verified - Welcome to Vidhiora!',
            text: `Hi ${user.fullName},\n\nYour payment of ₹${user.amountPaid} is successfully verified.\n\n${welcomeMessage}${supportFooter}`
        });

        res.json({ message: "Approved successfully." });
    } catch (error) { res.status(500).json({ error: "CRASH: " + error.message }); }
});

app.delete('/api/admin/reject-payment/:userId', verifyAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ error: "User not found." });
        
        await User.findByIdAndDelete(req.params.userId);
        res.json({ message: "Registration deleted successfully." });
    } catch (error) { res.status(500).json({ error: "CRASH: " + error.message }); }
});

app.delete('/api/admin/remove-ambassador/:userId', verifyAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ error: "Ambassador not found." });
        
        await User.findByIdAndDelete(req.params.userId);
        res.json({ message: "Ambassador removed successfully." });
    } catch (error) { res.status(500).json({ error: "CRASH: " + error.message }); }
});

app.post('/api/admin/create-ambassador', verifyAdmin, async (req, res) => {
    try {
        const { fullName, email, phone, customCode } = req.body;
        const formattedCode = customCode.trim().toUpperCase();
        const existingCode = await User.findOne({ referralId: formattedCode });
        if (existingCode) return res.status(400).json({ error: "Code already taken!" });
        const existingEmail = await User.findOne({ email: email });
        if (existingEmail) return res.status(400).json({ error: "Email is already registered!" });

        const newAmbassador = new User({
            fullName, email, phone, qualification: "Staff", courseYear: "N/A", college: "N/A",
            referralId: formattedCode, amountPaid: 0, paymentStatus: 'Approved', accountType: 'Ambassador'
        });

        await newAmbassador.save();
        await transporter.sendMail({
            from: 'vidhiora.official@gmail.com', 
            to: email,
            subject: 'Welcome to the Vidhiora Ambassador Program!',
            text: `Hi ${fullName},\n\nYou have been appointed as an official Vidhiora Ambassador!\nYour unique referral code is: ${formattedCode}\n\nShare this code with students. They will get 15% off, and you will earn ₹40 for every successful registration!${supportFooter}`
        });
        res.json({ message: "Ambassador created!", code: formattedCode });
    } catch (error) { res.status(500).json({ error: "CRASH: " + error.message }); }
});

app.get('/api/user/:referralId/dashboard', async (req, res) => {
    try {
        const code = req.params.referralId.toUpperCase();
        const user = await User.findOne({ referralId: code });
        if (!user) return res.status(404).json({ error: "Ambassador code not found" });

        const referrals = await User.find({ referredBy: code }).select('fullName email paymentStatus createdAt');
        res.json({ user: { fullName: user.fullName, referralId: user.referralId, walletBalance: user.walletBalance }, totalReferred: referrals.length, referrals });
    } catch (error) { res.status(500).json({ error: "CRASH: " + error.message }); }
});

app.get('/api/admin/users', verifyAdmin, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });
        let rev = 0, payouts = 0;
        const ambassadors = [], students = [], referralCounts = {};

        users.forEach(u => { if (u.referredBy && u.paymentStatus === 'Approved') referralCounts[u.referredBy] = (referralCounts[u.referredBy] || 0) + 1; });
        users.forEach(u => {
            if (u.paymentStatus === 'Approved') rev += u.amountPaid;
            payouts += u.walletBalance;
            
            if ((u.referralId || u.accountType === 'Ambassador') && u.paymentStatus === 'Approved') {
                ambassadors.push({ 
                    _id: u._id, fullName: u.fullName, email: u.email, phone: u.phone, 
                    referralId: u.referralId, walletBalance: u.walletBalance, totalReferred: referralCounts[u.referralId] || 0 
                });
            } else { students.push(u); }
        });
        res.json({ stats: { totalUsers: users.length, totalRevenue: rev.toFixed(2), ambassadorPayouts: payouts.toFixed(2), netProfit: (rev - payouts).toFixed(2) }, ambassadors, students });
    } catch (error) { res.status(500).json({ error: "CRASH: " + error.message }); }
});

// STRICTLY FILTERED STAFF DATA FETCH (Now includes Education Profile)
app.get('/api/staff/users', verifyStaff, async (req, res) => {
    try {
        const users = await User.find({ accountType: { $ne: 'Ambassador' } })
                                .select('fullName email phone college qualification courseYear utrNumber paymentStatus createdAt')
                                .sort({ createdAt: -1 });
        res.json({ students: users });
    } catch (error) { res.status(500).json({ error: "CRASH: " + error.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));