const express =
  require('express');

const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

const {
  requireAuth,
} = require('../middleware/auth');

const router =
  express.Router();

const IFSC_BASE =
  process.env.RAZORPAY_IFSC_BASE ||
  'https://ifsc.razorpay.com';

/*
 * Offline/demo IFSC records.
 *
 * The company challenge explicitly allows bank details and
 * third-party services to be simulated. These demo codes make
 * the application functional even when the external IFSC API
 * is unavailable.
 */
const DEMO_IFSC = {
  DEMO000001: {
    BANK: 'CREDENCE Demo Bank',
    BRANCH: 'Main Branch',
    ADDRESS: 'Demo Address',
    CITY: 'Bengaluru',
    STATE: 'Karnataka',
  },

  DEMO000002: {
    BANK: 'CREDENCE Demo Bank',
    BRANCH: 'Hyderabad Branch',
    ADDRESS: 'Demo Financial District',
    CITY: 'Hyderabad',
    STATE: 'Telangana',
  },
};

async function lookupIFSC(code) {
  if (DEMO_IFSC[code]) {
    return {
      ...DEMO_IFSC[code],
      source: 'simulated',
    };
  }

  try {
    const response =
      await fetch(
        `${IFSC_BASE}/${code}`
      );

    if (!response.ok) {
      return null;
    }

    const data =
      await response.json();

    return {
      ...data,
      source: 'external',
    };
  } catch {
    /*
     * External integration is optional for the challenge.
     * Returning null lets the caller decide whether to fail.
     */
    return null;
  }
}

/*
 * IFSC lookup
 */
router.get(
  '/ifsc/:code',
  requireAuth,
  async (req, res) => {
    try {
      const code =
        req.params.code
          .toUpperCase()
          .trim();

      const data =
        await lookupIFSC(code);

      if (!data) {
        return res.status(404).json({
          error:
            'IFSC code not found',

          valid: false,
        });
      }

      res.json({
        valid: true,
        bank: data.BANK,
        branch: data.BRANCH,
        address:
          data.ADDRESS,
        city: data.CITY,
        state: data.STATE,
        source:
          data.source || 'external',
      });
    } catch (err) {
      console.error(
        'GET /bank/ifsc/:code error:',
        err
      );

      res.status(500).json({
        error:
          'IFSC lookup failed',
      });
    }
  }
);

/*
 * SAVE / UPDATE BANK ACCOUNT
 */
router.post(
  '/accounts',
  requireAuth,
  async (req, res) => {
    try {
      const {
        applicationId,
        accountHolderName,
        accountNumber,
        ifscCode,
      } = req.body;

      const {
        data: application,
        error: appError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .select(
            'id,user_id,current_stage'
          )
          .eq(
            'id',
            applicationId
          )
          .single();

      if (
        appError ||
        !application ||
        application.user_id !==
          req.user.id
      ) {
        return res.status(403).json({
          error:
            'Not your application',
        });
      }

      if (
        [
          'under_review',
          'approved',
          'rejected',
          'disbursed',
          'closed',
        ].includes(
          application.current_stage
        )
      ) {
        return res.status(400).json({
          error:
            'This application is no longer editable.',
        });
      }

      if (
        !accountHolderName?.trim() ||
        !accountNumber?.trim() ||
        !ifscCode?.trim()
      ) {
        return res.status(400).json({
          error:
            'Account holder name, account number and IFSC code are required.',
        });
      }

      const code =
        ifscCode
          .toUpperCase()
          .trim();

      let bankName =
        null;

      let branch =
        null;

      let verified =
        false;

      const ifscData =
        await lookupIFSC(code);

      if (ifscData) {
        bankName =
          ifscData.BANK;

        branch =
          ifscData.BRANCH;

        verified =
          true;
      }

      if (!verified) {
        return res.status(400).json({
          error:
            'Please verify a valid IFSC code before saving the bank account.',
        });
      }

      const payload = {
        application_id:
          applicationId,

        account_holder_name:
          accountHolderName.trim(),

        account_number:
          accountNumber.trim(),

        ifsc_code:
          code,

        bank_name:
          bankName,

        branch,

        ifsc_verified:
          true,
      };

      /*
       * UPDATE existing bank account instead of
       * inserting duplicate records.
       */
      const {
        data: existing,
        error:
          existingError,
      } =
        await supabaseAdmin
          .from(
            'bank_accounts'
          )
          .select('id')
          .eq(
            'application_id',
            applicationId
          )
          .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      let saved;

      if (existing) {
        const {
          data,
          error,
        } =
          await supabaseAdmin
            .from(
              'bank_accounts'
            )
            .update(
              payload
            )
            .eq(
              'id',
              existing.id
            )
            .eq(
              'application_id',
              applicationId
            )
            .select()
            .single();

        if (error) {
          throw error;
        }

        saved =
          data;
      } else {
        const {
          data,
          error,
        } =
          await supabaseAdmin
            .from(
              'bank_accounts'
            )
            .insert(
              payload
            )
            .select()
            .single();

        if (error) {
          throw error;
        }

        saved =
          data;
      }

      res.json({
        bankAccount:
          saved,
      });
    } catch (err) {
      console.error(
        'POST /bank/accounts error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to save bank account',

        detail:
          process.env.NODE_ENV !==
          'production'
            ? err.message
            : undefined,
      });
    }
  }
);

module.exports =
  router;