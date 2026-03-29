const db = require('../db');

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function buildDueDate(year, month, dueDay) {
  const safeDay = Math.min(Math.max(Number(dueDay) || 1, 1), getDaysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

function parseMonthKey(monthKey) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthKey || '');
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function getMonthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function ensureMonthlyFixedExpenses(userId, monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new Error('Invalid month key');
  const { year, month } = parsed;
  const today = new Date();
  const todayKey = getMonthKey(today);

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
    const initialStatus = monthKey < todayKey && dueDate < today.toISOString().slice(0, 10) ? 'atrasado' : 'pendente';

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
       AND due_date < CURDATE()`,
    [userId, month, year]
  );
}

module.exports = {
  ensureMonthlyFixedExpenses,
  parseMonthKey,
  getMonthKey
};
