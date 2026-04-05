const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { ensureMonthlyFixedExpenses, markOverdueMonthlyExpenses } = require('../utils/monthly-fixed-expenses');
const { nowInTz, toTzDate, getDateKey, getMonthKey, isValidMonthKey, getMonthStart, getMonthEnd, getMonthLabel, getMonthShortLabel, addMonths, fromParts } = require('../utils/datetime');

const router = express.Router();
const LAST_LOGIN_EMAIL_COOKIE = 'lastLoginEmail';
const isProduction = process.env.NODE_ENV === 'production';
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
const MAX_MONTH_FILTER_OPTIONS = 18;

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
  return getDateKey(date);
}

function getNextOccurrence(dayOfMonth, baseDate) {
  const targetDay = Number(dayOfMonth);
  if (!Number.isFinite(targetDay) || targetDay < 1) return null;

  let year = baseDate.year();
  let month = baseDate.month() + 1;
  let day = Math.min(targetDay, fromParts(year, month, 1).daysInMonth());
  let candidate = fromParts(year, month, day);

  if (candidate.isBefore(baseDate, 'day')) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    day = Math.min(targetDay, fromParts(year, month, 1).daysInMonth());
    candidate = fromParts(year, month, day);
  }

  return candidate.toDate();
}

function getCookieValue(req, key) {
  const rawCookie = req.headers && req.headers.cookie ? req.headers.cookie : '';
  if (!rawCookie) return '';

  const parts = rawCookie.split(';');
  for (const part of parts) {
    const [cookieKey, ...rest] = part.trim().split('=');
    if (cookieKey === key) {
      return decodeURIComponent(rest.join('=') || '');
    }
  }

  return '';
}

function setLastLoginEmailCookie(res, email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) return;
  res.cookie(LAST_LOGIN_EMAIL_COOKIE, normalizedEmail, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}

function normalizeMonthOptions(monthOptions, selectedMonth, currentMonth, maxItems = MAX_MONTH_FILTER_OPTIONS) {
  const uniqueSorted = Array.from(new Set((monthOptions || []).filter(Boolean))).sort().reverse();
  const [currentYear, currentMonthNumber] = String(currentMonth || '').split('-').map(Number);
  const currentIndex = (currentYear * 12) + currentMonthNumber;

  const filtered = uniqueSorted.filter((monthKey) => {
    const [year, month] = String(monthKey || '').split('-').map(Number);
    if (!year || !month) return false;
    const monthIndex = (year * 12) + month;
    return monthIndex >= (currentIndex - 6) && monthIndex <= (currentIndex + 12);
  });

  const topItems = filtered.slice(0, maxItems);

  if (selectedMonth && !topItems.includes(selectedMonth)) {
    topItems.push(selectedMonth);
  }

  if (currentMonth && !topItems.includes(currentMonth)) {
    topItems.push(currentMonth);
  }

  return Array.from(new Set(topItems)).sort().reverse();
}

function removeOutliers(values) {
  if (!Array.isArray(values) || values.length < 3) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - (1.5 * iqr);
  const upperBound = q3 + (1.5 * iqr);
  const filtered = values.filter((value) => value >= lowerBound && value <= upperBound);
  return filtered.length ? filtered : values;
}

function getAverageFromRecentValidMonths(variableRows) {
  const validRows = (variableRows || [])
    .map((row) => parseFloat(row.total || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 3);

  if (!validRows.length) return 0;
  const valuesForAverage = removeOutliers(validRows);
  return valuesForAverage.reduce((sum, value) => sum + value, 0) / valuesForAverage.length;
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
  const rememberedEmail = getCookieValue(req, LAST_LOGIN_EMAIL_COOKIE);
  res.render('login', { error: null, email: rememberedEmail || '' });
});

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = (email || '').trim().toLowerCase();
  setLastLoginEmailCookie(res, normalizedEmail);

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
    req.session.userEmail = normalizedEmail;
    req.session.userRole = user.role || 'user';
    req.session.user = {
      id: user.id,
      name: user.name,
      email: normalizedEmail,
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
  setLastLoginEmailCookie(res, req.session && req.session.user ? req.session.user.email : '');
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
    const now = nowInTz();
    const currentMonthKey = getMonthKey(now);
    const todayDate = getDateKey(now);
    const selectedMonth = isValidMonthKey(requestedMonth) ? requestedMonth : currentMonthKey;
    const isFutureMonth = selectedMonth > currentMonthKey;
    const [selectedYear, selectedMonthNumber] = selectedMonth.split('-').map(Number);
    const startDate = getMonthStart(selectedMonth);
    const endDate = getMonthEnd(selectedMonth);

    const toastByType = {
      created: 'Transacao criada com sucesso',
      updated: 'Transacao atualizada com sucesso'
    };
    const dashboardToast = toastByType[toastType] || null;
    const selectedMonthLabel = getMonthLabel(selectedMonth);

    try {
      const nextMonthKey = getMonthKey(addMonths(now, 1));
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
        installment_total: 1,
        installment_number: 1,
        parent_transaction_id: null,
        is_future: getDateKey(expense.due_date) > todayDate,
        fixed_status: expense.status
      }));
    } catch (fixedTxError) {
      console.warn('Fixed monthly expenses unavailable for dashboard transaction list. Run: npm run init-fixed-expenses');
      fixedTransactions = [];
    }

    const normalizedTransactions = transactions.map((transaction) => ({
      ...transaction,
      is_future: getDateKey(transaction.date) > todayDate
    }));
    const realTransactions = normalizedTransactions.filter((transaction) => Number(transaction.affects_balance ?? 1) === 1);

    const monthTransactions = [...realTransactions, ...fixedTransactions].sort(
      (a, b) => toTzDate(b.date).valueOf() - toTzDate(a.date).valueOf()
    );

    const [monthRows] = await db.query(
      `SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') AS month_key
       FROM transactions
       WHERE user_id = ? AND COALESCE(affects_balance, 1) = 1
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

    monthOptions = normalizeMonthOptions(monthOptions, selectedMonth, currentMonthKey);

    let totalIncome = 0;
    let totalExpenses = 0;
    let totalIncomeForBalance = 0;
    let totalExpensesForBalance = 0;

    realTransactions.forEach((transaction) => {
      const amount = parseFloat(transaction.amount || 0);

      if (transaction.type === 'income') {
        totalIncome += amount;
        totalIncomeForBalance += amount;
      } else if (transaction.type === 'expense') {
        totalExpenses += amount;
        totalExpensesForBalance += amount;
      }
    });

    let totalFixedExpenses = 0;
    let pendingFixedExpenses = 0;
    let paidFixedExpenses = 0;
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

      const [paidFixedRows] = await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM monthly_fixed_expenses
         WHERE user_id = ? AND year = ? AND month = ? AND status = 'pago'`,
        [userId, selectedYear, selectedMonthNumber]
      );
      paidFixedExpenses = parseFloat((paidFixedRows[0] && paidFixedRows[0].total) || 0);
    } catch (fixedError) {
      console.warn('Fixed monthly expenses table unavailable. Run: npm run init-fixed-expenses');
      totalFixedExpenses = 0;
      pendingFixedExpenses = 0;
      paidFixedExpenses = 0;
    }

    let overdueAccounts = [];
    let upcomingDueAccounts = [];
    try {
      const [overdueRows] = await db.query(
        `SELECT mfe.id, mfe.amount, mfe.due_date, mfe.status, fe.description,
                DATEDIFF(?, mfe.due_date) AS overdue_days
         FROM monthly_fixed_expenses mfe
         INNER JOIN fixed_expenses fe ON fe.id = mfe.fixed_expense_id
         WHERE mfe.user_id = ? AND mfe.status = 'atrasado'
         ORDER BY mfe.due_date ASC
         LIMIT 6`,
        [todayDate, userId]
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
                DATEDIFF(mfe.due_date, ?) AS days_to_due
         FROM monthly_fixed_expenses mfe
         INNER JOIN fixed_expenses fe ON fe.id = mfe.fixed_expense_id
         WHERE mfe.user_id = ?
           AND mfe.status = 'pendente'
           AND mfe.due_date BETWEEN ? AND DATE_ADD(?, INTERVAL 3 DAY)
         ORDER BY mfe.due_date ASC
         LIMIT 6`,
        [todayDate, userId, todayDate, todayDate]
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

    const projectionWindowStart = addMonths(fromParts(selectedYear, selectedMonthNumber, 1), -12).format('YYYY-MM-DD');
    const [variableRows] = await db.query(
      `SELECT DATE_FORMAT(date, '%Y-%m') AS month_key, COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE user_id = ? AND type = 'expense' AND COALESCE(affects_balance, 1) = 1 AND date BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(date, '%Y-%m')
       ORDER BY month_key DESC`,
      [userId, projectionWindowStart, endDate]
    );

    let averageVariableExpenses = getAverageFromRecentValidMonths(variableRows);

    const hasCurrentMonthMovement = realTransactions.length > 0 || fixedTransactions.length > 0;
    if (!hasCurrentMonthMovement) {
      averageVariableExpenses = 0;
    }

    const realCommittedExpenses = totalExpensesForBalance + totalFixedExpenses;
    let realProjectedBalance = totalIncomeForBalance - realCommittedExpenses;
    const historicalEstimatedExpense = totalFixedExpenses + averageVariableExpenses;
    let historicalEstimatedBalance = totalIncomeForBalance - historicalEstimatedExpense;
    const shouldResetProjection = totalIncomeForBalance === 0
      && totalExpensesForBalance === 0
      && totalFixedExpenses === 0
      && pendingFixedExpenses === 0;

    let finalPendingFixedProjection = pendingFixedExpenses;
    let finalTotalFixedProjection = totalFixedExpenses;
    let finalAverageVariableProjection = averageVariableExpenses;
    let finalRealCommittedExpenses = realCommittedExpenses;
    let finalHistoricalEstimatedExpense = historicalEstimatedExpense;

    if (shouldResetProjection) {
      realProjectedBalance = 0;
      historicalEstimatedBalance = 0;
      finalPendingFixedProjection = 0;
      finalTotalFixedProjection = 0;
      finalAverageVariableProjection = 0;
      finalRealCommittedExpenses = 0;
      finalHistoricalEstimatedExpense = 0;
    }

    const monthlyProjection = {
      pendingFixedExpenses: finalPendingFixedProjection,
      totalFixedExpenses: finalTotalFixedProjection,
      averageVariableExpenses: finalAverageVariableProjection,
      realCommittedExpenses: finalRealCommittedExpenses,
      realProjectedBalance,
      historicalEstimatedExpense: finalHistoricalEstimatedExpense,
      historicalEstimatedBalance,
      isRealPositive: realProjectedBalance >= 0,
      isHistoricalPositive: historicalEstimatedBalance >= 0
    };

    const totalExpensesWithFixed = totalExpenses + totalFixedExpenses;
    const totalExpensesForBalanceWithFixed = totalExpensesForBalance + totalFixedExpenses;
    const balance = totalIncomeForBalance - totalExpensesForBalance;

    let realizedIncome = 0;
    let realizedExpenses = 0;
    let futureExpenseCommitments = 0;
    let installmentCommitments = 0;

    realTransactions.forEach((transaction) => {
      const amount = parseFloat(transaction.amount || 0);
      const transactionDateKey = getDateKey(transaction.date);
      const isFutureTransaction = transactionDateKey > todayDate;

      if (transaction.type === 'income' && !isFutureTransaction) {
        realizedIncome += amount;
      }

      if (transaction.type === 'expense') {
        if (!isFutureTransaction) {
          realizedExpenses += amount;
        } else {
          futureExpenseCommitments += amount;
        }

        if (Number(transaction.installment_total || 1) > 1) {
          installmentCommitments += amount;
        }
      }
    });

    const realizedExpensesWithFixed = realizedExpenses + paidFixedExpenses;
    const futureCommitments = futureExpenseCommitments + pendingFixedExpenses;
    const totalCommittedMonth = realizedExpensesWithFixed + futureCommitments;
    const currentRealBalance = balance;
    const projectedRealBalanceValue = Number(monthlyProjection && monthlyProjection.realProjectedBalance ? monthlyProjection.realProjectedBalance : 0);
    const estimatedHistoricalBalanceValue = Number(monthlyProjection && monthlyProjection.historicalEstimatedBalance ? monthlyProjection.historicalEstimatedBalance : 0);
    const financialBreakdown = {
      realizedExpenses: realizedExpensesWithFixed,
      futureCommitments,
      installmentCommitments,
      totalCommittedMonth,
      currentRealBalance,
      projectedRealBalance: projectedRealBalanceValue,
      estimatedHistoricalBalance: estimatedHistoricalBalanceValue
    };

    const previousMonthDate = addMonths(fromParts(selectedYear, selectedMonthNumber, 1), -1);
    const previousMonthKey = getMonthKey(previousMonthDate);
    const previousStartDate = getMonthStart(previousMonthKey);
    const previousEndDate = getMonthEnd(previousMonthKey);

    const [previousTotals] = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE user_id = ? AND COALESCE(affects_balance, 1) = 1 AND date BETWEEN ? AND ?`,
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
        [userId, Number(previousMonthKey.split('-')[0]), Number(previousMonthKey.split('-')[1])]
      );
      previousFixedExpenses = parseFloat((previousFixedRows[0] && previousFixedRows[0].total) || 0);
    } catch (previousFixedError) {
      previousFixedExpenses = 0;
    }

    const previousExpenses = previousVariableExpenses + previousFixedExpenses;
    const expenseDelta = totalExpensesForBalanceWithFixed - previousExpenses;

    let expenseVariationPercent = 0;
    if (previousExpenses > 0) {
      expenseVariationPercent = (expenseDelta / previousExpenses) * 100;
    } else if (totalExpensesForBalanceWithFixed > 0) {
      expenseVariationPercent = 100;
    }

    const financialInsight = {
      isHealthy: totalExpensesForBalanceWithFixed <= totalIncomeForBalance,
      message: totalExpensesForBalanceWithFixed <= totalIncomeForBalance
        ? 'Voce esta dentro do seu planejamento'
        : 'Atencao: voce esta gastando mais do que ganha',
      currentExpenses: totalExpensesForBalanceWithFixed,
      previousExpenses,
      expenseVariationPercent,
      expenseVariationDirection: expenseDelta > 0 ? 'up' : (expenseDelta < 0 ? 'down' : 'stable'),
      previousMonthLabel: getMonthLabel(previousMonthKey)
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
    realTransactions.forEach((transaction) => {
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
      const monthLabel = getMonthShortLabel(key);
      const bucket = monthlyMap.get(key) || { income: 0, expense: 0 };
      return {
        label: monthLabel,
        balance: bucket.income - bucket.expense
      };
    });

    const groupedTransactions = {};
    const today = nowInTz();
    const yesterday = today.subtract(1, 'day');

    monthTransactions.forEach((transaction) => {
      const transactionDate = transaction.date;
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
        const [year, month, day] = groupDateStr.split('-').map(Number);
        group.dateLabel = fromParts(year, month, day).format('DD [de] MMMM');
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
      nextDueDate: null,
      cards: []
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

      const cards = creditCards.map((card) => {
        const limitAmount = parseFloat(card.limit_amount || 0);
        const usedAmount = totalsByCard.get(Number(card.id)) || 0;
        const availableAmount = Math.max(limitAmount - usedAmount, 0);
        const usedPercentByCard = limitAmount > 0 ? (usedAmount / limitAmount) * 100 : 0;
        return {
          id: Number(card.id),
          name: card.name,
          limitAmount,
          usedAmount,
          availableAmount,
          usedPercent: usedPercentByCard,
          progressPercent: Math.max(0, Math.min(100, usedPercentByCard)),
          isRisk: usedPercentByCard >= 80,
          closingDay: Number(card.closing_day || 0),
          dueDay: Number(card.due_day || 0),
          nextClosingDate: getNextOccurrence(card.closing_day, now),
          nextDueDate: getNextOccurrence(card.due_day, now)
        };
      });

      const totalLimit = creditCards.reduce((acc, card) => acc + parseFloat(card.limit_amount || 0), 0);
      const currentInvoice = creditCards.reduce((acc, card) => acc + (totalsByCard.get(Number(card.id)) || 0), 0);
      const usedPercent = totalLimit > 0 ? (currentInvoice / totalLimit) * 100 : 0;

      let nextClosingDate = null;
      let nextDueDate = null;

      cards.forEach((card) => {
        const closing = card.nextClosingDate;
        const due = card.nextDueDate;

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
        isRisk: usedPercent >= 80 || cards.some((card) => card.isRisk),
        nextClosingDate,
        nextDueDate,
        cards
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
      isFutureMonth,
      monthOptions,
      transactionGroups,
      dashboardToast,
      highlightedTransactionId: Number.isNaN(highlightedTransactionId) ? null : highlightedTransactionId,
      creditCardSummary,
      dashboardCards,
      expenseCategoryReport,
      monthlyBalanceData,
      overdueAccounts,
      upcomingDueAccounts,
      financialBreakdown
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.render('dashboard', {
      userName: req.session.userName || 'Usuario',
      totalIncome: '0.00',
      totalExpenses: '0.00',
      totalFixedExpenses: '0.00',
      monthlyProjection: {
        pendingFixedExpenses: 0,
        totalFixedExpenses: 0,
        averageVariableExpenses: 0,
        realCommittedExpenses: 0,
        realProjectedBalance: 0,
        historicalEstimatedExpense: 0,
        historicalEstimatedBalance: 0,
        isRealPositive: true,
        isHistoricalPositive: true
      },
      balance: '0.00',
      selectedMonth: null,
      selectedMonthLabel: '',
      isFutureMonth: false,
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
        nextDueDate: null,
        cards: []
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
      upcomingDueAccounts: [],
      financialBreakdown: {
        realizedExpenses: 0,
        futureCommitments: 0,
        installmentCommitments: 0,
        totalCommittedMonth: 0,
        currentRealBalance: 0,
        projectedRealBalance: 0,
        estimatedHistoricalBalance: 0
      }
    });
  }
});

router.get('/analysis', requireAuth, async (req, res) => {
  try {
    if (req.session.userRole === 'admin') {
      return res.redirect('/admin');
    }

    const userId = req.session.userId;
    const requestedMonth = req.query.month;
    const now = nowInTz();
    const currentMonthKey = getMonthKey(now);
    const selectedMonth = isValidMonthKey(requestedMonth) ? requestedMonth : currentMonthKey;
    const isFutureMonth = selectedMonth > currentMonthKey;
    const startDate = getMonthStart(selectedMonth);
    const endDate = getMonthEnd(selectedMonth);
    const selectedMonthLabel = getMonthLabel(selectedMonth);
    const todayStr = getDateKey(now);
    const yesterdayStr = getDateKey(now.subtract(1, 'day'));

    const [transactions] = await db.query(
      `SELECT t.*, c.name AS category_name, c.color AS category_color
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ?
         AND t.date BETWEEN ? AND ?
         AND COALESCE(t.affects_balance, 1) = 0
       ORDER BY t.date DESC, t.id DESC`,
      [userId, startDate, endDate]
    );

    const [monthRows] = await db.query(
      `SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') AS month_key
       FROM transactions
       WHERE user_id = ?
         AND COALESCE(affects_balance, 1) = 0
       ORDER BY month_key DESC`,
      [userId]
    );
    const monthOptions = normalizeMonthOptions(
      monthRows.map((row) => row.month_key).filter(Boolean),
      selectedMonth,
      currentMonthKey
    );

    const normalizedTransactions = transactions.map((transaction) => ({
      ...transaction,
      is_future: getDateKey(transaction.date) > getDateKey(now)
    }));

    let totalAnalysisExpenses = 0;
    let creditInvoiceTotal = 0;
    let debitTotal = 0;
    let cashTotal = 0;
    let installmentTotal = 0;

    const categoryMap = new Map();
    normalizedTransactions.forEach((transaction) => {
      const amount = parseFloat(transaction.amount || 0);
      if (transaction.type === 'expense') {
        totalAnalysisExpenses += amount;
      }

      if (transaction.payment_method === 'credit') {
        creditInvoiceTotal += amount;
      } else if (transaction.payment_method === 'debit') {
        debitTotal += amount;
      } else {
        cashTotal += amount;
      }

      if (Number(transaction.installment_total || 1) > 1) {
        installmentTotal += amount;
      }

      const categoryName = (transaction.category_name || 'Sem categoria').trim() || 'Sem categoria';
      const categoryColor = transaction.category_color || '#00C9A7';
      const current = categoryMap.get(categoryName) || { total: 0, color: categoryColor };
      current.total += amount;
      if (!current.color && categoryColor) current.color = categoryColor;
      categoryMap.set(categoryName, current);
    });

    const categoryReport = Array.from(categoryMap.entries())
      .map(([name, info]) => ({
        name,
        total: info.total,
        color: info.color || '#00C9A7',
        percentage: totalAnalysisExpenses > 0 ? (info.total / totalAnalysisExpenses) * 100 : 0
      }))
      .sort((a, b) => b.total - a.total);

    const groupedTransactions = {};
    normalizedTransactions.forEach((transaction) => {
      const dateKey = getDateKey(transaction.date);
      if (!groupedTransactions[dateKey]) {
        groupedTransactions[dateKey] = {
          date: transaction.date,
          dateLabel: '',
          transactions: [],
          total: 0
        };
      }

      groupedTransactions[dateKey].transactions.push(transaction);
      groupedTransactions[dateKey].total += parseFloat(transaction.amount || 0);
    });

    const transactionGroups = Object.values(groupedTransactions).sort((a, b) => b.date - a.date);
    transactionGroups.forEach((group) => {
      const groupDateKey = getDateKey(group.date);
      if (groupDateKey === todayStr) {
        group.dateLabel = 'Hoje';
        return;
      }
      if (groupDateKey === yesterdayStr) {
        group.dateLabel = 'Ontem';
        return;
      }
      const [year, month, day] = groupDateKey.split('-').map(Number);
      group.dateLabel = fromParts(year, month, day).format('DD [de] MMMM');
    });

    return res.render('analysis', {
      userName: req.session.userName,
      selectedMonth,
      selectedMonthLabel,
      monthOptions,
      isFutureMonth,
      analysisSummary: {
        totalAnalysisExpenses,
        creditInvoiceTotal,
        debitTotal,
        cashTotal,
        installmentTotal,
        transactionsCount: normalizedTransactions.length
      },
      analysisCategoryReport: categoryReport,
      analysisTransactionGroups: transactionGroups
    });
  } catch (error) {
    console.error('Analysis page error:', error);
    return res.render('analysis', {
      userName: req.session.userName || 'Usuario',
      selectedMonth: null,
      selectedMonthLabel: '',
      monthOptions: [],
      isFutureMonth: false,
      analysisSummary: {
        totalAnalysisExpenses: 0,
        creditInvoiceTotal: 0,
        debitTotal: 0,
        cashTotal: 0,
        installmentTotal: 0,
        transactionsCount: 0
      },
      analysisCategoryReport: [],
      analysisTransactionGroups: []
    });
  }
});

module.exports = router;








