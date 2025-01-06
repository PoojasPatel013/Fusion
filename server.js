const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');
const User = require('./models/userModel');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const PORT = 3000;
const app = express();
const dataDir = path.resolve(__dirname, 'one_ingredient_recipes'); // Base directory for recipes

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const dbURL = 'mongodb://127.0.0.1:27017/fusion';

app.use(session({
    secret: 'your_session_secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: dbURL }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, 
        secure: false 
    }
}));

const connectToDB = async () => {
    try {
        await mongoose.connect(dbURL);
        console.log('MongoDB connected');
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        setTimeout(connectToDB, 5000);
    }
};

connectToDB();

const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
};

const loadData = (region) => {
    const regionDir = path.join(dataDir, region); 
    const filePath = path.join(regionDir, `${region.toLowerCase()}_recipes.json`); 

    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return [];
    }

    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Error loading JSON file: ${err.message}`);
        return [];
    }
};

app.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const newUser = new User({
            username,
            email,
            password,
            bio: "Welcome to Fusion!",
            avatar: "/assets/default-avatar.png"
        });
        await newUser.save();
        req.session.userId = newUser._id;
        res.redirect("/dashboard");
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(400).send('Registration failed. Please try again.');
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user || !(await user.matchPassword(password))) {
            return res.status(400).send('Invalid email or password');
        }

        req.session.userId = user._id;
        await user.updateLastLogin();
        res.redirect('/profile');
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).send('Internal server error');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
        res.redirect('/');
    });
});

app.get('/', (req, res) => {
    res.render('index', { user: req.session.userId ? { id: req.session.userId } : null });
});

app.get('/search', (req, res) => {
    const { region, ingredient } = req.query;

    if (!region) {
        return res.status(400).send('Region query parameter is required');
    }

    let recipes = loadData(region);

    if (ingredient) {
        recipes = recipes.filter(recipe =>
            recipe.Ingredients.toLowerCase().includes(ingredient.toLowerCase())
        );
    }

    res.render('region', { region, recipes, ingredient: ingredient || '' });
});

app.get('/api/recipes', (req, res) => {
    const { region, ingredient, offset = 0, limit = 8 } = req.query;
    const startIndex = parseInt(offset);
    const endIndex = startIndex + parseInt(limit);

    if (!region) {
        return res.status(400).json({ error: 'Region query parameter is required' });
    }

    let recipes = loadData(region);

    if (ingredient) {
        recipes = recipes.filter(recipe =>
            recipe.Ingredients.toLowerCase().includes(ingredient.toLowerCase())
        );
    }

    const paginatedRecipes = recipes.slice(startIndex, endIndex);
    res.json(paginatedRecipes);
});

app.get('/login', (req, res) => {
    res.render('login.ejs');
});

app.get('/register', (req, res) => {
    res.render('register.ejs');
});

app.get('/region/:region', (req, res) => {
    const { region } = req.params;
    const ingredient = req.query.ingredient || '';
    const recipes = loadData(region);

    const filteredRecipes = ingredient
        ? recipes.filter(recipe => recipe.Ingredients.toLowerCase().includes(ingredient.toLowerCase()))
        : recipes;

    res.render('region', { region, recipes: filteredRecipes, ingredient });
});

app.get('/recipe/:region/:recipeId', (req, res) => {
    const { region, recipeId } = req.params;
    const recipes = loadData(region);
    const recipeIndex = parseInt(recipeId, 10);

    if (recipeIndex < 0 || recipeIndex >= recipes.length) {
        return res.status(404).json({ error: 'Invalid recipe ID' });
    }

    const recipe = recipes[recipeIndex];
    res.render('recipe', { recipe });
});

app.get('/royalhouses', (req, res) => {
    const house = (req.query.house || '').toLowerCase();
    const ingredient = (req.query.ingredient || '').toLowerCase();

    if (!house) {
        return res.render('royal', { recipes: [], house: '', houseDescription: {}, ingredient });
    }
    try {
        const houseData = require(path.join(__dirname, `one_ingredient_recipes/royal_houses/${house}/${house}.json`));
        const houseDescription = houseData.description;
        let recipes = houseData.dishes;

        if (ingredient) {
            recipes = recipes.filter(recipe => 
                recipe.Ingredients.toLowerCase().includes(ingredient)
            );
        }
        res.render('royal', { recipes, house, houseDescription, ingredient });
    } catch (err) {
        console.error("Error loading house data:", err);
        res.status(500).send("Error loading house data");
    }
});

app.get('/user', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).send('User not found');
        }
        res.render('dashboard', { user });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).send('Internal server error');
    }
});

app.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).send('User not found');
        }
        res.render('profile', { user: user.toJSON() });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).send('Internal server error');
    }
});

app.post('/profile', isAuthenticated, async (req, res) => {
    try {
        const { name, email, bio } = req.body;
        const updatedUser = await User.findByIdAndUpdate(
            req.session.userId,
            { name, email, bio },
            { new: true, runValidators: true }
        );
        res.json({ success: true, user: updatedUser });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/change-password', isAuthenticated, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.session.userId);
        
        if (!user || !(await user.matchPassword(currentPassword))) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        user.password = newPassword;
        await user.save();

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const loadCategoryData = () => {
    const filePath = path.join(__dirname, 'category_recipes.json');
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Error loading category JSON file: ${err.message}`);
        return [];
    }
};
const categories = ['vegetarian', 'vegan', 'gluten-free', 'quick-meals'];

categories.forEach(category => {
    app.get(`/category/${category}`, (req, res) => {
        const allCategoryRecipes = loadCategoryData();
        const recipes = allCategoryRecipes.filter(recipe => recipe.Category === category);
        res.render('category', { category, recipes });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});