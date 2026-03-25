const bcrypt = require("bcrypt");
const { pool } = require("../config/db");

const profileSelectSql = `
  SELECT
    u.id,
    u.role,
    u.email,
    u.username,
    u.full_name,
    u.phone,
    u.avatar_url,
    u.is_active,
    u.created_at,
    u.updated_at,
    u.login_dorm_id AS dorm_id,
    d.dorm_slug,
    d.name AS dorm_name,
    d.name_en AS dorm_name_en,
    up.prefix,
    up.gender,
    up.birth_date,

    rc.id AS contract_id,
    rc.status AS contract_status,

    r.id AS room_id,
    r.room_number,
    r.floor_no,
    r.room_type,

    b.id AS building_id,
    b.building_code,
    b.display_name AS building_name
  FROM public.users u
  LEFT JOIN public.dorms d
    ON d.id = u.login_dorm_id
  LEFT JOIN public.user_profiles up
    ON up.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT rc1.*
    FROM public.rental_contracts rc1
    WHERE rc1.tenant_user_id = u.id
      AND rc1.status = 'active'
    ORDER BY rc1.created_at DESC
    LIMIT 1
  ) rc ON TRUE
  LEFT JOIN public.rooms r
    ON r.id = rc.room_id
  LEFT JOIN public.buildings b
    ON b.id = r.building_id
  WHERE u.id = $1
  LIMIT 1
`;

// GET /api/users/me
async function getMyProfile(req, res) {
  try {
    const userId = req.user.userId;

    const result = await pool.query(profileSelectSql, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const user = result.rows[0];

    return res.status(200).json({
      message: "Profile fetched successfully",
      user: {
        ...user,
        login_identifier: user.dorm_slug
          ? `${user.username}@${user.dorm_slug}`
          : user.username,
      },
    });
  } catch (error) {
    console.error("GET MY PROFILE ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

// PUT /api/users/me
async function updateMyProfile(req, res) {
  const client = await pool.connect();

  try {
    const userId = req.user.userId;
    const { full_name, phone, email, prefix, gender, birth_date } = req.body;

    if (!full_name || !phone || !email) {
      return res.status(400).json({
        message: "full_name, phone and email are required",
      });
    }

    await client.query("BEGIN");

    const checkEmail = await client.query(
      `
      SELECT id
      FROM public.users
      WHERE lower(email) = lower($1)
        AND id <> $2
      LIMIT 1
      `,
      [String(email).trim().toLowerCase(), userId]
    );

    if (checkEmail.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Email already exists",
      });
    }

    await client.query(
      `
      UPDATE public.users
      SET
        full_name = $1,
        phone = $2,
        email = $3,
        updated_at = now()
      WHERE id = $4
      `,
      [
        String(full_name).trim(),
        String(phone).trim(),
        String(email).trim().toLowerCase(),
        userId,
      ]
    );

    await client.query(
      `
      INSERT INTO public.user_profiles (
        user_id,
        prefix,
        gender,
        birth_date,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, now(), now())
      ON CONFLICT (user_id)
      DO UPDATE SET
        prefix = EXCLUDED.prefix,
        gender = EXCLUDED.gender,
        birth_date = EXCLUDED.birth_date,
        updated_at = now()
      `,
      [
        userId,
        prefix ? String(prefix).trim() : null,
        gender ? String(gender).trim() : null,
        birth_date || null,
      ]
    );

    const result = await client.query(profileSelectSql, [userId]);

    await client.query("COMMIT");

    const user = result.rows[0];

    return res.status(200).json({
      message: "Profile updated successfully",
      user: {
        ...user,
        login_identifier: user.dorm_slug
          ? `${user.username}@${user.dorm_slug}`
          : user.username,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("UPDATE MY PROFILE ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    client.release();
  }
}

// PUT /api/users/me/password
async function changeMyPassword(req, res) {
  try {
    const userId = req.user.userId;
    const { current_password, new_password, confirm_new_password } = req.body;

    if (!current_password || !new_password || !confirm_new_password) {
      return res.status(400).json({
        message:
          "current_password, new_password and confirm_new_password are required",
      });
    }

    if (String(new_password).length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters",
      });
    }

    if (new_password !== confirm_new_password) {
      return res.status(400).json({
        message: "New password confirmation does not match",
      });
    }

    const result = await pool.query(
      `
      SELECT id, password_hash
      FROM public.users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(
      current_password,
      user.password_hash
    );

    if (!isMatch) {
      return res.status(401).json({
        message: "Current password is incorrect",
      });
    }

    const newPasswordHash = await bcrypt.hash(new_password, 10);

    await pool.query(
      `
      UPDATE public.users
      SET
        password_hash = $1,
        updated_at = now()
      WHERE id = $2
      `,
      [newPasswordHash, userId]
    );

    return res.status(200).json({
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("CHANGE PASSWORD ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
};