const express = require('express');
const db = require('../db');
const { parseCurrencyInput, isValidPositiveAmount } = require('../utils/currency');
const router = express.Router();

function renderWithBase(res, options = {}) {
  const {
    title = 'Transacoes - RC2 Finance',
    content = 'partials/pages/add-transaction-content',
    currentPath = '/dashboard',
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

async function getUserCategories(userId) {
  const [categories] = await db.query(
    "SELECT id, name, type, color FROM categories WHERE user_id = ? AND name <> 'Outros' ORDER BY type ASC, name ASC",
    [userId]
  );
  return categories;
}

async function isValidCategory(userId, categoryId, type) {
  const [rows] = await db.query(
    "SELECT id FROM categories WHERE id = ? AND user_id = ? AND type = ? AND name <> 'Outros' LIMIT 1",
    [categoryId, userId, type]
  );
  return rows.length > 0;
}

function normalizePaymentMethod(paymentMethod) {
  const validMethods = ['cash', 'debit', 'credit'];
  return validMethods.includes(paymentMethod) ? paymentMethod : 'cash';
}

function normalizeRecurringFlag(recurringValue, transactionType) {
  if (transactionType !== 'expense') return 0;
  return recurringValue === 'on' || recurringValue === '1' || recurringValue === 1 || recurringValue === true ? 1 : 0;
}

router.get('/add', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const requestedType = req.query.type;
  const defaultType = requestedType === 'income' || requestedType === 'expense' ? requestedType : 'expense';

  try {
    const categories = await getUserCategories(userId);
    return renderWithBase(res, {
      title: 'Nova Transacao - RC2 Finance',
      content: 'partials/pages/add-transaction-content',
      currentPath: '/dashboard',
      data: {
        error: null,
        defaultType,
        categories,
        formData: { type: defaultType, payment_method: 'cash', is_recurring: 0 }
      }
    });
  } catch (error) {
    console.error(error);
    return renderWithBase(res, {
      title: 'Nova Transacao - RC2 Finance',
      content: 'partials/pages/add-transaction-content',
      currentPath: '/dashboard',
      data: {
        error: 'Erro ao carregar categorias. Execute: npm run init-categories',
        defaultType,
        categories: [],
        formData: { type: defaultType, payment_method: 'cash', is_recurring: 0 }
      }
    });
  }
});

router.post('/add', requireAuth, async (req, res) => {
  const { description, amount, type, date, category_id, payment_method, is_recurring } = req.body;
  const userId = req.session.userId;
  const defaultType = type === 'income' || type === 'expense' ? type : 'expense';
  const categoryId = parseInt(category_id, 10);
  const parsedAmount = parseCurrencyInput(amount);
  const normalizedPaymentMethod = normalizePaymentMethod(payment_method);
  const normalizedRecurring = normalizeRecurringFlag(is_recurring, defaultType);

  try {
    const categories = await getUserCategories(userId);

    if (!category_id || Number.isNaN(categoryId)) {
      return renderWithBase(res, {
        title: 'Nova Transacao - RC2 Finance',
        content: 'partials/pages/add-transaction-content',
        currentPath: '/dashboard',
        data: {
          error: 'Categoria e obrigatoria',
          defaultType,
          categories,
          formData: req.body
        }
      });
    }

    if (!isValidPositiveAmount(parsedAmount)) {
      return renderWithBase(res, {
        title: 'Nova Transacao - RC2 Finance',
        content: 'partials/pages/add-transaction-content',
        currentPath: '/dashboard',
        data: {
          error: 'Informe um valor valido maior que zero',
          defaultType,
          categories,
          formData: req.body
        }
      });
    }

    const validCategory = await isValidCategory(userId, categoryId, defaultType);
    if (!validCategory) {
      return renderWithBase(res, {
        title: 'Nova Transacao - RC2 Finance',
        content: 'partials/pages/add-transaction-content',
        currentPath: '/dashboard',
        data: {
          error: 'Categoria invalida para o tipo selecionado',
          defaultType,
          categories,
          formData: req.body
        }
      });
    }

    const [result] = await db.query(
      `INSERT INTO transactions
       (user_id, description, amount, type, date, category_id, payment_method, is_recurring)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, description, parsedAmount, defaultType, date, categoryId, normalizedPaymentMethod, normalizedRecurring]
    );

    return res.redirect(`/dashboard?toast=created&tx=${result.insertId}`);
  } catch (error) {
    console.error(error);
    const categories = await getUserCategories(userId).catch(() => []);
    return renderWithBase(res, {
      title: 'Nova Transacao - RC2 Finance',
      content: 'partials/pages/add-transaction-content',
      currentPath: '/dashboard',
      data: {
        error: 'Erro ao adicionar transacao',
        defaultType,
        categories,
        formData: req.body
      }
    });
  }
});

router.get('/edit/:id', requireAuth, async (req, res) => {
  const transactionId = req.params.id;
  const userId = req.session.userId;

  try {
    const [transactions] = await db.query(
      'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
      [transactionId, userId]
    );
    if (transactions.length === 0) {
      return res.redirect('/dashboard');
    }

    const categories = await getUserCategories(userId);
    return renderWithBase(res, {
      title: 'Editar Transacao - RC2 Finance',
      content: 'partials/pages/edit-transaction-content',
      currentPath: '/dashboard',
      data: {
        transaction: transactions[0],
        categories,
        error: null
      }
    });
  } catch (error) {
    console.error(error);
    return res.redirect('/dashboard');
  }
});

router.post('/edit/:id', requireAuth, async (req, res) => {
  const transactionId = req.params.id;
  const { description, amount, type, date, category_id, payment_method, is_recurring } = req.body;
  const userId = req.session.userId;
  const normalizedType = type === 'income' || type === 'expense' ? type : 'expense';
  const categoryId = parseInt(category_id, 10);
  const parsedAmount = parseCurrencyInput(amount);
  const normalizedPaymentMethod = normalizePaymentMethod(payment_method);
  const normalizedRecurring = normalizeRecurringFlag(is_recurring, normalizedType);

  try {
    const categories = await getUserCategories(userId);

    if (!category_id || Number.isNaN(categoryId)) {
      const [transactions] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
      return renderWithBase(res, {
        title: 'Editar Transacao - RC2 Finance',
        content: 'partials/pages/edit-transaction-content',
        currentPath: '/dashboard',
        data: {
          transaction: {
            ...(transactions[0] || {}),
            ...req.body,
            id: transactionId,
            type: normalizedType,
            payment_method: normalizedPaymentMethod,
            is_recurring: normalizedRecurring
          },
          categories,
          error: 'Categoria e obrigatoria'
        }
      });
    }

    if (!isValidPositiveAmount(parsedAmount)) {
      const [transactions] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
      return renderWithBase(res, {
        title: 'Editar Transacao - RC2 Finance',
        content: 'partials/pages/edit-transaction-content',
        currentPath: '/dashboard',
        data: {
          transaction: {
            ...(transactions[0] || {}),
            ...req.body,
            id: transactionId,
            type: normalizedType,
            payment_method: normalizedPaymentMethod,
            is_recurring: normalizedRecurring
          },
          categories,
          error: 'Informe um valor valido maior que zero'
        }
      });
    }

    const validCategory = await isValidCategory(userId, categoryId, normalizedType);
    if (!validCategory) {
      const [transactions] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
      return renderWithBase(res, {
        title: 'Editar Transacao - RC2 Finance',
        content: 'partials/pages/edit-transaction-content',
        currentPath: '/dashboard',
        data: {
          transaction: {
            ...(transactions[0] || {}),
            ...req.body,
            id: transactionId,
            type: normalizedType,
            payment_method: normalizedPaymentMethod,
            is_recurring: normalizedRecurring
          },
          categories,
          error: 'Categoria invalida para o tipo selecionado'
        }
      });
    }

    await db.query(
      `UPDATE transactions
       SET description = ?, amount = ?, type = ?, date = ?, category_id = ?, payment_method = ?, is_recurring = ?
       WHERE id = ? AND user_id = ?`,
      [description, parsedAmount, normalizedType, date, categoryId, normalizedPaymentMethod, normalizedRecurring, transactionId, userId]
    );

    return res.redirect(`/dashboard?toast=updated&tx=${transactionId}`);
  } catch (error) {
    console.error(error);
    const [transactions] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
    const categories = await getUserCategories(userId).catch(() => []);
    return renderWithBase(res, {
      title: 'Editar Transacao - RC2 Finance',
      content: 'partials/pages/edit-transaction-content',
      currentPath: '/dashboard',
      data: {
        transaction: transactions[0],
        categories,
        error: 'Erro ao editar transacao'
      }
    });
  }
});

router.post('/delete/:id', requireAuth, async (req, res) => {
  const transactionId = req.params.id;
  const userId = req.session.userId;

  try {
    await db.query('DELETE FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
    return res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    return res.redirect('/dashboard');
  }
});

module.exports = router;
