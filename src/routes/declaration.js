const express = require('express');

const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

const {
  requireAuth,
} = require('../middleware/auth');

const router = express.Router();

router.post(
  '/save',
  requireAuth,
  async (req, res) => {
    try {
      const {
        applicationId,
        accepted,
      } = req.body;

      if (
        !applicationId ||
        accepted !== true
      ) {
        return res.status(400).json({
          error:
            'You must accept the declaration before continuing.',
        });
      }

      const {
        data: application,
        error: applicationError,
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
          .maybeSingle();

      if (
        applicationError
      ) {
        throw applicationError;
      }

      if (!application) {
        return res.status(404).json({
          error:
            'Application not found',
        });
      }

      if (
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

      const payload = {
        application_id:
          applicationId,

        accepted:
          true,

        accepted_at:
          new Date().toISOString(),
      };

      const {
        data: existing,
        error: existingError,
      } =
        await supabaseAdmin
          .from(
            'declarations'
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
              'declarations'
            )
            .update(
              payload
            )
            .eq(
              'id',
              existing.id
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
            .from(
              'declarations'
            )
            .insert(
              payload
            )
            .select()
            .single();

        if (error) {
          throw error;
        }

        saved = data;
      }

      const {
        error: stageError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .update({
            current_stage:
              'selfie',
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

      res.json({
        declaration:
          saved,
      });
    } catch (err) {
      console.error(
        'POST /declaration/save error:',
        err
      );

      res.status(500).json({
        error:
          'Could not save declaration',

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
