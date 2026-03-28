const express = require('express');
const db = require('../db');
const router = express.Router();

function renderWithBase(res, options = {}) {
  const {
    title = 'Despesas Fixas - RC2 Finance',
    content = 'partials/pages/fixed-expenses-content',
    currentPath = '/fixed-expenses',
    data = {}
  } = options;

  return res.render('base', {
    title,
    content,
    currentPath,
    ...data
  });
}

function requireAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  try {
    const [expenses] = await db.query(
      'SELECT * FROM fixed_expenses WHERE user_id = ? ORDER BY is_active DESC, due_day ASC, created_at DESC',
      [userId]
    );
    renderWithBase(res, {
      title: 'Despesas Fixas - RC2 Finance',
      content: 'partials/pages/fixed-expenses-content',
      currentPath: '/fixed-expenses',
      data: { expenses, error: null, success: null }
    });
  } catch (error) {
    console.error(error);
    renderWithBase(res, {
      title: 'Despesas Fixas - RC2 Finance',
      content: 'partials/pages/fixed-expenses-content',
      currentPath: '/fixed-expenses',
      data: { expenses: [], error: 'Erro ao carregar despesas fixas', success: null }
    });
  }
});

router.get('/add', requireAuth, (req, res) => {
  renderWithBase(res, {
    title: 'Nova Despesa Fixa - RC2 Finance',
    content: 'partials/pages/add-fixed-expense-content',
    currentPath: '/fixed-expenses',
    data: { error: null }
  });
});

router.post('/add', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { description, amount, category_id, due_day, is_active } = req.body;
  const dueDay = parseInt(due_day, 10);
  const active = is_active === '1' ? 1 : 0;
  const categoryId = category_id ? parseInt(category_id, 10) : null;

  if (!dueDay || dueDay < 1 || dueDay > 31) {
    return renderWithBase(res, {
      title: 'Nova Despesa Fixa - RC2 Finance',
      content: 'partials/pages/add-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { error: 'Dia de vencimento deve estar entre 1 e 31' }
    });
  }

  try {
    await db.query(
      'INSERT INTO fixed_expenses (user_id, description, amount, category_id, due_day, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, description, parseFloat(amount), Number.isNaN(categoryId) ? null : categoryId, dueDay, active]
    );
    res.redirect('/fixed-expenses');
  } catch (error) {
    console.error(error);
    renderWithBase(res, {
      title: 'Nova Despesa Fixa - RC2 Finance',
      content: 'partials/pages/add-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { error: 'Erro ao cadastrar despesa fixa' }
    });
  }
});

router.get('/edit/:id', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const expenseId = req.params.id;

  try {
    const [expenses] = await db.query('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?', [expenseId, userId]);
    if (expenses.length === 0) {
      return res.redirect('/fixed-expenses');
    }
    return renderWithBase(res, {
      title: 'Editar Despesa Fixa - RC2 Finance',
      content: 'partials/pages/edit-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { expense: expenses[0], error: null }
    });
  } catch (error) {
    console.error(error);
    return res.redirect('/fixed-expenses');
  }
});

router.post('/edit/:id', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const expenseId = req.params.id;
  const { description, amount, category_id, due_day, is_active } = req.body;
  const dueDay = parseInt(due_day, 10);
  const active = is_active === '1' ? 1 : 0;
  const categoryId = category_id ? parseInt(category_id, 10) : null;

  if (!dueDay || dueDay < 1 || dueDay > 31) {
    const [expenses] = await db.query('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?', [expenseId, userId]);
    return renderWithBase(res, {
      title: 'Editar Despesa Fixa - RC2 Finance',
      content: 'partials/pages/edit-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { expense: expenses[0], error: 'Dia de vencimento deve estar entre 1 e 31' }
    });
  }

  try {
    await db.query(
      `UPDATE fixed_expenses
       SET description = ?, amount = ?, category_id = ?, due_day = ?, is_active = ?
       WHERE id = ? AND user_id = ?`,
      [description, parseFloat(amount), Number.isNaN(categoryId) ? null : categoryId, dueDay, active, expenseId, userId]
    );
    res.redirect('/fixed-expenses');
  } catch (error) {
    console.error(error);
    const [expenses] = await db.query('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?', [expenseId, userId]);
    renderWithBase(res, {
      title: 'Editar Despesa Fixa - RC2 Finance',
      content: 'partials/pages/edit-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { expense: expenses[0], error: 'Erro ao editar despesa fixa' }
    });
  }
});

router.post('/delete/:id', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const expenseId = req.params.id;
  try {
    await db.query('DELETE FROM fixed_expenses WHERE id = ? AND user_id = ?', [expenseId, userId]);
    res.redirect('/fixed-expenses');
  } catch (error) {
    console.error(error);
    res.redirect('/fixed-expenses');
  }
});

module.exports = router;
