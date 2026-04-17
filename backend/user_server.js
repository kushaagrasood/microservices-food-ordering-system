const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(express.json());

// CONNECT TO MongoDB
mongoose.connect("mongodb://127.0.0.1:27017/user_db")
.then(() => console.log("✅ Connected to User DB"))
.catch(err => console.log("❌ User DB Error:", err));

// USER SCHEMA - Enhanced with validation
const userSchema = new mongoose.Schema({
    email: { 
        type: String, 
        required: true, 
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password_hash: { type: String, required: true },
    full_name: { type: String, required: true, trim: true },
    phone: { 
        type: String,
        match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit phone number']
    },
    role_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    address: {
        street: String,
        city: String,
        state: String,
        pincode: String
    },
    created_at: { type: Date, default: Date.now },
    is_active: { type: Boolean, default: true },
    last_login: { type: Date },

    // ── Customer fields ──────────────────────────────────────
    gender: { type: String, enum: ["male", "female", "other", ""] },
    date_of_birth: { type: Date },
    dietary_preference: { type: String, enum: ["vegetarian", "vegan", "non_vegetarian", ""] },
    allergies: [{ type: String }],
    favourite_cuisines: [{ type: String }],
    preferred_spice_level: { type: String },
    default_payment_method: { type: String },

    // ── Restaurant Owner fields ───────────────────────────────
    alternate_phone: { type: String },
    gstin: { type: String },
    pan_number: { type: String },
    fssai_license: { type: String },
    bank_details: {
        bank_name: String,
        account_number: String,
        ifsc_code: String
    },

    // ── Delivery Partner fields ───────────────────────────────
    emergency_contact: { type: String },
    vehicle_type: { type: String, enum: ["bicycle", "motorcycle", "scooter", "car", "electric_scooter", ""] },
    vehicle_number: { type: String },
    driving_license: { type: String },
    preferred_zone: { type: String },
    is_available: { type: Boolean, default: true },
    max_delivery_radius: { type: Number },
    upi_id: { type: String }
}, { strict: false });

const User = mongoose.model("User", userSchema);

// ROLES SCHEMA
const roleSchema = new mongoose.Schema({
    role_name: {
        type: String,
        required: true,
        unique: true
    },
    permissions: [{
        type: String,
        required: true
    }]
});

const Role = mongoose.model("Role", roleSchema);

function isBcryptHash(value) {
    return typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);
}

// Middleware for error handling
const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || "Internal Server Error"
    });
};

// TEST ROUTE
app.get("/", (req, res) => {
    res.json({ success: true, message: "User Service is running", port: 3000 });
});

// REGISTER USER (Enhanced with password hashing)
app.post("/users/register", async (req, res) => {
    try {
        const { email, password, full_name, phone, role_name = 'customer' } = req.body;
        
        if (!email || !password || !full_name) {
            return res.status(400).json({ 
                success: false, 
                error: "Email, password, and full name are required" 
            });
        }

        // Only allow known roles to be self-registered
        const ALLOWED_ROLES = ["customer", "restaurant_owner", "delivery_partner"];
        if (!ALLOWED_ROLES.includes(role_name)) {
            return res.status(400).json({
                success: false,
                error: `Invalid role '${role_name}'. Allowed roles: ${ALLOWED_ROLES.join(", ")}`
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                error: "User with this email already exists" 
            });
        }

        // Get role from DB
        const role = await Role.findOne({ role_name });
        if (!role) {
            return res.status(400).json({ 
                success: false, 
                error: `Role '${role_name}' not found in database. Please seed roles first.` 
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const newUser = new User({
            email,
            password_hash,
            full_name,
            phone,
            role_id: role._id
        });

        await newUser.save();
        
        const userResponse = newUser.toObject();
        delete userResponse.password_hash;
        userResponse.roleName = role.role_name;

        res.status(201).json({ 
            success: true,
            message: `Registered successfully as ${role_name}`, 
            data: userResponse 
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                error: "User with this email already exists" 
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// LOGIN USER (Enhanced with password verification)
app.post("/users/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: "Email and password are required" 
            });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: "Invalid email or password" 
            });
        }

        if (!user.is_active) {
            return res.status(403).json({ 
                success: false, 
                error: "Account is deactivated. Contact support." 
            });
        }

        // Verify password with fallback for legacy plaintext/mock-hash records
        let isMatch = false;
        if (isBcryptHash(user.password_hash)) {
            isMatch = await bcrypt.compare(password, user.password_hash);
        } else {
            isMatch = password === user.password_hash;
            if (isMatch) {
                // Auto-migrate legacy record to bcrypt
                const salt = await bcrypt.genSalt(10);
                user.password_hash = await bcrypt.hash(password, salt);
            }
        }

        if (!isMatch) {
            return res.status(401).json({ 
                success: false, 
                error: "Invalid email or password" 
            });
        }

        // Update last login
        user.last_login = new Date();
        await user.save();

        // Get role information
        const role = await Role.findById(user.role_id);

        const userResponse = user.toObject();
        delete userResponse.password_hash;
        userResponse.roleName = role ? role.role_name : 'customer';

        res.json({ 
            success: true,
            message: "Login successful", 
            data: userResponse 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// CREATE USER ROUTE (POST/users) - Legacy support
app.post("/users", async (req, res) => {
    try {
        const newUser = new User(req.body);
        await newUser.save();
        res.status(201).json({ success: true, message: "User created successfully", data: newUser });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                error: "User with this email already exists" 
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET ALL USERS (GET/users)
app.get("/users", async (req, res) => {
    try {
        const users = await User.find().select('-password_hash');
        res.json({ success: true, count: users.length, data: users });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET USER BY ID
app.get("/users/:id", async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password_hash');
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        res.json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// UPDATE USER ROUTE (PUT/users/:id)
app.put("/users/:id", async (req, res) => {
    try {
        // Don't allow password_hash to be updated this way
        if (req.body.password_hash) {
            delete req.body.password_hash;
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true, runValidators: true }
        ).select('-password_hash');

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        res.json({ success: true, message: "User updated successfully", data: updatedUser });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// UPDATE PASSWORD
app.put("/users/:id/password", async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                success: false, 
                error: "Current password and new password are required" 
            });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Verify current password with legacy fallback
        let isMatch = false;
        if (isBcryptHash(user.password_hash)) {
            isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        } else {
            isMatch = currentPassword === user.password_hash;
        }

        if (!isMatch) {
            return res.status(401).json({ 
                success: false, 
                error: "Current password is incorrect" 
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        user.password_hash = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /user (Soft delete)
app.delete("/users/:id", async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Soft delete by marking as inactive
        user.is_active = false;
        await user.save();

        res.json({ success: true, message: "User deactivated successfully" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// HARD DELETE (for cleanup)
app.delete("/users/:id/permanent", async (req, res) => {
    try {
        const deleted = await User.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        res.json({ success: true, message: "User permanently deleted" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========== ROLE MANAGEMENT ==========

// CREATE ROLE (POST/roles)
app.post("/roles", async (req, res) => {
    try {
        const role = new Role(req.body);
        await role.save();
        res.status(201).json({ success: true, message: "Role created", data: role });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                error: "Role with this name already exists" 
            });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET ROLES (GET/roles)
app.get("/roles", async (req, res) => {
    try {
        const roles = await Role.find();
        res.json({ success: true, count: roles.length, data: roles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET ROLE BY ID
app.get("/roles/:id", async (req, res) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) {
            return res.status(404).json({ success: false, message: "Role not found" });
        }
        res.json({ success: true, data: role });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// UPDATE ROLE
app.put("/roles/:id", async (req, res) => {
    try {
        const updated = await Role.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!updated) {
            return res.status(404).json({ success: false, message: "Role not found" });
        }
        res.json({ success: true, message: "Role updated", data: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE ROLE
app.delete("/roles/:id", async (req, res) => {
    try {
        const deleted = await Role.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Role not found" });
        }
        res.json({ success: true, message: "Role deleted" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Error handling middleware
app.use(errorHandler);

// START SERVER (ALWAYS LAST)
app.listen(3000, () => {
    console.log("🚀 User service running on port 3000");
});