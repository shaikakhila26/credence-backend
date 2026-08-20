const express =
  require('express');

const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

const {
  requireAuth,
} = require('../middleware/auth');

const {
  calculateLoanBreakdown,
  calculateEMI,
} =
  require('../utils/emiCalculator');

const {
  evaluateTermEligibility,
} =
  require('../utils/eligibilityEngine');

const router =
  express.Router();

async function getActiveConfig() {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from('loan_config')
      .select('*')
      .eq(
        'is_active',
        true
      )
      .limit(1)
      .single();

  if (error) {
    throw error;
  }

  return data;
}

function calculateMaxAffordablePrincipal({
  monthlyIncome,
  existingDebts,
  interestRateAnnual,
  tenureMonths,
}) {
  const income =
    Number(monthlyIncome) || 0;

  const debts =
    Number(existingDebts) || 0;

  /*
   * Keep proposed EMI at or below 50% DTI
   * after accounting for existing debt.
   */
  const maxEmi =
    Math.max(
      income * 0.5 - debts,
      0
    );

  if (
    maxEmi <= 0 ||
    income <= 0
  ) {
    return 0;
  }

  /*
   * Binary search for the highest principal
   * that produces an EMI <= maxEmi.
   */
  let low = 0;
  let high = 10000000;

  for (
    let i = 0;
    i < 70;
    i += 1
  ) {
    const mid =
      (low + high) / 2;

    const emi =
      calculateEMI(
        mid,
        interestRateAnnual,
        tenureMonths
      );

    if (
      emi <= maxEmi
    ) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (
    Math.round(
      low * 100
    ) / 100
  );
}

async function getLatestEligibility(
  applicationId
) {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        'eligibility_checks'
      )
      .select('*')
      .eq(
        'application_id',
        applicationId
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

  return data || null;
}

/*
 * LIVE CALCULATOR
 */
router.post(
  '/calculate',
  requireAuth,
  async (req, res) => {
    try {
      const {
        loanAmount,
        tenureMonths,
        applicationId,
      } = req.body;

      const amount =
        Number(loanAmount);

      const tenure =
        Number(tenureMonths);

      if (
        amount <= 0 ||
        tenure <= 0
      ) {
        return res.status(400).json({
          error:
            'loanAmount and tenureMonths are required',
        });
      }

      const config =
        await getActiveConfig();

      if (
        !config.tenure_options.includes(
          tenure
        )
      ) {
        return res.status(400).json({
          error:
            `tenureMonths must be one of ${config.tenure_options}`,
        });
      }

      const breakdown =
        calculateLoanBreakdown({
          loanAmount:
            amount,

          tenureMonths:
            tenure,

          interestRateAnnual:
            Number(
              config.interest_rate_annual
            ),

          processingFee:
            Number(
              config.processing_fee
            ),

          gstPercent:
            Number(
              config.gst_percent
            ),
        });

      let termEligibility =
        null;

      if (applicationId) {
        const {
          data: application,
          error:
            applicationError,
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
          applicationError ||
          !application ||
          application.user_id !==
            req.user.id
        ) {
          return res.status(403).json({
            error:
              'Not your application',
          });
        }

        const eligibility =
          await getLatestEligibility(
            applicationId
          );

        if (eligibility) {
          const maxAffordablePrincipal =
            calculateMaxAffordablePrincipal({
              monthlyIncome:
                eligibility.monthly_income,

              existingDebts:
                eligibility.existing_debts,

              interestRateAnnual:
                Number(
                  config.interest_rate_annual
                ),

              tenureMonths:
                tenure,
            });

          const affordabilityCap =
            Math.min(
              Number(
                eligibility.max_eligible_amount ||
                  0
              ),
              maxAffordablePrincipal
            );

          termEligibility =
            evaluateTermEligibility({
              monthlyIncome:
                eligibility.monthly_income,

              existingDebts:
                eligibility.existing_debts,

              creditScore:
                eligibility.credit_score,

              requestedAmount:
                amount,

              emi:
                breakdown.emi,

              baseMaxEligibleAmount:
                affordabilityCap,
            });

          termEligibility.maxAffordablePrincipal =
            Math.round(
              maxAffordablePrincipal
            );

          termEligibility.maxTermEligibleAmount =
            Math.round(
              Math.max(
                affordabilityCap,
                0
              )
            );

          termEligibility.baseEligibilityResult =
            eligibility.result;
        }
      }

      res.json({
        breakdown,

        tenureOptions:
          config.tenure_options,

        termEligibility,
      });
    } catch (err) {
      console.error(
        'POST /loan-terms/calculate error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to calculate loan terms',

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
 * CONFIRM TERMS
 *
 * The server repeats the affordability check.
 */
router.post(
  '/confirm',
  requireAuth,
  async (req, res) => {
    try {
      const {
        applicationId,
        loanAmount,
        tenureMonths,
      } = req.body;

      const amount =
        Number(loanAmount);

      const tenure =
        Number(tenureMonths);

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

      const eligibility =
        await getLatestEligibility(
          applicationId
        );

      if (
        !eligibility ||
        eligibility.result ===
          'not_eligible'
      ) {
        return res.status(400).json({
          error:
            'Complete a successful eligibility check before selecting loan terms.',
        });
      }

      const config =
        await getActiveConfig();

      if (
        !config.tenure_options.includes(
          tenure
        )
      ) {
        return res.status(400).json({
          error:
            `Tenure must be one of ${config.tenure_options.join(
              ', '
            )} months.`,
        });
      }

      const breakdown =
        calculateLoanBreakdown({
          loanAmount:
            amount,

          tenureMonths:
            tenure,

          interestRateAnnual:
            Number(
              config.interest_rate_annual
            ),

          processingFee:
            Number(
              config.processing_fee
            ),

          gstPercent:
            Number(
              config.gst_percent
            ),
        });

      const maxAffordablePrincipal =
        calculateMaxAffordablePrincipal({
          monthlyIncome:
            eligibility.monthly_income,

          existingDebts:
            eligibility.existing_debts,

          interestRateAnnual:
            Number(
              config.interest_rate_annual
            ),

          tenureMonths:
            tenure,
        });

      const affordabilityCap =
        Math.min(
          Number(
            eligibility.max_eligible_amount ||
              0
          ),
          maxAffordablePrincipal
        );

      const termEligibility =
        evaluateTermEligibility({
          monthlyIncome:
            eligibility.monthly_income,

          existingDebts:
            eligibility.existing_debts,

          creditScore:
            eligibility.credit_score,

          requestedAmount:
            amount,

          emi:
            breakdown.emi,

          baseMaxEligibleAmount:
            affordabilityCap,
        });

      if (
        termEligibility.result ===
        'not_eligible'
      ) {
        return res.status(400).json({
          error:
            'These loan terms do not pass the affordability check. Choose a lower amount or a longer tenure.',

          termEligibility: {
            ...termEligibility,

            maxAffordablePrincipal:
              Math.round(
                maxAffordablePrincipal
              ),

            maxTermEligibleAmount:
              Math.round(
                Math.max(
                  affordabilityCap,
                  0
                )
              ),
          },
        });
      }

      if (
        amount >
        Number(
          eligibility.max_eligible_amount ||
            0
        )
      ) {
        return res.status(400).json({
          error:
            `Loan amount cannot exceed your maximum eligible amount of ₹${Number(
              eligibility.max_eligible_amount ||
                0
            ).toLocaleString(
              'en-IN'
            )}.`,
        });
      }

      if (
        amount >
        maxAffordablePrincipal
      ) {
        return res.status(400).json({
          error:
            `With this ${tenure}-month tenure, the EMI is too high for your income. A lower amount of approximately ₹${Math.round(
              maxAffordablePrincipal
            ).toLocaleString(
              'en-IN'
            )} or a longer tenure is required.`,
        });
      }

      const {
        data: saved,
        error: saveError,
      } =
        await supabaseAdmin
          .from('loan_terms')
          .insert({
            application_id:
              applicationId,

            loan_amount:
              breakdown.loanAmount,

            tenure_months:
              breakdown.tenureMonths,

            interest_rate_annual:
              breakdown.interestRateAnnual,

            processing_fee:
              breakdown.processingFee,

            gst:
              breakdown.gst,

            emi:
              breakdown.emi,

            total_interest:
              breakdown.totalInterest,

            total_repayment:
              breakdown.totalRepayment,

            net_disbursement:
              breakdown.netDisbursement,

            irr:
              breakdown.irr,
          })
          .select()
          .single();

      if (saveError) {
        throw saveError;
      }

      /*
       * Keep application summary synchronized.
       */
      const {
        error:
          applicationUpdateError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .update({
            requested_amount:
              breakdown.loanAmount,
          })
          .eq(
            'id',
            applicationId
          )
          .eq(
            'user_id',
            req.user.id
          );

      if (
        applicationUpdateError
      ) {
        throw applicationUpdateError;
      }

      res.json({
        loanTerms:
          saved,

        termEligibility,
      });
    } catch (err) {
      console.error(
        'POST /loan-terms/confirm error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to save loan terms',

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