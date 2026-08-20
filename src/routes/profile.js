const express = require('express');

const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

const {
  requireAuth,
} = require('../middleware/auth');

const router = express.Router();

function normalizePhone(raw) {
  let phone = String(raw || '')
    .trim()
    .replace(/[\s()-]/g, '');

  if (
    !phone.startsWith('+') &&
    /^\d{10}$/.test(phone)
  ) {
    phone =
      `+91${phone}`;
  }

  return phone;
}

function isValidPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(
    phone
  );
}

router.post(
  '/phone',
  requireAuth,
  async (req, res) => {
    try {
      const phone =
        normalizePhone(
          req.body?.phone
        );

      if (
        !isValidPhone(
          phone
        )
      ) {
        return res.status(400).json({
          error:
            'Enter a valid phone number with country code.',
        });
      }

      const {
        data: existing,
        error: existingError,
      } =
        await supabaseAdmin
          .from(
            'profiles'
          )
          .select('id')
          .eq(
            'phone',
            phone
          )
          .neq(
            'id',
            req.user.id
          )
          .maybeSingle();

      if (
        existingError
      ) {
        throw existingError;
      }

      if (existing) {
        return res.status(409).json({
          error:
            'An account already exists with this phone number.',
        });
      }

      const {
        data,
        error,
      } =
        await supabaseAdmin
          .from(
            'profiles'
          )
          .update({
            phone,

            phone_verified:
              false,
          })
          .eq(
            'id',
            req.user.id
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      res.json({
        profile:
          data,
      });
    } catch (err) {
      console.error(
        'POST /profile/phone error:',
        err
      );

      res.status(500).json({
        error:
          'Could not save phone number',

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
