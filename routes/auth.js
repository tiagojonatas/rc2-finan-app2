const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const router = express.Router();

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  } else {
    res.redirect('/login');
  }
}

// GET /register
router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// POST /register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    // Check if user already exists
    const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
      return res.render('register', { error: 'Email já cadastrado' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    await db.query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, hashedPassword]);

    res.redirect('/login');
  } catch (error) {
    console.error(error);
    res.render('register', { error: 'Erro ao cadastrar usuário' });
  }
});

// GET /login
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [users] = await db.query('SELECT id, name, password_hash FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.render('login', { error: 'Email ou senha inválidos' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.render('login', { error: 'Email ou senha inválidos' });
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.render('login', { error: 'Erro ao fazer login' });
  }
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
    }
    res.redirect('/login');
  });
});

// GET /dashboard (protected)
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    // Fetch transactions
    const [transactions] = await db.query('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC', [userId]);

    // Calculate totals
    let totalIncome = 0;
    let totalExpenses = 0;

    transactions.forEach(transaction => {
      if (transaction.type === 'income') {
        totalIncome += parseFloat(transaction.amount);
      } else if (transaction.type === 'expense') {
        totalExpenses += parseFloat(transaction.amount);
      }
    });

    const balance = totalIncome - totalExpenses;

    res.render('dashboard', {
      userName: req.session.userName,
      totalIncome: totalIncome.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      balance: balance.toFixed(2),
      transactions: transactions
    });
  } catch (error) {
    console.error(error);
    res.render('dashboard', {
      userName: req.session.userName,
      totalIncome: '0.00',
      totalExpenses: '0.00',
      balance: '0.00',
      transactions: []
    });
  }
});

module.exports = router;