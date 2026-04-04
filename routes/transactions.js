const express = require('express');
const db = require('../db');
const { parseCurrencyInput, isValidPositiveAmount } = require('../utils/currency');
const { nowInTz, toTzDate } = require('../utils/datetime');
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

async function getUserCards(userId) {
  const [cards] = await db.query(
    'SELECT id, name FROM credit_cards WHERE user_id = ? ORDER BY name ASC',
    [userId]
  );
  return cards;
}

async function isValidCategory(userId, categoryId, type) {
  const [rows] = await db.query(
    "SELECT id FROM categories WHERE id = ? AND user_id = ? AND type = ? AND name <> 'Outros' LIMIT 1",
    [categoryId, userId, type]
  );
  return rows.length > 0;
}

async function isValidCard(userId, cardId) {
  const [rows] = await db.query(
    'SELECT id FROM credit_cards WHERE id = ? AND user_id = ? LIMIT 1',
    [cardId, userId]
  );
  return rows.length > 0;
}

function normalizePaymentMethod(paymentMethod) {
  const validMethods = ['cash', 'pix', 'credit', 'debit'];
  return validMethods.includes(paymentMethod) ? paymentMethod : 'cash';
}

function normalizeRecurringFlag(recurringValue, transactionType) {
  if (transactionType !== 'expense') return 0;
  return recurringValue === 'on' || recurringValue === '1' || recurringValue === 1 || recurringValue === true ? 1 : 0;
}

function normalizeAffectsBalance(value) {
  return value === 'on' || value === '1' || value === 1 || value === true ? 1 : 0;
}

function enforceAffectsBalanceByType(transactionType, affectsBalanceValue) {
  if (transactionType === 'income') return 1;
  return affectsBalanceValue;
}

function normalizeInstallmentFlag(value) {
  return value === 'on' || value === '1' || value === 1 || value === true;
}

function normalizeInstallmentTotal(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 60);
}

function addMonthsKeepingDay(dateString, monthsToAdd) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  if (!year || !month || !day) return dateString;

  const base = new Date(year, month - 1, day);
  const targetYear = base.getFullYear();
  const targetMonth = base.getMonth() + monthsToAdd;
  const firstTargetMonth = new Date(targetYear, targetMonth, 1);
  const lastDay = new Date(firstTargetMonth.getFullYear(), firstTargetMonth.getMonth() + 1, 0).getDate();
  const finalDay = Math.min(day, lastDay);
  const finalDate = new Date(firstTargetMonth.getFullYear(), firstTargetMonth.getMonth(), finalDay);

  const yyyy = finalDate.getFullYear();
  const mm = String(finalDate.getMonth() + 1).padStart(2, '0');
  const dd = String(finalDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function splitAmountIntoInstallments(totalAmount, totalInstallments) {
  const totalCents = Math.round((Number(totalAmount) || 0) * 100);
  const baseCents = Math.floor(totalCents / totalInstallments);
  const remainder = totalCents - (baseCents * totalInstallments);
  const parts = [];

  for (let i = 0; i < totalInstallments; i += 1) {
    const cents = baseCents + (i < remainder ? 1 : 0);
    parts.push(cents / 100);
  }

  return parts;
}

function getAllowedDateRange() {
  const now = nowInTz();
  return {
    minDate: now.subtract(3, 'month').startOf('day'),
    maxDate: now.add(12, 'month').endOf('day')
  };
}

function isValidDateInput(dateValue) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ''));
}

function isDateWithinAllowedRange(dateValue) {
  if (!isValidDateInput(dateValue)) return false;
  const parsedDate = toTzDate(dateValue);
  if (!parsedDate.isValid()) return false;
  const { minDate, maxDate } = getAllowedDateRange();
  return !parsedDate.isBefore(minDate, 'day') && !parsedDate.isAfter(maxDate, 'day');
}

function validateTransactionDate(dateValue, installmentTotal = 1) {
  if (!isDateWithinAllowedRange(dateValue)) {
    return 'Data fora do intervalo permitido (ate 3 meses no passado e 12 meses no futuro)';
  }

  if (Number(installmentTotal || 1) > 1) {
    const lastInstallmentDate = addMonthsKeepingDay(dateValue, Number(installmentTotal) - 1);
    if (!isDateWithinAllowedRange(lastInstallmentDate)) {
      return 'Parcelamento excede o limite de 12 meses no futuro';
    }
  }

  return null;
}

router.get('/add', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const requestedType = req.query.type;
  const requestedPaymentMethod = req.query.payment_method;
  const defaultType = requestedType === 'income' || requestedType === 'expense' ? requestedType : 'expense';
  const defaultPaymentMethod = normalizePaymentMethod(requestedPaymentMethod);

  try {
    const categories = await getUserCategories(userId);
    const cards = await getUserCards(userId);
    return renderWithBase(res, {
      title: 'Nova Transacao - RC2 Finance',
      content: 'partials/pages/add-transaction-content',
      currentPath: '/dashboard',
      data: {
        error: null,
        defaultType,
        categories,
        cards,
        formData: { type: defaultType, payment_method: defaultPaymentMethod, is_recurring: 0, affects_balance: 1, is_installment: 0, installment_total: 2, card_id: '' }
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
        cards: [],
        formData: { type: defaultType, payment_method: defaultPaymentMethod, is_recurring: 0, affects_balance: 1, is_installment: 0, installment_total: 2, card_id: '' }
      }
    });
  }
});

router.post('/add', requireAuth, async (req, res) => {
  const { description, amount, type, date, category_id, payment_method, is_recurring, affects_balance, is_installment, installment_total, card_id } = req.body;
  const userId = req.session.userId;
  const defaultType = type === 'income' || type === 'expense' ? type : 'expense';
  const categoryId = parseInt(category_id, 10);
  const cardId = card_id ? parseInt(card_id, 10) : null;
  const parsedAmount = parseCurrencyInput(amount);
  const normalizedPaymentMethod = normalizePaymentMethod(payment_method);
  const normalizedRecurring = normalizeRecurringFlag(is_recurring, defaultType);
  const installmentEnabled = defaultType === 'expense' && normalizeInstallmentFlag(is_installment);
  const normalizedInstallmentTotal = installmentEnabled ? normalizeInstallmentTotal(installment_total) : 1;
  let normalizedAffectsBalance = enforceAffectsBalanceByType(defaultType, normalizeAffectsBalance(affects_balance));

  try {
    const categories = await getUserCategories(userId);
    const cards = await getUserCards(userId);

    if (!category_id || Number.isNaN(categoryId)) {
      return renderWithBase(res, {
        title: 'Nova Transacao - RC2 Finance',
        content: 'partials/pages/add-transaction-content',
        currentPath: '/dashboard',
        data: {
          error: 'Categoria e obrigatoria',
          defaultType,
          categories,
          cards,
          formData: { ...req.body, affects_balance: normalizedAffectsBalance }
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
          cards,
          formData: { ...req.body, affects_balance: normalizedAffectsBalance }
        }
      });
    }

    const dateValidationError = validateTransactionDate(date, normalizedInstallmentTotal);
    if (dateValidationError) {
      return renderWithBase(res, {
        title: 'Nova Transacao - RC2 Finance',
        content: 'partials/pages/add-transaction-content',
        currentPath: '/dashboard',
        data: {
          error: dateValidationError,
          defaultType,
          categories,
          cards,
          formData: { ...req.body, affects_balance: normalizedAffectsBalance }
        }
      });
    }

    if (installmentEnabled && normalizedInstallmentTotal < 2) {
      return renderWithBase(res, {
        title: 'Nova Transacao - RC2 Finance',
        content: 'partials/pages/add-transaction-content',
        currentPath: '/dashboard',
        data: {
          error: 'Informe ao menos 2 parcelas para compra parcelada',
          defaultType,
          categories,
          cards,
          formData: { ...req.body, affects_balance: normalizedAffectsBalance }
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
          cards,
          formData: { ...req.body, affects_balance: normalizedAffectsBalance }
        }
      });
    }

    if (normalizedPaymentMethod === 'credit') {
      if (!card_id || Number.isNaN(cardId)) {
        return renderWithBase(res, {
          title: 'Nova Transacao - RC2 Finance',
          content: 'partials/pages/add-transaction-content',
          currentPath: '/dashboard',
          data: {
            error: 'Selecione um cartao para pagamento com cartao',
            defaultType,
            categories,
            cards,
            formData: { ...req.body, affects_balance: normalizedAffectsBalance }
          }
        });
      }

      const validCard = await isValidCard(userId, cardId);
      if (!validCard) {
        return renderWithBase(res, {
          title: 'Nova Transacao - RC2 Finance',
          content: 'partials/pages/add-transaction-content',
          currentPath: '/dashboard',
          data: {
            error: 'Cartao invalido',
            defaultType,
            categories,
            cards,
            formData: { ...req.body, affects_balance: normalizedAffectsBalance }
          }
        });
      }
    }

    const normalizedCardId = normalizedPaymentMethod === 'credit' ? cardId : null;

    if (installmentEnabled && normalizedPaymentMethod === 'credit') {
      normalizedAffectsBalance = 0;
    }

    if (!installmentEnabled) {
      const [result] = await db.query(
        `INSERT INTO transactions
         (user_id, description, amount, type, date, category_id, payment_method, card_id, is_recurring, affects_balance, installment_total, installment_number, parent_transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, description, parsedAmount, defaultType, date, categoryId, normalizedPaymentMethod, normalizedCardId, normalizedRecurring, normalizedAffectsBalance, 1, 1, null]
      );

      return res.redirect(`/dashboard?toast=created&tx=${result.insertId}`);
    }

    const installmentAmounts = splitAmountIntoInstallments(parsedAmount, normalizedInstallmentTotal);
    const [firstInsert] = await db.query(
      `INSERT INTO transactions
       (user_id, description, amount, type, date, category_id, payment_method, card_id, is_recurring, affects_balance, installment_total, installment_number, parent_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        `${description} - 1/${normalizedInstallmentTotal}`,
        installmentAmounts[0],
        defaultType,
        date,
        categoryId,
        normalizedPaymentMethod,
        normalizedCardId,
        normalizedRecurring,
        normalizedAffectsBalance,
        normalizedInstallmentTotal,
        1,
        null
      ]
    );

    const parentTransactionId = firstInsert.insertId;
    await db.query(
      'UPDATE transactions SET parent_transaction_id = ? WHERE id = ? AND user_id = ?',
      [parentTransactionId, parentTransactionId, userId]
    );

    for (let installmentNumber = 2; installmentNumber <= normalizedInstallmentTotal; installmentNumber += 1) {
      await db.query(
        `INSERT INTO transactions
         (user_id, description, amount, type, date, category_id, payment_method, card_id, is_recurring, affects_balance, installment_total, installment_number, parent_transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          `${description} - ${installmentNumber}/${normalizedInstallmentTotal}`,
          installmentAmounts[installmentNumber - 1],
          defaultType,
          addMonthsKeepingDay(date, installmentNumber - 1),
          categoryId,
          normalizedPaymentMethod,
          normalizedCardId,
          normalizedRecurring,
          normalizedAffectsBalance,
          normalizedInstallmentTotal,
          installmentNumber,
          parentTransactionId
        ]
      );
    }

    return res.redirect(`/dashboard?toast=created&tx=${parentTransactionId}`);
  } catch (error) {
    console.error(error);
    const categories = await getUserCategories(userId).catch(() => []);
    const cards = await getUserCards(userId).catch(() => []);
    return renderWithBase(res, {
      title: 'Nova Transacao - RC2 Finance',
      content: 'partials/pages/add-transaction-content',
      currentPath: '/dashboard',
      data: {
        error: 'Erro ao adicionar transacao',
        defaultType,
        categories,
        cards,
        formData: { ...req.body, affects_balance: normalizedAffectsBalance }
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
    const cards = await getUserCards(userId);
    return renderWithBase(res, {
      title: 'Editar Transacao - RC2 Finance',
      content: 'partials/pages/edit-transaction-content',
      currentPath: '/dashboard',
      data: {
        transaction: transactions[0],
        categories,
        cards,
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
  const { description, amount, type, date, category_id, payment_method, is_recurring, affects_balance, card_id } = req.body;
  const userId = req.session.userId;
  const normalizedType = type === 'income' || type === 'expense' ? type : 'expense';
  const categoryId = parseInt(category_id, 10);
  const cardId = card_id ? parseInt(card_id, 10) : null;
  const parsedAmount = parseCurrencyInput(amount);
  const normalizedPaymentMethod = normalizePaymentMethod(payment_method);
  const normalizedRecurring = normalizeRecurringFlag(is_recurring, normalizedType);
  let normalizedAffectsBalance = enforceAffectsBalanceByType(normalizedType, normalizeAffectsBalance(affects_balance));

  try {
    const categories = await getUserCategories(userId);
    const cards = await getUserCards(userId);

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
            is_recurring: normalizedRecurring,
            affects_balance: normalizedAffectsBalance
          },
          categories,
          cards,
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
            is_recurring: normalizedRecurring,
            affects_balance: normalizedAffectsBalance
          },
          categories,
          cards,
          error: 'Informe um valor valido maior que zero'
        }
      });
    }

    const editDateValidationError = validateTransactionDate(date, 1);
    if (editDateValidationError) {
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
            is_recurring: normalizedRecurring,
            affects_balance: normalizedAffectsBalance
          },
          categories,
          cards,
          error: editDateValidationError
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
            is_recurring: normalizedRecurring,
            affects_balance: normalizedAffectsBalance
          },
          categories,
          cards,
          error: 'Categoria invalida para o tipo selecionado'
        }
      });
    }

    if (normalizedPaymentMethod === 'credit') {
      if (!card_id || Number.isNaN(cardId)) {
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
              is_recurring: normalizedRecurring,
              affects_balance: normalizedAffectsBalance
            },
            categories,
            cards,
            error: 'Selecione um cartao para pagamento com cartao'
          }
        });
      }

      const validCard = await isValidCard(userId, cardId);
      if (!validCard) {
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
              is_recurring: normalizedRecurring,
              affects_balance: normalizedAffectsBalance
            },
            categories,
            cards,
            error: 'Cartao invalido'
          }
        });
      }

      if (normalizedType === 'expense') {
        normalizedAffectsBalance = 0;
      }
    }

    const normalizedCardId = normalizedPaymentMethod === 'credit' ? cardId : null;

    await db.query(
      `UPDATE transactions
       SET description = ?, amount = ?, type = ?, date = ?, category_id = ?, payment_method = ?, card_id = ?, is_recurring = ?, affects_balance = ?
       WHERE id = ? AND user_id = ?`,
      [description, parsedAmount, normalizedType, date, categoryId, normalizedPaymentMethod, normalizedCardId, normalizedRecurring, normalizedAffectsBalance, transactionId, userId]
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
        cards: await getUserCards(userId).catch(() => []),
        error: 'Erro ao editar transacao'
      }
    });
  }
});

router.post('/delete/:id', requireAuth, async (req, res) => {
  const transactionId = req.params.id;
  const userId = req.session.userId;
  const deleteScope = String(req.body.delete_scope || 'single').toLowerCase();

  try {
    const [rows] = await db.query(
      'SELECT id, installment_total, parent_transaction_id FROM transactions WHERE id = ? AND user_id = ? LIMIT 1',
      [transactionId, userId]
    );

    if (!rows.length) {
      return res.redirect('/dashboard');
    }

    const transaction = rows[0];
    const installmentTotal = Number(transaction.installment_total || 1);
    const parentId = Number(transaction.parent_transaction_id || transaction.id);

    if (deleteScope === 'group' && installmentTotal > 1) {
      await db.query(
        'DELETE FROM transactions WHERE user_id = ? AND (id = ? OR parent_transaction_id = ?)',
        [userId, parentId, parentId]
      );
      return res.redirect('/dashboard');
    }

    await db.query('DELETE FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]);
    return res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    return res.redirect('/dashboard');
  }
});

module.exports = router;
