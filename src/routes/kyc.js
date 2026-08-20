const express = require('express');
const crypto = require('crypto');

const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

const {
  requireAuth,
} = require('../middleware/auth');

const router = express.Router();

const TERMINAL_STAGES = new Set([
  'under_review',
  'approved',
  'rejected',
  'disbursed',
  'closed',
]);

function normalizePAN(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function normalizeAadhaar(value) {
  return String(value || '')
    .replace(/\s/g, '')
    .trim();
}

function isValidPAN(pan) {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
}

/*
 * Verhoeff checksum used by Aadhaar numbers.
 * This validates the number mathematically; it does NOT
 * query UIDAI. The final verification is still simulated.
 */
const D = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,2,3,4,0,6,7,8,9,5],
  [2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],
  [7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];

const P = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,5,7,6,2,8,3,0,9,4],
  [5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],
  [7,0,4,6,9,1,3,2,5,8],
];

function isValidAadhaar(aadhaar) {
  if (!/^[0-9]{12}$/.test(aadhaar)) {
    return false;
  }

  if (/^[01]/.test(aadhaar)) {
    return false;
  }

  let c = 0;

  const digits = aadhaar
    .split('')
    .reverse()
    .map(Number);

  digits.forEach((digit, index) => {
    c = D[c][P[index % 8][digit]];
  });

  return c === 0;
}

/*
 * Simulated verification:
 *
 * - Valid PAN format => simulated "found/verified"
 * - AAAAA0000A is reserved as the demo "not found" PAN
 * - Valid Aadhaar checksum => simulated "verified"
 *
 * No government database is contacted.
 */
function simulateIdentityVerification(
  idType,
  rawIdNumber
) {
  if (idType === 'PAN') {
    const pan = normalizePAN(rawIdNumber);

    if (!isValidPAN(pan)) {
      return {
        verified: false,
        message:
          'PAN format is invalid. Expected format ABCDE1234F.',
      };
    }

    if (pan === 'AAAAA0000A') {
      return {
        verified: false,
        message:
          'Demo PAN verification could not find this PAN.',
      };
    }

    return {
      verified: true,
      message:
        'PAN verified successfully in simulated demo mode.',
      mode: 'simulated',
      provider: 'CREDENCE Demo KYC',
      referenceId:
        `PAN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    };
  }

  if (idType === 'AADHAAR') {
    const aadhaar =
      normalizeAadhaar(rawIdNumber);

    if (!isValidAadhaar(aadhaar)) {
      return {
        verified: false,
        message:
          'Aadhaar format/checksum is invalid.',
      };
    }

    return {
      verified: true,
      message:
        'Aadhaar verified successfully in simulated demo mode.',
      mode: 'simulated',
      provider: 'CREDENCE Demo KYC',
      referenceId:
        `AADHAAR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    };
  }

  return {
    verified: false,
    message:
      'Unsupported ID type.',
  };
}

async function getOwnedApplication(
  applicationId,
  userId
) {
  const {
    data: application,
    error,
  } =
    await supabaseAdmin
      .from('loan_applications')
      .select(
        'id,user_id,current_stage'
      )
      .eq(
        'id',
        applicationId
      )
      .maybeSingle();

  if (error) {
    throw error;
  }

  if (!application) {
    return {
      ok: false,
      status: 404,
      error:
        'Application not found',
    };
  }

  if (
    application.user_id !==
    userId
  ) {
    return {
      ok: false,
      status: 403,
      error:
        'Not your application',
    };
  }

  return {
    ok: true,
    application,
  };
}

/*
 * VERIFY + SAVE KYC
 *
 * This moves KYC metadata handling into the proper backend.
 * The optional document itself is uploaded to the private
 * Supabase Storage bucket by the frontend and its storage
 * path is passed here.
 */
router.post(
  '/save',
  requireAuth,
  async (req, res) => {
    try {
      const {
        applicationId,
        fullName,
        dob,
        gender,
        address,
        idType,
        idNumber,
        idDocumentUrl,
      } = req.body;

      if (
        !applicationId ||
        !fullName?.trim() ||
        !dob ||
        !gender ||
        !address?.trim() ||
        !idType ||
        !idNumber
      ) {
        return res.status(400).json({
          error:
            'All required KYC details must be provided.',
        });
      }

      const owned =
        await getOwnedApplication(
          applicationId,
          req.user.id
        );

      if (!owned.ok) {
        return res.status(
          owned.status
        ).json({
          error:
            owned.error,
        });
      }

      if (
        TERMINAL_STAGES.has(
          owned.application.current_stage
        )
      ) {
        return res.status(400).json({
          error:
            'This application is no longer editable.',
        });
      }

      const normalizedType =
        String(idType)
          .trim()
          .toUpperCase();

      const normalizedId =
        normalizedType ===
        'PAN'
          ? normalizePAN(
              idNumber
            )
          : normalizeAadhaar(
              idNumber
            );

      const verification =
        simulateIdentityVerification(
          normalizedType,
          normalizedId
        );

      if (
        !verification.verified
      ) {
        return res.status(400).json({
          error:
            verification.message,

          verification,
        });
      }

      if (
        idDocumentUrl &&
        !String(
          idDocumentUrl
        ).startsWith(
          `${req.user.id}/`
        )
      ) {
        return res.status(403).json({
          error:
            'Invalid KYC document storage path.',
        });
      }

      const payload = {
        application_id:
          applicationId,

        full_name:
          fullName.trim(),

        date_of_birth:
          dob,

        gender:
          gender.trim(),

        address:
          address.trim(),

        id_type:
          normalizedType,

        id_number:
          normalizedId,

        ...(idDocumentUrl
          ? {
              id_document_url:
                idDocumentUrl,
            }
          : {}),
      };

      /*
       * Update the existing KYC record if the customer
       * is editing an application. Otherwise insert it.
       */
      const {
        data: existing,
        error: existingError,
      } =
        await supabaseAdmin
          .from('kyc_details')
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
            .from('kyc_details')
            .update(payload)
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

        saved = data;
      } else {
        const {
          data,
          error,
        } =
          await supabaseAdmin
            .from('kyc_details')
            .insert(payload)
            .select()
            .single();

        if (error) {
          throw error;
        }

        saved = data;
      }

      /*
       * KYC was successfully verified/saved.
       * The next application step is eligibility.
       */
      const {
        error: stageError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .update({
            current_stage:
              'eligibility',
          })
          .eq(
            'id',
            applicationId
          )
          .eq(
            'user_id',
            req.user.id
          );

      if (stageError) {
        throw stageError;
      }

      return res.json({
        kyc: saved,
        verification,
      });
    } catch (err) {
      console.error(
        'POST /kyc/save error:',
        err
      );

      return res.status(500).json({
        error:
          'Could not save KYC details',

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
