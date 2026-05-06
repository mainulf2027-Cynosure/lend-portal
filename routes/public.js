const express = require('express');
const router = express.Router();
const db = require('../db');
const { marked } = require('marked');

function md(text) { return text ? marked(text) : ''; }
function excerpt(text, len = 220) {
  if (!text) return '';
  const stripped = text.replace(/[#*`\[\]_~>]/g, '');
  return stripped.length > len ? stripped.substring(0, len).trim() + '...' : stripped.trim();
}

router.get('/', (req, res) => {
  const recentPosts = db.prepare(
    'SELECT title, slug, excerpt, created_at, tags FROM posts WHERE published=1 ORDER BY created_at DESC LIMIT 5'
  ).all();
  const featuredProjects = db.prepare(
    'SELECT title, slug, description, technologies, status FROM projects WHERE published=1 AND featured=1 ORDER BY updated_at DESC LIMIT 4'
  ).all();
  const recentProjects = featuredProjects.length
    ? featuredProjects
    : db.prepare('SELECT title, slug, description, technologies, status FROM projects WHERE published=1 ORDER BY updated_at DESC LIMIT 4').all();
  const publicNotes = db.prepare(
    'SELECT title, slug, created_at FROM notes WHERE public=1 ORDER BY updated_at DESC LIMIT 5'
  ).all();
  const aboutRow = db.prepare('SELECT content FROM about WHERE id=1').get();
  const aboutSnippet = aboutRow && aboutRow.content ? md(aboutRow.content.substring(0, 600)) : '';

  res.render('public/home', {
    title: 'LEND — Mainul Fahad',
    activePage: 'home',
    recentPosts, recentProjects, publicNotes, aboutSnippet
  });
});

router.get('/blog', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  const posts = db.prepare(
    'SELECT title, slug, excerpt, created_at, tags FROM posts WHERE published=1 ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
  const { total } = db.prepare('SELECT COUNT(*) as total FROM posts WHERE published=1').get();
  res.render('public/blog', {
    title: 'Blog — LEND', activePage: 'blog',
    posts, currentPage: page, totalPages: Math.ceil(total / limit), total
  });
});

router.get('/blog/:slug', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug=? AND published=1').get(req.params.slug);
  if (!post) return res.status(404).render('public/404', { title: '404 — Not Found', activePage: '' });
  res.render('public/post', {
    title: `${post.title} — LEND`, activePage: 'blog', post, content: md(post.content)
  });
});

router.get('/articles', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  const articles = db.prepare(
    'SELECT title, slug, excerpt, created_at, tags FROM articles WHERE published=1 ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
  const { total } = db.prepare('SELECT COUNT(*) as total FROM articles WHERE published=1').get();
  res.render('public/articles', {
    title: 'Articles — LEND', activePage: 'articles',
    articles, currentPage: page, totalPages: Math.ceil(total / limit), total
  });
});

router.get('/articles/:slug', (req, res) => {
  const article = db.prepare('SELECT * FROM articles WHERE slug=? AND published=1').get(req.params.slug);
  if (!article) return res.status(404).render('public/404', { title: '404 — Not Found', activePage: '' });
  res.render('public/article', {
    title: `${article.title} — LEND`, activePage: 'articles',
    article, content: md(article.content)
  });
});

router.get('/projects', (req, res) => {
  const projects = db.prepare(
    'SELECT * FROM projects WHERE published=1 ORDER BY featured DESC, updated_at DESC'
  ).all();
  res.render('public/projects', { title: 'Projects — LEND', activePage: 'projects', projects });
});

router.get('/projects/:slug', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE slug=? AND published=1').get(req.params.slug);
  if (!project) return res.status(404).render('public/404', { title: '404 — Not Found', activePage: '' });
  const files = db.prepare('SELECT * FROM project_files WHERE project_id=? ORDER BY created_at DESC').all(project.id);
  res.render('public/project', {
    title: `${project.title} — LEND`, activePage: 'projects',
    project, files, content: md(project.content),
    formatBytes: (b) => {
      if (!b) return '0 B';
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1048576).toFixed(1) + ' MB';
    }
  });
});

router.get('/projects/:slug/download/:fileId', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE slug=? AND published=1').get(req.params.slug);
  if (!project) return res.status(404).send('Not found');
  const file = db.prepare('SELECT * FROM project_files WHERE id=? AND project_id=?').get(req.params.fileId, project.id);
  if (!file) return res.status(404).send('Not found');
  const uploadBase = process.env.UPLOAD_BASE || require('path').join(__dirname, '../public/uploads');
  res.download(require('path').join(uploadBase, 'files', file.filename), file.original_name);
});

router.get('/videos', (req, res) => {
  const videos = db.prepare('SELECT * FROM videos WHERE published=1 ORDER BY created_at DESC').all();
  res.render('public/videos', { title: 'Videos — LEND', activePage: 'videos', videos });
});

router.get('/notes', (req, res) => {
  const notes = db.prepare(
    'SELECT title, slug, content, created_at, tags FROM notes WHERE public=1 ORDER BY updated_at DESC'
  ).all();
  res.render('public/notes', { title: 'Notes — LEND', activePage: 'notes', notes, excerpt });
});

router.get('/notes/:slug', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE slug=? AND public=1').get(req.params.slug);
  if (!note) return res.status(404).render('public/404', { title: '404 — Not Found', activePage: '' });
  res.render('public/note', {
    title: `${note.title} — LEND`, activePage: 'notes', note, content: md(note.content)
  });
});

router.get('/about', (req, res) => {
  const aboutRow = db.prepare('SELECT content FROM about WHERE id=1').get();
  res.render('public/about', {
    title: 'About — LEND', activePage: 'about',
    content: md(aboutRow ? aboutRow.content : '')
  });
});

router.get('/contact', (req, res) => {
  res.render('public/contact', { title: 'Contact — LEND', activePage: 'contact' });
});

router.post('/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    req.session.flash = { type: 'error', message: 'Name, email, and message are required.' };
    return res.redirect('/contact');
  }
  db.prepare('INSERT INTO contacts (name, email, subject, message) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email.trim(), (subject || '').trim(), message.trim());
  req.session.flash = { type: 'success', message: 'Message received. Thank you for reaching out.' };
  res.redirect('/contact');
});

module.exports = router;
