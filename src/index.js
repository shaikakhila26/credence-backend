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
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || '*',
    credentials: true,
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
