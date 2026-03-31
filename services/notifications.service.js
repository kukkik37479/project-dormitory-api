const { pool } = require("../config/db");
const {
  getUnreadAnnouncementCountByUser,
} = require("./announcement.service");

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function getUserContext(user = {}) {
  return {
    userId: user.userId || user.id || user.user_id || user.sub || null,
    dormId: user.dormId || user.dorm_id || user.loginDormId || user.login_dorm_id || null,
    role: user.role || null,
  };
}

async function resolveOwnerDormId(userId, dormIdFromToken = null) {
  if (dormIdFromToken) return dormIdFromToken;

  const result = await pool.query(
    `
    SELECT id
    FROM public.dorms
    WHERE owner_user_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [userId]
  );

  const dorm = result.rows[0] || null;

  if (!dorm) {
    throw createError(403, "ไม่พบข้อมูลหอพักของเจ้าของหอ");
  }

  return dorm.id;
}

async function getOwnerSummary({ userId, dormId }) {
  const resolvedDormId = await resolveOwnerDormId(userId, dormId);

  const [chatResult, paymentResult, repairResult, reviewResult] =
    await Promise.all([
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM public.chat_messages cm
        JOIN public.chat_conversations cc
          ON cc.id = cm.conversation_id
        JOIN public.rental_contracts rc
          ON rc.id = cc.rental_contract_id
        JOIN public.users tenant_user
          ON tenant_user.id = cc.tenant_user_id
        WHERE cc.owner_user_id = $1
          AND cm.sender_user_id <> $1
          AND cm.read_at IS NULL
          AND rc.status = 'active'
          AND COALESCE(tenant_user.is_active, true) = true
        `,
        [userId]
      ),

      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM public.invoices i
        LEFT JOIN LATERAL (
          SELECT
            p.id,
            p.status
          FROM public.payments p
          WHERE p.invoice_id = i.id
          ORDER BY p.created_at DESC
          LIMIT 1
        ) lp ON true
        WHERE i.dorm_id = $1
          AND lp.id IS NOT NULL
          AND lp.status = 'submitted'
        `,
        [resolvedDormId]
      ),

      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM public.repair_requests
        WHERE dorm_id = $1
          AND status = 'pending'
        `,
        [resolvedDormId]
      ),

      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM public.reviews r
        LEFT JOIN public.review_replies rr
          ON rr.review_id = r.id
        WHERE r.dorm_id = $1
          AND r.status = 'visible'
          AND rr.id IS NULL
        `,
        [resolvedDormId]
      ),
    ]);

  const chatMessages = toInt(chatResult.rows[0]?.count);
  const payments = toInt(paymentResult.rows[0]?.count);
  const repairs = toInt(repairResult.rows[0]?.count);
  const reviews = toInt(reviewResult.rows[0]?.count);

  return {
    chat: chatMessages,
    chat_messages: chatMessages,
    announcements: 0,
    payments,
    repairs,
    reviews,
    total: chatMessages + payments + repairs + reviews,
  };
}

async function getTenantSummary({ userId, dormId }) {
  const [chatResult, announcementCount, paymentResult, repairResult] =
    await Promise.all([
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM public.chat_messages cm
        JOIN public.chat_conversations cc
          ON cc.id = cm.conversation_id
        JOIN public.rental_contracts rc
          ON rc.id = cc.rental_contract_id
        WHERE cc.tenant_user_id = $1
          AND cm.sender_user_id <> $1
          AND cm.read_at IS NULL
          AND rc.status = 'active'
        `,
        [userId]
      ),

      getUnreadAnnouncementCountByUser(userId, "tenant", dormId),

      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM public.invoices i
        LEFT JOIN LATERAL (
          SELECT
            p.status
          FROM public.payments p
          WHERE p.invoice_id = i.id
          ORDER BY p.created_at DESC
          LIMIT 1
        ) lp ON true
        WHERE i.tenant_user_id = $1
          AND (
            i.status IN ('draft', 'unpaid', 'overdue', 'pending_review')
            OR lp.status = 'rejected'
          )
        `,
        [userId]
      ),

      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM public.repair_requests
        WHERE tenant_user_id = $1
          AND status IN ('pending', 'in_progress', 'waiting_parts')
        `,
        [userId]
      ),
    ]);

  const chatMessages = toInt(chatResult.rows[0]?.count);
  const announcements = toInt(announcementCount);
  const chat = chatMessages + announcements;
  const payments = toInt(paymentResult.rows[0]?.count);
  const repairs = toInt(repairResult.rows[0]?.count);

  return {
    chat,
    chat_messages: chatMessages,
    announcements,
    payments,
    repairs,
    reviews: 0,
    total: chat + payments + repairs,
  };
}

async function buildNotificationSummary(user = {}) {
  const { userId, dormId, role } = getUserContext(user);

  if (!userId) {
    throw createError(401, "กรุณาเข้าสู่ระบบ");
  }

  if (!role) {
    throw createError(401, "ไม่พบ role ของผู้ใช้งาน");
  }

  if (role === "owner") {
    return getOwnerSummary({ userId, dormId });
  }

  if (role === "tenant") {
    return getTenantSummary({ userId, dormId });
  }

  return {
    chat: 0,
    chat_messages: 0,
    announcements: 0,
    payments: 0,
    repairs: 0,
    reviews: 0,
    total: 0,
  };
}

module.exports = {
  buildNotificationSummary,
};