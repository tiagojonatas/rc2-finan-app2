const express = require('express');
const db = require('../db');
const router = express.Router();

function renderWithBase(res, options = {}) {
  const {
    title = 'Cartoes - RC2 Finance',
    content = 'partials/pages/credit-cards-content',
    currentPath = '/credit-cards',
    data = {}
  } = options;

  return res.render('base', {
    title,
    content,
    currentPath,
    ...data
  });
}

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
    renderWithBase(res, {
      title: 'Meus Cartoes - RC2 Finance',
      content: 'partials/pages/credit-cards-content',
      currentPath: '/credit-cards',
      data: { cards, error: null, success: null }
    });
  } catch (error) {
    console.error(error);
    renderWithBase(res, {
      title: 'Meus Cartoes - RC2 Finance',
      content: 'partials/pages/credit-cards-content',
      currentPath: '/credit-cards',
      data: { cards: [], error: 'Erro ao carregar cartoes', success: null }
    });
  }
});

// GET /credit-cards/add - Show add credit card form
router.get('/add', requireAuth, (req, res) => {
  renderWithBase(res, {
    title: 'Novo Cartao - RC2 Finance',
    content: 'partials/pages/add-credit-card-content',
    currentPath: '/credit-cards',
    data: { error: null }
  });
});

// POST /credit-cards/add - Add new credit card
router.post('/add', requireAuth, async (req, res) => {
  const { name, limit_amount, closing_day, due_day } = req.body;
  const userId = req.session.userId;

  const closingDay = parseInt(closing_day, 10);
  const dueDay = parseInt(due_day, 10);

  if (closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31) {
    return renderWithBase(res, {
      title: 'Novo Cartao - RC2 Finance',
      content: 'partials/pages/add-credit-card-content',
      currentPath: '/credit-cards',
      data: { error: 'Dias de fechamento e vencimento devem estar entre 1 e 31' }
    });
  }

  try {
    await db.query('INSERT INTO credit_cards (user_id, name, limit_amount, closing_day, due_day) VALUES (?, ?, ?, ?, ?)',
      [userId, name, parseFloat(limit_amount), closingDay, dueDay]);
    res.redirect('/credit-cards');
  } catch (error) {
    console.error(error);
    renderWithBase(res, {
      title: 'Novo Cartao - RC2 Finance',
      content: 'partials/pages/add-credit-card-content',
      currentPath: '/credit-cards',
      data: { error: 'Erro ao adicionar cartao' }
    });
  }
});

async function renderEditCardForm(req, res) {
  const cardId = req.params.id;
  const userId = req.session.userId;

  try {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    if (cards.length === 0) {
      return res.redirect('/credit-cards');
    }
    renderWithBase(res, {
      title: 'Editar Cartao - RC2 Finance',
      content: 'partials/pages/edit-credit-card-content',
      currentPath: '/credit-cards',
      data: { card: cards[0], error: null }
    });
  } catch (error) {
    console.error(error);
    res.redirect('/credit-cards');
  }
}

// GET /credit-cards/edit/:id - legacy format
router.get('/edit/:id', requireAuth, renderEditCardForm);

// GET /credit-cards/:id/edit - format used by view links
router.get('/:id/edit', requireAuth, renderEditCardForm);

// POST /credit-cards/edit/:id - Update credit card
router.post('/edit/:id', requireAuth, async (req, res) => {
  const cardId = req.params.id;
  const { name, limit_amount, closing_day, due_day } = req.body;
  const userId = req.session.userId;

  const closingDay = parseInt(closing_day, 10);
  const dueDay = parseInt(due_day, 10);

  if (closingDay < 1 || closingDay > 31 || dueDay < 1 || dueDay > 31) {
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    return renderWithBase(res, {
      title: 'Editar Cartao - RC2 Finance',
      content: 'partials/pages/edit-credit-card-content',
      currentPath: '/credit-cards',
      data: { card: cards[0], error: 'Dias devem estar entre 1 e 31' }
    });
  }

  try {
    await db.query('UPDATE credit_cards SET name = ?, limit_amount = ?, closing_day = ?, due_day = ? WHERE id = ? AND user_id = ?',
      [name, parseFloat(limit_amount), closingDay, dueDay, cardId, userId]);
    res.redirect('/credit-cards');
  } catch (error) {
    console.error(error);
    const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
    renderWithBase(res, {
      title: 'Editar Cartao - RC2 Finance',
      content: 'partials/pages/edit-credit-card-content',
      currentPath: '/credit-cards',
      data: { card: cards[0], error: 'Erro ao editar cartao' }
    });
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

    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    let totalThisMonth = 0;
    transactions.forEach((t) => {
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
    res.render('add-card-transaction', { card: cards[0], error: 'Erro ao adicionar transacao' });
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

    try {
      const [cards] = await db.query('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?', [cardId, userId]);
      if (cards.length === 0) {
        return res.redirect('/credit-cards');
      }

      const [transactions] = await db.query('SELECT * FROM card_transactions WHERE id = ? AND card_id = ?', [transactionId, cardId]);
      if (transactions.length === 0) {
        return res.redirect(`/credit-cards/${cardId}/transactions`);
      }

      return res.render('edit-card-transaction', {
        card: cards[0],
        transaction: transactions[0],
        error: 'Erro ao editar transacao'
      });
    } catch (fallbackError) {
      console.error(fallbackError);
      return res.redirect(`/credit-cards/${cardId}/transactions`);
    }
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
