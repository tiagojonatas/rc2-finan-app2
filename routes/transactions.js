const express = require('express');
const db = require('../db');
const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

async function getUserCategories(userId) {
  const [categories] = await db.query(
    'SELECT id, name, type, color FROM categories WHERE user_id = ? ORDER BY type ASC, name ASC',
    [userId]
  );
  return categories;
}

async function isValidCategory(userId, categoryId, type) {
  const [rows] = await db.query(
    'SELECT id FROM categories WHERE id = ? AND user_id = ? AND type = ? LIMIT 1',
    [categoryId, userId, type]
  );
  return rows.length > 0;
}

router.get('/add', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const requestedType = req.query.type;
  const defaultType = requestedType === 'income' || requestedType === 'expense' ? requestedType : 'expense';

  try {
    const categories = await getUserCategories(userId);
    return res.render('add-transaction', {
      error: null,
      defaultType,
      categories,
      formData: { type: defaultType }
    });
  } catch (error) {
    console.error(error);
    return res.render('add-transaction', {
      error: 'Erro ao carregar categorias. Execute: npm run init-categories',
      defaultType,
      categories: [],
      formData: { type: defaultType }
    });
  }
});

router.post('/add', requireAuth, async (req, res) => {
  const { description, amount, type, date, category_id } = req.body;
  const userId = req.session.userId;
  const defaultType = type === 'income' || type === 'expense' ? type : 'expense';
  const categoryId = parseInt(category_id, 10);

  try {
    const categories = await getUserCategories(userId);

    if (!category_id || Number.isNaN(categoryId)) {
      return res.render('add-transaction', {
        error: 'Categoria e obrigatoria',
        defaultType,
        categories,
        formData: req.body
      });
    }

    const validCategory = await isValidCategory(userId, categoryId, defaultType);
    if (!validCategory) {
      return res.render('add-transaction', {
        error: 'Categoria invalida para o tipo selecionado',
        defaultType,
        categories,
        formData: req.body
      });
    }

    const [result] = await db.query(
      'INSERT INTO transactions (user_id, description, amount, type, date, category_id) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, description, parseFloat(amount), defaultType, date, categoryId]
    );

    return res.redirect(`/dashboard?toast=created&tx=${result.insertId}`);
  } catch (error) {
    console.error(error);
    const categories = await getUserCategories(userId).catch(() => []);
    return res.render('add-transaction', {
      error: 'Erro ao adicionar transacao',
      defaultType,
      categories,
      formData: req.body
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
    return res.render('edit-transaction', {
      transaction: transactions[0],
      categories,
      error: null
    });
  } catch (error) {
    console.error(error);
    return res.redirect('/dashboard');
  }
});

router.post('/edit/:id', requireAuth, async (req, res) => {
  const transactionId = req.params.id;
  const { description, amount, type, date, category_id } = req.body;
  const userId = req.session.userId;
  const normalizedType = type === 'income' || type === 'expense' ? type : 'expense';
  const categoryId = parseInt(category_id, 10);

  try {
    const categories = await getUserCategories(userId);

    if (!category_id || Number.isNaN(categoryId)) {
      const [transactions] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
      return res.render('edit-transaction', {
        transaction: { ...(transactions[0] || {}), ...req.body, id: transactionId },
        categories,
        error: 'Categoria e obrigatoria'
      });
    }

    const validCategory = await isValidCategory(userId, categoryId, normalizedType);
    if (!validCategory) {
      const [transactions] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
      return res.render('edit-transaction', {
        transaction: { ...(transactions[0] || {}), ...req.body, id: transactionId },
        categories,
        error: 'Categoria invalida para o tipo selecionado'
      });
    }

    await db.query(
      'UPDATE transactions SET description = ?, amount = ?, type = ?, date = ?, category_id = ? WHERE id = ? AND user_id = ?',
      [description, parseFloat(amount), normalizedType, date, categoryId, transactionId, userId]
    );

    return res.redirect(`/dashboard?toast=updated&tx=${transactionId}`);
  } catch (error) {
    console.error(error);
    const [transactions] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
    const categories = await getUserCategories(userId).catch(() => []);
    return res.render('edit-transaction', {
      transaction: transactions[0],
      categories,
      error: 'Erro ao editar transacao'
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
