const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  if (req.session.userRole !== 'admin') {
    return res.redirect('/dashboard');
  }
  return next();
}

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'user';
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY id ASC'
    );
    return res.render('admin-dashboard', {
      users,
      totalUsers: users.length,
      totalAdmins: users.filter((user) => user.role === 'admin').length
    });
  } catch (error) {
    console.error(error);
    return res.render('admin-dashboard', {
      users: [],
      totalUsers: 0,
      totalAdmins: 0
    });
  }
});

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, name, email, role, created_at FROM users ORDER BY id ASC'
    );
    return res.render('admin-users', {
      users,
      error: null,
      success: req.query.success || null,
      currentUserId: req.session.userId
    });
  } catch (error) {
    console.error(error);
    return res.render('admin-users', {
      users: [],
      error: 'Erro ao carregar usuarios',
      success: null,
      currentUserId: req.session.userId
    });
  }
});

router.get('/users/add', requireAdmin, (req, res) => {
  return res.render('admin-user-form', {
    mode: 'add',
    user: { name: '', email: '', role: 'user' },
    error: null
  });
});

router.post('/users/add', requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  const normalizedName = (name || '').trim();
  const normalizedEmail = (email || '').trim().toLowerCase();
  const normalizedRole = normalizeRole(role);

  if (!normalizedName || !normalizedEmail || !password) {
    return res.render('admin-user-form', {
      mode: 'add',
      user: { name: normalizedName, email: normalizedEmail, role: normalizedRole },
      error: 'Nome, email e senha sao obrigatorios'
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [normalizedName, normalizedEmail, hashedPassword, normalizedRole]
    );
    return res.redirect('/admin/users?success=Usuario criado com sucesso');
  } catch (error) {
    console.error(error);
    const errorMessage = error.code === 'ER_DUP_ENTRY'
      ? 'Email ja cadastrado'
      : 'Erro ao criar usuario';
    return res.render('admin-user-form', {
      mode: 'add',
      user: { name: normalizedName, email: normalizedEmail, role: normalizedRole },
      error: errorMessage
    });
  }
});

router.get('/users/edit/:id', requireAdmin, async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) {
    return res.redirect('/admin/users');
  }

  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!rows.length) {
      return res.redirect('/admin/users');
    }

    return res.render('admin-user-form', {
      mode: 'edit',
      user: rows[0],
      error: null
    });
  } catch (error) {
    console.error(error);
    return res.redirect('/admin/users');
  }
});

router.post('/users/edit/:id', requireAdmin, async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  const { name, email, password, role } = req.body;
  const normalizedName = (name || '').trim();
  const normalizedEmail = (email || '').trim().toLowerCase();
  const normalizedRole = normalizeRole(role);

  if (Number.isNaN(userId)) {
    return res.redirect('/admin/users');
  }

  if (!normalizedName || !normalizedEmail) {
    return res.render('admin-user-form', {
      mode: 'edit',
      user: { id: userId, name: normalizedName, email: normalizedEmail, role: normalizedRole },
      error: 'Nome e email sao obrigatorios'
    });
  }

  try {
    if (password && password.trim()) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.query(
        'UPDATE users SET name = ?, email = ?, role = ?, password_hash = ? WHERE id = ?',
        [normalizedName, normalizedEmail, normalizedRole, hashedPassword, userId]
      );
    } else {
      await db.query(
        'UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?',
        [normalizedName, normalizedEmail, normalizedRole, userId]
      );
    }

    return res.redirect('/admin/users?success=Usuario atualizado com sucesso');
  } catch (error) {
    console.error(error);
    const errorMessage = error.code === 'ER_DUP_ENTRY'
      ? 'Email ja cadastrado'
      : 'Erro ao atualizar usuario';
    return res.render('admin-user-form', {
      mode: 'edit',
      user: { id: userId, name: normalizedName, email: normalizedEmail, role: normalizedRole },
      error: errorMessage
    });
  }
});

router.post('/users/delete/:id', requireAdmin, async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  const currentUserId = req.session.userId;

  if (Number.isNaN(userId)) {
    return res.redirect('/admin/users');
  }

  if (userId === currentUserId) {
    return res.redirect('/admin/users?success=Voce nao pode excluir seu proprio usuario');
  }

  async function safeDelete(connection, sql, params = []) {
    try {
      await connection.query(sql, params);
    } catch (error) {
      if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    }
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Remove dependencias financeiras do usuario antes de excluir a conta.
    await safeDelete(
      connection,
      `DELETE ct
       FROM card_transactions ct
       INNER JOIN credit_cards cc ON cc.id = ct.card_id
       WHERE cc.user_id = ?`,
      [userId]
    );
    await safeDelete(connection, 'DELETE FROM credit_cards WHERE user_id = ?', [userId]);
    await safeDelete(connection, 'DELETE FROM transactions WHERE user_id = ?', [userId]);
    await safeDelete(connection, 'DELETE FROM fixed_expenses WHERE user_id = ?', [userId]);
    await safeDelete(connection, 'DELETE FROM categories WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM users WHERE id = ?', [userId]);

    await connection.commit();
    return res.redirect('/admin/users?success=Usuario excluido com sucesso');
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Erro ao fazer rollback da exclusao de usuario:', rollbackError);
      }
    }
    console.error(error);
    return res.redirect('/admin/users');
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

module.exports = router;
