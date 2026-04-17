const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// CONNECT TO restaurant_db
mongoose.connect("mongodb://127.0.0.1:27017/restaurant_db")
.then(() => console.log("✅ Connected to Restaurant DB"))
.catch(err => console.log("❌ Restaurant DB Error:", err));

// RESTAURANT SCHEMA (Enhanced)
const restaurantSchema = new mongoose.Schema({
    restaurant_name: {
        type: String,
        required: true,
        trim: true
    },
    owner_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    cuisine_type: {
        type: String,
        trim: true
    },
    address: {
        street: String,
        city: String,
        state: String,
        pincode: String
    },
    rating: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },
    is_open: {
        type: Boolean,
        default: true
    },
    opening_hours: {
        type: String
    },
    delivery_time: {
        type: Number, // in minutes
        default: 30
    },
    minimum_order: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0
    },
    created_at: {
        type: Date,
        default: Date.now
    },
    total_orders: {
        type: Number,
        default: 0
    },
    image_url: {
        type: String
    }
});

const Restaurant = mongoose.model("Restaurant", restaurantSchema);

// MENU SCHEMA (Enhanced)
const menuSchema = new mongoose.Schema({
    restaurant_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    item_name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String
    },
    price: {
        type: mongoose.Schema.Types.Decimal128,
        required: true
    },
    category: {
        type: String,
        enum: ['appetizer', 'main_course', 'dessert', 'beverage', 'combo'],
        default: 'main_course'
    },
    is_available: {
        type: Boolean,
        default: true
    },
    is_vegetarian: {
        type: Boolean,
        default: false
    },
    is_vegan: {
        type: Boolean,
        default: false
    },
    spice_level: {
        type: String,
        enum: ['mild', 'medium', 'hot', 'extra_hot'],
        default: 'medium'
    },
    preparation_time: {
        type: Number, // in minutes
        default: 15
    },
    image_url: {
        type: String
    },
    rating: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },
    total_orders: {
        type: Number,
        default: 0
    }
});

const Menu = mongoose.model("Menu", menuSchema);

// REVIEWS SCHEMA (Enhanced)
const reviewSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    restaurant_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    order_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: String,
    created_at: {
        type: Date,
        default: Date.now
    },
    is_verified: {
        type: Boolean,
        default: true
    }
});

const Review = mongoose.model("Review", reviewSchema);

// ========== RESTAURANT ROUTES ==========

// Test Route
app.get("/", (req, res) => {
    res.json({ success: true, message: "Restaurant Service is running", port: 3001 });
});

// CREATE RESTAURANT
app.post("/restaurants", async (req, res) => {
    try {
        const newRestaurant = new Restaurant(req.body);
        await newRestaurant.save();
        res.status(201).json({ success: true, message: "Restaurant created", data: newRestaurant });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET ALL RESTAURANTS (with filters)
app.get("/restaurants", async (req, res) => {
    try {
        const { cuisine, city, is_open, sort } = req.query;
        let filter = {};
        
        if (cuisine) filter.cuisine_type = new RegExp(cuisine, 'i');
        if (city) filter['address.city'] = new RegExp(city, 'i');
        if (is_open !== undefined) filter.is_open = is_open === 'true';

        let query = Restaurant.find(filter);
        
        // Sorting
        if (sort === 'rating') query = query.sort({ rating: -1 });
        else if (sort === 'name') query = query.sort({ restaurant_name: 1 });
        else query = query.sort({ created_at: -1 });

        const restaurants = await query;
        res.json({ success: true, count: restaurants.length, data: restaurants });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET RESTAURANT BY ID
app.get("/restaurants/:id", async (req, res) => {
    try {
        const restaurant = await Restaurant.findById(req.params.id);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found" });
        }
        
        // Get average rating from reviews
        const reviews = await Review.find({ restaurant_id: req.params.id });
        if (reviews.length > 0) {
            const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
            restaurant.rating = Math.round(avgRating * 10) / 10;
        }

        res.json({ success: true, data: restaurant });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// SEARCH RESTAURANTS
app.get("/restaurants/search/:query", async (req, res) => {
    try {
        const searchQuery = req.params.query;
        const restaurants = await Restaurant.find({
            $or: [
                { restaurant_name: new RegExp(searchQuery, 'i') },
                { cuisine_type: new RegExp(searchQuery, 'i') },
                { 'address.city': new RegExp(searchQuery, 'i') }
            ]
        });
        res.json({ success: true, count: restaurants.length, data: restaurants });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// UPDATE RESTAURANT
app.put("/restaurants/:id", async (req, res) => {
    try {
        const updated = await Restaurant.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: "Restaurant not found" });
        }

        res.json({ success: true, message: "Restaurant updated", data: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE RESTAURANT
app.delete("/restaurants/:id", async (req, res) => {
    try {
        const deleted = await Restaurant.findByIdAndDelete(req.params.id);

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Restaurant not found" });
        }

        // Also delete all menus for this restaurant
        await Menu.deleteMany({ restaurant_id: req.params.id });

        res.json({ success: true, message: "Restaurant and its menus deleted" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========== MENU ROUTES ==========

// CREATE MENU ITEM
app.post("/menus", async (req, res) => {
    try {
        const menuData = {
            ...req.body,
            price: mongoose.Types.Decimal128.fromString(req.body.price.toString())
        };

        const newMenu = new Menu(menuData);
        await newMenu.save();
        res.status(201).json({ success: true, message: "Menu item created", data: newMenu });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET ALL MENU ITEMS (with filters)
app.get("/menus", async (req, res) => {
    try {
        const { restaurant_id, category, is_vegetarian, is_vegan, available } = req.query;
        let filter = {};
        
        if (restaurant_id) filter.restaurant_id = restaurant_id;
        if (category) filter.category = category;
        if (is_vegetarian !== undefined) filter.is_vegetarian = is_vegetarian === 'true';
        if (is_vegan !== undefined) filter.is_vegan = is_vegan === 'true';
        if (available !== undefined) filter.is_available = available === 'true';

        const menus = await Menu.find(filter).sort({ category: 1, item_name: 1 });
        res.json({ success: true, count: menus.length, data: menus });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET MENU BY ID
app.get("/menus/:id", async (req, res) => {
    try {
        const menu = await Menu.findById(req.params.id);
        if (!menu) {
            return res.status(404).json({ success: false, message: "Menu item not found" });
        }
        res.json({ success: true, data: menu });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// SEARCH MENU ITEMS
app.get("/menus/search/:query", async (req, res) => {
    try {
        const searchQuery = req.params.query;
        const menus = await Menu.find({
            $or: [
                { item_name: new RegExp(searchQuery, 'i') },
                { description: new RegExp(searchQuery, 'i') }
            ],
            is_available: true
        });
        res.json({ success: true, count: menus.length, data: menus });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// UPDATE MENU
app.put("/menus/:id", async (req, res) => {
    try {
        const updateData = { ...req.body };

        if (req.body.price) {
            updateData.price = mongoose.Types.Decimal128.fromString(req.body.price.toString());
        }

        const updated = await Menu.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: "Menu item not found" });
        }

        res.json({ success: true, message: "Menu updated", data: updated });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE MENU
app.delete("/menus/:id", async (req, res) => {
    try {
        const deleted = await Menu.findByIdAndDelete(req.params.id);

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Menu item not found" });
        }

        res.json({ success: true, message: "Menu deleted" });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========== REVIEW ROUTES ==========

// CREATE REVIEW
app.post("/reviews", async (req, res) => {
    try {
        // Check if user already reviewed this order
        const existingReview = await Review.findOne({
            user_id: req.body.user_id,
            order_id: req.body.order_id
        });

        if (existingReview) {
            return res.status(400).json({ 
                success: false, 
                error: "You have already reviewed this order" 
            });
        }

        const review = new Review(req.body);
        await review.save();

        // Update restaurant rating
        const reviews = await Review.find({ restaurant_id: req.body.restaurant_id });
        const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
        await Restaurant.findByIdAndUpdate(req.body.restaurant_id, { 
            rating: Math.round(avgRating * 10) / 10 
        });

        res.status(201).json({ success: true, message: "Review added", data: review });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET REVIEWS (with filters)
app.get("/reviews", async (req, res) => {
    try {
        const { restaurant_id, user_id, order_id, min_rating } = req.query;
        let filter = {};
        
        if (restaurant_id) filter.restaurant_id = restaurant_id;
        if (user_id) filter.user_id = user_id;
        if (order_id) filter.order_id = order_id;
        if (min_rating) filter.rating = { $gte: parseInt(min_rating) };

        const reviews = await Review.find(filter).sort({ created_at: -1 });
        res.json({ success: true, count: reviews.length, data: reviews });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET REVIEW BY ID
app.get("/reviews/:id", async (req, res) => {
    try {
        const review = await Review.findById(req.params.id);
        if (!review) {
            return res.status(404).json({ success: false, message: "Review not found" });
        }
        res.json({ success: true, data: review });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// UPDATE REVIEW
app.put("/reviews/:id", async (req, res) => {
    try {
        const updated = await Review.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: "Review not found" });
        }

        // Recalculate restaurant rating
        const reviews = await Review.find({ restaurant_id: updated.restaurant_id });
        const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
        await Restaurant.findByIdAndUpdate(updated.restaurant_id, { 
            rating: Math.round(avgRating * 10) / 10 
        });

        res.json({ success: true, message: "Review updated", data: updated });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE REVIEW
app.delete("/reviews/:id", async (req, res) => {
    try {
        const deleted = await Review.findByIdAndDelete(req.params.id);

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Review not found" });
        }

        // Recalculate restaurant rating
        const reviews = await Review.find({ restaurant_id: deleted.restaurant_id });
        if (reviews.length > 0) {
            const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
            await Restaurant.findByIdAndUpdate(deleted.restaurant_id, { 
                rating: Math.round(avgRating * 10) / 10 
            });
        } else {
            await Restaurant.findByIdAndUpdate(deleted.restaurant_id, { rating: 0 });
        }

        res.json({ success: true, message: "Review deleted" });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/reviews/restaurant/:id", async (req, res) => {
    try {
        const reviews = await Review.find({
            restaurant_id: new mongoose.Types.ObjectId(req.params.id)
        }).sort({ created_at: -1 });

        res.json({
            success: true,
            data: reviews
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.patch("/menus/:id/toggle", async (req, res) => {
    try {
        const menu = await Menu.findById(req.params.id);

        if (!menu) {
            return res.status(404).json({
                success: false,
                error: "Menu not found"
            });
        }

        // 🔥 Toggle logic
        menu.is_available = !menu.is_available;

        await menu.save();

        res.json({
            success: true,
            message: "Menu availability toggled",
            data: menu
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ========== STATISTICS ==========

// Get restaurant statistics
app.get("/restaurants/:id/stats", async (req, res) => {
    try {
        const restaurant = await Restaurant.findById(req.params.id);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: "Restaurant not found" });
        }

        const menuCount = await Menu.countDocuments({ restaurant_id: req.params.id });
        const reviews = await Review.find({ restaurant_id: req.params.id });
        
        const stats = {
            restaurant_name: restaurant.restaurant_name,
            total_menu_items: menuCount,
            total_reviews: reviews.length,
            average_rating: restaurant.rating,
            total_orders: restaurant.total_orders,
            rating_breakdown: {
                5: reviews.filter(r => r.rating === 5).length,
                4: reviews.filter(r => r.rating === 4).length,
                3: reviews.filter(r => r.rating === 3).length,
                2: reviews.filter(r => r.rating === 2).length,
                1: reviews.filter(r => r.rating === 1).length
            }
        };

        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// START SERVER
app.listen(3001, () => {
    console.log("🚀 Restaurant service running on port 3001");
});