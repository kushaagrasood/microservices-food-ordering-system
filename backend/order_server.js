const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

function decimalToNumber(value, fallback = 0) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "number") return value;
    if (typeof value === "string") return parseFloat(value) || fallback;
    if (value.$numberDecimal) return parseFloat(value.$numberDecimal) || fallback;
    const parsed = parseFloat(value.toString());
    return Number.isFinite(parsed) ? parsed : fallback;
}

// CONNECT TO order_db
mongoose.connect("mongodb://127.0.0.1:27017/order_db")
.then(() => console.log("✅ Connected to Order DB"))
.catch(err => console.log("❌ Order DB Error:", err));

// ORDER SCHEMA (Enhanced)
const orderSchema = new mongoose.Schema({
    user_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true,
        index: true 
    },
    restaurant_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true,
        index: true 
    },
    order_date: { type: Date, default: Date.now },
    delivery_address: {
        street: { type: String, required: true },
        city: { type: String, required: true },
        state: String,
        pincode: String
    },
    total_amount: { 
        type: mongoose.Schema.Types.Decimal128, 
        required: true 
    },
    discount_amount: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0
    },
    delivery_fee: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0
    },
    tax_amount: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0
    },
    final_amount: {
        type: mongoose.Schema.Types.Decimal128,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'],
        default: 'pending',
        index: true
    },
    delivery_partner_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        default: null 
    },
    estimated_delivery_time: { type: Date },
    actual_delivery_time: { type: Date },
    special_instructions: { type: String },
    cancelled_reason: { type: String },
    cancelled_at: { type: Date }
});

// Add pre-save hook to calculate estimated delivery time
orderSchema.pre('save', function() {
    if (this.isNew && !this.estimated_delivery_time) {
        // Default 30 minutes from now
        this.estimated_delivery_time = new Date(Date.now() + 30 * 60 * 1000);
    }
});

const Order = mongoose.model("Order", orderSchema);

// ORDER ITEM SCHEMA (Fixed collection name)
const orderItemSchema = new mongoose.Schema({
    order_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true,
        index: true 
    },
    menu_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true 
    },
    item_name: {
        type: String,
        required: true
    },
    quantity: { 
        type: Number, 
        required: true, 
        min: 1 
    },
    price_at_order: { 
        type: mongoose.Schema.Types.Decimal128, 
        required: true 
    },
    subtotal: {
        type: mongoose.Schema.Types.Decimal128,
        required: true
    },
    special_instructions: { type: String, default: null }
}, { collection: 'order_items' });

// Calculate subtotal before saving
orderItemSchema.pre('save', function() {
    if (this.isModified('quantity') || this.isModified('price_at_order')) {
        const price = parseFloat(this.price_at_order.toString());
        this.subtotal = mongoose.Types.Decimal128.fromString((price * this.quantity).toFixed(2));
    }
});

const OrderItem = mongoose.model("OrderItem", orderItemSchema);

// Test Route
app.get("/", (req, res) => {
    res.json({ success: true, message: "Order Service is running", port: 3002 });
});

// ========== ORDER ROUTES ==========

// CREATE ORDER (Enhanced)
app.post("/orders", async (req, res) => {
    try {
        const {
    user_id,
    restaurant_id,
    delivery_address,
    special_instructions,
    total_amount,
    discount_amount = 0,
    delivery_fee = 0,
    tax_amount = 0
} = req.body;

console.log("📦 Received address:", delivery_address);
        
        // Calculate final amount
        const total = parseFloat(total_amount);
        const discount = parseFloat(discount_amount);
        const delivery = parseFloat(delivery_fee);
        const tax = parseFloat(tax_amount);
        const final = total - discount + delivery + tax;

        console.log("RAW BODY:", req.body);
        console.log("ADDRESS:", req.body.delivery_address);

if (!delivery_address) {
    return res.status(400).json({
        success: false,
        error: "Address missing at backend"
    });
}

        const orderData = {
        user_id,
        restaurant_id,

        delivery_address: {
            street: String(delivery_address?.street || ""),
            city: String(delivery_address?.city || ""),
            state: delivery_address?.state || "",
            pincode: delivery_address?.pincode || ""
        },

        special_instructions: special_instructions || null,

        total_amount: mongoose.Types.Decimal128.fromString(total.toFixed(2)),
        discount_amount: mongoose.Types.Decimal128.fromString(discount.toFixed(2)),
        delivery_fee: mongoose.Types.Decimal128.fromString(delivery.toFixed(2)),
        tax_amount: mongoose.Types.Decimal128.fromString(tax.toFixed(2)),
        final_amount: mongoose.Types.Decimal128.fromString(final.toFixed(2))
};

        const newOrder = new Order(orderData);
        await newOrder.save();
        
        res.status(201).json({ success: true, message: "Order created", data: newOrder });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET ALL ORDERS (with filters)
app.get("/orders", async (req, res) => {
    try {
        const { user_id, restaurant_id, status, from_date, to_date } = req.query;
        let filter = {};
        
        if (user_id) filter.user_id = user_id;
        if (restaurant_id) filter.restaurant_id = restaurant_id;
        if (status) filter.status = status;
        
        if (from_date || to_date) {
            filter.order_date = {};
            if (from_date) filter.order_date.$gte = new Date(from_date);
            if (to_date) filter.order_date.$lte = new Date(to_date);
        }

        const orders = await Order.find(filter).sort({ order_date: -1 });
        res.json({ success: true, count: orders.length, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET ORDER BY ID
app.get("/orders/:id", async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        
        // Get order items
        const items = await OrderItem.find({ order_id: req.params.id });
        
        res.json({ 
            success: true, 
            data: {
                ...order.toObject(),
                items
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// UPDATE ORDER STATUS
app.put("/orders/:id", async (req, res) => {
    try {
        const updateData = {};
        
        if (req.body.status) {
            updateData.status = req.body.status;
            
            // If status is delivered, record actual delivery time
            if (req.body.status === 'delivered') {
                updateData.actual_delivery_time = new Date();
            }
            
            // If status is cancelled, record cancellation details
            if (req.body.status === 'cancelled') {
                updateData.cancelled_at = new Date();
                if (req.body.cancelled_reason) {
                    updateData.cancelled_reason = req.body.cancelled_reason;
                }
            }
        }
        
        if (req.body.delivery_partner_id) {
            updateData.delivery_partner_id = req.body.delivery_partner_id;
        }

        const updatedOrder = await Order.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedOrder) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        res.json({ success: true, message: "Order updated", data: updatedOrder });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// CANCEL ORDER
app.put("/orders/:id/cancel", async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        // Only allow cancellation if order is pending or confirmed
        if (!['pending', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ 
                success: false, 
                error: "Order cannot be cancelled at this stage" 
            });
        }

        order.status = 'cancelled';
        order.cancelled_at = new Date();
        order.cancelled_reason = req.body.reason || 'Cancelled by user';
        await order.save();

        res.json({ success: true, message: "Order cancelled", data: order });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE ORDER
app.delete("/orders/:id", async (req, res) => {
    try {
        const deleted = await Order.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        
        // Also delete all order items
        await OrderItem.deleteMany({ order_id: req.params.id });
        
        res.json({ success: true, message: "Order and items deleted" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========== ORDER ITEM ROUTES ==========

// CREATE ORDER ITEM
app.post("/order_items", async (req, res) => {
    try {
        const { price_at_order, quantity, ...rest } = req.body;
        
        const price = parseFloat(price_at_order);
        const itemData = {
            ...rest,
            quantity,
            price_at_order: mongoose.Types.Decimal128.fromString(price.toFixed(2)),
            subtotal: mongoose.Types.Decimal128.fromString((price * quantity).toFixed(2))
        };

        const newItem = new OrderItem(itemData);
        await newItem.save();
        
        res.status(201).json({ success: true, message: "Order item added", data: newItem });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// CREATE MULTIPLE ORDER ITEMS (Batch)
app.post("/order_items/batch", async (req, res) => {
    try {
        const { items } = req.body;
        
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: "Items array is required" 
            });
        }

        const processedItems = items.map(item => {
            const price = parseFloat(item.price_at_order);
            return {
                ...item,
                price_at_order: mongoose.Types.Decimal128.fromString(price.toFixed(2)),
                subtotal: mongoose.Types.Decimal128.fromString((price * item.quantity).toFixed(2))
            };
        });

        const savedItems = await OrderItem.insertMany(processedItems);
        
        res.status(201).json({ 
            success: true, 
            message: `${savedItems.length} items added`, 
            data: savedItems 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET ORDER ITEMS (with filters)
app.get("/order_items", async (req, res) => {
    try {
        const { order_id, menu_id } = req.query;
        let filter = {};
        
        if (order_id) filter.order_id = order_id;
        if (menu_id) filter.menu_id = menu_id;

        const items = await OrderItem.find(filter);
        res.json({ success: true, count: items.length, data: items });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET ORDER ITEM BY ID
app.get("/order_items/:id", async (req, res) => {
    try {
        const item = await OrderItem.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ success: false, message: "Order item not found" });
        }
        res.json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// UPDATE ORDER ITEM
app.put("/order_items/:id", async (req, res) => {
    try {
        const updateData = { ...req.body };
        
        if (req.body.price_at_order || req.body.quantity) {
            const item = await OrderItem.findById(req.params.id);
            const price = parseFloat(req.body.price_at_order || item.price_at_order.toString());
            const qty = req.body.quantity || item.quantity;
            
            updateData.subtotal = mongoose.Types.Decimal128.fromString((price * qty).toFixed(2));
        }

        const updated = await OrderItem.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: "Order item not found" });
        }

        res.json({ success: true, message: "Order item updated", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE ORDER ITEM
app.delete("/order_items/:id", async (req, res) => {
    try {
        const deleted = await OrderItem.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Order item not found" });
        }
        res.json({ success: true, message: "Order item deleted" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== STATISTICS ==========

// Get order statistics
app.get("/orders/stats/summary", async (req, res) => {
    try {
        const { user_id, restaurant_id } = req.query;
        let filter = {};
        
        if (user_id) filter.user_id = user_id;
        if (restaurant_id) filter.restaurant_id = restaurant_id;

        const totalOrders = await Order.countDocuments(filter);
        const pendingOrders = await Order.countDocuments({ ...filter, status: 'pending' });
        const deliveredOrders = await Order.countDocuments({ ...filter, status: 'delivered' });
        const cancelledOrders = await Order.countDocuments({ ...filter, status: 'cancelled' });

        const allOrders = await Order.find(filter);
        const totalRevenue = allOrders.reduce((sum, order) => {
            const finalAmount = decimalToNumber(order.final_amount, NaN);
            const fallbackTotal = decimalToNumber(order.total_amount, 0);
            return sum + (Number.isFinite(finalAmount) ? finalAmount : fallbackTotal);
        }, 0);

        res.json({ 
            success: true, 
            data: {
                total_orders: totalOrders,
                pending_orders: pendingOrders,
                delivered_orders: deliveredOrders,
                cancelled_orders: cancelledOrders,
                total_revenue: totalRevenue.toFixed(2),
                average_order_value: totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// START SERVER
app.listen(3002, () => {
    console.log("🚀 Order service running on port 3002");
});
