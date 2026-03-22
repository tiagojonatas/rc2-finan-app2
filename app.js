const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./db'); // Adiciona a conexão com o banco
const helpers = require('./helpers'); // Import helpers
const app = express();

// Configuração do EJS
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
app.use(session({
  secret: 'your-secret-key', // Change this to a secure secret
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
}));

// Static
app.use(express.static(path.join(__dirname, 'public')));

// Rotas
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const creditCardRoutes = require('./routes/credit-cards');
app.use('/', indexRoutes);
app.use('/', authRoutes);
app.use('/transactions', transactionRoutes);
app.use('/credit-cards', creditCardRoutes);

// Servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
