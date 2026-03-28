const express = require('express');
const db = require('../db');

const router = express.Router();

function renderWithBase(res, options = {}) {
  const {
    title = 'Categorias - RC2 Finance',
    content = 'partials/pages/categories-content',
    currentPath = '/categories',
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
  if (req.session.userId) return next();
  return res.redirect('/login');
}

function normalizeCategoryType(type) {
  return type === 'income' ? 'income' : 'expense';
}

function normalizeCategoryColor(color) {
  return /^#[0-9A-Fa-f]{6}$/.test(color || '') ? color : '#00C9A7';
}

function normalizeCategoryName(name) {
  return (name || '').trim();
}

function isBlockedCategoryName(name) {
  return (name || '').trim().toLowerCase() === 'outros';
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
    renderWithBase(res, {
      title: 'Categorias - RC2 Finance',
      content: 'partials/pages/categories-content',
      currentPath: '/categories',
      data: { categories, error: null }
    });
  } catch (error) {
    console.error(error);
    renderWithBase(res, {
      title: 'Categorias - RC2 Finance',
      content: 'partials/pages/categories-content',
      currentPath: '/categories',
      data: { categories: [], error: 'Erro ao carregar categorias' }
    });
  }
});

router.get('/add', requireAuth, (req, res) => {
  renderWithBase(res, {
    title: 'Nova Categoria - RC2 Finance',
    content: 'partials/pages/add-category-content',
    currentPath: '/categories',
    data: { error: null }
  });
});

router.post('/add', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { name, type, color } = req.body;
  const normalizedType = normalizeCategoryType(type);
  const normalizedColor = normalizeCategoryColor(color);
  const normalizedName = normalizeCategoryName(name);

  if (!normalizedName) {
    return renderWithBase(res, {
      title: 'Nova Categoria - RC2 Finance',
      content: 'partials/pages/add-category-content',
      currentPath: '/categories',
      data: { error: 'Nome da categoria e obrigatorio' }
    });
  }
  if (isBlockedCategoryName(normalizedName)) {
    return renderWithBase(res, {
      title: 'Nova Categoria - RC2 Finance',
      content: 'partials/pages/add-category-content',
      currentPath: '/categories',
      data: { error: 'Categoria Outros nao e permitida' }
    });
  }

  try {
    await db.query(
      'INSERT INTO categories (user_id, name, type, color) VALUES (?, ?, ?, ?)',
      [userId, normalizedName, normalizedType, normalizedColor]
    );
    return res.redirect('/categories');
  } catch (error) {
    console.error(error);
    if (error.code === 'ER_DUP_ENTRY') {
      return renderWithBase(res, {
        title: 'Nova Categoria - RC2 Finance',
        content: 'partials/pages/add-category-content',
        currentPath: '/categories',
        data: { error: 'Categoria ja existe para este tipo' }
      });
    }
    return renderWithBase(res, {
      title: 'Nova Categoria - RC2 Finance',
      content: 'partials/pages/add-category-content',
      currentPath: '/categories',
      data: { error: 'Erro ao cadastrar categoria' }
    });
  }
});

router.get('/edit/:id', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const categoryId = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(categoryId)) {
    return res.redirect('/categories');
  }

  try {
    const [rows] = await db.query(
      'SELECT id, name, type, color FROM categories WHERE id = ? AND user_id = ? LIMIT 1',
      [categoryId, userId]
    );

    if (!rows.length) {
      return res.redirect('/categories');
    }

    return renderWithBase(res, {
      title: 'Editar Categoria - RC2 Finance',
      content: 'partials/pages/edit-category-content',
      currentPath: '/categories',
      data: { category: rows[0], error: null }
    });
  } catch (error) {
    console.error(error);
    return res.redirect('/categories');
  }
});

router.post('/edit/:id', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const categoryId = Number.parseInt(req.params.id, 10);
  const { name, color } = req.body;
  const normalizedName = normalizeCategoryName(name);
  const normalizedColor = normalizeCategoryColor(color);

  if (Number.isNaN(categoryId)) {
    return res.redirect('/categories');
  }

  let category = null;
  try {
    const [rows] = await db.query(
      'SELECT id, name, type, color FROM categories WHERE id = ? AND user_id = ? LIMIT 1',
      [categoryId, userId]
    );

    if (!rows.length) {
      return res.redirect('/categories');
    }

    category = rows[0];

    if (!normalizedName) {
      return renderWithBase(res, {
        title: 'Editar Categoria - RC2 Finance',
        content: 'partials/pages/edit-category-content',
        currentPath: '/categories',
        data: {
          category: {
            ...category,
            name: normalizedName,
            color: normalizedColor
          },
          error: 'Nome da categoria e obrigatorio'
        }
      });
    }
    if (isBlockedCategoryName(normalizedName)) {
      return renderWithBase(res, {
        title: 'Editar Categoria - RC2 Finance',
        content: 'partials/pages/edit-category-content',
        currentPath: '/categories',
        data: {
          category: {
            ...category,
            name: normalizedName,
            color: normalizedColor
          },
          error: 'Categoria Outros nao e permitida'
        }
      });
    }

    await db.query(
      'UPDATE categories SET name = ?, color = ? WHERE id = ? AND user_id = ?',
      [normalizedName, normalizedColor, categoryId, userId]
    );

    return res.redirect('/categories');
  } catch (error) {
    console.error(error);

    if (error.code === 'ER_DUP_ENTRY') {
      return renderWithBase(res, {
        title: 'Editar Categoria - RC2 Finance',
        content: 'partials/pages/edit-category-content',
        currentPath: '/categories',
        data: {
          category: {
            ...(category || { id: categoryId, type: 'expense' }),
            name: normalizedName,
            color: normalizedColor
          },
          error: 'Ja existe categoria com esse nome nesse tipo'
        }
      });
    }

    return renderWithBase(res, {
      title: 'Editar Categoria - RC2 Finance',
      content: 'partials/pages/edit-category-content',
      currentPath: '/categories',
      data: {
        category: {
          ...(category || { id: categoryId, type: 'expense' }),
          name: normalizedName,
          color: normalizedColor
        },
        error: 'Erro ao atualizar categoria'
      }
    });
  }
});

router.post('/delete/:id', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const categoryId = req.params.id;

  try {
    const [transactionCountRows] = await db.query(
      'SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND category_id = ?',
      [userId, categoryId]
    );

    let fixedExpenseCountRows = [{ count: 0 }];
    try {
      [fixedExpenseCountRows] = await db.query(
        'SELECT COUNT(*) AS count FROM fixed_expenses WHERE user_id = ? AND category_id = ?',
        [userId, categoryId]
      );
    } catch (fixedExpenseError) {
      if (fixedExpenseError.code !== 'ER_NO_SUCH_TABLE') throw fixedExpenseError;
    }

    if (transactionCountRows[0].count > 0 || fixedExpenseCountRows[0].count > 0) {
      const [categories] = await db.query(
        'SELECT * FROM categories WHERE user_id = ? ORDER BY type ASC, name ASC',
        [userId]
      );

      return renderWithBase(res, {
        title: 'Categorias - RC2 Finance',
        content: 'partials/pages/categories-content',
        currentPath: '/categories',
        data: {
          categories,
          error: 'Nao foi possivel excluir: categoria em uso por lancamentos'
        }
      });
    }

    await db.query('DELETE FROM categories WHERE id = ? AND user_id = ?', [categoryId, userId]);
    return res.redirect('/categories');
  } catch (error) {
    console.error(error);
    return res.redirect('/categories');
  }
});

module.exports = router;
