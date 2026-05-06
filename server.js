const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const UPLOAD_BASE = process.env.UPLOAD_BASE || path.join(__dirname, 'public/uploads');
app.use('/uploads', express.static(UPLOAD_BASE));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'lend-portal-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  res.locals.user = req.session.user || null;
  delete req.session.flash;
  next();
});

app.use('/', require('./routes/public'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('public/404', { title: '404 — Not Found', activePage: '' });
});

app.listen(PORT, () => {
  console.log(`\nLEND Portal — http://localhost:${PORT}`);
  console.log(`Admin panel  — http://localhost:${PORT}/admin\n`);
});
