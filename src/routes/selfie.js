const express = require('express');

const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

const {
  requireAuth,
} = require('../middleware/auth');

const router = express.Router();

router.post(
  '/submit',
  requireAuth,
  async (req, res) => {
    try {
      const {
        applicationId,
        photoUrl,
      } = req.body;

      if (
        !applicationId ||
        !photoUrl
      ) {
        return res.status(400).json({
          error:
            'Application and selfie path are required.',
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

      /*
       * The browser uploads to a private bucket using a path
       * beginning with the authenticated user's ID.
       *
       * The backend verifies the path before saving it.
       */
      const expectedPrefix =
        `${req.user.id}/`;

      if (
        !String(
          photoUrl
        ).startsWith(
          expectedPrefix
        )
      ) {
        return res.status(403).json({
          error:
            'Invalid selfie storage path.',
        });
      }

      const payload = {
        application_id:
          applicationId,

        photo_url:
          photoUrl,

        status:
          'pending',
      };

      const {
        data: existing,
        error: existingError,
      } =
        await supabaseAdmin
          .from(
            'selfie_verifications'
          )
          .select('id')
          .eq(
            'application_id',
            applicationId
          )
          .eq(
            'status',
            'pending'
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
              'selfie_verifications'
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
              'selfie_verifications'
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
        data: updatedApplication,
        error: stageError,
      } =
        await supabaseAdmin
          .from(
            'loan_applications'
          )
          .update({
            current_stage:
              'under_review',
          })
          .eq(
            'id',
            applicationId
          )
          .eq(
            'user_id',
            req.user.id
          )
          .select()
          .single();

      if (stageError) {
        throw stageError;
      }

      res.json({
        selfie:
          saved,

        application:
          updatedApplication,
      });
    } catch (err) {
      console.error(
        'POST /selfie/submit error:',
        err
      );

      res.status(500).json({
        error:
          'Could not submit selfie',

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
