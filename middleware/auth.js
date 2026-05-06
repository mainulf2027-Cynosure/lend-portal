module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.session.flash = { type: 'error', message: 'Access denied. Authentication required.' };
  res.redirect('/admin/login');
};
