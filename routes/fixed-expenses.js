const express = require('express');
const db = require('../db');
const { parseCurrencyInput, isValidPositiveAmount } = require('../utils/currency');
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

async function getExpenseCategories(userId) {
  const [categories] = await db.query(
    "SELECT id, name FROM categories WHERE user_id = ? AND type = 'expense' AND name <> 'Outros' ORDER BY name ASC",
    [userId]
  );
  return categories;
}

async function isValidExpenseCategory(userId, categoryId) {
  if (!categoryId) return true;
  const [rows] = await db.query(
    "SELECT id FROM categories WHERE id = ? AND user_id = ? AND type = 'expense' AND name <> 'Outros' LIMIT 1",
    [categoryId, userId]
  );
  return rows.length > 0;
}

router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  try {
    const [expenses] = await db.query(
      `SELECT fe.*, c.name AS category_name
       FROM fixed_expenses fe
       LEFT JOIN categories c ON c.id = fe.category_id AND c.user_id = fe.user_id
       WHERE fe.user_id = ?
       ORDER BY fe.is_active DESC, fe.due_day ASC, fe.created_at DESC`,
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
  const userId = req.session.userId;
  getExpenseCategories(userId)
    .then((categories) => renderWithBase(res, {
      title: 'Nova Despesa Fixa - RC2 Finance',
      content: 'partials/pages/add-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { error: null, categories, formData: {} }
    }))
    .catch((error) => {
      console.error(error);
      renderWithBase(res, {
        title: 'Nova Despesa Fixa - RC2 Finance',
        content: 'partials/pages/add-fixed-expense-content',
        currentPath: '/fixed-expenses',
        data: { error: 'Erro ao carregar categorias', categories: [], formData: {} }
      });
    });
});

router.post('/add', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { description, amount, category_id, due_day, is_active } = req.body;
  const dueDay = parseInt(due_day, 10);
  const active = is_active === '1' ? 1 : 0;
  const categoryId = category_id ? parseInt(category_id, 10) : null;
  const parsedAmount = parseCurrencyInput(amount);

  if (!dueDay || dueDay < 1 || dueDay > 31 || !isValidPositiveAmount(parsedAmount)) {
    const categories = await getExpenseCategories(userId).catch(() => []);
    const errorMessage = !isValidPositiveAmount(parsedAmount)
      ? 'Informe um valor valido maior que zero'
      : 'Dia de vencimento deve estar entre 1 e 31';
    return renderWithBase(res, {
      title: 'Nova Despesa Fixa - RC2 Finance',
      content: 'partials/pages/add-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { error: errorMessage, categories, formData: req.body }
    });
  }

  try {
    const validCategory = await isValidExpenseCategory(userId, Number.isNaN(categoryId) ? null : categoryId);
    if (!validCategory) {
      const categories = await getExpenseCategories(userId).catch(() => []);
      return renderWithBase(res, {
        title: 'Nova Despesa Fixa - RC2 Finance',
        content: 'partials/pages/add-fixed-expense-content',
        currentPath: '/fixed-expenses',
        data: { error: 'Categoria invalida', categories, formData: req.body }
      });
    }

    await db.query(
      'INSERT INTO fixed_expenses (user_id, description, amount, category_id, due_day, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, description, parsedAmount, Number.isNaN(categoryId) ? null : categoryId, dueDay, active]
    );
    res.redirect('/fixed-expenses');
  } catch (error) {
    console.error(error);
    const categories = await getExpenseCategories(userId).catch(() => []);
    renderWithBase(res, {
      title: 'Nova Despesa Fixa - RC2 Finance',
      content: 'partials/pages/add-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { error: 'Erro ao cadastrar despesa fixa', categories, formData: req.body }
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
    const categories = await getExpenseCategories(userId);
    return renderWithBase(res, {
      title: 'Editar Despesa Fixa - RC2 Finance',
      content: 'partials/pages/edit-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { expense: expenses[0], categories, error: null }
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
  const parsedAmount = parseCurrencyInput(amount);

  if (!dueDay || dueDay < 1 || dueDay > 31 || !isValidPositiveAmount(parsedAmount)) {
    const [expenses] = await db.query('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?', [expenseId, userId]);
    const categories = await getExpenseCategories(userId).catch(() => []);
    const errorMessage = !isValidPositiveAmount(parsedAmount)
      ? 'Informe um valor valido maior que zero'
      : 'Dia de vencimento deve estar entre 1 e 31';
    return renderWithBase(res, {
      title: 'Editar Despesa Fixa - RC2 Finance',
      content: 'partials/pages/edit-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: {
        expense: { ...(expenses[0] || {}), ...req.body, id: expenseId },
        categories,
        error: errorMessage
      }
    });
  }

  try {
    const validCategory = await isValidExpenseCategory(userId, Number.isNaN(categoryId) ? null : categoryId);
    if (!validCategory) {
      const [expenses] = await db.query('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?', [expenseId, userId]);
      const categories = await getExpenseCategories(userId).catch(() => []);
      return renderWithBase(res, {
        title: 'Editar Despesa Fixa - RC2 Finance',
        content: 'partials/pages/edit-fixed-expense-content',
        currentPath: '/fixed-expenses',
        data: {
          expense: { ...(expenses[0] || {}), ...req.body, id: expenseId },
          categories,
          error: 'Categoria invalida'
        }
      });
    }

    await db.query(
      `UPDATE fixed_expenses
       SET description = ?, amount = ?, category_id = ?, due_day = ?, is_active = ?
       WHERE id = ? AND user_id = ?`,
      [description, parsedAmount, Number.isNaN(categoryId) ? null : categoryId, dueDay, active, expenseId, userId]
    );
    res.redirect('/fixed-expenses');
  } catch (error) {
    console.error(error);
    const [expenses] = await db.query('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?', [expenseId, userId]);
    const categories = await getExpenseCategories(userId).catch(() => []);
    renderWithBase(res, {
      title: 'Editar Despesa Fixa - RC2 Finance',
      content: 'partials/pages/edit-fixed-expense-content',
      currentPath: '/fixed-expenses',
      data: { expense: expenses[0], categories, error: 'Erro ao editar despesa fixa' }
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
