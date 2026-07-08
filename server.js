
const express = require('express');
const path = require('path');
const session = require('express-session');
const speakeasy = require('speakeasy');
const cookieParser = require('cookie-parser');

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const { initializeAdmins } = require('./config/admins');
const authRoutes = require('./routes/auth');

const WebSocket = require('ws');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    realtime: { transport: WebSocket }
  }
);

const app = express();
app.use(cookieParser());
// Proste EJS bez ejs-mate
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

app.use(express.static(path.join(__dirname, 'public')));

// ===== INICJALIZACJA TOTP ADMINÓW =====
app.locals.admins = new Map();
app.locals.sessions = new Map();

initializeAdmins().then(admins => {
    app.locals.admins = admins;
    console.log('Admini TOTP zainicjalizowani:', admins.size);
});

app.use('/api/auth', authRoutes);

// ===== MIDDLEWARE =====

// Middleware: sprawdź czy użytkownik zalogowany (magic link)
const requireAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/');
};

// Middleware: sprawdź czy admin zalogowany przez TOTP
const requireAdmin = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
             || req.cookies?.adminToken;

  const session = app.locals.sessions.get(token);

  if (session && session.expires > Date.now()) {
    req.admin = app.locals.admins.get(session.email);
    req.session.isAdmin = true;
    return next();
  }

  // Nie zalogowany — redirect do logowania admina
  res.redirect('/admin');
};

// ===== PANEL ADMINISTRATORA (TOTP) =====

// Strona logowania admina
app.get('/admin', (req, res) => {
  res.render('admin-login', { error: null, year: new Date().getFullYear() });
  
});

// Wylogowanie admina
app.get('/admin/wyloguj', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
             || req.cookies?.adminToken;
  app.locals.sessions.delete(token);
  req.session.isAdmin = false;
  res.redirect('/admin');
});

// Lista kursów
app.get('/admin/kursy', requireAdmin, async (req, res) => {
  const { data: courses } = await supabase
    .from('courses')
    .select('*')
    .order('name');

  res.render('admin-kursy', { isAdmin: true, courses: courses || [] });
});

// Dodaj kurs
app.post('/admin/kursy', requireAdmin, async (req, res) => {
  const { name, description } = req.body;

  const { data, error } = await supabase
    .from('courses')
    .insert([{ name, description }])
    .select();

  if (error) {
    console.log('BŁĄD SUPABASE:', error);
    return res.render('admin-kursy', {
      isAdmin: true,
      courses: [],
      error: error.message
    });
  }

  res.redirect('/admin/kursy');
});

// Materiały kursu
app.get('/admin/kursy/:id/materials', requireAdmin, async (req, res) => {
  const { data: course } = await supabase
    .from('courses')
    .select('*')
    .eq('id', req.params.id)
    .single();

  const { data: materials } = await supabase
    .from('materials')
    .select('*')
    .eq('course_id', req.params.id)
    .order('order');

  res.render('admin-materiały', { isAdmin: true, course, materials: materials || [] });
});

// Dodaj materiał (tylko link)
app.post('/admin/kursy/:id/materiały', requireAdmin, async (req, res) => {
  const { title, type, url, order } = req.body;

  await supabase.from('materials').insert([{
    course_id: req.params.id,
    title,
    type,
    url,
    order: parseInt(order) || 1
  }]);

  res.redirect(`/admin/kursy/${req.params.id}/materiały`);
});

// Usuń materiał
app.post('/admin/materiały/:id/usuń', requireAdmin, async (req, res) => {
  const { data: material } = await supabase
    .from('materials')
    .select('course_id')
    .eq('id', req.params.id)
    .single();

  await supabase.from('materials').delete().eq('id', req.params.id);

  res.redirect(`/admin/kursy/${material.course_id}/materials`);
});

// Uczestnicy kursu
app.get('/admin/kursy/:id/uczestnicy', requireAdmin, async (req, res) => {
  const { data: course } = await supabase
    .from('courses')
    .select('*')
    .eq('id', req.params.id)
    .single();

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('*')
    .eq('course_id', req.params.id);

  res.render('admin-uczestnicy', { isAdmin: true, course, enrollments: enrollments || [] });
});

// Dodaj uczestnika
app.post('/admin/kursy/:id/uczestnicy', requireAdmin, async (req, res) => {
  const { email } = req.body;

  await supabase.from('enrollments').insert([{
    course_id: req.params.id,
    email,
    status: 'active'
  }]);

  res.redirect(`/admin/kursy/${req.params.id}/uczestnicy`);
});

// ===== NORMALNE TRASY (UCZESTNICY) =====

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/kursy');
  res.render('login', {
    title: 'Logowanie — CEEA',
    error: null,
    message: null
  });
});

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

app.get('/kursy', requireAuth, async (req, res) => {
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select(`
      courses (
        id,
        name,
        description,
        materials (
          title,
          type,
          url,
          order_num
        )
      )
    `)
    .eq('email', req.session.user.email)
    .eq('status', 'active');

  res.render('dashboard', {
    title: 'Moje kursy — CEEA',
    user: req.session.user,
    courses: enrollments?.map(e => e.courses) || []
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});



app.get('/api/admin/force-reset', (req, res) => {
  const { email } = req.query;
  const admin = app.locals.admins.get(email);
  if (!admin) return res.status(404).send('Admin nie istnieje');
  
  const newSecret = require('speakeasy').generateSecret({
      name: `Panel: ${admin.name}`,
      length: 32
  });
  
  admin.secret = newSecret.base32;
  admin.qrSetup = false;
  
  console.log('Nowy secret:', admin.secret);
  res.send(`Zresetowano ${email}. Zaloguj się ponownie.`);
});



const PORT = process.env.PORT || 3000;

// Sprawdź czy to Vercel (serverless) czy lokalny serwer
if (process.env.VERCEL) {
    // Vercel — exportuj app
    module.exports = app;
} else {
    // Lokalnie — uruchom serwer
    app.listen(PORT, () => {
        console.log(`Panel działa na http://localhost:${PORT}`);
    });
}