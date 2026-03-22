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

// GET /credit-cards - List all credit cards
router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.userId;

  try {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    res.render('credit-cards', { cards, error: null, success: null });
  } catch (error) {
    console.error(error);
    res.render('credit-cards', { cards: [], error: 'Erro ao carregar cartões', success: null });
  }
});

// GET /credit-cards/add - Show add credit card form
router.get('/add', requireAuth, (req, res) => {
  res.render('add-credit-card', { error: null });
});

// POST /credit-cards/add - Add new credit card
router.post('/add', requireAuth, async (req, res) => {
  const { name, limit_amount, closing_day, due_day } = req.body;
  const userId = req.session.userId;

  // Validate days
  const closingDay = parseInt(closing_day, 10);
  const dueDay = parseInt(due_day, 10);

  if (closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31) {
    return res.render('add-credit-card', { error: 'Días de fechamento e vencimento devem estar entre 1 e 31' });
  }

  try {
    await db.query('INSERT INTO credit_cards (user_id, name, limit_amount, closing_day, due_day) VALUES (?, ?, ?, ?, ?)',
      [userId, name, parseFloat(limit_amount), closingDay, dueDay]);
    res.redirect('/credit-cards');
  } catch (error) {
    console.error(error);
    res.render('add-credit-card', { error: 'Erro ao adicionar cartão' });
  }
});

// GET /credit-cards/edit/:id - Show edit credit card form
router.get('/edit/:id', requireAuth, async (req, res) => {
  const cardId = req.params.id;
  const userId = req.session.userId;

  try {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    if (cards.length === 0) {
      return res.redirect('/credit-cards');
    }
    res.render('edit-credit-card', { card: cards[0], error: null });
  } catch (error) {
    console.error(error);
    res.redirect('/credit-cards');
  }
});

// POST /credit-cards/edit/:id - Update credit card
router.post('/edit/:id', requireAuth, async (req, res) => {
  const cardId = req.params.id;
  const { name, limit_amount, closing_day, due_day } = req.body;
  const userId = req.session.userId;

  const closingDay = parseInt(closing_day, 10);
  const dueDay = parseInt(due_day, 10);

  if (closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31) {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    return res.render('edit-credit-card', { card: cards[0], error: 'Días devem estar entre 1 e 31' });
  }

  try {
    await db.query('UPDATE credit_cards SET name = ?, limit_amount = ?, closing_day = ?, due_day = ? WHERE id = ? AND user_id = ?',
      [name, parseFloat(limit_amount), closingDay, dueDay, cardId, userId]);
    res.redirect('/credit-cards');
  } catch (error) {
    console.error(error);
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    res.render('edit-credit-card', { card: cards[0], error: 'Erro ao editar cartão' });
  }
});

// POST /credit-cards/delete/:id - Delete credit card
router.post('/delete/:id', requireAuth, async (req, res) => {
  const cardId = req.params.id;
  const userId = req.session.userId;

  try {
    await db.query('DELETE FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    res.redirect('/credit-cards');
  } catch (error) {
    console.error(error);
    res.redirect('/credit-cards');
  }
});

// GET /credit-cards/:id/transactions - List card transactions
router.get('/:id/transactions', requireAuth, async (req, res) => {
  const cardId = req.params.id;
  const userId = req.session.userId;

  try {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    if (cards.length === 0) {
      return res.redirect('/credit-cards');
    }

    const [transactions] = await db.query('SELECT * FROM card_transactions WHERE card_id = ? ORDER BY date DESC', [cardId]);

    // Calculate total this month and available limit
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    let totalThisMonth = 0;
    transactions.forEach(t => {
      const tDate = new Date(t.date);
      if (tDate.getFullYear() === currentYear && tDate.getMonth() + 1 === currentMonth) {
        totalThisMonth += parseFloat(t.amount);
      }
    });

    const availableLimit = cards[0].limit_amount - totalThisMonth;

    res.render('card-transactions', {
      card: cards[0],
      transactions,
      totalThisMonth,
      availableLimit,
      error: null,
      success: null
    });
  } catch (error) {
    console.error(error);
    res.redirect('/credit-cards');
  }
});

// GET /credit-cards/:id/add-transaction - Show add transaction form
router.get('/:id/add-transaction', requireAuth, async (req, res) => {
  const cardId = req.params.id;
  const userId = req.session.userId;

  try {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    if (cards.length === 0) {
      return res.redirect('/credit-cards');
    }
    res.render('add-card-transaction', { card: cards[0], error: null });
  } catch (error) {
    console.error(error);
    res.redirect('/credit-cards');
  }
});

// POST /credit-cards/:id/add-transaction - Add card transaction
router.post('/:id/add-transaction', requireAuth, async (req, res) => {
  const cardId = req.params.id;
  const userId = req.session.userId;
  const { description, amount, date } = req.body;

  try {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    if (cards.length === 0) {
      return res.redirect('/credit-cards');
    }

    await db.query('INSERT INTO card_transactions (card_id, description, amount, date) VALUES (?, ?, ?, ?)',
      [cardId, description, parseFloat(amount), date]);

    res.redirect(`/credit-cards/${cardId}/transactions`);
  } catch (error) {
    console.error(error);
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    res.render('add-card-transaction', { card: cards[0], error: 'Erro ao adicionar transação' });
  }
});

// GET /credit-cards/:cardId/edit-transaction/:transactionId - Show edit transaction form
router.get('/:cardId/edit-transaction/:transactionId', requireAuth, async (req, res) => {
  const { cardId, transactionId } = req.params;
  const userId = req.session.userId;

  try {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    if (cards.length === 0) {
      return res.redirect('/credit-cards');
    }

    const [transactions] = await db.query('SELECT * FROM card_transactions WHERE id = ? AND card_id = ?', [transactionId, cardId]);
    if (transactions.length === 0) {
      return res.redirect(`/credit-cards/${cardId}/transactions`);
    }

    res.render('edit-card-transaction', { card: cards[0], transaction: transactions[0], error: null });
  } catch (error) {
    console.error(error);
    res.redirect('/credit-cards');
  }
});

// POST /credit-cards/:cardId/edit-transaction/:transactionId - Update card transaction
router.post('/:cardId/edit-transaction/:transactionId', requireAuth, async (req, res) => {
  const { cardId, transactionId } = req.params;
  const userId = req.session.userId;
  const { description, amount, date } = req.body;

  try {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    if (cards.length === 0) {
      return res.redirect('/credit-cards');
    }

    await db.query('UPDATE card_transactions SET description = ?, amount = ?, date = ? WHERE id = ? AND card_id = ?',
      [description, parseFloat(amount), date, transactionId, cardId]);

    res.redirect(`/credit-cards/${cardId}/transactions`);
  } catch (error) {
    console.error(error);
    const [transactions] = await db.query('SELECT * FROM card_transactions WHERE id = ? AND card_id = ?', [transactionId, cardId]);
    res.render('edit-card-transaction', { card: cards[0], transaction: transactions[0], error: 'Erro ao editar transação' });
  }
});

// POST /credit-cards/:cardId/delete-transaction/:transactionId - Delete card transaction
router.post('/:cardId/delete-transaction/:transactionId', requireAuth, async (req, res) => {
  const { cardId, transactionId } = req.params;
  const userId = req.session.userId;

  try {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    if (cards.length === 0) {
      return res.redirect('/credit-cards');
    }

    await db.query('DELETE FROM card_transactions WHERE id = ? AND card_id = ?', [transactionId, cardId]);
    res.redirect(`/credit-cards/${cardId}/transactions`);
  } catch (error) {
    console.error(error);
    res.redirect(`/credit-cards/${cardId}/transactions`);
  }
});

module.exports = router;
