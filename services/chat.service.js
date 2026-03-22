const { pool } = require("../config/db");

function normalizeMessageText(text) {
  return String(text || "").trim();
}

async function getAccessibleConversation(client, conversationId, userId, role) {
  const result = await client.query(
    `
    SELECT
      cc.*
    FROM public.chat_conversations cc
    WHERE cc.id = $1
      AND (
        ($2 = 'owner' AND cc.owner_user_id = $3)
        OR
        ($2 = 'tenant' AND cc.tenant_user_id = $3)
      )
    LIMIT 1
    `,
    [conversationId, role, userId]
  );

  return result.rows[0] || null;
}

async function ensureConversationForTenantUser(tenantUserId) {
  const client = await pool.connect();

  try {
    const contractResult = await client.query(
      `
      SELECT
        rc.id AS rental_contract_id,
        rc.dorm_id,
        rc.room_id,
        rc.tenant_user_id,
        d.owner_user_id
      FROM public.rental_contracts rc
      INNER JOIN public.dorms d
        ON d.id = rc.dorm_id
      WHERE rc.tenant_user_id = $1
        AND rc.status = 'active'
      ORDER BY rc.created_at DESC
      LIMIT 1
      `,
      [tenantUserId]
    );

    const contract = contractResult.rows[0] || null;

    if (!contract) {
      return null;
    }

    const existingResult = await client.query(
      `
      SELECT *
      FROM public.chat_conversations
      WHERE dorm_id = $1
        AND tenant_user_id = $2
      LIMIT 1
      `,
      [contract.dorm_id, contract.tenant_user_id]
    );

    if (existingResult.rows[0]) {
      const existing = existingResult.rows[0];

      const updatedResult = await client.query(
        `
        UPDATE public.chat_conversations
        SET
          room_id = $2,
          rental_contract_id = $3,
          updated_at = now()
        WHERE id = $1
        RETURNING *
        `,
        [existing.id, contract.room_id, contract.rental_contract_id]
      );

      return updatedResult.rows[0];
    }

    const insertResult = await client.query(
      `
      INSERT INTO public.chat_conversations (
        dorm_id,
        owner_user_id,
        tenant_user_id,
        room_id,
        rental_contract_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, now(), now())
      RETURNING *
      `,
      [
        contract.dorm_id,
        contract.owner_user_id,
        contract.tenant_user_id,
        contract.room_id,
        contract.rental_contract_id,
      ]
    );

    return insertResult.rows[0];
  } finally {
    client.release();
  }
}

async function ensureOwnerConversations(ownerUserId) {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT
        rc.id AS rental_contract_id,
        rc.dorm_id,
        rc.room_id,
        rc.tenant_user_id,
        d.owner_user_id
      FROM public.rental_contracts rc
      INNER JOIN public.dorms d
        ON d.id = rc.dorm_id
      WHERE d.owner_user_id = $1
        AND rc.status = 'active'
      `,
      [ownerUserId]
    );

    for (const row of result.rows) {
      const existingResult = await client.query(
        `
        SELECT id
        FROM public.chat_conversations
        WHERE dorm_id = $1
          AND tenant_user_id = $2
        LIMIT 1
        `,
        [row.dorm_id, row.tenant_user_id]
      );

      if (existingResult.rows[0]) {
        await client.query(
          `
          UPDATE public.chat_conversations
          SET
            room_id = $2,
            rental_contract_id = $3,
            updated_at = now()
          WHERE id = $1
          `,
          [
            existingResult.rows[0].id,
            row.room_id,
            row.rental_contract_id,
          ]
        );
      } else {
        await client.query(
          `
          INSERT INTO public.chat_conversations (
            dorm_id,
            owner_user_id,
            tenant_user_id,
            room_id,
            rental_contract_id,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, now(), now())
          `,
          [
            row.dorm_id,
            row.owner_user_id,
            row.tenant_user_id,
            row.room_id,
            row.rental_contract_id,
          ]
        );
      }
    }
  } finally {
    client.release();
  }
}

async function getOwnerConversations(ownerUserId) {
  await ensureOwnerConversations(ownerUserId);

  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT
        cc.id,
        cc.dorm_id,
        cc.owner_user_id,
        cc.tenant_user_id,
        cc.room_id,
        cc.rental_contract_id,
        cc.last_message_text,
        cc.last_message_at,
        cc.last_sender_user_id,
        cc.created_at,
        cc.updated_at,

        u.full_name AS tenant_name,
        u.avatar_url AS tenant_avatar_url,
        u.phone AS tenant_phone,

        r.room_number,
        b.display_name AS building_name,

        COALESCE((
          SELECT COUNT(*)
          FROM public.chat_messages cm
          WHERE cm.conversation_id = cc.id
            AND cm.sender_user_id <> $1
            AND cm.read_at IS NULL
        ), 0)::int AS unread_count

      FROM public.chat_conversations cc
      INNER JOIN public.users u
        ON u.id = cc.tenant_user_id
      LEFT JOIN public.rooms r
        ON r.id = cc.room_id
      LEFT JOIN public.buildings b
        ON b.id = r.building_id
      WHERE cc.owner_user_id = $1
      ORDER BY cc.last_message_at DESC NULLS LAST, cc.created_at DESC
      `,
      [ownerUserId]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

async function getTenantConversations(tenantUserId) {
  await ensureConversationForTenantUser(tenantUserId);

  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT
        cc.id,
        cc.dorm_id,
        cc.owner_user_id,
        cc.tenant_user_id,
        cc.room_id,
        cc.rental_contract_id,
        cc.last_message_text,
        cc.last_message_at,
        cc.last_sender_user_id,
        cc.created_at,
        cc.updated_at,

        u.full_name AS owner_name,
        u.avatar_url AS owner_avatar_url,
        u.phone AS owner_phone,

        d.name AS dorm_name,
        r.room_number,
        b.display_name AS building_name,

        COALESCE((
          SELECT COUNT(*)
          FROM public.chat_messages cm
          WHERE cm.conversation_id = cc.id
            AND cm.sender_user_id <> $1
            AND cm.read_at IS NULL
        ), 0)::int AS unread_count

      FROM public.chat_conversations cc
      INNER JOIN public.users u
        ON u.id = cc.owner_user_id
      INNER JOIN public.dorms d
        ON d.id = cc.dorm_id
      LEFT JOIN public.rooms r
        ON r.id = cc.room_id
      LEFT JOIN public.buildings b
        ON b.id = r.building_id
      WHERE cc.tenant_user_id = $1
      ORDER BY cc.last_message_at DESC NULLS LAST, cc.created_at DESC
      `,
      [tenantUserId]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

async function getConversationsByUser(userId, role) {
  if (role === "owner") {
    return getOwnerConversations(userId);
  }

  if (role === "tenant") {
    return getTenantConversations(userId);
  }

  const error = new Error("Unsupported role");
  error.statusCode = 403;
  throw error;
}

async function getMessages(conversationId, userId, role) {
  const client = await pool.connect();

  try {
    const conversation = await getAccessibleConversation(
      client,
      conversationId,
      userId,
      role
    );

    if (!conversation) {
      const error = new Error("Conversation not found or access denied");
      error.statusCode = 404;
      throw error;
    }

    const result = await client.query(
      `
      SELECT
        cm.id,
        cm.conversation_id,
        cm.sender_user_id,
        cm.message_text,
        cm.read_at,
        cm.created_at,
        cm.updated_at,
        u.full_name AS sender_name,
        u.avatar_url AS sender_avatar_url
      FROM public.chat_messages cm
      INNER JOIN public.users u
        ON u.id = cm.sender_user_id
      WHERE cm.conversation_id = $1
      ORDER BY cm.created_at ASC
      `,
      [conversationId]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

async function sendMessage(conversationId, senderUserId, role, messageText) {
  const normalizedText = normalizeMessageText(messageText);

  if (!normalizedText) {
    const error = new Error("message_text is required");
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const conversation = await getAccessibleConversation(
      client,
      conversationId,
      senderUserId,
      role
    );

    if (!conversation) {
      const error = new Error("Conversation not found or access denied");
      error.statusCode = 404;
      throw error;
    }

    const messageResult = await client.query(
      `
      INSERT INTO public.chat_messages (
        conversation_id,
        sender_user_id,
        message_text,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, now(), now())
      RETURNING *
      `,
      [conversationId, senderUserId, normalizedText]
    );

    const message = messageResult.rows[0];

    await client.query(
      `
      UPDATE public.chat_conversations
      SET
        last_message_text = $2,
        last_message_at = $3,
        last_sender_user_id = $4,
        updated_at = now()
      WHERE id = $1
      `,
      [conversationId, normalizedText, message.created_at, senderUserId]
    );

    await client.query("COMMIT");
    return message;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markConversationAsRead(conversationId, userId, role) {
  const client = await pool.connect();

  try {
    const conversation = await getAccessibleConversation(
      client,
      conversationId,
      userId,
      role
    );

    if (!conversation) {
      const error = new Error("Conversation not found or access denied");
      error.statusCode = 404;
      throw error;
    }

    await client.query(
      `
      UPDATE public.chat_messages
      SET
        read_at = now(),
        updated_at = now()
      WHERE conversation_id = $1
        AND sender_user_id <> $2
        AND read_at IS NULL
      `,
      [conversationId, userId]
    );

    return { success: true };
  } finally {
    client.release();
  }
}

module.exports = {
  ensureConversationForTenantUser,
  ensureOwnerConversations,
  getOwnerConversations,
  getTenantConversations,
  getConversationsByUser,
  getMessages,
  sendMessage,
  markConversationAsRead,
};