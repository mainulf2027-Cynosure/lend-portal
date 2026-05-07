const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  console.warn('[WARN] SESSION_SECRET is not set — using insecure default. Set it in App Service Configuration.');
}

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "*"],
      frameSrc: ["'self'", "https:"],
      mediaSrc: ["'self'", "blob:", "*"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests — please try again later.',
}));

const UPLOAD_BASE = process.env.UPLOAD_BASE || path.join(__dirname, 'public/uploads');
app.use('/uploads', express.static(UPLOAD_BASE));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'lend-portal-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
  }
}));

// CSRF — synchronizer token stored in session
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  next();
});

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.body?._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrf) {
    return res.status(403).render('public/404', { title: '403 — Forbidden', activePage: '' });
  }
  next();
});

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
