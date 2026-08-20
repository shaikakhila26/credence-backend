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

app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
const normalizeOrigin = (value) => {
  if (!value) return value;

  return value
    .trim()
    .replace(/\/+$/, '');
};

const frontendUrl =
  normalizeOrigin(
    process.env.FRONTEND_URL
  );

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  frontendUrl,
].filter(Boolean);

console.log(
  '[CORS] Allowed origins:',
  allowedOrigins
);

app.use(
  cors({
    origin(origin, callback) {
      /*
       * Allow requests without an Origin header.
       * Useful for health checks/server-to-server calls.
       */
      if (!origin) {
        return callback(
          null,
          true
        );
      }

      const normalizedOrigin =
        normalizeOrigin(origin);

      if (
        allowedOrigins.includes(
          normalizedOrigin
        )
      ) {
        return callback(
          null,
          true
        );
      }

      console.warn(
        `[CORS] Blocked origin: ${origin}`
      );

      return callback(
        new Error(
          'Not allowed by CORS'
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
    ],

    optionsSuccessStatus: 204,
  })
);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'credence-backend' }));

app.use('/api/applications', applicationsRoutes);
app.use('/api/eligibility', eligibilityRoutes);
app.use('/api/loan-terms', loanTermsRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth/phone', authPhoneRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/declaration', declarationRoutes);
app.use('/api/selfie', selfieRoutes);
app.use('/api/profile', profileRoutes);

// Central error handler (catches anything that slips past route try/catch)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`CREDENCE backend running on port ${PORT}`);
});
