const express = require('express');

const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

const {
  requireAuth,
  requireAdmin,
} = require('../middleware/auth');

const router = express.Router();

router.use(
  requireAuth,
  requireAdmin
);

/*
|--------------------------------------------------------------------------
| ADMIN — ALL APPLICATIONS
|--------------------------------------------------------------------------
*/
router.get(
  '/applications',
  async (req, res) => {
    try {
      const {
        data,
        error,
      } = await supabaseAdmin
        .from('loan_applications')
        .select(`
          id,
          application_code,
          current_stage,
          requested_amount,
          created_at,
          started_at,
          profiles:user_id (
            full_name,
            email,
            phone,
            phone_verified
          ),
          loan_terms (
            tenure_months,
            loan_amount,
            emi,
            total_interest,
            total_repayment,
            net_disbursement,
            irr
          ),
          selfie_verifications (
            status,
            rejection_reason,
            reviewed_at
          )
        `)
        .not(
          'started_at',
          'is',
          null
        )
        .order(
          'started_at',
          {
            ascending: false,
          }
        );

      if (error) {
        throw error;
      }

      const applications =
        (data || []).map(
          (item) => {
            const loanTerms =
              Array.isArray(
                item.loan_terms
              )
                ? item.loan_terms[
                    item.loan_terms.length -
                      1
                  ] || null
                : item.loan_terms ||
                  null;

            const selfie =
              Array.isArray(
                item.selfie_verifications
              )
                ? item
                    .selfie_verifications[
                    item
                      .selfie_verifications
                      .length - 1
                  ] || null
                : item.selfie_verifications ||
                  null;

            return {
              ...item,

              loan_terms:
                loanTerms,

              selfie,

              selfie_verifications:
                undefined,
            };
          }
        );

      res.json({
        applications,
      });
    } catch (err) {
      console.error(
        'GET /admin/applications error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to fetch applications',
        detail:
          process.env.NODE_ENV ===
          'development'
            ? err.message
            : undefined,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — FULL APPLICATION DETAIL
|--------------------------------------------------------------------------
*/
router.get(
  '/applications/:id',
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const [
        applicationResult,
        kycResult,
        eligibilityResult,
        loanTermsResult,
        bankResult,
        declarationResult,
        selfieResult,
      ] =
        await Promise.all([
          supabaseAdmin
            .from(
              'loan_applications'
            )
            .select(
              '*, profiles:user_id(*)'
            )
            .eq(
              'id',
              id
            )
            .maybeSingle(),

          supabaseAdmin
            .from(
              'kyc_details'
            )
            .select('*')
            .eq(
              'application_id',
              id
            )
            .maybeSingle(),

          supabaseAdmin
            .from(
              'eligibility_checks'
            )
            .select('*')
            .eq(
              'application_id',
              id
            )
            .order(
              'created_at',
              {
                ascending: false,
              }
            )
            .limit(1)
            .maybeSingle(),

          supabaseAdmin
            .from(
              'loan_terms'
            )
            .select('*')
            .eq(
              'application_id',
              id
            )
            .order(
              'created_at',
              {
                ascending: false,
              }
            )
            .limit(1)
            .maybeSingle(),

          supabaseAdmin
            .from(
              'bank_accounts'
            )
            .select('*')
            .eq(
              'application_id',
              id
            )
            .maybeSingle(),

          supabaseAdmin
            .from(
              'declarations'
            )
            .select('*')
            .eq(
              'application_id',
              id
            )
            .maybeSingle(),

          supabaseAdmin
            .from(
              'selfie_verifications'
            )
            .select('*')
            .eq(
              'application_id',
              id
            )
            .order(
              'created_at',
              {
                ascending: false,
              }
            )
            .limit(1)
            .maybeSingle(),
        ]);

      if (
        applicationResult.error
      ) {
        throw applicationResult.error;
      }

      if (
        kycResult.error
      ) {
        throw kycResult.error;
      }

      if (
        eligibilityResult.error
      ) {
        throw eligibilityResult.error;
      }

      if (
        loanTermsResult.error
      ) {
        throw loanTermsResult.error;
      }

      if (
        bankResult.error
      ) {
        throw bankResult.error;
      }

      if (
        declarationResult.error
      ) {
        throw declarationResult.error;
      }

      if (
        selfieResult.error
      ) {
        throw selfieResult.error;
      }

      if (
        !applicationResult.data
      ) {
        return res.status(404).json({
          error:
            'Application not found',
        });
      }

      /*
       * Get the real Supabase Auth verification timestamp
       * instead of assuming an email exists means it is verified.
       */
      let authUser = null;

      try {
        const {
          data: authData,
        } =
          await supabaseAdmin.auth.admin.getUserById(
            applicationResult
              .data
              .user_id
          );

        authUser =
          authData?.user ||
          null;
      } catch (authLookupError) {
        console.warn(
          'Admin detail auth lookup failed:',
          authLookupError
        );
      }

      /*
       * Generate short-lived signed URLs server-side.
       * The browser never needs public access to KYC/selfie
       * storage objects.
       */
      let selfieSignedUrl =
        null;

      let idDocumentSignedUrl =
        null;

      if (
        selfieResult.data?.photo_url
      ) {
        const {
          data: signed,
        } =
          await supabaseAdmin.storage
            .from(
              'selfies'
            )
            .createSignedUrl(
              selfieResult.data.photo_url,
              300
            );

        selfieSignedUrl =
          signed?.signedUrl ||
          null;
      }

      if (
        kycResult.data
          ?.id_document_url
      ) {
        const {
          data: signed,
        } =
          await supabaseAdmin.storage
            .from(
              'kyc-documents'
            )
            .createSignedUrl(
              kycResult.data
                .id_document_url,
              300
            );

        idDocumentSignedUrl =
          signed?.signedUrl ||
          null;
      }

      res.json({
        application:
          applicationResult.data,

        authVerification: {
          emailVerified:
            Boolean(
              authUser?.email_confirmed_at
            ),

          emailConfirmedAt:
            authUser
              ?.email_confirmed_at ||
            null,
        },

        selfieSignedUrl,

        idDocumentSignedUrl,

        kyc:
          kycResult.data,

        eligibility:
          eligibilityResult.data,

        loanTerms:
          loanTermsResult.data,

        bankAccount:
          bankResult.data,

        declaration:
          declarationResult.data,

        selfie:
          selfieResult.data,
      });
    } catch (err) {
      console.error(
        'GET /admin/applications/:id error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to fetch application detail',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — APPROVE SELFIE
|--------------------------------------------------------------------------
*/
router.post(
  '/selfies/:id/approve',
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const {
        data: selfie,
        error: selfieError,
      } = await supabaseAdmin
        .from(
          'selfie_verifications'
        )
        .select(
          'id, application_id, status'
        )
        .eq(
          'id',
          id
        )
        .maybeSingle();

      if (selfieError) {
        throw selfieError;
      }

      if (!selfie) {
        return res.status(404).json({
          error:
            'Selfie verification not found',
        });
      }

      const {
        data: application,
        error:
          applicationError,
      } = await supabaseAdmin
        .from(
          'loan_applications'
        )
        .select(
          'id, current_stage'
        )
        .eq(
          'id',
          selfie.application_id
        )
        .maybeSingle();

      if (applicationError) {
        throw applicationError;
      }

      if (!application) {
        return res.status(404).json({
          error:
            'Application not found',
        });
      }

      if (
        application.current_stage ===
        'closed'
      ) {
        return res.status(400).json({
          error:
            'This application was closed by the customer and can no longer be approved.',
        });
      }

      if (
        application.current_stage !==
          'under_review' ||
        selfie.status !==
          'pending'
      ) {
        return res.status(400).json({
          error:
            'This selfie is no longer awaiting review.',
        });
      }

      const {
        data: updatedSelfie,
        error:
          updateSelfieError,
      } = await supabaseAdmin
        .from(
          'selfie_verifications'
        )
        .update({
          status:
            'approved',

          reviewed_by:
            req.user.id,

          reviewed_at:
            new Date().toISOString(),

          rejection_reason:
            null,
        })
        .eq(
          'id',
          id
        )
        .select()
        .single();

      if (updateSelfieError) {
        throw updateSelfieError;
      }

      const {
        error:
          updateApplicationError,
      } = await supabaseAdmin
        .from(
          'loan_applications'
        )
        .update({
          current_stage:
            'approved',
        })
        .eq(
          'id',
          selfie.application_id
        );

      if (
        updateApplicationError
      ) {
        throw updateApplicationError;
      }

      res.json({
        selfie:
          updatedSelfie,
      });
    } catch (err) {
      console.error(
        'POST /admin/selfies/:id/approve error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to approve selfie',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — REJECT SELFIE
|--------------------------------------------------------------------------
*/
router.post(
  '/selfies/:id/reject',
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const reason =
        typeof req.body?.reason ===
        'string'
          ? req.body.reason.trim()
          : '';

      const {
        data: selfie,
        error: selfieError,
      } = await supabaseAdmin
        .from(
          'selfie_verifications'
        )
        .select(
          'id, application_id, status'
        )
        .eq(
          'id',
          id
        )
        .maybeSingle();

      if (selfieError) {
        throw selfieError;
      }

      if (!selfie) {
        return res.status(404).json({
          error:
            'Selfie verification not found',
        });
      }

      const {
        data: application,
        error:
          applicationError,
      } = await supabaseAdmin
        .from(
          'loan_applications'
        )
        .select(
          'id, current_stage'
        )
        .eq(
          'id',
          selfie.application_id
        )
        .maybeSingle();

      if (applicationError) {
        throw applicationError;
      }

      if (!application) {
        return res.status(404).json({
          error:
            'Application not found',
        });
      }

      if (
        application.current_stage ===
        'closed'
      ) {
        return res.status(400).json({
          error:
            'This application was closed by the customer and can no longer be rejected.',
        });
      }

      if (
        application.current_stage !==
          'under_review' ||
        selfie.status !==
          'pending'
      ) {
        return res.status(400).json({
          error:
            'This selfie is no longer awaiting review.',
        });
      }

      const {
        data: updatedSelfie,
        error:
          updateSelfieError,
      } = await supabaseAdmin
        .from(
          'selfie_verifications'
        )
        .update({
          status:
            'rejected',

          reviewed_by:
            req.user.id,

          reviewed_at:
            new Date().toISOString(),

          rejection_reason:
            reason || null,
        })
        .eq(
          'id',
          id
        )
        .select()
        .single();

      if (updateSelfieError) {
        throw updateSelfieError;
      }

      const {
        error:
          updateApplicationError,
      } = await supabaseAdmin
        .from(
          'loan_applications'
        )
        .update({
          current_stage:
            'rejected',
        })
        .eq(
          'id',
          selfie.application_id
        );

      if (
        updateApplicationError
      ) {
        throw updateApplicationError;
      }

      res.json({
        selfie:
          updatedSelfie,
      });
    } catch (err) {
      console.error(
        'POST /admin/selfies/:id/reject error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to reject selfie',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — DISBURSE
|--------------------------------------------------------------------------
*/
router.post(
  '/applications/:id/disburse',
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const {
        data: application,
        error: fetchError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .select(
            'id, current_stage'
          )
          .eq(
            'id',
            id
          )
          .maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      if (!application) {
        return res.status(404).json({
          error:
            'Application not found',
        });
      }

      if (
        application.current_stage ===
        'closed'
      ) {
        return res.status(400).json({
          error:
            'Closed applications cannot be disbursed.',
        });
      }

      if (
        application.current_stage !==
        'approved'
      ) {
        return res.status(400).json({
          error:
            'Only an approved application can be marked as disbursed.',
        });
      }

      /*
       * Final readiness checks.
       */
      const [
        termsResult,
        bankResult,
        declarationResult,
        selfieResult,
      ] =
        await Promise.all([
          supabaseAdmin
            .from(
              'loan_terms'
            )
            .select(
              'id,loan_amount,tenure_months,emi,net_disbursement'
            )
            .eq(
              'application_id',
              id
            )
            .maybeSingle(),

          supabaseAdmin
            .from(
              'bank_accounts'
            )
            .select(
              'id,ifsc_verified'
            )
            .eq(
              'application_id',
              id
            )
            .maybeSingle(),

          supabaseAdmin
            .from(
              'declarations'
            )
            .select(
              'id,accepted'
            )
            .eq(
              'application_id',
              id
            )
            .maybeSingle(),

          supabaseAdmin
            .from(
              'selfie_verifications'
            )
            .select(
              'id,status'
            )
            .eq(
              'application_id',
              id
            )
            .maybeSingle(),
        ]);

      for (
        const result of [
          termsResult,
          bankResult,
          declarationResult,
          selfieResult,
        ]
      ) {
        if (result.error) {
          throw result.error;
        }
      }

      if (
        !termsResult.data
      ) {
        return res.status(400).json({
          error:
            'Loan terms are missing.',
        });
      }

      if (
        !bankResult.data
          ?.ifsc_verified
      ) {
        return res.status(400).json({
          error:
            'A verified bank account is required before disbursement.',
        });
      }

      if (
        !declarationResult.data
          ?.accepted
      ) {
        return res.status(400).json({
          error:
            'The customer declaration must be accepted before disbursement.',
        });
      }

      if (
        selfieResult.data
          ?.status !==
        'approved'
      ) {
        return res.status(400).json({
          error:
            'The selfie must be approved before disbursement.',
        });
      }

      const {
        data: updated,
        error: updateError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .update({
            current_stage:
              'disbursed',
          })
          .eq(
            'id',
            id
          )
          .eq(
            'current_stage',
            'approved'
          )
          .select()
          .single();

      if (updateError) {
        throw updateError;
      }

      res.json({
        application:
          updated,
      });
    } catch (err) {
      console.error(
        'POST /admin/applications/:id/disburse error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to mark application as disbursed',
      });
    }
  }
);

module.exports = router;