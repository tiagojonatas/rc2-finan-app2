const express = require('express');
const db = require('../db');
const router = express.Router();

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (req.session.userId) {
    return next();
  } else {
    res.redirect('/login');
  }
}

// GET /transactions/add - Show add transaction form
router.get('/add', requireAuth, (req, res) => {
  const requestedType = req.query.type;
  const defaultType = requestedType === 'income' || requestedType === 'expense' ? requestedType : 'expense';
  res.render('add-transaction', { error: null, defaultType });
});

// POST /transactions/add - Add new transaction
router.post('/add', requireAuth, async (req, res) => {
  const { description, amount, type, date } = req.body;
  const userId = req.session.userId;

  try {
    await db.query('INSERT INTO transactions (user_id, description, amount, type, date) VALUES (?, ?, ?, ?, ?)',
      [userId, description, parseFloat(amount), type, date]);
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    const defaultType = type === 'income' || type === 'expense' ? type : 'expense';
    res.render('add-transaction', { error: 'Erro ao adicionar transação', defaultType });
  }
});

// GET /transactions/edit/:id - Show edit transaction form
router.get('/edit/:id', requireAuth, async (req, res) => {
  const transactionId = req.params.id;
  const userId = req.session.userId;

  try {
    const [transactions] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
    if (transactions.length === 0) {
      return res.redirect('/dashboard');
    }
    res.render('edit-transaction', { transaction: transactions[0], error: null });
  } catch (error) {
    console.error(error);
    res.redirect('/dashboard');
  }
});

// POST /transactions/edit/:id - Update transaction
router.post('/edit/:id', requireAuth, async (req, res) => {
  const transactionId = req.params.id;
  const { description, amount, type, date } = req.body;
  const userId = req.session.userId;

  try {
    await db.query('UPDATE transactions SET description = ?, amount = ?, type = ?, date = ? WHERE id = ? AND user_id = ?',
      [description, parseFloat(amount), type, date, transactionId, userId]);
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    const [transactions] = await db.query('SELECT * FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
    res.render('edit-transaction', { transaction: transactions[0], error: 'Erro ao editar transação' });
  }
});

// POST /transactions/delete/:id - Delete transaction
router.post('/delete/:id', requireAuth, async (req, res) => {
  const transactionId = req.params.id;
  const userId = req.session.userId;

  try {
    await db.query('DELETE FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.redirect('/dashboard');
  }
});

module.exports = router;

