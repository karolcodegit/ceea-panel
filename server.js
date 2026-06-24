const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const WebSocket = require('ws');

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    realtime: {
      transport: WebSocket
    }
  }
);

const app = express();

// Middleware
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Sesje
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

// Sprawdź czy zalogowany
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/');
  next();
};

// ===== STRONY =====

// Logowanie
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/kursy');
  res.render('login', { error: null, message: null });
});

// Wysłanie Magic Link
app.post('/login', async (req, res) => {
  const { email } = req.body;

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('id')
    .eq('email', email)
    .eq('status', 'active')
    .limit(1);

  if (!enrollments?.length) {
    return res.render('login', {
      error: 'Ten email nie jest zapisany na kurs.',
      message: null
    });
  }

  // Supabase Magic Link
  const { error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: { redirectTo: 'https://panel.ceea.org.pl/auth/callback' }
  });

  if (error) {
    return res.render('login', {
      error: 'Błąd wysyłania. Spróbuj ponownie.',
      message: null
    });
  }

  res.render('login', {
    error: null,
    message: 'Sprawdź email z linkiem logowania!'
  });
});

// Callback po kliknięciu w Magic Link
app.get('/auth/callback', async (req, res) => {
  const { token_hash } = req.query;

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash,
    type: 'magiclink'
  });

  if (error) {
    return res.render('login', {
      error: 'Link wygasł lub jest nieprawidłowy.',
      message: null
    });
  }

  req.session.user = {
    id: data.user.id,
    email: data.user.email
  };

  res.redirect('/kursy');
});

// Panel z kursami (wymaga logowania)
app.get('/kursy', requireAuth, async (req, res) => {
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('courses(id, name, description, materials(title, type, url, order))')
    .eq('email', req.session.user.email)
    .eq('status', 'active');

  res.render('dashboard', {
    user: req.session.user,
    courses: enrollments?.map(e => e.courses) || []
  });
});

// Wylogowanie
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Panel działa na http://localhost:${PORT}`);
});