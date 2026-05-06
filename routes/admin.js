const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const bcrypt = require('bcrypt');
const multer = require('multer');
const slugify = require('slugify');
const requireAuth = require('../middleware/auth');

const UPLOAD_BASE = process.env.UPLOAD_BASE || path.join(__dirname, '../public/uploads');

const mkStorage = (subdir) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_BASE, subdir);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});

const uploadFile  = multer({ storage: mkStorage('files'),  limits: { fileSize: 500 * 1024 * 1024 } });
const uploadVideo = multer({ storage: mkStorage('videos'), limits: { fileSize: 2000 * 1024 * 1024 } });
const uploadMedia = multer({ storage: mkStorage('media'),  limits: { fileSize: 100 * 1024 * 1024 } });

function makeSlug(title, table, excludeId = null) {
  let base = (slugify(title, { lower: true, strict: true }) || 'untitled').substring(0, 80);
  let slug = base, n = 1;
  while (true) {
    const row = excludeId
      ? db.prepare(`SELECT id FROM ${table} WHERE slug=? AND id!=?`).get(slug, excludeId)
      : db.prepare(`SELECT id FROM ${table} WHERE slug=?`).get(slug);
    if (!row) break;
    slug = `${base}-${n++}`;
  }
  return slug;
}

function formatBytes(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// ── AUTH ───────────────────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => res.redirect('/admin/dashboard'));

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin/dashboard');
  res.render('admin/login', { title: 'Admin Login — LEND' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.session.flash = { type: 'error', message: 'Invalid credentials.' };
    return res.redirect('/admin/login');
  }
  req.session.user = { id: user.id, username: user.username };
  res.redirect('/admin/dashboard');
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ── DASHBOARD ─────────────────────────────────────────────────────────

router.get('/dashboard', requireAuth, (req, res) => {
  const stats = {
    posts:           db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    posts_pub:       db.prepare('SELECT COUNT(*) as c FROM posts WHERE published=1').get().c,
    articles:        db.prepare('SELECT COUNT(*) as c FROM articles').get().c,
    articles_pub:    db.prepare('SELECT COUNT(*) as c FROM articles WHERE published=1').get().c,
    projects:        db.prepare('SELECT COUNT(*) as c FROM projects').get().c,
    projects_pub:    db.prepare('SELECT COUNT(*) as c FROM projects WHERE published=1').get().c,
    videos:          db.prepare('SELECT COUNT(*) as c FROM videos').get().c,
    notes:           db.prepare('SELECT COUNT(*) as c FROM notes').get().c,
    unread_contacts: db.prepare('SELECT COUNT(*) as c FROM contacts WHERE read=0').get().c,
    media_files:     db.prepare('SELECT COUNT(*) as c FROM media').get().c,
  };
  const recentContacts = db.prepare('SELECT * FROM contacts ORDER BY created_at DESC LIMIT 6').all();
  const recentPosts    = db.prepare('SELECT id, title, slug, published, created_at FROM posts ORDER BY created_at DESC LIMIT 5').all();
  res.render('admin/dashboard', {
    title: 'Dashboard — LEND Admin', section: 'dashboard',
    stats, recentContacts, recentPosts
  });
});

// ── BLOG ──────────────────────────────────────────────────────────────

router.get('/blog', requireAuth, (req, res) => {
  const posts = db.prepare('SELECT id, title, slug, published, featured, created_at, updated_at, tags FROM posts ORDER BY created_at DESC').all();
  res.render('admin/blog-index', { title: 'Blog Posts — LEND Admin', section: 'blog', posts });
});

router.get('/blog/new', requireAuth, (req, res) => {
  res.render('admin/content-edit', {
    title: 'New Post — LEND Admin', section: 'blog',
    item: null, type: 'post', action: '/admin/blog/new',
    cancelUrl: '/admin/blog', hasExcerpt: true, hasFeatured: true
  });
});

router.post('/blog/new', requireAuth, (req, res) => {
  const { title, excerpt, content, tags, published, featured } = req.body;
  if (!title) { req.session.flash = { type: 'error', message: 'Title is required.' }; return res.redirect('/admin/blog/new'); }
  const slug = makeSlug(title, 'posts');
  db.prepare('INSERT INTO posts (title, slug, excerpt, content, tags, published, featured) VALUES (?,?,?,?,?,?,?)')
    .run(title, slug, excerpt||'', content||'', tags||'', published?1:0, featured?1:0);
  req.session.flash = { type: 'success', message: `Post "${title}" created.` };
  res.redirect('/admin/blog');
});

router.get('/blog/:id/edit', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!post) return res.redirect('/admin/blog');
  res.render('admin/content-edit', {
    title: `Edit: ${post.title} — LEND Admin`, section: 'blog',
    item: post, type: 'post', action: `/admin/blog/${post.id}/edit`,
    cancelUrl: '/admin/blog', hasExcerpt: true, hasFeatured: true
  });
});

router.post('/blog/:id/edit', requireAuth, (req, res) => {
  const { title, excerpt, content, tags, published, featured } = req.body;
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.id);
  if (!post) return res.redirect('/admin/blog');
  const slug = makeSlug(title||post.title, 'posts', post.id);
  db.prepare("UPDATE posts SET title=?,slug=?,excerpt=?,content=?,tags=?,published=?,featured=?,updated_at=datetime('now') WHERE id=?")
    .run(title||post.title, slug, excerpt||'', content||'', tags||'', published?1:0, featured?1:0, post.id);
  req.session.flash = { type: 'success', message: 'Post updated.' };
  res.redirect('/admin/blog');
});

router.post('/blog/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Post deleted.' };
  res.redirect('/admin/blog');
});

// ── ARTICLES ──────────────────────────────────────────────────────────

router.get('/articles', requireAuth, (req, res) => {
  const articles = db.prepare('SELECT id, title, slug, published, created_at, updated_at, tags FROM articles ORDER BY created_at DESC').all();
  res.render('admin/articles-index', { title: 'Articles — LEND Admin', section: 'articles', articles });
});

router.get('/articles/new', requireAuth, (req, res) => {
  res.render('admin/content-edit', {
    title: 'New Article — LEND Admin', section: 'articles',
    item: null, type: 'article', action: '/admin/articles/new',
    cancelUrl: '/admin/articles', hasExcerpt: true, hasFeatured: false
  });
});

router.post('/articles/new', requireAuth, (req, res) => {
  const { title, excerpt, content, tags, published } = req.body;
  if (!title) { req.session.flash = { type: 'error', message: 'Title is required.' }; return res.redirect('/admin/articles/new'); }
  const slug = makeSlug(title, 'articles');
  db.prepare('INSERT INTO articles (title, slug, excerpt, content, tags, published) VALUES (?,?,?,?,?,?)')
    .run(title, slug, excerpt||'', content||'', tags||'', published?1:0);
  req.session.flash = { type: 'success', message: `Article "${title}" created.` };
  res.redirect('/admin/articles');
});

router.get('/articles/:id/edit', requireAuth, (req, res) => {
  const article = db.prepare('SELECT * FROM articles WHERE id=?').get(req.params.id);
  if (!article) return res.redirect('/admin/articles');
  res.render('admin/content-edit', {
    title: `Edit: ${article.title} — LEND Admin`, section: 'articles',
    item: article, type: 'article', action: `/admin/articles/${article.id}/edit`,
    cancelUrl: '/admin/articles', hasExcerpt: true, hasFeatured: false
  });
});

router.post('/articles/:id/edit', requireAuth, (req, res) => {
  const { title, excerpt, content, tags, published } = req.body;
  const article = db.prepare('SELECT * FROM articles WHERE id=?').get(req.params.id);
  if (!article) return res.redirect('/admin/articles');
  const slug = makeSlug(title||article.title, 'articles', article.id);
  db.prepare("UPDATE articles SET title=?,slug=?,excerpt=?,content=?,tags=?,published=?,updated_at=datetime('now') WHERE id=?")
    .run(title||article.title, slug, excerpt||'', content||'', tags||'', published?1:0, article.id);
  req.session.flash = { type: 'success', message: 'Article updated.' };
  res.redirect('/admin/articles');
});

router.post('/articles/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM articles WHERE id=?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Article deleted.' };
  res.redirect('/admin/articles');
});

// ── PROJECTS ──────────────────────────────────────────────────────────

router.get('/projects', requireAuth, (req, res) => {
  const projects = db.prepare('SELECT id, title, slug, status, published, featured, created_at, updated_at FROM projects ORDER BY created_at DESC').all();
  res.render('admin/projects-index', { title: 'Projects — LEND Admin', section: 'projects', projects });
});

router.get('/projects/new', requireAuth, (req, res) => {
  res.render('admin/project-edit', {
    title: 'New Project — LEND Admin', section: 'projects',
    project: null, files: [], formatBytes
  });
});

router.post('/projects/new', requireAuth, (req, res) => {
  const { title, description, content, technologies, status, repo_url, demo_url, published, featured } = req.body;
  if (!title) { req.session.flash = { type: 'error', message: 'Title is required.' }; return res.redirect('/admin/projects/new'); }
  const slug = makeSlug(title, 'projects');
  db.prepare('INSERT INTO projects (title, slug, description, content, technologies, status, repo_url, demo_url, published, featured) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(title, slug, description||'', content||'', technologies||'', status||'active', repo_url||'', demo_url||'', published?1:0, featured?1:0);
  req.session.flash = { type: 'success', message: `Project "${title}" created.` };
  res.redirect('/admin/projects');
});

router.get('/projects/files/:fileId/delete', requireAuth, (req, res) => {
  const file = db.prepare('SELECT * FROM project_files WHERE id=?').get(req.params.fileId);
  if (file) {
    const fp = path.join(__dirname, '../public/uploads/files', file.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.prepare('DELETE FROM project_files WHERE id=?').run(file.id);
    req.session.flash = { type: 'success', message: 'File deleted.' };
    return res.redirect(`/admin/projects/${file.project_id}/edit`);
  }
  res.redirect('/admin/projects');
});

router.get('/projects/:id/edit', requireAuth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!project) return res.redirect('/admin/projects');
  const files = db.prepare('SELECT * FROM project_files WHERE project_id=? ORDER BY created_at DESC').all(project.id);
  res.render('admin/project-edit', {
    title: `Edit: ${project.title} — LEND Admin`, section: 'projects',
    project, files, formatBytes
  });
});

router.post('/projects/:id/edit', requireAuth, (req, res) => {
  const { title, description, content, technologies, status, repo_url, demo_url, published, featured } = req.body;
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!project) return res.redirect('/admin/projects');
  const slug = makeSlug(title||project.title, 'projects', project.id);
  db.prepare("UPDATE projects SET title=?,slug=?,description=?,content=?,technologies=?,status=?,repo_url=?,demo_url=?,published=?,featured=?,updated_at=datetime('now') WHERE id=?")
    .run(title||project.title, slug, description||'', content||'', technologies||'', status||'active', repo_url||'', demo_url||'', published?1:0, featured?1:0, project.id);
  req.session.flash = { type: 'success', message: 'Project updated.' };
  res.redirect(`/admin/projects/${project.id}/edit`);
});

router.post('/projects/:id/delete', requireAuth, (req, res) => {
  const files = db.prepare('SELECT filename FROM project_files WHERE project_id=?').all(req.params.id);
  files.forEach(f => { const fp = path.join(__dirname, '../public/uploads/files', f.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); });
  db.prepare('DELETE FROM projects WHERE id=?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Project deleted.' };
  res.redirect('/admin/projects');
});

router.post('/projects/:id/upload', requireAuth, uploadFile.single('file'), (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id=?').get(req.params.id);
  if (!project || !req.file) { req.session.flash = { type: 'error', message: 'Upload failed.' }; return res.redirect(`/admin/projects/${req.params.id}/edit`); }
  db.prepare('INSERT INTO project_files (project_id, filename, original_name, size, mimetype, description) VALUES (?,?,?,?,?,?)')
    .run(project.id, req.file.filename, req.file.originalname, req.file.size, req.file.mimetype, req.body.description||'');
  req.session.flash = { type: 'success', message: `File "${req.file.originalname}" uploaded.` };
  res.redirect(`/admin/projects/${req.params.id}/edit`);
});

// ── VIDEOS ────────────────────────────────────────────────────────────

router.get('/videos', requireAuth, (req, res) => {
  const videos = db.prepare('SELECT id, title, slug, published, created_at, embed_url, filename FROM videos ORDER BY created_at DESC').all();
  res.render('admin/videos-index', { title: 'Videos — LEND Admin', section: 'videos', videos });
});

router.get('/videos/new', requireAuth, (req, res) => {
  res.render('admin/video-edit', { title: 'New Video — LEND Admin', section: 'videos', video: null });
});

router.post('/videos/new', requireAuth, uploadVideo.single('video_file'), (req, res) => {
  const { title, description, embed_url, published } = req.body;
  if (!title) { req.session.flash = { type: 'error', message: 'Title is required.' }; return res.redirect('/admin/videos/new'); }
  const slug = makeSlug(title, 'videos');
  db.prepare('INSERT INTO videos (title, slug, description, embed_url, filename, published) VALUES (?,?,?,?,?,?)')
    .run(title, slug, description||'', embed_url||'', req.file ? req.file.filename : '', published?1:0);
  req.session.flash = { type: 'success', message: `Video "${title}" added.` };
  res.redirect('/admin/videos');
});

router.get('/videos/:id/edit', requireAuth, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id=?').get(req.params.id);
  if (!video) return res.redirect('/admin/videos');
  res.render('admin/video-edit', { title: `Edit: ${video.title} — LEND Admin`, section: 'videos', video });
});

router.post('/videos/:id/edit', requireAuth, uploadVideo.single('video_file'), (req, res) => {
  const { title, description, embed_url, published } = req.body;
  const video = db.prepare('SELECT * FROM videos WHERE id=?').get(req.params.id);
  if (!video) return res.redirect('/admin/videos');
  const slug = makeSlug(title||video.title, 'videos', video.id);
  let filename = video.filename;
  if (req.file) {
    if (filename) { const fp = path.join(__dirname, '../public/uploads/videos', filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
    filename = req.file.filename;
  }
  db.prepare("UPDATE videos SET title=?,slug=?,description=?,embed_url=?,filename=?,published=?,updated_at=datetime('now') WHERE id=?")
    .run(title||video.title, slug, description||'', embed_url||'', filename, published?1:0, video.id);
  req.session.flash = { type: 'success', message: 'Video updated.' };
  res.redirect('/admin/videos');
});

router.post('/videos/:id/delete', requireAuth, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id=?').get(req.params.id);
  if (video && video.filename) { const fp = path.join(__dirname, '../public/uploads/videos', video.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
  db.prepare('DELETE FROM videos WHERE id=?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Video deleted.' };
  res.redirect('/admin/videos');
});

// ── NOTES ─────────────────────────────────────────────────────────────

router.get('/notes', requireAuth, (req, res) => {
  const notes = db.prepare('SELECT id, title, slug, public, created_at, updated_at, tags FROM notes ORDER BY updated_at DESC').all();
  res.render('admin/notes-index', { title: 'Notes — LEND Admin', section: 'notes', notes });
});

router.get('/notes/new', requireAuth, (req, res) => {
  res.render('admin/note-edit', { title: 'New Note — LEND Admin', section: 'notes', note: null });
});

router.post('/notes/new', requireAuth, (req, res) => {
  const { title, content, tags, isPublic } = req.body;
  if (!title) { req.session.flash = { type: 'error', message: 'Title is required.' }; return res.redirect('/admin/notes/new'); }
  const slug = makeSlug(title, 'notes');
  db.prepare('INSERT INTO notes (title, slug, content, tags, public) VALUES (?,?,?,?,?)')
    .run(title, slug, content||'', tags||'', isPublic?1:0);
  req.session.flash = { type: 'success', message: `Note "${title}" created.` };
  res.redirect('/admin/notes');
});

router.get('/notes/:id/edit', requireAuth, (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!note) return res.redirect('/admin/notes');
  res.render('admin/note-edit', { title: `Edit: ${note.title} — LEND Admin`, section: 'notes', note });
});

router.post('/notes/:id/edit', requireAuth, (req, res) => {
  const { title, content, tags, isPublic } = req.body;
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!note) return res.redirect('/admin/notes');
  const slug = makeSlug(title||note.title, 'notes', note.id);
  db.prepare("UPDATE notes SET title=?,slug=?,content=?,tags=?,public=?,updated_at=datetime('now') WHERE id=?")
    .run(title||note.title, slug, content||'', tags||'', isPublic?1:0, note.id);
  req.session.flash = { type: 'success', message: 'Note updated.' };
  res.redirect('/admin/notes');
});

router.post('/notes/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Note deleted.' };
  res.redirect('/admin/notes');
});

// ── ABOUT ─────────────────────────────────────────────────────────────

router.get('/about', requireAuth, (req, res) => {
  const aboutRow = db.prepare('SELECT content FROM about WHERE id=1').get();
  res.render('admin/about', {
    title: 'About Me — LEND Admin', section: 'about',
    content: aboutRow ? aboutRow.content : ''
  });
});

router.post('/about', requireAuth, (req, res) => {
  db.prepare("INSERT OR REPLACE INTO about (id, content, updated_at) VALUES (1, ?, datetime('now'))").run(req.body.content||'');
  req.session.flash = { type: 'success', message: 'About Me updated.' };
  res.redirect('/admin/about');
});

// ── CONTACTS ──────────────────────────────────────────────────────────

router.get('/contacts', requireAuth, (req, res) => {
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all();
  db.prepare('UPDATE contacts SET read=1 WHERE read=0').run();
  res.render('admin/contacts', { title: 'Messages — LEND Admin', section: 'contacts', contacts });
});

router.post('/contacts/:id/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id=?').run(req.params.id);
  req.session.flash = { type: 'success', message: 'Message deleted.' };
  res.redirect('/admin/contacts');
});

// ── MEDIA ─────────────────────────────────────────────────────────────

router.get('/media', requireAuth, (req, res) => {
  const files = db.prepare('SELECT * FROM media ORDER BY created_at DESC').all();
  res.render('admin/media', { title: 'Media Library — LEND Admin', section: 'media', files, formatBytes });
});

router.post('/media/upload', requireAuth, uploadMedia.array('files', 20), (req, res) => {
  if (!req.files || !req.files.length) { req.session.flash = { type: 'error', message: 'No files selected.' }; return res.redirect('/admin/media'); }
  const stmt = db.prepare('INSERT INTO media (filename, original_name, size, mimetype) VALUES (?,?,?,?)');
  req.files.forEach(f => stmt.run(f.filename, f.originalname, f.size, f.mimetype));
  req.session.flash = { type: 'success', message: `${req.files.length} file(s) uploaded.` };
  res.redirect('/admin/media');
});

router.post('/media/:id/delete', requireAuth, (req, res) => {
  const file = db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id);
  if (file) {
    const fp = path.join(__dirname, '../public/uploads/media', file.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.prepare('DELETE FROM media WHERE id=?').run(file.id);
  }
  req.session.flash = { type: 'success', message: 'File deleted.' };
  res.redirect('/admin/media');
});

// ── SETTINGS ──────────────────────────────────────────────────────────

router.get('/settings', requireAuth, (req, res) => {
  res.render('admin/settings', { title: 'Settings — LEND Admin', section: 'settings' });
});

router.post('/settings/password', requireAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    req.session.flash = { type: 'error', message: 'Current password is incorrect.' };
    return res.redirect('/admin/settings');
  }
  if (new_password !== confirm_password) {
    req.session.flash = { type: 'error', message: 'New passwords do not match.' };
    return res.redirect('/admin/settings');
  }
  if (new_password.length < 8) {
    req.session.flash = { type: 'error', message: 'Password must be at least 8 characters.' };
    return res.redirect('/admin/settings');
  }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(new_password, 10), user.id);
  req.session.flash = { type: 'success', message: 'Password updated.' };
  res.redirect('/admin/settings');
});

module.exports = router;
