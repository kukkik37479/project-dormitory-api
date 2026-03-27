const { pool } = require("../config/db");

function s(value) {
  return String(value ?? "").trim();
}

function getOwnerContext(req) {
  const userId = req.user?.userId || null;
  const dormId = req.user?.dormId || null;
  const role = req.user?.role || null;

  return { userId, dormId, role };
}

function ensureOwner(req, res) {
  const { userId, dormId, role } = getOwnerContext(req);

  if (!userId) {
    res.status(401).json({
      message: "ไม่พบ user ใน token",
    });
    return null;
  }

  if (!dormId) {
    res.status(403).json({
      message: "ไม่พบ dorm ของเจ้าของหอใน token",
    });
    return null;
  }

  if (role !== "owner") {
    res.status(403).json({
      message: "เฉพาะเจ้าของหอเท่านั้น",
    });
    return null;
  }

  return { userId, dormId, role };
}

function mapReviewRow(row) {
  return {
    id: row.id,
    dorm_id: row.dorm_id,
    room_id: row.room_id,
    tenant_user_id: row.tenant_user_id,
    rating: Number(row.rating || 0),
    comment: row.comment,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewer_name: row.reviewer_name || "ผู้เช่า",
    tenant_username: row.tenant_username || null,
    room_number: row.room_number || null,
    building_name: row.building_name || null,
    has_reply: Boolean(row.reply_id),
    reply: row.reply_id
      ? {
          id: row.reply_id,
          replied_by: row.replied_by,
          reply_text: row.reply_text,
          created_at: row.reply_created_at,
          updated_at: row.reply_updated_at,
        }
      : null,
  };
}

// GET /api/reviews/owner/stats
const getOwnerReviewStats = async (req, res) => {
  try {
    const auth = ensureOwner(req, res);
    if (!auth) return;

    const { dormId } = auth;

    const result = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total_reviews,
        COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0)::float AS average_rating,
        COUNT(*) FILTER (
          WHERE rr.id IS NULL
            AND r.status = 'visible'
        )::int AS waiting_reply_count,
        COUNT(*) FILTER (WHERE rr.id IS NOT NULL)::int AS replied_count,
        COUNT(*) FILTER (WHERE r.status = 'visible')::int AS visible_count,
        COUNT(*) FILTER (WHERE r.status = 'hidden')::int AS hidden_count,
        COUNT(*) FILTER (WHERE r.status = 'pending')::int AS pending_count
      FROM public.reviews r
      LEFT JOIN public.review_replies rr
        ON rr.review_id = r.id
      WHERE r.dorm_id = $1
      `,
      [dormId]
    );

    const row = result.rows[0] || {};

    return res.status(200).json({
      message: "ดึงสถิติรีวิวสำเร็จ",
      data: {
        total_reviews: Number(row.total_reviews || 0),
        average_rating: Number(row.average_rating || 0),
        waiting_reply_count: Number(row.waiting_reply_count || 0),
        replied_count: Number(row.replied_count || 0),
        visible_count: Number(row.visible_count || 0),
        hidden_count: Number(row.hidden_count || 0),
        pending_count: Number(row.pending_count || 0),
      },
    });
  } catch (error) {
    console.error("GET OWNER REVIEW STATS ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงสถิติรีวิว",
      error: error.message,
    });
  }
};

// GET /api/reviews/owner
const getOwnerReviews = async (req, res) => {
  try {
    const auth = ensureOwner(req, res);
    if (!auth) return;

    const { dormId } = auth;

    const search = s(req.query.search);
    const status = s(req.query.status).toLowerCase(); // all | visible | hidden | pending
    const replyStatus = s(req.query.replyStatus).toLowerCase(); // all | replied | waiting
    const rating = Number(req.query.rating);
    const sort = s(req.query.sort).toLowerCase(); // newest | oldest | highest | lowest
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
    const offset = (page - 1) * limit;

    const params = [dormId];
    let whereSql = `WHERE r.dorm_id = $1`;

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;

      whereSql += `
        AND (
          COALESCE(u.username, '') ILIKE $${idx}
          OR COALESCE(r.comment, '') ILIKE $${idx}
          OR COALESCE(rm.room_number, '') ILIKE $${idx}
          OR COALESCE(b.display_name, '') ILIKE $${idx}
        )
      `;
    }

    if (status && status !== "all") {
      params.push(status);
      whereSql += ` AND r.status = $${params.length}`;
    }

    if (replyStatus === "replied") {
      whereSql += ` AND rr.id IS NOT NULL`;
    } else if (replyStatus === "waiting") {
      whereSql += ` AND rr.id IS NULL`;
    }

    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      params.push(rating);
      whereSql += ` AND r.rating = $${params.length}`;
    }

    let orderBySql = `ORDER BY r.created_at DESC`;

    if (sort === "oldest") {
      orderBySql = `ORDER BY r.created_at ASC`;
    } else if (sort === "highest") {
      orderBySql = `ORDER BY r.rating DESC, r.created_at DESC`;
    } else if (sort === "lowest") {
      orderBySql = `ORDER BY r.rating ASC, r.created_at DESC`;
    }

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.reviews r
      LEFT JOIN public.users u
        ON u.id = r.tenant_user_id
      LEFT JOIN public.rooms rm
        ON rm.id = r.room_id
      LEFT JOIN public.buildings b
        ON b.id = rm.building_id
      LEFT JOIN public.review_replies rr
        ON rr.review_id = r.id
      ${whereSql}
      `,
      params
    );

    const total = Number(countResult.rows[0]?.total || 0);
    const dataParams = [...params, limit, offset];

    const result = await pool.query(
      `
      SELECT
        r.id,
        r.dorm_id,
        r.room_id,
        r.tenant_user_id,
        r.rating,
        r.comment,
        r.status,
        r.created_at,
        r.updated_at,

        COALESCE(NULLIF(u.username, ''), 'ผู้เช่า') AS reviewer_name,
        u.username AS tenant_username,

        rm.room_number,
        b.display_name AS building_name,

        rr.id AS reply_id,
        rr.replied_by,
        rr.reply_text,
        rr.created_at AS reply_created_at,
        rr.updated_at AS reply_updated_at
      FROM public.reviews r
      LEFT JOIN public.users u
        ON u.id = r.tenant_user_id
      LEFT JOIN public.rooms rm
        ON rm.id = r.room_id
      LEFT JOIN public.buildings b
        ON b.id = rm.building_id
      LEFT JOIN public.review_replies rr
        ON rr.review_id = r.id
      ${whereSql}
      ${orderBySql}
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return res.status(200).json({
      message: "ดึงรายการรีวิวสำเร็จ",
      data: result.rows.map(mapReviewRow),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        start: total === 0 ? 0 : offset + 1,
        end: Math.min(offset + limit, total),
      },
    });
  } catch (error) {
    console.error("GET OWNER REVIEWS ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงรายการรีวิว",
      error: error.message,
    });
  }
};

// POST /api/reviews/:reviewId/reply
const createReviewReply = async (req, res) => {
  const client = await pool.connect();

  try {
    const auth = ensureOwner(req, res);
    if (!auth) return;

    const { userId, dormId } = auth;
    const reviewId = req.params.reviewId;
    const replyText = s(req.body.reply_text);

    if (!reviewId) {
      return res.status(400).json({
        message: "reviewId is required",
      });
    }

    if (!replyText) {
      return res.status(400).json({
        message: "กรุณากรอกข้อความตอบกลับ",
      });
    }

    await client.query("BEGIN");

    const reviewResult = await client.query(
      `
      SELECT id
      FROM public.reviews
      WHERE id = $1
        AND dorm_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [reviewId, dormId]
    );

    if (reviewResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "ไม่พบรีวิวนี้ในหอของคุณ",
      });
    }

    const existingReplyResult = await client.query(
      `
      SELECT id
      FROM public.review_replies
      WHERE review_id = $1
      LIMIT 1
      `,
      [reviewId]
    );

    if (existingReplyResult.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "รีวิวนี้มีการตอบกลับแล้ว",
      });
    }

    const insertResult = await client.query(
      `
      INSERT INTO public.review_replies (
        review_id,
        replied_by,
        reply_text
      )
      VALUES ($1, $2, $3)
      RETURNING
        id,
        review_id,
        replied_by,
        reply_text,
        created_at,
        updated_at
      `,
      [reviewId, userId, replyText]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "ตอบกลับรีวิวสำเร็จ",
      data: insertResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("CREATE REVIEW REPLY ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการตอบกลับรีวิว",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// PATCH /api/reviews/:reviewId/reply
const updateReviewReply = async (req, res) => {
  const client = await pool.connect();

  try {
    const auth = ensureOwner(req, res);
    if (!auth) return;

    const { dormId } = auth;
    const reviewId = req.params.reviewId;
    const replyText = s(req.body.reply_text);

    if (!reviewId) {
      return res.status(400).json({
        message: "reviewId is required",
      });
    }

    if (!replyText) {
      return res.status(400).json({
        message: "กรุณากรอกข้อความตอบกลับ",
      });
    }

    await client.query("BEGIN");

    const reviewResult = await client.query(
      `
      SELECT id
      FROM public.reviews
      WHERE id = $1
        AND dorm_id = $2
      LIMIT 1
      `,
      [reviewId, dormId]
    );

    if (reviewResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "ไม่พบรีวิวนี้ในหอของคุณ",
      });
    }

    const updateResult = await client.query(
      `
      UPDATE public.review_replies
      SET
        reply_text = $1,
        updated_at = now()
      WHERE review_id = $2
      RETURNING
        id,
        review_id,
        replied_by,
        reply_text,
        created_at,
        updated_at
      `,
      [replyText, reviewId]
    );

    if (updateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "รีวิวนี้ยังไม่มีการตอบกลับ",
      });
    }

    await client.query("COMMIT");

    return res.status(200).json({
      message: "แก้ไขการตอบกลับสำเร็จ",
      data: updateResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("UPDATE REVIEW REPLY ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการแก้ไขการตอบกลับ",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// DELETE /api/reviews/:reviewId/reply
const deleteReviewReply = async (req, res) => {
  try {
    const auth = ensureOwner(req, res);
    if (!auth) return;

    const { dormId } = auth;
    const reviewId = req.params.reviewId;

    if (!reviewId) {
      return res.status(400).json({
        message: "reviewId is required",
      });
    }

    const result = await pool.query(
      `
      DELETE FROM public.review_replies rr
      USING public.reviews r
      WHERE rr.review_id = r.id
        AND rr.review_id = $1
        AND r.dorm_id = $2
      RETURNING rr.id, rr.review_id
      `,
      [reviewId, dormId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "ไม่พบการตอบกลับของรีวิวนี้",
      });
    }

    return res.status(200).json({
      message: "ลบการตอบกลับสำเร็จ",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("DELETE REVIEW REPLY ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการลบการตอบกลับ",
      error: error.message,
    });
  }
};

// PATCH /api/reviews/:reviewId/status
const updateReviewStatus = async (req, res) => {
  try {
    const auth = ensureOwner(req, res);
    if (!auth) return;

    const { dormId } = auth;
    const reviewId = req.params.reviewId;
    const status = s(req.body.status).toLowerCase();

    if (!reviewId) {
      return res.status(400).json({
        message: "reviewId is required",
      });
    }

    if (!["visible", "hidden"].includes(status)) {
      return res.status(400).json({
        message: "status ต้องเป็น visible หรือ hidden เท่านั้น",
      });
    }

    const result = await pool.query(
      `
      UPDATE public.reviews
      SET
        status = $1,
        updated_at = now()
      WHERE id = $2
        AND dorm_id = $3
      RETURNING
        id,
        dorm_id,
        room_id,
        tenant_user_id,
        rating,
        comment,
        status,
        created_at,
        updated_at
      `,
      [status, reviewId, dormId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "ไม่พบรีวิวนี้ในหอของคุณ",
      });
    }

    return res.status(200).json({
      message: "อัปเดตสถานะรีวิวสำเร็จ",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("UPDATE REVIEW STATUS ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการอัปเดตสถานะรีวิว",
      error: error.message,
    });
  }
};

// DELETE /api/reviews/:reviewId
const deleteReview = async (req, res) => {
  try {
    const auth = ensureOwner(req, res);
    if (!auth) return;

    const { dormId } = auth;
    const reviewId = req.params.reviewId;

    if (!reviewId) {
      return res.status(400).json({
        message: "reviewId is required",
      });
    }

    const result = await pool.query(
      `
      DELETE FROM public.reviews
      WHERE id = $1
        AND dorm_id = $2
      RETURNING id, dorm_id
      `,
      [reviewId, dormId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "ไม่พบรีวิวนี้ในหอของคุณ",
      });
    }

    return res.status(200).json({
      message: "ลบรีวิวสำเร็จ",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("DELETE REVIEW ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการลบรีวิว",
      error: error.message,
    });
  }
};

module.exports = {
  getOwnerReviewStats,
  getOwnerReviews,
  createReviewReply,
  updateReviewReply,
  deleteReviewReply,
  updateReviewStatus,
  deleteReview,
};