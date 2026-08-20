const {
  supabaseAdmin,
} = require('../config/supabaseAdmin');

/**
 * =========================================================
 * REQUIRE AUTH
 * =========================================================
 *
 * Expected:
 *
 * Authorization: Bearer <supabase-access-token>
 *
 * The frontend gets the token from:
 *
 * supabase.auth.getSession()
 *
 * We NEVER trust a user id sent by the frontend.
 *
 * The user id comes from the verified Supabase token.
 */
async function requireAuth(
  req,
  res,
  next
) {
  try {
    const authHeader =
      req.headers.authorization || '';

    /*
     * Missing header.
     */
    if (
      !authHeader.startsWith(
        'Bearer '
      )
    ) {
      console.warn(
        `[AUTH] Missing Bearer token: ${req.method} ${req.originalUrl}`
      );

      return res.status(401).json({
        error:
          'Authentication required',
      });
    }

    const token =
      authHeader
        .slice(7)
        .trim();

    /*
     * Empty token.
     */
    if (!token) {
      console.warn(
        `[AUTH] Empty Bearer token: ${req.method} ${req.originalUrl}`
      );

      return res.status(401).json({
        error:
          'Authentication required',
      });
    }

    /*
     * -------------------------------------------------------
     * VERIFY TOKEN WITH SUPABASE
     * -------------------------------------------------------
     */
    const {
      data,
      error,
    } =
      await supabaseAdmin.auth.getUser(
        token
      );

    if (
      error ||
      !data?.user
    ) {
      console.error(
        '[AUTH] Supabase token validation failed:',
        error?.message ||
          'No user returned'
      );

      return res.status(401).json({
        error:
          'Invalid or expired session',

        detail:
          process.env.NODE_ENV !==
          'production'
            ? error?.message
            : undefined,
      });
    }

    const user =
      data.user;

    /*
     * -------------------------------------------------------
     * LOAD PROFILE
     * -------------------------------------------------------
     */
    const {
      data: profile,
      error: profileError,
    } =
      await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (
      profileError
    ) {
      console.error(
        '[AUTH] Profile lookup failed:',
        profileError
      );

      return res.status(500).json({
        error:
          'Failed to load user profile',

        detail:
          process.env.NODE_ENV !==
          'production'
            ? profileError.message
            : undefined,
      });
    }

    if (!profile) {
      console.error(
        `[AUTH] No profile found for authenticated user ${user.id}`
      );

      return res.status(401).json({
        error:
          'Profile not found for user',
      });
    }

    /*
     * -------------------------------------------------------
     * ATTACH VERIFIED USER TO REQUEST
     * -------------------------------------------------------
     */
    req.user = user;
    req.profile = profile;

    console.log(
      `[AUTH] ${req.method} ${req.originalUrl} → ${user.id} (${profile.role || 'customer'})`
    );

    next();
  } catch (error) {
    console.error(
      '[AUTH] Unexpected authentication error:',
      error
    );

    return res.status(500).json({
      error:
        'Authentication check failed',
    });
  }
}

/**
 * =========================================================
 * REQUIRE ADMIN
 * =========================================================
 */
function requireAdmin(
  req,
  res,
  next
) {
  if (
    !req.user ||
    !req.profile
  ) {
    return res.status(401).json({
      error:
        'Authentication required',
    });
  }

  if (
    req.profile.role !==
    'admin'
  ) {
    return res.status(403).json({
      error:
        'Admin access required',
    });
  }

  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
};