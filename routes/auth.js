const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { ensureMonthlyFixedExpenses, markOverdueMonthlyExpenses } = require('../utils/monthly-fixed-expenses');

const router = express.Router();
const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Moradia', color: '#8B5CF6' },
  { name: 'Alimentacao', color: '#10B981' },
  { name: 'Transporte', color: '#3B82F6' },
  { name: 'Lazer', color: '#F59E0B' },
  { name: 'Saude', color: '#EF4444' },
  { name: 'Educacao', color: '#6366F1' },
  { name: 'Impostos', color: '#EC4899' }
];
const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Salario', color: '#14B8A6' },
  { name: 'Extra', color: '#22C55E' },
  { name: 'Michele', color: '#06B6D4' },
  { name: 'Forex', color: '#F59E0B' }
];

async function createDefaultCategoriesForUser(userId) {
  for (const category of DEFAULT_EXPENSE_CATEGORIES) {
    await db.query(
      `INSERT INTO categories (user_id, name, type, color)
       VALUES (?, ?, 'expense', ?)
       ON DUPLICATE KEY UPDATE color = VALUES(color)`,
      [userId, category.name, category.color]
    );
  }

  for (const category of DEFAULT_INCOME_CATEGORIES) {
    await db.query(
      `INSERT INTO categories (user_id, name, type, color)
       VALUES (?, ?, 'income', ?)
       ON DUPLICATE KEY UPDATE color = VALUES(color)`,
      [userId, category.name, category.color]
    );
  }
}

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

function isValidMonthKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
}

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

// GET /register
router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

// POST /register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedName = (name || '').trim();
  const normalizedEmail = (email || '').trim().toLowerCase();

  try {
    const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existingUser.length > 0) {
      return res.render('register', { error: 'Email ja cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'user')",
      [normalizedName, normalizedEmail, hashedPassword]
    );

    try {
      await createDefaultCategoriesForUser(result.insertId);
    } catch (categoryError) {
      console.warn('Categories table unavailable during register. Run: npm run init-categories');
    }

    return res.redirect('/login');
  } catch (error) {
    console.error(error);
    return res.render('register', { error: 'Erro ao cadastrar usuario' });
  }
});

// GET /login
router.get('/login', (req, res) => {
  res.render('login', { error: null, email: '' });
});

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = (email || '').trim().toLowerCase();

  try {
    const [users] = await db.query('SELECT id, name, password_hash, role FROM users WHERE email = ?', [normalizedEmail]);
    if (users.length === 0) {
      return res.render('login', { error: 'Email ou senha invalidos', email: (email || '').trim() });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.render('login', { error: 'Email ou senha invalidos', email: (email || '').trim() });
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userRole = user.role || 'user';
    req.session.user = {
      id: user.id,
      name: user.name,
      role: user.role || 'user'
    };

    if (req.session.userRole === 'admin') {
      return res.redirect('/admin');
    }

    return res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    return res.render('login', { error: 'Erro ao fazer login', email: (email || '').trim() });
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
    if (req.session.userRole === 'admin') {
      return res.redirect('/admin');
    }

    const userId = req.session.userId;
    const toastType = req.query.toast;
    const highlightedTransactionId = Number.parseInt(req.query.tx, 10);
    const requestedMonth = req.query.month;
    const now = new Date();
    const currentMonthKey = getMonthKey(now);
    const selectedMonth = isValidMonthKey(requestedMonth) ? requestedMonth : currentMonthKey;
    const [selectedYear, selectedMonthNumber] = selectedMonth.split('-').map(Number);
    const startDate = `${selectedMonth}-01`;
    const endDate = new Date(selectedYear, selectedMonthNumber, 0).toISOString().split('T')[0];

    const toastByType = {
      created: 'Transacao criada com sucesso',
      updated: 'Transacao atualizada com sucesso'
    };
    const dashboardToast = toastByType[toastType] || null;
    const selectedMonthLabel = new Date(selectedYear, selectedMonthNumber - 1, 1).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric'
    });

    try {
      const nextMonthKey = getMonthKey(new Date(now.getFullYear(), now.getMonth() + 1, 1));
      const monthsToEnsure = Array.from(new Set([selectedMonth, currentMonthKey, nextMonthKey]));
      for (const monthKey of monthsToEnsure) {
        await ensureMonthlyFixedExpenses(userId, monthKey);
      }
      await markOverdueMonthlyExpenses(userId);
    } catch (ensureError) {
      console.warn('Monthly fixed expenses unavailable for dashboard. Run: npm run init-fixed-expenses');
    }

    const [transactions] = await db.query(
      `SELECT t.*, c.name AS category_name, c.color AS category_color
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.date BETWEEN ? AND ?
       ORDER BY t.date DESC`,
      [userId, startDate, endDate]
    );

    let fixedTransactions = [];
    try {
      const [fixedExpenseRows] = await db.query(
        `SELECT mfe.id, mfe.amount, mfe.due_date, mfe.status,
                fe.id AS fixed_id, fe.description, fe.category_id,
                c.name AS category_name, c.color AS category_color
         FROM monthly_fixed_expenses mfe
         INNER JOIN fixed_expenses fe ON fe.id = mfe.fixed_expense_id
         LEFT JOIN categories c ON c.id = fe.category_id AND c.user_id = fe.user_id
         WHERE mfe.user_id = ? AND mfe.year = ? AND mfe.month = ?`,
        [userId, selectedYear, selectedMonthNumber]
      );

      fixedTransactions = fixedExpenseRows.map((expense) => ({
        id: `fixed-${expense.id}`,
        source: 'fixed_expense',
        description: expense.description,
        amount: parseFloat(expense.amount || 0),
        type: 'expense',
        date: expense.due_date,
        category_id: expense.category_id,
        category_name: expense.category_name || 'Sem categoria',
        category_color: expense.category_color || '#00C9A7',
        payment_method: 'fixed',
        is_recurring: 1,
        fixed_status: expense.status
      }));
    } catch (fixedTxError) {
      console.warn('Fixed monthly expenses unavailable for dashboard transaction list. Run: npm run init-fixed-expenses');
      fixedTransactions = [];
    }

    const monthTransactions = [...transactions, ...fixedTransactions].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );

    const [monthRows] = await db.query(
      `SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') AS month_key
       FROM transactions
       WHERE user_id = ?
       ORDER BY month_key DESC`,
      [userId]
    );
    let monthOptions = monthRows.map((row) => row.month_key).filter(Boolean);

    try {
      const [fixedMonthRows] = await db.query(
        `SELECT CONCAT(year, '-', LPAD(month, 2, '0')) AS month_key
         FROM monthly_fixed_expenses
         WHERE user_id = ?
         GROUP BY year, month
         ORDER BY year DESC, month DESC`,
        [userId]
      );
      const fixedMonths = fixedMonthRows.map((row) => row.month_key).filter(Boolean);
      monthOptions = Array.from(new Set([...monthOptions, ...fixedMonths])).sort().reverse();
    } catch (monthError) {
      console.warn('Monthly fixed expenses unavailable for month options.');
    }

    if (!monthOptions.includes(currentMonthKey)) monthOptions.unshift(currentMonthKey);
    if (!monthOptions.includes(selectedMonth)) monthOptions.unshift(selectedMonth);

    let totalIncome = 0;
    let totalExpenses = 0;

    transactions.forEach((transaction) => {
      if (transaction.type === 'income') {
        totalIncome += parseFloat(transaction.amount);
      } else if (transaction.type === 'expense') {
        totalExpenses += parseFloat(transaction.amount);
      }
    });

    let totalFixedExpenses = 0;
    let pendingFixedExpenses = 0;
    try {
      const [fixedExpenseRows] = await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM monthly_fixed_expenses
         WHERE user_id = ? AND year = ? AND month = ?`,
        [userId, selectedYear, selectedMonthNumber]
      );
      totalFixedExpenses = parseFloat((fixedExpenseRows[0] && fixedExpenseRows[0].total) || 0);

      const [pendingFixedRows] = await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM monthly_fixed_expenses
         WHERE user_id = ? AND year = ? AND month = ? AND status IN ('pendente', 'atrasado')`,
        [userId, selectedYear, selectedMonthNumber]
      );
      pendingFixedExpenses = parseFloat((pendingFixedRows[0] && pendingFixedRows[0].total) || 0);
    } catch (fixedError) {
      console.warn('Fixed monthly expenses table unavailable. Run: npm run init-fixed-expenses');
      totalFixedExpenses = 0;
      pendingFixedExpenses = 0;
    }

    let overdueAccounts = [];
    let upcomingDueAccounts = [];
    try {
      const [overdueRows] = await db.query(
        `SELECT mfe.id, mfe.amount, mfe.due_date, mfe.status, fe.description,
                DATEDIFF(CURDATE(), mfe.due_date) AS overdue_days
         FROM monthly_fixed_expenses mfe
         INNER JOIN fixed_expenses fe ON fe.id = mfe.fixed_expense_id
         WHERE mfe.user_id = ? AND mfe.status = 'atrasado'
         ORDER BY mfe.due_date ASC
         LIMIT 6`,
        [userId]
      );
      overdueAccounts = overdueRows.map((row) => ({
        id: row.id,
        description: row.description,
        amount: parseFloat(row.amount || 0),
        dueDate: row.due_date,
        status: row.status,
        overdueDays: Number(row.overdue_days || 0)
      }));

      const [upcomingRows] = await db.query(
        `SELECT mfe.id, mfe.amount, mfe.due_date, mfe.status, fe.description,
                DATEDIFF(mfe.due_date, CURDATE()) AS days_to_due
         FROM monthly_fixed_expenses mfe
         INNER JOIN fixed_expenses fe ON fe.id = mfe.fixed_expense_id
         WHERE mfe.user_id = ?
           AND mfe.status = 'pendente'
           AND mfe.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
         ORDER BY mfe.due_date ASC
         LIMIT 6`,
        [userId]
      );
      upcomingDueAccounts = upcomingRows.map((row) => ({
        id: row.id,
        description: row.description,
        amount: parseFloat(row.amount || 0),
        dueDate: row.due_date,
        status: row.status,
        daysToDue: Number(row.days_to_due || 0)
      }));
    } catch (fixedStatusError) {
      console.warn('Monthly fixed expenses unavailable for overdue/upcoming lists.');
      overdueAccounts = [];
      upcomingDueAccounts = [];
    }

    const projectionWindowStartDate = new Date(selectedYear, selectedMonthNumber - 3, 1);
    const projectionWindowStart = `${projectionWindowStartDate.getFullYear()}-${String(projectionWindowStartDate.getMonth() + 1).padStart(2, '0')}-01`;
    const [variableRows] = await db.query(
      `SELECT DATE_FORMAT(date, '%Y-%m') AS month_key, COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE user_id = ? AND type = 'expense' AND date BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(date, '%Y-%m')
       ORDER BY month_key DESC`,
      [userId, projectionWindowStart, endDate]
    );

    const recentVariableRows = variableRows.slice(0, 3);
    const averageVariableExpenses = recentVariableRows.length > 0
      ? recentVariableRows.reduce((sum, row) => sum + parseFloat(row.total || 0), 0) / recentVariableRows.length
      : 0;

    const estimatedTotalMonthExpense = pendingFixedExpenses + averageVariableExpenses;
    const projectedBalance = totalIncome - estimatedTotalMonthExpense;
    const monthlyProjection = {
      fixedExpenses: pendingFixedExpenses,
      totalFixedExpenses,
      averageVariableExpenses,
      estimatedTotalMonthExpense,
      projectedBalance,
      isPositive: projectedBalance >= 0
    };

    const totalExpensesWithFixed = totalExpenses + totalFixedExpenses;
    const balance = totalIncome - totalExpensesWithFixed;

    const previousMonthDate = new Date(selectedYear, selectedMonthNumber - 2, 1);
    const previousMonthKey = getMonthKey(previousMonthDate);
    const previousStartDate = `${previousMonthKey}-01`;
    const previousEndDate = new Date(
      previousMonthDate.getFullYear(),
      previousMonthDate.getMonth() + 1,
      0
    ).toISOString().split('T')[0];

    const [previousTotals] = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ? AND date BETWEEN ? AND ?`,
      [userId, previousStartDate, previousEndDate]
    );

    const previousIncome = parseFloat((previousTotals[0] && previousTotals[0].income) || 0);
    const previousVariableExpenses = parseFloat((previousTotals[0] && previousTotals[0].expense) || 0);

    let previousFixedExpenses = 0;
    try {
      const [previousFixedRows] = await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM monthly_fixed_expenses
         WHERE user_id = ? AND year = ? AND month = ?`,
        [userId, previousMonthDate.getFullYear(), previousMonthDate.getMonth() + 1]
      );
      previousFixedExpenses = parseFloat((previousFixedRows[0] && previousFixedRows[0].total) || 0);
    } catch (previousFixedError) {
      previousFixedExpenses = 0;
    }

    const previousExpenses = previousVariableExpenses + previousFixedExpenses;
    const expenseDelta = totalExpensesWithFixed - previousExpenses;

    let expenseVariationPercent = 0;
    if (previousExpenses > 0) {
      expenseVariationPercent = (expenseDelta / previousExpenses) * 100;
    } else if (totalExpensesWithFixed > 0) {
      expenseVariationPercent = 100;
    }

    const financialInsight = {
      isHealthy: totalExpensesWithFixed <= totalIncome,
      message: totalExpensesWithFixed <= totalIncome
        ? 'Voce esta dentro do seu planejamento'
        : 'Atencao: voce esta gastando mais do que ganha',
      currentExpenses: totalExpensesWithFixed,
      previousExpenses,
      expenseVariationPercent,
      expenseVariationDirection: expenseDelta > 0 ? 'up' : (expenseDelta < 0 ? 'down' : 'stable'),
      previousMonthLabel: new Date(previousMonthDate.getFullYear(), previousMonthDate.getMonth(), 1).toLocaleDateString('pt-BR', {
        month: 'long',
        year: 'numeric'
      })
    };

    const expenseCategoryMap = new Map();
    monthTransactions.forEach((transaction) => {
      if (transaction.type !== 'expense') return;
      const categoryName = (transaction.category_name || 'Sem categoria').trim() || 'Sem categoria';
      const categoryColor = transaction.category_color || '#00C9A7';
      const current = expenseCategoryMap.get(categoryName) || { total: 0, color: categoryColor };
      current.total += parseFloat(transaction.amount || 0);
      if (!current.color && categoryColor) current.color = categoryColor;
      expenseCategoryMap.set(categoryName, current);
    });

    const expenseCategoryReport = Array.from(expenseCategoryMap.entries())
      .map(([name, info]) => ({
        name,
        total: info.total,
        color: info.color || '#00C9A7',
        percentage: totalExpensesWithFixed > 0 ? (info.total / totalExpensesWithFixed) * 100 : 0
      }))
      .sort((a, b) => b.total - a.total);

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

    try {
      const [fixedMonthlyRows] = await db.query(
        `SELECT CONCAT(year, '-', LPAD(month, 2, '0')) AS month_key, COALESCE(SUM(amount), 0) AS total
         FROM monthly_fixed_expenses
         WHERE user_id = ?
         GROUP BY year, month`,
        [userId]
      );
      fixedMonthlyRows.forEach((row) => {
        const key = row.month_key;
        const bucket = monthlyMap.get(key) || { income: 0, expense: 0 };
        bucket.expense += parseFloat(row.total || 0);
        monthlyMap.set(key, bucket);
      });
    } catch (monthlyFixedBalanceError) {
      console.warn('Monthly fixed expenses unavailable for balance chart.');
    }

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

    const groupedTransactions = {};
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    monthTransactions.forEach((transaction) => {
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
        groupedTransactions[dateKey].totalIncome += parseFloat(transaction.amount || 0);
      } else if (transaction.type === 'expense') {
        groupedTransactions[dateKey].totalExpenses += parseFloat(transaction.amount || 0);
      }
    });

    const transactionGroups = Object.values(groupedTransactions).sort((a, b) => b.date - a.date);

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

    const [creditCards] = await db.query('SELECT id, name, limit_amount, closing_day, due_day FROM credit_cards WHERE user_id = ?', [userId]);
    let creditCardSummary = {
      hasCards: false,
      currentInvoice: 0,
      totalLimit: 0,
      availableLimit: 0,
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
         WHERE card_id IN (?) AND date BETWEEN ? AND ?
         GROUP BY card_id`,
        [cardIds, startDate, endDate]
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
        availableLimit: Math.max(totalLimit - currentInvoice, 0),
        usedPercent,
        progressPercent: Math.min(100, usedPercent),
        isRisk: usedPercent >= 80,
        nextClosingDate,
        nextDueDate
      };
    }

    const dashboardCards = creditCards.map((card) => ({ id: card.id, name: card.name }));

    return res.render('dashboard', {
      userName: req.session.userName,
      totalIncome: totalIncome.toFixed(2),
      totalExpenses: totalExpensesWithFixed.toFixed(2),
      totalFixedExpenses: totalFixedExpenses.toFixed(2),
      monthlyProjection,
      balance: balance.toFixed(2),
      financialInsight,
      selectedMonth,
      selectedMonthLabel,
      monthOptions,
      transactionGroups,
      dashboardToast,
      highlightedTransactionId: Number.isNaN(highlightedTransactionId) ? null : highlightedTransactionId,
      creditCardSummary,
      dashboardCards,
      expenseCategoryReport,
      monthlyBalanceData,
      overdueAccounts,
      upcomingDueAccounts
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.render('dashboard', {
      userName: req.session.userName || 'Usuario',
      totalIncome: '0.00',
      totalExpenses: '0.00',
      totalFixedExpenses: '0.00',
      monthlyProjection: {
        fixedExpenses: 0,
        averageVariableExpenses: 0,
        estimatedTotalMonthExpense: 0,
        projectedBalance: 0,
        isPositive: true
      },
      balance: '0.00',
      selectedMonth: null,
      selectedMonthLabel: '',
      monthOptions: [],
      transactionGroups: [],
      dashboardToast: null,
      highlightedTransactionId: null,
      creditCardSummary: {
        hasCards: false,
        currentInvoice: 0,
        totalLimit: 0,
        availableLimit: 0,
        usedPercent: 0,
        progressPercent: 0,
        isRisk: false,
        nextClosingDate: null,
        nextDueDate: null
      },
      dashboardCards: [],
      financialInsight: {
        isHealthy: true,
        message: 'Voce esta dentro do seu planejamento',
        currentExpenses: 0,
        previousExpenses: 0,
        expenseVariationPercent: 0,
        expenseVariationDirection: 'stable',
        previousMonthLabel: ''
      },
      expenseCategoryReport: [],
      monthlyBalanceData: [],
      overdueAccounts: [],
      upcomingDueAccounts: []
    });
  }
});

module.exports = router;




