const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const router = express.Router();

function getLocalDateKey(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextOccurrence(dayOfMonth, baseDate) {
  const targetDay = Number(dayOfMonth);
  if (!Number.isFinite(targetDay) || targetDay < 1) return null;

  let year = baseDate.getFullYear();
  let monthIndex = baseDate.getMonth();
  let day = Math.min(targetDay, new Date(year, monthIndex + 1, 0).getDate());
  let candidate = new Date(year, monthIndex, day);

  if (candidate < baseDate) {
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
    day = Math.min(targetDay, new Date(year, monthIndex + 1, 0).getDate());
    candidate = new Date(year, monthIndex, day);
  }

  return candidate;
}

function getMonthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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
      return res.render('register', { error: 'Email ja cadastrado' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    await db.query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, hashedPassword]);

    res.redirect('/login');
  } catch (error) {
    console.error(error);
    res.render('register', { error: 'Erro ao cadastrar usuario' });
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
      return res.render('login', { error: 'Email ou senha invalidos' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.render('login', { error: 'Email ou senha invalidos' });
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

    transactions.forEach((transaction) => {
      if (transaction.type === 'income') {
        totalIncome += parseFloat(transaction.amount);
      } else if (transaction.type === 'expense') {
        totalExpenses += parseFloat(transaction.amount);
      }
    });

    const balance = totalIncome - totalExpenses;

    // Expense categories for pie chart (grouped by description)
    const expenseCategoryMap = new Map();
    transactions.forEach((transaction) => {
      if (transaction.type !== 'expense') return;
      const category = (transaction.description || 'Outros').trim() || 'Outros';
      const current = expenseCategoryMap.get(category) || 0;
      expenseCategoryMap.set(category, current + parseFloat(transaction.amount || 0));
    });

    const expenseCategoryData = Array.from(expenseCategoryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }));

    // Monthly balance evolution (last 12 months)
    const monthlyMap = new Map();
    transactions.forEach((transaction) => {
      const key = getMonthKey(transaction.date);
      const bucket = monthlyMap.get(key) || { income: 0, expense: 0 };
      if (transaction.type === 'income') {
        bucket.income += parseFloat(transaction.amount || 0);
      } else if (transaction.type === 'expense') {
        bucket.expense += parseFloat(transaction.amount || 0);
      }
      monthlyMap.set(key, bucket);
    });

    const monthKeys = Array.from(monthlyMap.keys()).sort().slice(-12);
    const monthlyBalanceData = monthKeys.map((key) => {
      const [year, month] = key.split('-');
      const monthDate = new Date(Number(year), Number(month) - 1, 1);
      const monthLabel = monthDate.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      const bucket = monthlyMap.get(key) || { income: 0, expense: 0 };
      return {
        label: monthLabel,
        balance: bucket.income - bucket.expense
      };
    });

    // Group transactions by date
    const groupedTransactions = {};
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    transactions.forEach((transaction) => {
      const transactionDate = new Date(transaction.date);
      const dateKey = getLocalDateKey(transactionDate);

      if (!groupedTransactions[dateKey]) {
        groupedTransactions[dateKey] = {
          date: transactionDate,
          transactions: [],
          totalIncome: 0,
          totalExpenses: 0
        };
      }

      groupedTransactions[dateKey].transactions.push(transaction);

      if (transaction.type === 'income') {
        groupedTransactions[dateKey].totalIncome += parseFloat(transaction.amount);
      } else if (transaction.type === 'expense') {
        groupedTransactions[dateKey].totalExpenses += parseFloat(transaction.amount);
      }
    });

    // Convert grouped transactions to array and sort by date (most recent first)
    const transactionGroups = Object.values(groupedTransactions).sort((a, b) => b.date - a.date);

    // Add formatted date labels
    const todayStr = getLocalDateKey(today);
    const yesterdayStr = getLocalDateKey(yesterday);

    transactionGroups.forEach((group) => {
      const groupDate = group.date;
      const groupDateStr = getLocalDateKey(groupDate);

      if (groupDateStr === todayStr) {
        group.dateLabel = 'Hoje';
      } else if (groupDateStr === yesterdayStr) {
        group.dateLabel = 'Ontem';
      } else {
        group.dateLabel = groupDate.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'long'
        });
      }
    });

    // Credit card summary
    const [creditCards] = await db.query('SELECT id, name, limit_amount, closing_day, due_day FROM credit_cards WHERE user_id = ?', [userId]);
    const now = new Date();
    let creditCardSummary = {
      hasCards: false,
      currentInvoice: 0,
      totalLimit: 0,
      usedPercent: 0,
      progressPercent: 0,
      isRisk: false,
      nextClosingDate: null,
      nextDueDate: null
    };

    if (creditCards.length > 0) {
      const cardIds = creditCards.map((card) => card.id);
      const [monthlyTotals] = await db.query(
        `SELECT card_id, COALESCE(SUM(amount), 0) AS total
         FROM card_transactions
         WHERE card_id IN (?) AND YEAR(date) = ? AND MONTH(date) = ?
         GROUP BY card_id`,
        [cardIds, now.getFullYear(), now.getMonth() + 1]
      );

      const totalsByCard = new Map();
      monthlyTotals.forEach((row) => {
        totalsByCard.set(Number(row.card_id), parseFloat(row.total));
      });

      const totalLimit = creditCards.reduce((acc, card) => acc + parseFloat(card.limit_amount || 0), 0);
      const currentInvoice = creditCards.reduce((acc, card) => acc + (totalsByCard.get(Number(card.id)) || 0), 0);
      const usedPercent = totalLimit > 0 ? (currentInvoice / totalLimit) * 100 : 0;

      let nextClosingDate = null;
      let nextDueDate = null;

      creditCards.forEach((card) => {
        const closing = getNextOccurrence(card.closing_day, now);
        const due = getNextOccurrence(card.due_day, now);

        if (closing && (!nextClosingDate || closing < nextClosingDate)) {
          nextClosingDate = closing;
        }

        if (due && (!nextDueDate || due < nextDueDate)) {
          nextDueDate = due;
        }
      });

      creditCardSummary = {
        hasCards: true,
        currentInvoice,
        totalLimit,
        usedPercent,
        progressPercent: Math.min(100, usedPercent),
        isRisk: usedPercent >= 80,
        nextClosingDate,
        nextDueDate
      };
    }
    const dashboardCards = creditCards.map((card) => ({ id: card.id, name: card.name }));

    res.render('dashboard', {
      userName: req.session.userName,
      totalIncome: totalIncome.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      balance: balance.toFixed(2),
      transactionGroups,
      creditCardSummary,
      dashboardCards,
      expenseCategoryData,
      monthlyBalanceData
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('dashboard', {
      userName: req.session.userName || 'Usuario',
      totalIncome: '0.00',
      totalExpenses: '0.00',
      balance: '0.00',
      transactionGroups: [],
      creditCardSummary: {
        hasCards: false,
        currentInvoice: 0,
        totalLimit: 0,
        usedPercent: 0,
        progressPercent: 0,
        isRisk: false,
        nextClosingDate: null,
        nextDueDate: null
      },
      dashboardCards: [],
      expenseCategoryData: [],
      monthlyBalanceData: []
    });
  }
});

module.exports = router;
