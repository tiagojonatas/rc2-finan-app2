const express = require('express');
const db = require('../db');
const { ensureMonthlyFixedExpenses } = require('../utils/monthly-fixed-expenses');
const {
  getMonthKey,
  isValidMonthKey,
  nowInTz,
  getMonthStart,
  getMonthEnd,
  getMonthLabel,
  getMonthShortLabel
} = require('../utils/datetime');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  return res.redirect('/login');
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const requestedMonth = req.query.month;
    const currentMonthKey = getMonthKey(nowInTz());
    const selectedMonth = isValidMonthKey(requestedMonth) ? requestedMonth : currentMonthKey;
    const isFutureMonth = selectedMonth > currentMonthKey;
    const parsedMonth = selectedMonth.split('-').map(Number);
    const selectedYear = parsedMonth[0];
    const selectedMonthNumber = parsedMonth[1];
    const startDate = getMonthStart(selectedMonth);
    const endDate = getMonthEnd(selectedMonth);
    const selectedMonthLabel = getMonthLabel(selectedMonth);

    try {
      await ensureMonthlyFixedExpenses(userId, selectedMonth);
    } catch (ensureError) {
      console.warn('Monthly fixed expenses unavailable for reports. Run: npm run init-fixed-expenses');
    }

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
    } catch (fixedMonthError) {
      console.warn('Monthly fixed expenses unavailable for report month options.');
    }

    if (!monthOptions.includes(currentMonthKey)) monthOptions.unshift(currentMonthKey);
    if (!monthOptions.includes(selectedMonth)) monthOptions.unshift(selectedMonth);

    const [transactions] = await db.query(
      `SELECT t.*, c.name AS category_name, c.color AS category_color
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.date BETWEEN ? AND ?
       ORDER BY t.date DESC`,
      [userId, startDate, endDate]
    );

    let fixedExpenses = [];
    try {
      const [fixedRows] = await db.query(
        `SELECT mfe.amount, c.name AS category_name, c.color AS category_color
         FROM monthly_fixed_expenses mfe
         INNER JOIN fixed_expenses fe ON fe.id = mfe.fixed_expense_id
         LEFT JOIN categories c ON c.id = fe.category_id AND c.user_id = fe.user_id
         WHERE mfe.user_id = ? AND mfe.year = ? AND mfe.month = ?`,
        [userId, selectedYear, selectedMonthNumber]
      );
      fixedExpenses = fixedRows.map((row) => ({
        type: 'expense',
        amount: parseFloat(row.amount || 0),
        category_name: row.category_name || 'Sem categoria',
        category_color: row.category_color || '#00C9A7'
      }));
    } catch (fixedErr) {
      console.warn('Monthly fixed expenses unavailable for reports. Run: npm run init-fixed-expenses');
      fixedExpenses = [];
    }

    let totalExpenses = 0;
    const expenseCategoryMap = new Map();
    const expenseSources = [...transactions, ...fixedExpenses];

    expenseSources.forEach((transaction) => {
      if (transaction.type !== 'expense') return;

      const amount = parseFloat(transaction.amount || 0);
      totalExpenses += amount;
      const categoryName = (transaction.category_name || 'Sem categoria').trim() || 'Sem categoria';
      const categoryColor = transaction.category_color || '#00C9A7';
      const current = expenseCategoryMap.get(categoryName) || { total: 0, color: categoryColor };
      current.total += amount;
      if (!current.color && categoryColor) current.color = categoryColor;
      expenseCategoryMap.set(categoryName, current);
    });

    const expenseCategoryReport = Array.from(expenseCategoryMap.entries())
      .map(([name, info]) => ({
        name,
        total: info.total,
        color: info.color || '#00C9A7',
        percentage: totalExpenses > 0 ? (info.total / totalExpenses) * 100 : 0
      }))
      .sort((a, b) => b.total - a.total);

    const [monthlyRows] = await db.query(
      `SELECT DATE_FORMAT(date, '%Y-%m') AS month_key,
              SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income_total,
              SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense_total
       FROM transactions
       WHERE user_id = ? AND COALESCE(affects_balance, 1) = 1
       GROUP BY DATE_FORMAT(date, '%Y-%m')
       ORDER BY month_key ASC`,
      [userId]
    );

    const monthlyMap = new Map();
    monthlyRows.forEach((row) => {
      monthlyMap.set(row.month_key, {
        income: parseFloat(row.income_total || 0),
        expense: parseFloat(row.expense_total || 0)
      });
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
        const bucket = monthlyMap.get(row.month_key) || { income: 0, expense: 0 };
        bucket.expense += parseFloat(row.total || 0);
        monthlyMap.set(row.month_key, bucket);
      });
    } catch (fixedMonthlyError) {
      console.warn('Monthly fixed expenses unavailable for reports balance chart.');
    }

    const monthlyBalanceData = Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([monthKey, values]) => ({
        label: getMonthShortLabel(monthKey),
        balance: values.income - values.expense
      }));

    return res.render('reports', {
      selectedMonth,
      selectedMonthLabel,
      isFutureMonth,
      monthOptions,
      expenseCategoryReport,
      monthlyBalanceData,
      totalExpenses: totalExpenses.toFixed(2)
    });
  } catch (error) {
    console.error('Reports error:', error);
    return res.render('reports', {
      selectedMonth: null,
      selectedMonthLabel: '',
      isFutureMonth: false,
      monthOptions: [],
      expenseCategoryReport: [],
      monthlyBalanceData: [],
      totalExpenses: '0.00'
    });
  }
});

module.exports = router;
