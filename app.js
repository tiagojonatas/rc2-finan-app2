const express = require('express');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const db = require('./db'); // Adiciona a conexao com o banco
const helpers = require('./helpers'); // Import helpers
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET nao definido no .env. Gerado segredo temporario para esta execucao.');
}

// Configuracao do EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make helpers available in all EJS templates
app.use((req, res, next) => {
  res.locals.formatCurrency = helpers.formatCurrency;
  res.locals.formatDate = helpers.formatDate;
  res.locals.formatTime = helpers.formatTime;
  next();
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
if (isProduction) {
  app.set('trust proxy', 1);
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

// Static
app.use(express.static(path.join(__dirname, 'public')));

// Rotas
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const creditCardRoutes = require('./routes/credit-cards');
const fixedExpenseRoutes = require('./routes/fixed-expenses');
const categoryRoutes = require('./routes/categories');
app.use('/', indexRoutes);
app.use('/', authRoutes);
app.use('/transactions', transactionRoutes);
app.use('/credit-cards', creditCardRoutes);
app.use('/fixed-expenses', fixedExpenseRoutes);
app.use('/categories', categoryRoutes);

// Servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
