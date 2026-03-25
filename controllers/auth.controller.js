const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "roomie_fallback_secret";

function slugify(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

async function generateUniqueDormSlug(client, rawText) {
  let baseSlug = slugify(rawText);

  if (!baseSlug) {
    baseSlug = `dorm-${Date.now()}`;
  }

  let finalSlug = baseSlug;
  let counter = 1;

  while (true) {
    const check = await client.query(
      `
      SELECT id
      FROM public.dorms
      WHERE lower(dorm_slug) = lower($1)
      LIMIT 1
      `,
      [finalSlug]
    );

    if (check.rows.length === 0) {
      return finalSlug;
    }

    finalSlug = `${baseSlug}-${counter}`;
    counter++;
  }
}

// REGISTER: create owner + dorm together
async function register(req, res) {
  const client = await pool.connect();

  try {
    const {
      username,
      email,
      password,
      full_name,
      phone,
      dorm_name,
      dorm_name_en,
    } = req.body;

    const normalizedUsername = String(username).trim().toLowerCase();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedFullName = String(full_name).trim();
    const normalizedPhone = String(phone).trim();
    const normalizedDormName = String(dorm_name).trim();
    const normalizedDormNameEn = String(dorm_name_en).trim();

    const placeholderAddress = "ยังไม่ได้ระบุที่อยู่";

    await client.query("BEGIN");

    const checkEmail = await client.query(
      `
      SELECT id
      FROM public.users
      WHERE lower(email) = lower($1)
      LIMIT 1
      `,
      [normalizedEmail]
    );

    if (checkEmail.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Email already exists",
      });
    }

    const dormSlug = await generateUniqueDormSlug(client, normalizedDormNameEn);
    const passwordHash = await bcrypt.hash(password, 10);

    const userResult = await client.query(
      `
      INSERT INTO public.users (
        role,
        email,
        username,
        password_hash,
        full_name,
        phone,
        must_change_password,
        is_active,
        login_dorm_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, false, true, NULL)
      RETURNING
        id,
        role,
        email,
        username,
        full_name,
        phone,
        must_change_password,
        is_active,
        created_at
      `,
      [
        "owner",
        normalizedEmail,
        normalizedUsername,
        passwordHash,
        normalizedFullName,
        normalizedPhone,
      ]
    );

    const owner = userResult.rows[0];

    const dormResult = await client.query(
      `
      INSERT INTO public.dorms (
        owner_user_id,
        name,
        name_en,
        phone,
        full_address,
        status,
        dorm_slug
      )
      VALUES ($1, $2, $3, $4, $5, 'active', $6)
      RETURNING
        id,
        owner_user_id,
        name,
        name_en,
        phone,
        full_address,
        status,
        dorm_slug,
        created_at,
        updated_at
      `,
      [
        owner.id,
        normalizedDormName,
        normalizedDormNameEn,
        normalizedPhone,
        placeholderAddress,
        dormSlug,
      ]
    );

    const dorm = dormResult.rows[0];

    await client.query(
      `
      UPDATE public.users
      SET login_dorm_id = $1
      WHERE id = $2
      `,
      [dorm.id, owner.id]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Owner and dorm registered successfully",
      user: {
        ...owner,
        login_dorm_id: dorm.id,
      },
      dorm,
      login_identifier: `${owner.username}@${dorm.dorm_slug}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("REGISTER ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    client.release();
  }
}

// LOGIN: owner / tenant => username@dorm_slug
// admin => username (plain)
async function login(req, res) {
  try {
    const { identifier, password } = req.body;

    const normalizedIdentifier = String(identifier).trim().toLowerCase();

    let result;

    if (normalizedIdentifier.includes("@")) {
      const [rawUsername, rawDormSlug] = normalizedIdentifier.split("@");

      const parsedUsername = String(rawUsername || "").trim().toLowerCase();
      const parsedDormSlug = String(rawDormSlug || "").trim().toLowerCase();

      if (!parsedUsername || !parsedDormSlug) {
        return res.status(400).json({
          message: "Invalid login format",
        });
      }

      result = await pool.query(
        `
        SELECT
          u.id,
          u.role,
          u.email,
          u.username,
          u.password_hash,
          u.full_name,
          u.phone,
          u.avatar_url,
          u.must_change_password,
          u.is_active,
          u.created_at,
          u.updated_at,
          d.id AS dorm_id,
          d.dorm_slug,
          d.name AS dorm_name,
          d.name_en AS dorm_name_en,
          up.prefix,
          up.gender,
          up.birth_date
        FROM public.users u
        JOIN public.dorms d
          ON d.id = u.login_dorm_id
        LEFT JOIN public.user_profiles up
          ON up.user_id = u.id
        WHERE lower(u.username) = lower($1)
          AND lower(d.dorm_slug) = lower($2)
        LIMIT 1
        `,
        [parsedUsername, parsedDormSlug]
      );
    } else {
      result = await pool.query(
        `
        SELECT
          u.id,
          u.role,
          u.email,
          u.username,
          u.password_hash,
          u.full_name,
          u.phone,
          u.avatar_url,
          u.must_change_password,
          u.is_active,
          u.created_at,
          u.updated_at,
          NULL::uuid AS dorm_id,
          NULL::varchar AS dorm_slug,
          NULL::varchar AS dorm_name,
          NULL::varchar AS dorm_name_en,
          up.prefix,
          up.gender,
          up.birth_date
        FROM public.users u
        LEFT JOIN public.user_profiles up
          ON up.user_id = u.id
        WHERE lower(u.username) = lower($1)
          AND u.role = 'admin'
        LIMIT 1
        `,
        [normalizedIdentifier]
      );
    }

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid identifier or password",
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        message: "This account is inactive",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid identifier or password",
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        username: user.username,
        dormId: user.dorm_id,
        dormSlug: user.dorm_slug,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        role: user.role,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        phone: user.phone,
        avatar_url: user.avatar_url,
        prefix: user.prefix,
        gender: user.gender,
        birth_date: user.birth_date,
        must_change_password: user.must_change_password,
        is_active: user.is_active,
        created_at: user.created_at,
        updated_at: user.updated_at,
        dorm_id: user.dorm_id,
        dorm_slug: user.dorm_slug,
        dorm_name: user.dorm_name,
        dorm_name_en: user.dorm_name_en,
        login_identifier: user.dorm_slug
          ? `${user.username}@${user.dorm_slug}`
          : user.username,
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

// ME
async function me(req, res) {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.role,
        u.email,
        u.username,
        u.full_name,
        u.phone,
        u.avatar_url,
        u.must_change_password,
        u.is_active,
        u.created_at,
        u.updated_at,
        d.id AS dorm_id,
        d.dorm_slug,
        d.name AS dorm_name,
        d.name_en AS dorm_name_en,
        up.prefix,
        up.gender,
        up.birth_date
      FROM public.users u
      LEFT JOIN public.dorms d
        ON d.id = u.login_dorm_id
      LEFT JOIN public.user_profiles up
        ON up.user_id = u.id
      WHERE u.id = $1
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

    return res.status(200).json({
      message: "Current user fetched successfully",
      user: {
        ...user,
        login_identifier: user.dorm_slug
          ? `${user.username}@${user.dorm_slug}`
          : user.username,
      },
    });
  } catch (error) {
    console.error("ME ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

module.exports = {
  register,
  login,
  me,
};