const express = require('express');

const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

const {
  requireAuth,
} = require('../middleware/auth');

const {
  evaluateEligibility,
} = require('../utils/eligibilityEngine');

const {
  simulateCreditScore,
} = require('../utils/creditScoreSimulator');

const router =
  express.Router();

const TERMINAL_STAGES =
  new Set([
    'under_review',
    'approved',
    'rejected',
    'disbursed',
    'closed',
  ]);

router.post(
  '/check',
  requireAuth,
  async (req, res) => {
    try {
      const {
        applicationId,
        monthlyIncome,
        requestedAmount,
        existingDebts = 0,
        creditScore,
        employerName,
        designation,
      } = req.body;

      const income =
        Number(monthlyIncome);

      const amount =
        Number(requestedAmount);

      const debts =
        Number(existingDebts || 0);

      if (
        !applicationId ||
        income <= 0 ||
        amount <= 0 ||
        debts < 0 ||
        (
          creditScore !==
            undefined &&
          (
            !Number.isFinite(
              Number(
                creditScore
              )
            ) ||
            Number(
              creditScore
            ) < 300 ||
            Number(
              creditScore
            ) > 900
          )
        )
      ) {
        return res.status(400).json({
          error:
            'Income, requested amount and application are required. Credit score must be between 300 and 900.',
        });
      }

      const {
        data: app,
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
        !app ||
        app.user_id !==
          req.user.id
      ) {
        return res.status(403).json({
          error:
            'Not your application',
        });
      }

      if (
        TERMINAL_STAGES.has(
          app.current_stage
        )
      ) {
        return res.status(400).json({
          error:
            'This application is no longer editable.',
        });
      }

      const {
        data: kyc,
        error: kycError,
      } =
        await supabaseAdmin
          .from('kyc_details')
          .select(
            'full_name,date_of_birth,id_number'
          )
          .eq(
            'application_id',
            applicationId
          )
          .maybeSingle();

      if (kycError) {
        throw kycError;
      }

      if (!kyc) {
        return res.status(400).json({
          error:
            'Complete KYC before checking eligibility',
        });
      }

      /*
       * In the challenge build the customer can enter a
       * simulated CIBIL score so that all eligibility
       * scenarios can be tested deterministically.
       *
       * If no score is supplied, keep the deterministic
       * fallback simulator for backward compatibility.
       */
      const suppliedCreditScore =
        creditScore ===
          undefined ||
        creditScore === null ||
        creditScore === ''
          ? null
          : Number(
              creditScore
            );

      const resolvedCreditScore =
        suppliedCreditScore ??
        simulateCreditScore({
          idNumber:
            kyc.id_number,

          dateOfBirth:
            kyc.date_of_birth,

          fullName:
            kyc.full_name,
        });

      const evaluation =
        evaluateEligibility({
          monthlyIncome:
            income,

          requestedAmount:
            amount,

          creditScore:
            resolvedCreditScore,

          existingDebts:
            debts,
        });

      /*
       * Keep eligibility history.
       *
       * If the customer goes back and changes income,
       * amount or debt, a new eligibility record is
       * created and the latest one becomes current.
       */
      const {
        data: saved,
        error: saveError,
      } =
        await supabaseAdmin
          .from(
            'eligibility_checks'
          )
          .insert({
            application_id:
              applicationId,

            monthly_income:
              income,

            requested_amount:
              amount,

            credit_score:
              resolvedCreditScore,

            existing_debts:
              debts,

            employer_name:
              employerName ||
              null,

            designation:
              designation ||
              null,

            debt_to_income_ratio:
              evaluation.debtToIncomeRatio,

            result:
              evaluation.result,

            max_eligible_amount:
              evaluation.maxEligibleAmount,
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
              amount,
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

      /*
       * The result screen is the Eligibility stage.
       * Persisting this here prevents the Back button from
       * thinking the application is still at KYC.
       */
      if (
        [
          'kyc',
          'eligibility',
        ].includes(
          app.current_stage
        )
      ) {
        const {
          error:
            stageError,
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
      }

      res.json({
        eligibility:
          saved,

        reasoning:
          evaluation.reasoning,

        creditScore:
          resolvedCreditScore,
      });
    } catch (err) {
      console.error(
        'POST /eligibility/check error:',
        err
      );

      res.status(500).json({
        error:
          'Failed to evaluate eligibility',

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