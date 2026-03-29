const express = require('express');
const db = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  return res.redirect('/login');
}

function getMonthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isValidMonthKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const requestedMonth = req.query.month;
    const now = new Date();
    const currentMonthKey = getMonthKey(now);
    const selectedMonth = isValidMonthKey(requestedMonth) ? requestedMonth : currentMonthKey;
    const [selectedYear, selectedMonthNumber] = selectedMonth.split('-').map(Number);
    const startDate = `${selectedMonth}-01`;
    const endDate = new Date(selectedYear, selectedMonthNumber, 0).toISOString().split('T')[0];
    const selectedMonthLabel = new Date(selectedYear, selectedMonthNumber - 1, 1).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric'
    });

    const [monthRows] = await db.query(
      `SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') AS month_key
       FROM transactions
       WHERE user_id = ?
       ORDER BY month_key DESC`,
      [userId]
    );
    const monthOptions = monthRows.map((row) => row.month_key).filter(Boolean);
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
        `SELECT fe.id, fe.amount, fe.created_at, c.name AS category_name, c.color AS category_color
         FROM fixed_expenses fe
         LEFT JOIN categories c ON c.id = fe.category_id AND c.user_id = fe.user_id
         WHERE fe.user_id = ? AND fe.is_active = 1 AND DATE(fe.created_at) <= ?`,
        [userId, endDate]
      );
      fixedExpenses = fixedRows.map((row) => ({
        type: 'expense',
        amount: parseFloat(row.amount || 0),
        category_name: row.category_name || 'Sem categoria',
        category_color: row.category_color || '#00C9A7'
      }));
    } catch (fixedErr) {
      console.warn('Fixed expenses unavailable for reports. Run: npm run init-fixed-expenses');
      fixedExpenses = [];
    }

    let totalExpenses = 0;
    const expenseCategoryMap = new Map();
    const expenseSources = [
      ...transactions,
      ...fixedExpenses
    ];

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
       WHERE user_id = ?
       GROUP BY DATE_FORMAT(date, '%Y-%m')
       ORDER BY month_key ASC`,
      [userId]
    );

    const monthlyBalanceData = monthlyRows.slice(-12).map((row) => {
      const [year, month] = row.month_key.split('-');
      const monthDate = new Date(Number(year), Number(month) - 1, 1);
      const monthLabel = monthDate.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      return {
        label: monthLabel,
        balance: parseFloat(row.income_total || 0) - parseFloat(row.expense_total || 0)
      };
    });

    return res.render('reports', {
      selectedMonth,
      selectedMonthLabel,
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
      monthOptions: [],
      expenseCategoryReport: [],
      monthlyBalanceData: [],
      totalExpenses: '0.00'
    });
  }
});

module.exports = router;

