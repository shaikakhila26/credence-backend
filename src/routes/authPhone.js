const express = require('express');
const crypto = require('crypto');

const { supabaseAdmin } = require('../config/supabaseAdmin');

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function normalizePhone(raw) {
  let phone = String(raw || '')
    .trim()
    .replace(/[\s()-]/g, '');

  if (!phone.startsWith('+') && /^\d{10}$/.test(phone)) {
    phone = `+91${phone}`;
  }

  return phone;
}

function validPhone(phone) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(email || '').trim()
  );
}

function generateOtp() {
  return crypto
    .randomInt(100000, 1000000)
    .toString();
}

/*
|--------------------------------------------------------------------------
| Frontend URL
|--------------------------------------------------------------------------
|
| Production Render:
|
| FRONTEND_URL=https://credence-frontend-gules.vercel.app
|
| Local:
|
| FRONTEND_URL=http://localhost:5173
|
|--------------------------------------------------------------------------
*/

function getFrontendOrigin() {
  const origin =
    process.env.FRONTEND_URL ||
    process.env.FRONTEND_ORIGIN ||
    'http://localhost:5173';

  return String(origin)
    .trim()
    .replace(/\/+$/, '');
}

/*
|--------------------------------------------------------------------------
| REQUEST OTP
|--------------------------------------------------------------------------
*/

router.post(
  '/request-otp',
  async (req, res) => {
    try {
      const purpose = [
        'signup',
        'login',
      ].includes(req.body.purpose)
        ? req.body.purpose
        : 'login';

      const phone =
        normalizePhone(
          req.body.phone
        );

      if (!validPhone(phone)) {
        return res.status(400).json({
          error:
            'Enter a valid phone number with country code',
        });
      }

      let profile;

      /*
      |--------------------------------------------------------------------------
      | PHONE SIGNUP
      |--------------------------------------------------------------------------
      |
      | Frontend creates the Supabase Auth user first.
      |
      */

      if (purpose === 'signup') {
        const email =
          String(
            req.body.email || ''
          )
            .trim()
            .toLowerCase();

        const fullName =
          String(
            req.body.fullName || ''
          ).trim();

        const userId =
          String(
            req.body.userId || ''
          ).trim();

        if (!validEmail(email)) {
          return res.status(400).json({
            error:
              'Enter a valid email address',
          });
        }

        if (fullName.length < 2) {
          return res.status(400).json({
            error:
              'Enter your full name',
          });
        }

        if (!userId) {
          return res.status(400).json({
            error:
              'Missing account ID',
          });
        }

        /*
        |--------------------------------------------------------------------------
        | Verify Supabase Auth user exists
        |--------------------------------------------------------------------------
        */

        const {
          data: authResult,
          error: authError,
        } =
          await supabaseAdmin.auth.admin.getUserById(
            userId
          );

        if (authError) {
          throw authError;
        }

        const authUser =
          authResult?.user;

        if (!authUser) {
          return res.status(400).json({
            error:
              'Could not find the newly created account',
          });
        }

        /*
        |--------------------------------------------------------------------------
        | Verify email matches Auth account
        |--------------------------------------------------------------------------
        */

        if (
          String(
            authUser.email || ''
          ).toLowerCase() !== email
        ) {
          return res.status(400).json({
            error:
              'Account email does not match signup email',
          });
        }

        /*
        |--------------------------------------------------------------------------
        | Make sure phone is not already used
        |--------------------------------------------------------------------------
        */

        const {
          data: existingPhone,
          error: phoneError,
        } =
          await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('phone', phone)
            .neq('id', userId)
            .maybeSingle();

        if (phoneError) {
          throw phoneError;
        }

        if (existingPhone) {
          return res.status(409).json({
            error:
              'An account already exists with this phone number. Please log in.',
          });
        }

        /*
        |--------------------------------------------------------------------------
        | Create/update profile
        |--------------------------------------------------------------------------
        */

        const {
          data: savedProfile,
          error: profileError,
        } =
          await supabaseAdmin
            .from('profiles')
            .upsert(
              {
                id: userId,
                email,
                full_name: fullName,
                phone,
                phone_verified: false,
                role: 'customer',
              },
              {
                onConflict: 'id',
              }
            )
            .select('*')
            .single();

        if (profileError) {
          throw profileError;
        }

        profile =
          savedProfile;
      }

      /*
      |--------------------------------------------------------------------------
      | PHONE LOGIN
      |--------------------------------------------------------------------------
      */

      else {
        const {
          data: existing,
          error,
        } =
          await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('phone', phone)
            .maybeSingle();

        if (error) {
          throw error;
        }

        if (!existing) {
          return res.status(404).json({
            error:
              'No account found with this phone number. Please sign up first.',
          });
        }

        if (!existing.email) {
          return res.status(400).json({
            error:
              'This account has no email address. Please complete your profile.',
          });
        }

        profile =
          existing;
      }

      /*
      |--------------------------------------------------------------------------
      | Invalidate previous OTPs
      |--------------------------------------------------------------------------
      */

      const {
        error: invalidateError,
      } =
        await supabaseAdmin
          .from('phone_otps')
          .update({
            verified: true,
          })
          .eq('phone', phone)
          .eq('verified', false);

      if (invalidateError) {
        throw invalidateError;
      }

      /*
      |--------------------------------------------------------------------------
      | Create OTP
      |--------------------------------------------------------------------------
      */

      const otp =
        generateOtp();

      const expiresAt =
        new Date(
          Date.now() +
            10 * 60 * 1000
        ).toISOString();

      const {
        data: saved,
        error: otpError,
      } =
        await supabaseAdmin
          .from('phone_otps')
          .insert({
            user_id: profile.id,
            phone,
            code: otp,
            expires_at: expiresAt,
            verified: false,
          })
          .select(
            'id, expires_at'
          )
          .single();

      if (otpError) {
        throw otpError;
      }

      return res.json({
        otpId: saved.id,
        code: otp,
        phone,
        purpose,
        expiresAt:
          saved.expires_at,
        email:
          profile.email,
      });
    } catch (err) {
      console.error(
        'POST /auth/phone/request-otp error:',
        err
      );

      return res.status(500).json({
        error:
          'Could not generate a verification code',

        detail:
          process.env.NODE_ENV !==
          'production'
            ? err.message
            : undefined,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| RESEND OTP
|--------------------------------------------------------------------------
*/

router.post(
  '/resend-otp',
  async (req, res) => {
    try {
      const purpose = [
        'signup',
        'login',
      ].includes(req.body.purpose)
        ? req.body.purpose
        : 'login';

      const phone =
        normalizePhone(
          req.body.phone
        );

      if (!validPhone(phone)) {
        return res.status(400).json({
          error:
            'Enter a valid phone number with country code',
        });
      }

      const {
        data: profile,
        error: profileError,
      } =
        await supabaseAdmin
          .from('profiles')
          .select('*')
          .eq('phone', phone)
          .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      if (!profile) {
        return res.status(404).json({
          error:
            'No account found with this phone number.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Invalidate old OTP
      |--------------------------------------------------------------------------
      */

      const {
        error: invalidateError,
      } =
        await supabaseAdmin
          .from('phone_otps')
          .update({
            verified: true,
          })
          .eq('phone', phone)
          .eq('verified', false);

      if (invalidateError) {
        throw invalidateError;
      }

      /*
      |--------------------------------------------------------------------------
      | Generate new OTP
      |--------------------------------------------------------------------------
      */

      const otp =
        generateOtp();

      const expiresAt =
        new Date(
          Date.now() +
            10 * 60 * 1000
        ).toISOString();

      const {
        data: saved,
        error: otpError,
      } =
        await supabaseAdmin
          .from('phone_otps')
          .insert({
            user_id: profile.id,
            phone,
            code: otp,
            expires_at: expiresAt,
            verified: false,
          })
          .select(
            'id, expires_at'
          )
          .single();

      if (otpError) {
        throw otpError;
      }

      return res.json({
        otpId: saved.id,
        code: otp,
        phone,
        purpose,
        expiresAt:
          saved.expires_at,
        email:
          profile.email,
      });
    } catch (err) {
      console.error(
        'POST /auth/phone/resend-otp error:',
        err
      );

      return res.status(500).json({
        error:
          'Could not resend the verification code',

        detail:
          process.env.NODE_ENV !==
          'production'
            ? err.message
            : undefined,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| VERIFY OTP
|--------------------------------------------------------------------------
*/

router.post(
  '/verify-otp',
  async (req, res) => {
    try {
      const phone =
        normalizePhone(
          req.body.phone
        );

      const entered =
        String(
          req.body.code || ''
        ).trim();

      const purpose = [
        'signup',
        'login',
      ].includes(req.body.purpose)
        ? req.body.purpose
        : 'login';

      if (
        !validPhone(phone) ||
        !/^\d{6}$/.test(
          entered
        )
      ) {
        return res.status(400).json({
          error:
            'Enter the valid 6-digit verification code',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Get newest OTP
      |--------------------------------------------------------------------------
      */

      const {
        data: otp,
        error: otpError,
      } =
        await supabaseAdmin
          .from('phone_otps')
          .select('*')
          .eq('phone', phone)
          .eq('verified', false)
          .order(
            'created_at',
            {
              ascending: false,
            }
          )
          .limit(1)
          .maybeSingle();

      if (otpError) {
        throw otpError;
      }

      if (!otp) {
        return res.status(400).json({
          error:
            'No pending code for this number. Request a new code.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Expiry
      |--------------------------------------------------------------------------
      */

      if (
        new Date(
          otp.expires_at
        ) < new Date()
      ) {
        return res.status(400).json({
          error:
            'Code expired — request a new one',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Compare OTP
      |--------------------------------------------------------------------------
      */

      if (
        otp.code !== entered
      ) {
        return res.status(400).json({
          error:
            'Incorrect code',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Get profile
      |--------------------------------------------------------------------------
      */

      const {
        data: profile,
        error: profileError,
      } =
        await supabaseAdmin
          .from('profiles')
          .select('*')
          .eq('id', otp.user_id)
          .single();

      if (
        profileError ||
        !profile
      ) {
        throw (
          profileError ||
          new Error(
            'Profile not found'
          )
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Consume OTP
      |--------------------------------------------------------------------------
      */

      const {
        error: verifyError,
      } =
        await supabaseAdmin
          .from('phone_otps')
          .update({
            verified: true,
          })
          .eq('id', otp.id);

      if (verifyError) {
        throw verifyError;
      }

      /*
      |--------------------------------------------------------------------------
      | Mark phone verified
      |--------------------------------------------------------------------------
      */

      const {
        error: phoneUpdateError,
      } =
        await supabaseAdmin
          .from('profiles')
          .update({
            phone_verified: true,
          })
          .eq('id', profile.id);

      if (phoneUpdateError) {
        throw phoneUpdateError;
      }

      /*
      |--------------------------------------------------------------------------
      | PHONE SIGNUP
      |--------------------------------------------------------------------------
      |
      | Email verification is still required.
      |
      */

      if (
        purpose === 'signup'
      ) {
        return res.json({
          verified: true,
          requiresEmailVerification: true,
          email:
            profile.email,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | PHONE LOGIN
      |--------------------------------------------------------------------------
      */

      const {
        data: authResult,
        error: authError,
      } =
        await supabaseAdmin.auth.admin.getUserById(
          profile.id
        );

      if (
        authError ||
        !authResult?.user
      ) {
        throw (
          authError ||
          new Error(
            'Auth user not found'
          )
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Email must already be verified
      |--------------------------------------------------------------------------
      */

      if (
        !authResult.user
          .email_confirmed_at
      ) {
        return res.status(403).json({
          error:
            'Phone verified. Please verify your email before signing in.',

          code:
            'EMAIL_NOT_VERIFIED',

          email:
            profile.email,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Generate Supabase magic login link
      |--------------------------------------------------------------------------
      |
      | IMPORTANT:
      |
      | Use FRONTEND_URL first.
      |
      | Render:
      | https://credence-frontend-gules.vercel.app
      |
      | Local:
      | http://localhost:5173
      |
      */

      const frontendOrigin =
        getFrontendOrigin();

      const redirectTo =
        `${frontendOrigin}/auth/callback`;

      console.log(
        '[PHONE LOGIN] OAuth callback:',
        redirectTo
      );

      const {
        data: linkData,
        error: linkError,
      } =
        await supabaseAdmin.auth.admin.generateLink(
          {
            type: 'magiclink',

            email:
              profile.email,

            options: {
              redirectTo,
            },
          }
        );

      if (linkError) {
        throw linkError;
      }

      const loginLink =
        linkData?.properties?.action_link ||
        linkData?.properties?.actionLink ||
        null;

      if (!loginLink) {
        throw new Error(
          'Could not create the phone login session link'
        );
      }

      return res.json({
        verified: true,

        requiresEmailVerification:
          false,

        loginLink,
      });
    } catch (err) {
      console.error(
        'POST /auth/phone/verify-otp error:',
        err
      );

      return res.status(500).json({
        error:
          'Could not verify code',

        detail:
          process.env.NODE_ENV !==
          'production'
            ? err.message
            : undefined,
      });
    }
  }
);

module.exports = router;