const { pool } = require("../config/db");

function normalizeText(value) {
  return String(value || "").trim();
}

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getOwnerDormId(client, ownerUserId) {
  const result = await client.query(
    `
    SELECT id
    FROM public.dorms
    WHERE owner_user_id = $1
    LIMIT 1
    `,
    [ownerUserId]
  );

  const dorm = result.rows[0];

  if (!dorm) {
    throw createError(404, "Dorm not found");
  }

  return dorm.id;
}

async function resolveDormIdForRequest(client, userId, role, dormId) {
  if (role === "owner") {
    if (dormId) return dormId;
    return getOwnerDormId(client, userId);
  }

  if (!dormId) {
    throw createError(400, "dormId is required");
  }

  return dormId;
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
    const resolvedDormId = await resolveDormIdForRequest(
      client,
      userId,
      role,
      dormId
    );

    if (role === "owner") {
      const canManage = await ensureOwnerCanManageDorm(
        client,
        userId,
        resolvedDormId
      );

      if (!canManage) {
        throw createError(403, "Access denied");
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
        [resolvedDormId]
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
        [resolvedDormId]
      );

      return result.rows;
    }

    throw createError(403, "Unsupported role");
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
      throw createError(403, "Only owner can create announcements");
    }

    const resolvedDormId = await resolveDormIdForRequest(
      client,
      userId,
      role,
      dormId
    );

    const normalizedTitle = normalizeText(title);
    const normalizedContent = normalizeText(content);

    if (!normalizedContent) {
      throw createError(400, "content is required");
    }

    const canManage = await ensureOwnerCanManageDorm(
      client,
      userId,
      resolvedDormId
    );

    if (!canManage) {
      throw createError(403, "Access denied");
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
        resolvedDormId,
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
      throw createError(403, "Only owner can update announcements");
    }

    if (!announcementId) {
      throw createError(400, "announcementId is required");
    }

    const resolvedDormId = await resolveDormIdForRequest(
      client,
      userId,
      role,
      dormId
    );

    const canManage = await ensureOwnerCanManageDorm(
      client,
      userId,
      resolvedDormId
    );

    if (!canManage) {
      throw createError(403, "Access denied");
    }

    const existingResult = await client.query(
      `
      SELECT *
      FROM public.announcements
      WHERE id = $1
        AND dorm_id = $2
      LIMIT 1
      `,
      [announcementId, resolvedDormId]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      throw createError(404, "Announcement not found");
    }

    const nextTitle =
      title !== undefined ? normalizeText(title) || null : existing.title;

    const nextContent =
      content !== undefined ? normalizeText(content) : existing.content;

    if (!nextContent) {
      throw createError(400, "content is required");
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
      throw createError(403, "Only owner can delete announcements");
    }

    if (!announcementId) {
      throw createError(400, "announcementId is required");
    }

    const resolvedDormId = await resolveDormIdForRequest(
      client,
      userId,
      role,
      dormId
    );

    const canManage = await ensureOwnerCanManageDorm(
      client,
      userId,
      resolvedDormId
    );

    if (!canManage) {
      throw createError(403, "Access denied");
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
      [announcementId, resolvedDormId]
    );

    if (!result.rows[0]) {
      throw createError(404, "Announcement not found");
    }

    return { success: true };
  } finally {
    client.release();
  }
}

async function getVacancyAnnouncementDetailById(
  client,
  vacancyAnnouncementId,
  dormId
) {
  const result = await client.query(
    `
    SELECT
      va.id,
      va.dorm_id,
      va.room_id,
      va.created_by,
      va.status,
      va.note,
      va.published_at,
      va.created_at,
      va.updated_at,
      r.room_number,
      r.floor_no,
      r.monthly_rent,
      r.room_type,
      r.status AS room_status,
      b.building_code,
      b.display_name AS building_display_name,
      rt.size_sqm,
      rt.room_layout,
      u.full_name AS created_by_name
    FROM public.vacancy_announcements va
    INNER JOIN public.rooms r
      ON r.id = va.room_id
    INNER JOIN public.buildings b
      ON b.id = r.building_id
    LEFT JOIN public.room_types rt
      ON rt.dorm_id = r.dorm_id
     AND rt.type_name = r.room_type
    LEFT JOIN public.users u
      ON u.id = va.created_by
    WHERE va.id = $1
      AND va.dorm_id = $2
    LIMIT 1
    `,
    [vacancyAnnouncementId, dormId]
  );

  return result.rows[0] || null;
}

async function getVacancyAnnouncementsByOwner(userId, dormId) {
  const client = await pool.connect();

  try {
    const resolvedDormId = await resolveDormIdForRequest(
      client,
      userId,
      "owner",
      dormId
    );

    const canManage = await ensureOwnerCanManageDorm(
      client,
      userId,
      resolvedDormId
    );

    if (!canManage) {
      throw createError(403, "Access denied");
    }

    const result = await client.query(
      `
      SELECT
        va.id,
        va.dorm_id,
        va.room_id,
        va.created_by,
        va.status,
        va.note,
        va.published_at,
        va.created_at,
        va.updated_at,
        r.room_number,
        r.floor_no,
        r.monthly_rent,
        r.room_type,
        r.status AS room_status,
        b.building_code,
        b.display_name AS building_display_name,
        rt.size_sqm,
        rt.room_layout,
        u.full_name AS created_by_name
      FROM public.vacancy_announcements va
      INNER JOIN public.rooms r
        ON r.id = va.room_id
      INNER JOIN public.buildings b
        ON b.id = r.building_id
      LEFT JOIN public.room_types rt
        ON rt.dorm_id = r.dorm_id
       AND rt.type_name = r.room_type
      LEFT JOIN public.users u
        ON u.id = va.created_by
      WHERE va.dorm_id = $1
        AND va.status <> 'archived'
      ORDER BY
        va.published_at DESC NULLS LAST,
        va.created_at DESC
      `,
      [resolvedDormId]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

async function createVacancyAnnouncement({
  userId,
  dormId,
  roomId,
  note,
  status,
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (!roomId) {
      throw createError(400, "roomId is required");
    }

    const resolvedDormId = await resolveDormIdForRequest(
      client,
      userId,
      "owner",
      dormId
    );

    const canManage = await ensureOwnerCanManageDorm(
      client,
      userId,
      resolvedDormId
    );

    if (!canManage) {
      throw createError(403, "Access denied");
    }

    const roomResult = await client.query(
      `
      SELECT
        r.id,
        r.dorm_id,
        r.status,
        r.room_number
      FROM public.rooms r
      WHERE r.id = $1
        AND r.dorm_id = $2
      LIMIT 1
      `,
      [roomId, resolvedDormId]
    );

    const room = roomResult.rows[0];

    if (!room) {
      throw createError(404, "Room not found");
    }

    if (room.status !== "vacant") {
      throw createError(400, "สามารถสร้างประกาศได้เฉพาะห้องที่สถานะเป็น vacant");
    }

    const activeExistingResult = await client.query(
      `
      SELECT id
      FROM public.vacancy_announcements
      WHERE room_id = $1
        AND status IN ('draft', 'published')
      LIMIT 1
      `,
      [roomId]
    );

    if (activeExistingResult.rows[0]) {
      throw createError(400, "ห้องนี้มีประกาศที่ยังใช้งานอยู่แล้ว");
    }

    const nextStatus = status === "draft" ? "draft" : "published";
    const normalizedNote = normalizeText(note) || null;
    const publishedAt = nextStatus === "published" ? new Date() : null;

    const insertResult = await client.query(
      `
      INSERT INTO public.vacancy_announcements (
        dorm_id,
        room_id,
        created_by,
        status,
        note,
        published_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        now(),
        now()
      )
      RETURNING id
      `,
      [
        resolvedDormId,
        roomId,
        userId,
        nextStatus,
        normalizedNote,
        publishedAt,
      ]
    );

    const created = await getVacancyAnnouncementDetailById(
      client,
      insertResult.rows[0].id,
      resolvedDormId
    );

    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function archiveVacancyAnnouncement({
  vacancyAnnouncementId,
  userId,
  dormId,
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (!vacancyAnnouncementId) {
      throw createError(400, "vacancyAnnouncementId is required");
    }

    const resolvedDormId = await resolveDormIdForRequest(
      client,
      userId,
      "owner",
      dormId
    );

    const canManage = await ensureOwnerCanManageDorm(
      client,
      userId,
      resolvedDormId
    );

    if (!canManage) {
      throw createError(403, "Access denied");
    }

    const result = await client.query(
      `
      UPDATE public.vacancy_announcements
      SET
        status = 'archived',
        updated_at = now()
      WHERE id = $1
        AND dorm_id = $2
        AND status <> 'archived'
      RETURNING id
      `,
      [vacancyAnnouncementId, resolvedDormId]
    );

    if (!result.rows[0]) {
      throw createError(404, "Vacancy announcement not found");
    }

    await client.query("COMMIT");
    return { success: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getAnnouncementsByUser,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getVacancyAnnouncementsByOwner,
  createVacancyAnnouncement,
  archiveVacancyAnnouncement,
};