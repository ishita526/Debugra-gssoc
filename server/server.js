require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const executeRoutes = require('./routes/execute');
const aiRoutes = require('./routes/ai');
const memoryRoutes = require('./routes/memory');
const memoryTracker = require('./middleware/memoryTracker');
const memoryProfiler = require('./services/memoryProfiler');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';
const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  process.env.CLIENT_URL ||
  defaultDevOrigins.join(',')
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// ──────────────────────────────────────────────
// Security Headers (all six required headers)
// ──────────────────────────────────────────────
app.use(helmet({
  // 1. Strict-Transport-Security — force HTTPS for 1 year (prod only)
  strictTransportSecurity: isProd
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,

  // 2. Content-Security-Policy — tight API-only policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'none'"],
      scriptSrc:      ["'none'"],
      styleSrc:       ["'none'"],
      imgSrc:         ["'none'"],
      connectSrc:     ["'self'"],
      fontSrc:        ["'none'"],
      objectSrc:      ["'none'"],
      mediaSrc:       ["'none'"],
      frameSrc:       ["'none'"],
      frameAncestors: ["'none'"],
      formAction:     ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },

  // 3. X-Frame-Options — prevent clickjacking
  frameguard: { action: 'deny' },

  // 4. X-Content-Type-Options — prevent MIME sniffing
  noSniff: true,

  // 5. Referrer-Policy — no referrer leakage from API
  referrerPolicy: { policy: 'no-referrer' },

  // Other useful helmet defaults kept on
  xssFilter: true,
  hidePoweredBy: true,
  ieNoOpen: true,
}));

// 6. Permissions-Policy — helmet doesn't set this natively; add manually
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
  );
  next();
});

// ──────────────────────────────────────────────
// CORS
// ──────────────────────────────────────────────
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

// ──────────────────────────────────────────────
// Rate Limiting
// ──────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

// ──────────────────────────────────────────────
// Body Parsing & Compression
// ──────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(memoryTracker);

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/execute', executeRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin/memory-profile', memoryRoutes);

// ──────────────────────────────────────────────
// Error Handler
// ──────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Debugra server running on port ${PORT}`);
  console.log(`🔒 Security headers: HSTS=${isProd}, CSP=on, Permissions-Policy=on`);
  memoryProfiler.start();
});
