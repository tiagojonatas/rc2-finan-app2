const express = require('express');
const db = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  return res.redirect('/login');
}

router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  try {
    const [categories] = await db.query(
      `SELECT * FROM categories
       WHERE user_id = ?
       ORDER BY type ASC, name ASC`,
      [userId]
    );
    res.render('categories', { categories, error: null });
  } catch (error) {
    console.error(error);
    res.render('categories', { categories: [], error: 'Erro ao carregar categorias' });
  }
});

router.get('/add', requireAuth, (req, res) => {
  res.render('add-category', { error: null });
});

router.post('/add', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { name, type, color } = req.body;
  const normalizedType = type === 'income' ? 'income' : 'expense';
  const normalizedColor = /^#[0-9A-Fa-f]{6}$/.test(color || '') ? color : '#8A05BE';

  if (!name || !name.trim()) {
    return res.render('add-category', { error: 'Nome da categoria é obrigatório' });
  }

  try {
    await db.query(
      'INSERT INTO categories (user_id, name, type, color) VALUES (?, ?, ?, ?)',
      [userId, name.trim(), normalizedType, normalizedColor]
    );
    res.redirect('/categories');
  } catch (error) {
    console.error(error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.render('add-category', { error: 'Categoria já existe para este tipo' });
    }
    return res.render('add-category', { error: 'Erro ao cadastrar categoria' });
  }
});

router.post('/delete/:id', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const categoryId = req.params.id;
  try {
    const [countRows] = await db.query(
      'SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND category_id = ?',
      [userId, categoryId]
    );
    if (countRows[0].count > 0) {
      const [categories] = await db.query('SELECT * FROM categories WHERE user_id = ? ORDER BY type ASC, name ASC', [userId]);
      return res.render('categories', {
        categories,
        error: 'Nao foi possivel excluir: categoria em uso por transacoes'
      });
    }

    await db.query('DELETE FROM categories WHERE id = ? AND user_id = ?', [categoryId, userId]);
    res.redirect('/categories');
  } catch (error) {
    console.error(error);
    res.redirect('/categories');
  }
});

module.exports = router;
