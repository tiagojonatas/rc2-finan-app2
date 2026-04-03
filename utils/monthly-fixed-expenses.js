const db = require('../db');
const {
  getMonthKey,
  parseMonthKey,
  getDaysInMonth,
  buildDate,
  todayDate
} = require('./datetime');

function buildDueDate(year, month, dueDay) {
  const safeDay = Math.min(Math.max(Number(dueDay) || 1, 1), getDaysInMonth(year, month));
  return buildDate(year, month, safeDay);
}

async function ensureMonthlyFixedExpenses(userId, monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new Error('Invalid month key');
  const { year, month } = parsed;
  const todayKey = getMonthKey();
  const today = todayDate();

  const [activeFixed] = await db.query(
    `SELECT id, due_day, amount, created_at
     FROM fixed_expenses
     WHERE user_id = ? AND is_active = 1`,
    [userId]
  );

  for (const fixed of activeFixed) {
    const createdKey = getMonthKey(fixed.created_at);
    if (createdKey > monthKey) continue;

    const dueDate = buildDueDate(year, month, fixed.due_day);
    const initialStatus = monthKey < todayKey && dueDate < today ? 'atrasado' : 'pendente';

    await db.query(
      `INSERT INTO monthly_fixed_expenses
       (fixed_expense_id, user_id, month, year, amount, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         amount = monthly_fixed_expenses.amount`,
      [fixed.id, userId, month, year, fixed.amount === null ? 0 : Number(fixed.amount), dueDate, initialStatus]
    );
  }

  await db.query(
    `UPDATE monthly_fixed_expenses
     SET status = 'atrasado'
     WHERE user_id = ?
       AND month = ?
       AND year = ?
       AND status = 'pendente'
       AND due_date < ?`,
    [userId, month, year, today]
  );
}

async function markOverdueMonthlyExpenses(userId) {
  await db.query(
    `UPDATE monthly_fixed_expenses
     SET status = 'atrasado'
     WHERE user_id = ?
       AND status = 'pendente'
       AND due_date < ?`,
    [userId, todayDate()]
  );
}

module.exports = {
  ensureMonthlyFixedExpenses,
  markOverdueMonthlyExpenses,
  parseMonthKey,
  getMonthKey
};
