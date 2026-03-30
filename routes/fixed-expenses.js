const express = require('express');
const db = require('../db');
const { parseCurrencyInput, isValidPositiveAmount } = require('../utils/currency');
const { ensureMonthlyFixedExpenses, parseMonthKey, getMonthKey } = require('../utils/monthly-fixed-expenses');

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

function getSelectedMonth(req) {
  const requested = req.query.month;
  const parsed = parseMonthKey(requested);
  if (parsed) {
    return {
      monthKey: requested,
      year: parsed.year,
      month: parsed.month
    };
  }
  const currentMonthKey = getMonthKey(new Date());
  const currentParsed = parseMonthKey(currentMonthKey);
  return {
    monthKey: currentMonthKey,
    year: currentParsed.year,
    month: currentParsed.month
  };
}

function monthLabel(year, month) {
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric'
  });
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

function normalizeStatusFilter(status) {
  const allowed = ['all', 'pendente', 'pago', 'atrasado'];
  return allowed.includes(status) ? status : 'all';
}

function buildFixedExpenseRedirect(month, status, extra = {}) {
  const params = new URLSearchParams();
  params.set('month', month || getMonthKey(new Date()));
  params.set('status', normalizeStatusFilter(status));
  Object.entries(extra).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/fixed-expenses?${params.toString()}`;
}

async function loadFixedExpensePageData(userId, monthKey, statusFilter) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new Error('Mes invalido');
  const { year, month } = parsed;

  try {
    await ensureMonthlyFixedExpenses(userId, monthKey);
  } catch (error) {
    console.warn('Could not ensure monthly fixed expenses:', error.message);
  }

  let fixedDefinitions = [];
  try {
    const [rows] = await db.query(
      `SELECT fe.*, c.name AS category_name
       FROM fixed_expenses fe
       LEFT JOIN categories c ON c.id = fe.category_id AND c.user_id = fe.user_id
       WHERE fe.user_id = ?
       ORDER BY fe.is_active DESC, fe.due_day ASC, fe.created_at DESC`,
      [userId]
    );
    fixedDefinitions = rows;
  } catch (error) {
    console.warn('Could not load fixed expense definitions:', error.message);
  }

  let monthlyExpensesAll = [];
  try {
    const [rows] = await db.query(
      `SELECT mfe.*, fe.description, fe.due_day, fe.is_active, c.name AS category_name
       FROM monthly_fixed_expenses mfe
       INNER JOIN fixed_expenses fe ON fe.id = mfe.fixed_expense_id
       LEFT JOIN categories c ON c.id = fe.category_id AND c.user_id = fe.user_id
       WHERE mfe.user_id = ? AND mfe.year = ? AND mfe.month = ?
       ORDER BY mfe.due_date ASC, fe.description ASC`,
      [userId, year, month]
    );
    monthlyExpensesAll = rows;
  } catch (error) {
    console.warn('Could not load monthly fixed expenses:', error.message);
  }

  let monthRows = [];
  try {
    const [rows] = await db.query(
      `SELECT CONCAT(year, '-', LPAD(month, 2, '0')) AS month_key
       FROM monthly_fixed_expenses
       WHERE user_id = ?
       GROUP BY year, month
       ORDER BY year DESC, month DESC`,
      [userId]
    );
    monthRows = rows;
  } catch (error) {
    console.warn('Could not load month options from monthly fixed expenses:', error.message);
  }

  const currentMonthKey = getMonthKey(new Date());
  const monthOptions = monthRows.map((row) => row.month_key).filter(Boolean);
  if (!monthOptions.includes(currentMonthKey)) monthOptions.unshift(currentMonthKey);
  if (!monthOptions.includes(monthKey)) monthOptions.unshift(monthKey);

  const monthlyExpensesByStatus = {
    atrasado: monthlyExpensesAll.filter((item) => item.status === 'atrasado'),
    pendente: monthlyExpensesAll.filter((item) => item.status === 'pendente'),
    pago: monthlyExpensesAll.filter((item) => item.status === 'pago')
  };
  const totalsByStatus = {
    atrasado: monthlyExpensesByStatus.atrasado.reduce((acc, item) => acc + Number(item.amount || 0), 0),
    pendente: monthlyExpensesByStatus.pendente.reduce((acc, item) => acc + Number(item.amount || 0), 0),
    pago: monthlyExpensesByStatus.pago.reduce((acc, item) => acc + Number(item.amount || 0), 0)
  };
  const filteredMonthlyExpenses = statusFilter === 'all'
    ? monthlyExpensesAll
    : monthlyExpensesByStatus[statusFilter] || [];

  return {
    fixedDefinitions,
    monthlyExpenses: filteredMonthlyExpenses,
    monthlyExpensesAll,
    monthlyExpensesByStatus,
    totalsByStatus,
    monthOptions,
    selectedMonth: monthKey,
    selectedMonthLabel: monthLabel(year, month),
    selectedStatus: statusFilter
  };
}

router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const selected = getSelectedMonth(req);
  const selectedStatus = normalizeStatusFilter(req.query.status);
  const feedbackErrorMap = {
    missing_amount: 'Defina um valor maior que zero antes de marcar como pago.'
  };
  const feedbackSuccessMap = {
    paid: 'Conta marcada como paga com sucesso.',
    reopened: 'Conta reaberta com sucesso.',
    value_updated: 'Valor atualizado com sucesso.'
  };
  const feedbackError = feedbackErrorMap[req.query.error] || null;
  const feedbackSuccess = feedbackSuccessMap[req.query.success] || null;

  try {
    const data = await loadFixedExpensePageData(userId, selected.monthKey, selectedStatus);
    renderWithBase(res, {
      data: {
        ...data,
        error: feedbackError,
        success: feedbackSuccess
      }
    });
  } catch (error) {
    console.error(error);
    renderWithBase(res, {
      data: {
        fixedDefinitions: [],
        monthlyExpenses: [],
        monthlyExpensesAll: [],
        monthlyExpensesByStatus: { atrasado: [], pendente: [], pago: [] },
        totalsByStatus: { atrasado: 0, pendente: 0, pago: 0 },
        monthOptions: [selected.monthKey],
        selectedMonth: selected.monthKey,
        selectedMonthLabel: monthLabel(selected.year, selected.month),
        selectedStatus,
        error: feedbackError || 'Erro ao carregar despesas fixas',
        success: feedbackSuccess
      }
    });
  }
});

router.get('/add', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  try {
    const categories = await getExpenseCategories(userId);
    renderWithBase(res, {
      title: 'Nova Despesa Fixa - RC2 Finance',
      content: 'partials/pages/add-fixed-expense-content',
      data: { error: null, categories, formData: {} }
    });
  } catch (error) {
    console.error(error);
    renderWithBase(res, {
      title: 'Nova Despesa Fixa - RC2 Finance',
      content: 'partials/pages/add-fixed-expense-content',
      data: { error: 'Erro ao carregar categorias', categories: [], formData: {} }
    });
  }
});

router.post('/add', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { description, amount, category_id, due_day, is_active } = req.body;
  const dueDay = parseInt(due_day, 10);
  const active = is_active === '1' ? 1 : 0;
  const categoryId = category_id ? parseInt(category_id, 10) : null;
  const normalizedDescription = (description || '').trim();
  const hasAmount = String(amount || '').trim() !== '';
  const parsedAmount = hasAmount ? parseCurrencyInput(amount) : null;

  if (!normalizedDescription || !dueDay || dueDay < 1 || dueDay > 31 || (hasAmount && !isValidPositiveAmount(parsedAmount))) {
    const categories = await getExpenseCategories(userId).catch(() => []);
    return renderWithBase(res, {
      title: 'Nova Despesa Fixa - RC2 Finance',
      content: 'partials/pages/add-fixed-expense-content',
      data: {
        error: !normalizedDescription
          ? 'Descricao e obrigatoria'
          : (!dueDay || dueDay < 1 || dueDay > 31)
            ? 'Dia de vencimento deve estar entre 1 e 31'
            : 'Informe um valor valido maior que zero',
        categories,
        formData: req.body
      }
    });
  }

  try {
    const validCategory = await isValidExpenseCategory(userId, Number.isNaN(categoryId) ? null : categoryId);
    if (!validCategory) {
      const categories = await getExpenseCategories(userId).catch(() => []);
      return renderWithBase(res, {
        title: 'Nova Despesa Fixa - RC2 Finance',
        content: 'partials/pages/add-fixed-expense-content',
        data: { error: 'Categoria invalida', categories, formData: req.body }
      });
    }

    await db.query(
      'INSERT INTO fixed_expenses (user_id, description, amount, category_id, due_day, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, normalizedDescription, hasAmount ? parsedAmount : null, Number.isNaN(categoryId) ? null : categoryId, dueDay, active]
    );

    return res.redirect('/fixed-expenses');
  } catch (error) {
    console.error(error);
    const categories = await getExpenseCategories(userId).catch(() => []);
    return renderWithBase(res, {
      title: 'Nova Despesa Fixa - RC2 Finance',
      content: 'partials/pages/add-fixed-expense-content',
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
  const normalizedDescription = (description || '').trim();
  const hasAmount = String(amount || '').trim() !== '';
  const parsedAmount = hasAmount ? parseCurrencyInput(amount) : null;

  if (!normalizedDescription || !dueDay || dueDay < 1 || dueDay > 31 || (hasAmount && !isValidPositiveAmount(parsedAmount))) {
    const [expenses] = await db.query('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?', [expenseId, userId]);
    const categories = await getExpenseCategories(userId).catch(() => []);
    return renderWithBase(res, {
      title: 'Editar Despesa Fixa - RC2 Finance',
      content: 'partials/pages/edit-fixed-expense-content',
      data: {
        expense: { ...(expenses[0] || {}), ...req.body, id: expenseId },
        categories,
        error: !normalizedDescription
          ? 'Descricao e obrigatoria'
          : (!dueDay || dueDay < 1 || dueDay > 31)
            ? 'Dia de vencimento deve estar entre 1 e 31'
            : 'Informe um valor valido maior que zero'
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
      [normalizedDescription, hasAmount ? parsedAmount : null, Number.isNaN(categoryId) ? null : categoryId, dueDay, active, expenseId, userId]
    );

    return res.redirect('/fixed-expenses');
  } catch (error) {
    console.error(error);
    const [expenses] = await db.query('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?', [expenseId, userId]);
    const categories = await getExpenseCategories(userId).catch(() => []);
    return renderWithBase(res, {
      title: 'Editar Despesa Fixa - RC2 Finance',
      content: 'partials/pages/edit-fixed-expense-content',
      data: { expense: expenses[0], categories, error: 'Erro ao editar despesa fixa' }
    });
  }
});

router.post('/monthly/:id/value', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const monthlyId = req.params.id;
  const { amount, month, status } = req.body;
  const parsedAmount = parseCurrencyInput(amount);

  if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
    return res.redirect(buildFixedExpenseRedirect(month, status));
  }

  try {
    await db.query(
      'UPDATE monthly_fixed_expenses SET amount = ? WHERE id = ? AND user_id = ?',
      [parsedAmount, monthlyId, userId]
    );
  } catch (error) {
    console.error(error);
  }

  return res.redirect(buildFixedExpenseRedirect(month, status, { success: 'value_updated' }));
});

router.post('/monthly/:id/pay', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const monthlyId = req.params.id;
  const { month, status, amount } = req.body;

  try {
    const [rows] = await db.query(
      'SELECT amount FROM monthly_fixed_expenses WHERE id = ? AND user_id = ? LIMIT 1',
      [monthlyId, userId]
    );
    const monthlyExpense = rows[0];
    const hasAmountInput = typeof amount !== 'undefined' && String(amount).trim() !== '';
    const parsedInputAmount = hasAmountInput ? parseCurrencyInput(amount) : null;
    const numericAmount = hasAmountInput
      ? parsedInputAmount
      : parseFloat((monthlyExpense && monthlyExpense.amount) || 0);
    if (!monthlyExpense || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.redirect(buildFixedExpenseRedirect(month, status, { error: 'missing_amount' }));
    }

    if (hasAmountInput) {
      await db.query(
        'UPDATE monthly_fixed_expenses SET amount = ? WHERE id = ? AND user_id = ?',
        [numericAmount, monthlyId, userId]
      );
    }

    await db.query(
      `UPDATE monthly_fixed_expenses
       SET status = 'pago', payment_date = CURDATE()
       WHERE id = ? AND user_id = ?`,
      [monthlyId, userId]
    );
  } catch (error) {
    console.error(error);
  }

  return res.redirect(buildFixedExpenseRedirect(month, status, { success: 'paid' }));
});

router.post('/monthly/:id/reopen', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const monthlyId = req.params.id;
  const { month, status } = req.body;

  try {
    await db.query(
      `UPDATE monthly_fixed_expenses
       SET status = CASE WHEN due_date < CURDATE() THEN 'atrasado' ELSE 'pendente' END,
           payment_date = NULL
       WHERE id = ? AND user_id = ?`,
      [monthlyId, userId]
    );
  } catch (error) {
    console.error(error);
  }

  return res.redirect(buildFixedExpenseRedirect(month, status, { success: 'reopened' }));
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
