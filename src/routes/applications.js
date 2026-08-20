// backend/src/routes/applications.js

const express =
  require('express');

const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

const {
  requireAuth,
} = require('../middleware/auth');

const {
  nextStage,
  previousStage,
  progressFraction,
  CUSTOMER_STAGES,
} =
  require('../utils/stageMachine');

const router =
  express.Router();

const TERMINAL_STAGES =
  new Set([
    'approved',
    'rejected',
    'disbursed',
    'closed',
  ]);

/*
 * Applications that cannot be closed by the customer.
 *
 * Customers can close applications while they are:
 *
 * kyc
 * eligibility
 * loan_terms
 * bank_account
 * declaration
 * selfie
 * under_review
 *
 * They cannot close an application after:
 *
 * approved
 * rejected
 * disbursed
 * closed
 */
const CLOSE_BLOCKED_STAGES =
  new Set([
    'approved',
    'rejected',
    'disbursed',
    'closed',
  ]);

async function getOwnedApplication(
  applicationId,
  userId
) {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        'loan_applications'
      )
      .select('*')
      .eq(
        'id',
        applicationId
      )
      .single();

  if (
    error ||
    !data
  ) {
    return {
      error:
        'Application not found',
      status: 404,
    };
  }

  if (
    data.user_id !==
    userId
  ) {
    return {
      error:
        'Not your application',
      status: 403,
    };
  }

  return {
    application: data,
  };
}

async function hydrateApplications(
  applications
) {
  if (
    !applications?.length
  ) {
    return [];
  }

  const ids =
    applications.map(
      (item) => item.id
    );

  const [
    kycDetails,
    eligibility,
    loanTerms,
    bankAccounts,
    declarations,
    selfies,
  ] =
    await Promise.all([
      supabaseAdmin
        .from(
          'kyc_details'
        )
        .select('*')
        .in(
          'application_id',
          ids
        ),

      supabaseAdmin
        .from(
          'eligibility_checks'
        )
        .select('*')
        .in(
          'application_id',
          ids
        )
        .order(
          'created_at',
          {
            ascending: false,
          }
        ),

      supabaseAdmin
        .from(
          'loan_terms'
        )
        .select('*')
        .in(
          'application_id',
          ids
        )
        .order(
          'created_at',
          {
            ascending: false,
          }
        ),

      supabaseAdmin
        .from(
          'bank_accounts'
        )
        .select('*')
        .in(
          'application_id',
          ids
        ),

      supabaseAdmin
        .from(
          'declarations'
        )
        .select('*')
        .in(
          'application_id',
          ids
        ),

      supabaseAdmin
        .from(
          'selfie_verifications'
        )
        .select('*')
        .in(
          'application_id',
          ids
        )
        .order(
          'created_at',
          {
            ascending: false,
          }
        ),
    ]);

  for (
    const result of [
      kycDetails,
      eligibility,
      loanTerms,
      bankAccounts,
      declarations,
      selfies,
    ]
  ) {
    if (result.error) {
      throw result.error;
    }
  }

  const latestByApplication =
    (rows) => {
      const map =
        new Map();

      for (
        const row of
          rows?.data || []
      ) {
        if (
          !map.has(
            row.application_id
          )
        ) {
          map.set(
            row.application_id,
            row
          );
        }
      }

      return map;
    };

  const kycMap =
    latestByApplication(
      kycDetails
    );

  const eligibilityMap =
    latestByApplication(
      eligibility
    );

  const loanTermsMap =
    latestByApplication(
      loanTerms
    );

  const bankMap =
    latestByApplication(
      bankAccounts
    );

  const declarationMap =
    latestByApplication(
      declarations
    );

  const selfieMap =
    latestByApplication(
      selfies
    );

  return applications.map(
    (application) => {
      const eligibilityRow =
        eligibilityMap.get(
          application.id
        ) || null;

      return {
        ...application,

        progress:
          progressFraction(
            application.current_stage
          ),

        kyc:
          kycMap.get(
            application.id
          ) || null,

        eligibility:
          eligibilityRow,

        eligibility_reasoning:
          eligibilityRow
            ? {
                creditScore:
                  eligibilityRow.credit_score,

                creditBand:
                  eligibilityRow.credit_score >=
                  750
                    ? 'excellent'
                    : eligibilityRow.credit_score >=
                        650
                      ? 'good'
                      : eligibilityRow.credit_score >=
                          600
                        ? 'fair'
                        : 'poor',

                monthlyIncome:
                  Number(
                    eligibilityRow.monthly_income ||
                      0
                  ),

                requestedAmount:
                  Number(
                    eligibilityRow.requested_amount ||
                      0
                  ),

                existingDebts:
                  Number(
                    eligibilityRow.existing_debts ||
                      0
                  ),

                debtToIncomeRatio:
                  Number(
                    eligibilityRow.debt_to_income_ratio ||
                      0
                  ),

                maxEligibleAmount:
                  Number(
                    eligibilityRow.max_eligible_amount ||
                      0
                  ),
              }
            : null,

        loan_terms:
          loanTermsMap.get(
            application.id
          ) || null,

        bank_account:
          bankMap.get(
            application.id
          ) || null,

        declaration:
          declarationMap.get(
            application.id
          ) || null,

        selfie:
          selfieMap.get(
            application.id
          ) || null,
      };
    }
  );
}

/*
 * ALL APPLICATIONS FOR CUSTOMER
 */
router.get(
  '/me',
  requireAuth,
  async (req, res) => {
    try {
      const {
        data: applications,
        error,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .select('*')
          .eq(
            'user_id',
            req.user.id
          )
          .order(
            'created_at',
            {
              ascending: false,
            }
          );

      if (error) {
        throw error;
      }

      const hydrated =
        await hydrateApplications(
          applications || []
        );

      const activeApplication =
        hydrated.find(
          (item) =>
            !TERMINAL_STAGES.has(
              item.current_stage
            )
        ) || null;

      res.json({
        applications:
          hydrated,

        activeApplication,

        application:
          activeApplication ||
          hydrated[0] ||
          null,

        progress:
          activeApplication
            ? progressFraction(
                activeApplication.current_stage
              )
            : null,
      });
    } catch (err) {
      console.error(
        'GET /applications/me error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to fetch applications',
      });
    }
  }
);

/*
 * SINGLE APPLICATION
 */
router.get(
  '/:id',
  requireAuth,
  async (req, res) => {
    try {
      const owned =
        await getOwnedApplication(
          req.params.id,
          req.user.id
        );

      if (owned.error) {
        return res.status(
          owned.status
        ).json({
          error:
            owned.error,
        });
      }

      const [
        application,
      ] =
        await hydrateApplications([
          owned.application,
        ]);

      res.json({
        application,

        progress:
          progressFraction(
            application.current_stage
          ),
      });
    } catch (err) {
      console.error(
        'GET /applications/:id error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to fetch application',
      });
    }
  }
);

/*
 * START APPLICATION
 */
router.post(
  '/start',
  requireAuth,
  async (req, res) => {
    try {
      const {
        data: latest,
        error,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .select('*')
          .eq(
            'user_id',
            req.user.id
          )
          .order(
            'created_at',
            {
              ascending: false,
            }
          )
          .limit(1)
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (
        latest &&
        !TERMINAL_STAGES.has(
          latest.current_stage
        )
      ) {
        const [
          application,
        ] =
          await hydrateApplications([
            latest,
          ]);

        return res.json({
          application,

          activeApplication:
            application,

          progress:
            progressFraction(
              application.current_stage
            ),

          created: false,
        });
      }

      const {
        data: created,
        error:
          createError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .insert({
            user_id:
              req.user.id,

            current_stage:
              'kyc',

            started_at:
              new Date().toISOString(),
          })
          .select()
          .single();

      if (createError) {
        throw createError;
      }

      const [
        application,
      ] =
        await hydrateApplications([
          created,
        ]);

      res.status(201).json({
        application,

        activeApplication:
          application,

        progress:
          progressFraction(
            application.current_stage
          ),

        created: true,
      });
    } catch (err) {
      console.error(
        'POST /applications/start error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to start application',
      });
    }
  }
);

/*
 * ADVANCE
 */
router.post(
  '/:id/advance',
  requireAuth,
  async (req, res) => {
    try {
      const owned =
        await getOwnedApplication(
          req.params.id,
          req.user.id
        );

      if (owned.error) {
        return res.status(
          owned.status
        ).json({
          error:
            owned.error,
        });
      }

      const application =
        owned.application;

      if (
        TERMINAL_STAGES.has(
          application.current_stage
        )
      ) {
        return res.status(400).json({
          error:
            'This application is no longer editable.',
        });
      }

      const newStage =
        nextStage(
          application.current_stage
        );

      if (!newStage) {
        return res.status(400).json({
          error:
            'There is no next application step.',
        });
      }

      const {
        data: updated,
        error:
          updateError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .update({
            current_stage:
              newStage,
          })
          .eq(
            'id',
            req.params.id
          )
          .eq(
            'user_id',
            req.user.id
          )
          .select()
          .single();

      if (updateError) {
        throw updateError;
      }

      res.json({
        application:
          updated,

        progress:
          progressFraction(
            updated.current_stage
          ),
      });
    } catch (err) {
      console.error(
        'POST /applications/:id/advance error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to advance application stage',
      });
    }
  }
);

/*
 * BACK
 */
router.post(
  '/:id/back',
  requireAuth,
  async (req, res) => {
    try {
      const owned =
        await getOwnedApplication(
          req.params.id,
          req.user.id
        );

      if (owned.error) {
        return res.status(
          owned.status
        ).json({
          error:
            owned.error,
        });
      }

      const application =
        owned.application;

      if (
        TERMINAL_STAGES.has(
          application.current_stage
        )
      ) {
        return res.status(400).json({
          error:
            'This application is no longer editable.',
        });
      }

      const requestedTarget =
        typeof req.body?.targetStage ===
        'string'
          ? req.body.targetStage
          : null;

      const calculatedPrevious =
        previousStage(
          application.current_stage
        );

      const targetStage =
        requestedTarget ||
        calculatedPrevious;

      if (
        !CUSTOMER_STAGES.includes(
          targetStage
        )
      ) {
        return res.status(400).json({
          error:
            'Invalid previous application step.',
        });
      }

      if (
        targetStage !==
          calculatedPrevious &&
        targetStage !==
          application.current_stage
      ) {
        return res.status(400).json({
          error:
            'You can only move back one application step at a time.',
        });
      }

      if (
        targetStage ===
        application.current_stage
      ) {
        return res.json({
          application,

          progress:
            progressFraction(
              application.current_stage
            ),

          targetStage,
        });
      }

      const invalidations = [];

      if (
        targetStage ===
        'kyc'
      ) {
        invalidations.push(
          supabaseAdmin
            .from(
              'eligibility_checks'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'loan_terms'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'bank_accounts'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'declarations'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'selfie_verifications'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            )
        );
      } else if (
        targetStage ===
        'eligibility'
      ) {
        invalidations.push(
          supabaseAdmin
            .from(
              'loan_terms'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'bank_accounts'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'declarations'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'selfie_verifications'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            )
        );
      } else if (
        targetStage ===
        'loan_terms'
      ) {
        invalidations.push(
          supabaseAdmin
            .from(
              'bank_accounts'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'declarations'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'selfie_verifications'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            )
        );
      } else if (
        targetStage ===
        'bank_account'
      ) {
        invalidations.push(
          supabaseAdmin
            .from(
              'declarations'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            ),

          supabaseAdmin
            .from(
              'selfie_verifications'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            )
        );
      } else if (
        targetStage ===
        'declaration'
      ) {
        invalidations.push(
          supabaseAdmin
            .from(
              'selfie_verifications'
            )
            .delete()
            .eq(
              'application_id',
              application.id
            )
        );
      }

      if (
        invalidations.length
      ) {
        const results =
          await Promise.all(
            invalidations
          );

        const failed =
          results.find(
            (result) =>
              result.error
          );

        if (failed) {
          throw failed.error;
        }
      }

      const {
        data: updated,
        error:
          updateError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .update({
            current_stage:
              targetStage,
          })
          .eq(
            'id',
            application.id
          )
          .eq(
            'user_id',
            req.user.id
          )
          .select()
          .single();

      if (updateError) {
        throw updateError;
      }

      res.json({
        application:
          updated,

        progress:
          progressFraction(
            updated.current_stage
          ),

        targetStage,
      });
    } catch (err) {
      console.error(
        'POST /applications/:id/back error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to move application back',

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
 * CLOSE
 */
router.post(
  '/:id/close',
  requireAuth,
  async (req, res) => {
    try {
      const owned =
        await getOwnedApplication(
          req.params.id,
          req.user.id
        );

      if (owned.error) {
        return res.status(
          owned.status
        ).json({
          error:
            owned.error,
        });
      }

      const application =
        owned.application;

      /*
       * Only block closing for stages that
       * are already terminal.
       *
       * Under-review applications CAN be closed.
       */
      if (
        CLOSE_BLOCKED_STAGES.has(
          application.current_stage
        )
      ) {
        return res.status(400).json({
          error:
            'This application is already closed or completed.',
        });
      }

      const {
        data: updated,
        error:
          updateError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .update({
            current_stage:
              'closed',
          })
          .eq(
            'id',
            req.params.id
          )
          .eq(
            'user_id',
            req.user.id
          )
          .select()
          .single();

      if (updateError) {
        throw updateError;
      }

      return res.json({
        success: true,

        application:
          updated,

        progress:
          progressFraction(
            'closed'
          ),
      });
    } catch (err) {
      console.error(
        'POST /applications/:id/close error:',
        err
      );

      return res.status(500).json({
        error:
          'Could not close the application',

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