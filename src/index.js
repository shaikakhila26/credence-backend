require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const applicationsRoutes = require('./routes/applications');
const eligibilityRoutes = require('./routes/eligibility');
const loanTermsRoutes = require('./routes/loanTerms');
const bankRoutes = require('./routes/bank');
const adminRoutes = require('./routes/admin');
const authPhoneRoutes = require('./routes/authPhone');
const kycRoutes = require('./routes/kyc');
const declarationRoutes = require('./routes/declaration');
const selfieRoutes = require('./routes/selfie');
const profileRoutes = require('./routes/profile');

const app = express();

/*
|--------------------------------------------------------------------------
| Basic middleware
|--------------------------------------------------------------------------
*/

app.use(helmet());

app.use(morgan('dev'));

app.use(
  express.json({
    limit: '10mb',
  })
);

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
|
| IMPORTANT:
| FRONTEND_URL in Render MUST be:
|
| https://credence-frontend-gules.vercel.app
|
| NOT:
|
| https://credence-frontend-gules.vercel.app/
|
|--------------------------------------------------------------------------
*/

function normalizeOrigin(value) {
  if (!value) {
    return null;
  }

  return String(value)
    .trim()
    .replace(/\/+$/, '');
}

const frontendUrl =
  normalizeOrigin(
    process.env.FRONTEND_URL
  );

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  frontendUrl,
]
  .filter(Boolean)
  .map(normalizeOrigin);

console.log(
  '[CORS] FRONTEND_URL from environment:',
  process.env.FRONTEND_URL || '(not set)'
);

console.log(
  '[CORS] Allowed origins:',
  allowedOrigins
);

app.use(
  cors({
    origin(origin, callback) {
      /*
       * Requests without an Origin header are allowed.
       *
       * Examples:
       * - Render health checks
       * - curl
       * - server-to-server requests
       */
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin =
        normalizeOrigin(origin);

      if (
        allowedOrigins.includes(
          normalizedOrigin
        )
      ) {
        return callback(null, true);
      }

      console.warn(
        `[CORS] Blocked origin: ${origin}`
      );

      return callback(
        new Error(
          `Origin ${origin} is not allowed by CORS`
        )
      );
    },

    credentials: true,

    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
    ],

    exposedHeaders: [
      'Content-Length',
      'Content-Type',
    ],

    optionsSuccessStatus: 204,
  })
);

/*
|--------------------------------------------------------------------------
| Health checks
|--------------------------------------------------------------------------
*/

app.get(
  '/',
  (req, res) => {
    res.json({
      success: true,
      service: 'CREDENCE Backend',
      status: 'running',
    });
  }
);

app.get(
  '/health',
  (req, res) => {
    res.json({
      status: 'ok',
      service: 'credence-backend',
      timestamp:
        new Date().toISOString(),
    });
  }
);

/*
|--------------------------------------------------------------------------
| API routes
|--------------------------------------------------------------------------
*/

app.use(
  '/api/applications',
  applicationsRoutes
);

app.use(
  '/api/eligibility',
  eligibilityRoutes
);

app.use(
  '/api/loan-terms',
  loanTermsRoutes
);

app.use(
  '/api/bank',
  bankRoutes
);

app.use(
  '/api/admin',
  adminRoutes
);

app.use(
  '/api/auth/phone',
  authPhoneRoutes
);

app.use(
  '/api/kyc',
  kycRoutes
);

app.use(
  '/api/declaration',
  declarationRoutes
);

app.use(
  '/api/selfie',
  selfieRoutes
);

app.use(
  '/api/profile',
  profileRoutes
);

/*
|--------------------------------------------------------------------------
| 404 handler
|--------------------------------------------------------------------------
*/

app.use(
  (req, res) => {
    res.status(404).json({
      error: 'Route not found',
      path: req.originalUrl,
    });
  }
);

/*
|--------------------------------------------------------------------------
| Central error handler
|--------------------------------------------------------------------------
*/

app.use(
  (err, req, res, next) => {
    console.error(
      'Unhandled error:',
      err
    );

    if (
      err.message &&
      err.message.includes(
        'not allowed by CORS'
      )
    ) {
      return res.status(403).json({
        error:
          'CORS origin not allowed',
      });
    }

    res.status(500).json({
      error:
        'Something went wrong',
    });
  }
);

/*
|--------------------------------------------------------------------------
| Server
|--------------------------------------------------------------------------
*/

const PORT =
  process.env.PORT || 5000;

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `CREDENCE backend running on port ${PORT}`
    );
  }
);