const { pool } = require("../config/db");

function normalizeText(value) {
  return String(value || "").trim();
}

async function ensureOwnerCanManageDorm(client, ownerUserId, dormId) {
  const result = await client.query(
    `
    SELECT d.id
    FROM public.dorms d
    WHERE d.id = $1
      AND d.owner_user_id = $2
    LIMIT 1
    `,
    [dormId, ownerUserId]
  );

  return !!result.rows[0];
}

async function getAnnouncementsByUser(userId, role, dormId) {
  const client = await pool.connect();

  try {
    if (!dormId) {
      const error = new Error("dormId is required");
      error.statusCode = 400;
      throw error;
    }

    if (role === "owner") {
      const canManage = await ensureOwnerCanManageDorm(client, userId, dormId);

      if (!canManage) {
        const error = new Error("Access denied");
        error.statusCode = 403;
        throw error;
      }

      const result = await client.query(
        `
        SELECT
          a.id,
          a.dorm_id,
          a.created_by,
          a.title,
          a.content,
          a.publish_date,
          a.is_pinned,
          a.status,
          a.created_at,
          a.updated_at,
          u.full_name AS created_by_name
        FROM public.announcements a
        LEFT JOIN public.users u
          ON u.id = a.created_by
        WHERE a.dorm_id = $1
          AND a.status <> 'archived'
        ORDER BY a.is_pinned DESC, a.publish_date DESC, a.created_at DESC
        `,
        [dormId]
      );

      return result.rows;
    }

    if (role === "tenant") {
      const result = await client.query(
        `
        SELECT
          a.id,
          a.dorm_id,
          a.created_by,
          a.title,
          a.content,
          a.publish_date,
          a.is_pinned,
          a.status,
          a.created_at,
          a.updated_at,
          u.full_name AS created_by_name
        FROM public.announcements a
        LEFT JOIN public.users u
          ON u.id = a.created_by
        WHERE a.dorm_id = $1
          AND a.status = 'published'
        ORDER BY a.is_pinned DESC, a.publish_date DESC, a.created_at DESC
        `,
        [dormId]
      );

      return result.rows;
    }

    const error = new Error("Unsupported role");
    error.statusCode = 403;
    throw error;
  } finally {
    client.release();
  }
}

async function createAnnouncement({
  userId,
  role,
  dormId,
  title,
  content,
  publishDate,
  isPinned,
  status,
}) {
  const client = await pool.connect();

  try {
    if (role !== "owner") {
      const error = new Error("Only owner can create announcements");
      error.statusCode = 403;
      throw error;
    }

    if (!dormId) {
      const error = new Error("dormId is required");
      error.statusCode = 400;
      throw error;
    }

    const normalizedTitle = normalizeText(title);
    const normalizedContent = normalizeText(content);

    if (!normalizedContent) {
      const error = new Error("content is required");
      error.statusCode = 400;
      throw error;
    }

    const canManage = await ensureOwnerCanManageDorm(client, userId, dormId);

    if (!canManage) {
      const error = new Error("Access denied");
      error.statusCode = 403;
      throw error;
    }

    const result = await client.query(
      `
      INSERT INTO public.announcements (
        dorm_id,
        created_by,
        title,
        content,
        publish_date,
        is_pinned,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7, now(), now())
      RETURNING *
      `,
      [
        dormId,
        userId,
        normalizedTitle || null,
        normalizedContent,
        publishDate || null,
        Boolean(isPinned),
        status || "published",
      ]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

async function updateAnnouncement({
  announcementId,
  userId,
  role,
  dormId,
  title,
  content,
  publishDate,
  isPinned,
  status,
}) {
  const client = await pool.connect();

  try {
    if (role !== "owner") {
      const error = new Error("Only owner can update announcements");
      error.statusCode = 403;
      throw error;
    }

    if (!announcementId) {
      const error = new Error("announcementId is required");
      error.statusCode = 400;
      throw error;
    }

    if (!dormId) {
      const error = new Error("dormId is required");
      error.statusCode = 400;
      throw error;
    }

    const canManage = await ensureOwnerCanManageDorm(client, userId, dormId);

    if (!canManage) {
      const error = new Error("Access denied");
      error.statusCode = 403;
      throw error;
    }

    const existingResult = await client.query(
      `
      SELECT *
      FROM public.announcements
      WHERE id = $1
        AND dorm_id = $2
      LIMIT 1
      `,
      [announcementId, dormId]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      const error = new Error("Announcement not found");
      error.statusCode = 404;
      throw error;
    }

    const nextTitle =
      title !== undefined ? normalizeText(title) || null : existing.title;

    const nextContent =
      content !== undefined ? normalizeText(content) : existing.content;

    if (!nextContent) {
      const error = new Error("content is required");
      error.statusCode = 400;
      throw error;
    }

    const nextPublishDate =
      publishDate !== undefined ? publishDate || null : existing.publish_date;

    const nextPinned =
      isPinned !== undefined ? Boolean(isPinned) : existing.is_pinned;

    const nextStatus = status !== undefined ? status : existing.status;

    const result = await client.query(
      `
      UPDATE public.announcements
      SET
        title = $2,
        content = $3,
        publish_date = COALESCE($4, publish_date),
        is_pinned = $5,
        status = $6,
        updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [
        announcementId,
        nextTitle,
        nextContent,
        nextPublishDate,
        nextPinned,
        nextStatus,
      ]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
}

async function deleteAnnouncement({
  announcementId,
  userId,
  role,
  dormId,
}) {
  const client = await pool.connect();

  try {
    if (role !== "owner") {
      const error = new Error("Only owner can delete announcements");
      error.statusCode = 403;
      throw error;
    }

    if (!announcementId) {
      const error = new Error("announcementId is required");
      error.statusCode = 400;
      throw error;
    }

    if (!dormId) {
      const error = new Error("dormId is required");
      error.statusCode = 400;
      throw error;
    }

    const canManage = await ensureOwnerCanManageDorm(client, userId, dormId);

    if (!canManage) {
      const error = new Error("Access denied");
      error.statusCode = 403;
      throw error;
    }

    const result = await client.query(
      `
      UPDATE public.announcements
      SET
        status = 'archived',
        updated_at = now()
      WHERE id = $1
        AND dorm_id = $2
      RETURNING *
      `,
      [announcementId, dormId]
    );

    if (!result.rows[0]) {
      const error = new Error("Announcement not found");
      error.statusCode = 404;
      throw error;
    }

    return { success: true };
  } finally {
    client.release();
  }
}

module.exports = {
  getAnnouncementsByUser,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
};