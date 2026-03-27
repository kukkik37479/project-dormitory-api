const { pool } = require("../config/db");

const ALLOWED_CATEGORIES = new Set([
  "electrical",
  "water",
  "furniture",
  "room",
  "other",
]);

const ALLOWED_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

const ALLOWED_STATUSES = new Set([
  "pending",
  "in_progress",
  "waiting_parts",
  "completed",
  "cancelled",
]);

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function s(value) {
  return String(value ?? "").trim();
}

function integerOrDefault(value, defaultValue) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : defaultValue;
}

function normalizeCategory(value) {
  const category = s(value).toLowerCase() || "other";
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw createError(400, "หมวดหมู่การแจ้งซ่อมไม่ถูกต้อง");
  }
  return category;
}

function normalizePriority(value) {
  const priority = s(value).toLowerCase() || "medium";
  if (!ALLOWED_PRIORITIES.has(priority)) {
    throw createError(400, "ระดับความเร่งด่วนไม่ถูกต้อง");
  }
  return priority;
}

function normalizeStatus(value) {
  const status = s(value).toLowerCase();
  if (!ALLOWED_STATUSES.has(status)) {
    throw createError(400, "สถานะงานซ่อมไม่ถูกต้อง");
  }
  return status;
}

function normalizeTextOrNull(value) {
  const text = s(value);
  return text || null;
}

function normalizeUrlArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => s(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => s(item)).filter(Boolean);
      }
    } catch (_error) {}

    return raw
      .split(",")
      .map((item) => s(item))
      .filter(Boolean);
  }

  return [];
}

function getUserIdFromToken(user = {}) {
  return user?.userId || user?.id || null;
}

function getDormIdFromToken(user = {}) {
  return user?.dormId || user?.loginDormId || user?.login_dorm_id || null;
}

function buildDefaultTitle({ furnitureName, category }) {
  if (furnitureName) {
    return `แจ้งซ่อม${furnitureName}`;
  }

  const labelMap = {
    electrical: "อุปกรณ์ไฟฟ้า",
    water: "ระบบน้ำ",
    furniture: "เฟอร์นิเจอร์",
    room: "ภายในห้อง",
    other: "รายการทั่วไป",
  };

  return `แจ้งซ่อม${labelMap[category] || "รายการทั่วไป"}`;
}

function mapAttachmentRow(row) {
  return {
    id: row.id,
    repairRequestId: row.repair_request_id,
    fileUrl: row.file_url,
    label: row.label,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function mapStatusLogRow(row) {
  return {
    id: row.id,
    repairRequestId: row.repair_request_id,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    note: row.note,
    changedBy: row.changed_by,
    changedByName: row.changed_by_name,
    changedAt: row.changed_at,
  };
}

function mapRepairSummaryRow(row) {
  return {
    id: row.id,
    dormId: row.dorm_id,
    roomId: row.room_id,
    contractId: row.contract_id,
    tenantUserId: row.tenant_user_id,
    furnitureItemId: row.furniture_item_id || row.furniture_id || null,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    ownerNote: row.owner_note,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    room: {
      id: row.room_id,
      roomNumber: row.room_number,
      floorNo: row.floor_no,
      buildingId: row.building_id,
      buildingCode: row.building_code,
      buildingName: row.building_name,
    },
    tenant: {
      id: row.tenant_user_id,
      fullName: row.tenant_full_name,
      username: row.tenant_username,
      phone: row.tenant_phone,
    },
    furniture:
      row.furniture_item_id || row.furniture_id
        ? {
            id: row.furniture_item_id || row.furniture_id,
            itemName: row.furniture_item_name,
            categoryName: row.furniture_category_name,
          }
        : null,
    previewImages: {
      before: row.before_image_url || null,
      after: row.after_image_url || null,
    },
  };
}

function mapRepairDetail(row, attachments, logs) {
  return {
    ...mapRepairSummaryRow(row),
    attachments,
    beforeImages: attachments.filter((item) => item.label === "before"),
    afterImages: attachments.filter((item) => item.label === "after"),
    generalImages: attachments.filter((item) => item.label === "general"),
    statusLogs: logs,
  };
}

async function getOwnerDorm(client, ownerUserId) {
  const result = await client.query(
    `
    SELECT id, owner_user_id, name
    FROM public.dorms
    WHERE owner_user_id = $1
    LIMIT 1
    `,
    [ownerUserId]
  );

  const dorm = result.rows[0];

  if (!dorm) {
    throw createError(404, "ไม่พบหอพักของเจ้าของรายนี้");
  }

  return dorm;
}

async function getActiveTenantContext(client, tenantUserId, tokenDormId = null) {
  const result = await client.query(
    `
    SELECT
      rc.id AS contract_id,
      rc.dorm_id,
      rc.room_id,
      rc.status AS contract_status,
      r.room_number,
      r.floor_no,
      r.building_id,
      b.building_code,
      b.display_name AS building_name
    FROM public.rental_contracts rc
    JOIN public.rooms r
      ON r.id = rc.room_id
    LEFT JOIN public.buildings b
      ON b.id = r.building_id
    WHERE rc.tenant_user_id = $1
      AND rc.status = 'active'
      ${tokenDormId ? "AND rc.dorm_id = $2" : ""}
    ORDER BY rc.created_at DESC
    LIMIT 1
    `,
    tokenDormId ? [tenantUserId, tokenDormId] : [tenantUserId]
  );

  const contract = result.rows[0];

  if (!contract) {
    throw createError(404, "ไม่พบสัญญาเช่าที่ใช้งานอยู่ของผู้เช่านี้");
  }

  return contract;
}

async function getFurnitureItemInRoom(client, furnitureItemId, dormId, roomId) {
  if (!furnitureItemId) return null;

  const result = await client.query(
    `
    SELECT
      fi.id,
      fi.dorm_id,
      fi.room_id,
      fi.category_id,
      fi.item_name,
      fi.usage_status,
      fc.name AS category_name
    FROM public.furniture_items fi
    LEFT JOIN public.furniture_categories fc
      ON fc.id = fi.category_id
    WHERE fi.id = $1
      AND fi.dorm_id = $2
      AND fi.room_id = $3
    LIMIT 1
    `,
    [furnitureItemId, dormId, roomId]
  );

  const item = result.rows[0];

  if (!item) {
    throw createError(404, "ไม่พบเฟอร์นิเจอร์ในห้องนี้");
  }

  if (item.usage_status && item.usage_status !== "active") {
    throw createError(400, "เฟอร์นิเจอร์รายการนี้ไม่พร้อมใช้งานสำหรับการแจ้งซ่อม");
  }

  return item;
}

async function insertStatusLog(
  client,
  { repairRequestId, oldStatus = null, newStatus, note = null, changedBy }
) {
  await client.query(
    `
    INSERT INTO public.repair_status_logs (
      repair_request_id,
      old_status,
      new_status,
      note,
      changed_by
    )
    VALUES ($1, $2, $3, $4, $5)
    `,
    [repairRequestId, oldStatus, newStatus, note, changedBy]
  );
}

async function insertAttachments(
  client,
  repairRequestId,
  uploadedBy,
  urls = [],
  label = "general"
) {
  const cleanUrls = normalizeUrlArray(urls);

  if (cleanUrls.length === 0) {
    return;
  }

  const values = [];
  const placeholders = cleanUrls.map((fileUrl, index) => {
    const base = index * 4;
    values.push(repairRequestId, fileUrl, label, uploadedBy);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });

  await client.query(
    `
    INSERT INTO public.repair_request_attachments (
      repair_request_id,
      file_url,
      label,
      uploaded_by
    )
    VALUES ${placeholders.join(", ")}
    `,
    values
  );
}

async function getRepairDetailRowById(client, repairRequestId) {
  const result = await client.query(
    `
    SELECT
      rr.id,
      rr.dorm_id,
      rr.room_id,
      rr.contract_id,
      rr.tenant_user_id,
      rr.furniture_id,
      rr.furniture_item_id,
      rr.title,
      rr.description,
      rr.category,
      rr.priority,
      rr.status,
      rr.owner_note,
      rr.requested_at,
      rr.completed_at,
      rr.created_at,
      rr.updated_at,
      r.room_number,
      r.floor_no,
      r.building_id,
      b.building_code,
      b.display_name AS building_name,
      u.full_name AS tenant_full_name,
      u.username AS tenant_username,
      u.phone AS tenant_phone,
      fi.item_name AS furniture_item_name,
      fc.name AS furniture_category_name,
      (
        SELECT rra.file_url
        FROM public.repair_request_attachments rra
        WHERE rra.repair_request_id = rr.id
          AND rra.label = 'before'
        ORDER BY rra.created_at ASC
        LIMIT 1
      ) AS before_image_url,
      (
        SELECT rra.file_url
        FROM public.repair_request_attachments rra
        WHERE rra.repair_request_id = rr.id
          AND rra.label = 'after'
        ORDER BY rra.created_at ASC
        LIMIT 1
      ) AS after_image_url
    FROM public.repair_requests rr
    JOIN public.rooms r
      ON r.id = rr.room_id
    LEFT JOIN public.buildings b
      ON b.id = r.building_id
    JOIN public.users u
      ON u.id = rr.tenant_user_id
    LEFT JOIN public.furniture_items fi
      ON fi.id = COALESCE(rr.furniture_item_id, rr.furniture_id)
    LEFT JOIN public.furniture_categories fc
      ON fc.id = fi.category_id
    WHERE rr.id = $1
    LIMIT 1
    `,
    [repairRequestId]
  );

  return result.rows[0] || null;
}

async function getRepairAttachments(client, repairRequestId) {
  const result = await client.query(
    `
    SELECT
      id,
      repair_request_id,
      file_url,
      label,
      uploaded_by,
      created_at
    FROM public.repair_request_attachments
    WHERE repair_request_id = $1
    ORDER BY created_at ASC, id ASC
    `,
    [repairRequestId]
  );

  return result.rows.map(mapAttachmentRow);
}

async function getRepairStatusLogs(client, repairRequestId) {
  const result = await client.query(
    `
    SELECT
      rsl.id,
      rsl.repair_request_id,
      rsl.old_status,
      rsl.new_status,
      rsl.note,
      rsl.changed_by,
      rsl.changed_at,
      u.full_name AS changed_by_name
    FROM public.repair_status_logs rsl
    LEFT JOIN public.users u
      ON u.id = rsl.changed_by
    WHERE rsl.repair_request_id = $1
    ORDER BY rsl.changed_at ASC, rsl.id ASC
    `,
    [repairRequestId]
  );

  return result.rows.map(mapStatusLogRow);
}

async function getTenantRepairFormOptionsByTenantId(
  tenantUserId,
  tokenDormId = null
) {
  const client = await pool.connect();

  try {
    const context = await getActiveTenantContext(client, tenantUserId, tokenDormId);

    const furnitureResult = await client.query(
      `
      SELECT
        fi.id,
        fi.item_name,
        fi.quantity,
        fi.condition_status,
        fi.usage_status,
        fi.image_url,
        fc.id AS category_id,
        fc.name AS category_name
      FROM public.furniture_items fi
      LEFT JOIN public.furniture_categories fc
        ON fc.id = fi.category_id
      WHERE fi.room_id = $1
        AND fi.dorm_id = $2
        AND fi.usage_status = 'active'
      ORDER BY fi.item_name ASC
      `,
      [context.room_id, context.dorm_id]
    );

    return {
      room: {
        id: context.room_id,
        roomNumber: context.room_number,
        floorNo: context.floor_no,
        buildingId: context.building_id,
        buildingCode: context.building_code,
        buildingName: context.building_name,
      },
      contract: {
        id: context.contract_id,
        status: context.contract_status,
      },
      categories: [
        { value: "electrical", label: "เครื่องใช้ไฟฟ้า" },
        { value: "water", label: "ระบบน้ำ" },
        { value: "furniture", label: "เฟอร์นิเจอร์" },
        { value: "room", label: "ภายในห้อง" },
        { value: "other", label: "อื่น ๆ" },
      ],
      priorities: [
        { value: "low", label: "ต่ำ" },
        { value: "medium", label: "ปานกลาง" },
        { value: "high", label: "สูง" },
        { value: "urgent", label: "เร่งด่วน" },
      ],
      furniture: furnitureResult.rows.map((item) => ({
        id: item.id,
        itemName: item.item_name,
        quantity: Number(item.quantity || 0),
        conditionStatus: item.condition_status,
        usageStatus: item.usage_status,
        imageUrl: item.image_url,
        category: item.category_id
          ? {
              id: item.category_id,
              name: item.category_name,
            }
          : null,
      })),
    };
  } finally {
    client.release();
  }
}

async function createRepairRequestByTenantId(
  tenantUserId,
  tokenDormId = null,
  payload = {}
) {
  const client = await pool.connect();

  try {
    const description = s(payload.description);
    if (!description) {
      throw createError(400, "กรุณาระบุปัญหาที่ต้องการแจ้งซ่อม");
    }

    const context = await getActiveTenantContext(client, tenantUserId, tokenDormId);
    const furnitureItemId = normalizeTextOrNull(
      payload.furniture_item_id || payload.furnitureItemId || payload.furniture_id
    );
    const category = normalizeCategory(payload.category);
    const priority = normalizePriority(payload.priority);
    const ownerNote = normalizeTextOrNull(payload.owner_note || payload.ownerNote);
    const beforeImageUrls = normalizeUrlArray(
      payload.before_image_urls || payload.beforeImageUrls || payload.image_urls
    );
    const generalImageUrls = normalizeUrlArray(
      payload.general_image_urls || payload.generalImageUrls
    );

    const furnitureItem = await getFurnitureItemInRoom(
      client,
      furnitureItemId,
      context.dorm_id,
      context.room_id
    );

    const title =
      normalizeTextOrNull(payload.title) ||
      buildDefaultTitle({
        furnitureName: furnitureItem?.item_name || null,
        category,
      });

    await client.query("BEGIN");

    const insertResult = await client.query(
      `
      INSERT INTO public.repair_requests (
        dorm_id,
        room_id,
        contract_id,
        tenant_user_id,
        furniture_id,
        furniture_item_id,
        title,
        description,
        category,
        priority,
        status,
        owner_note
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        'pending',
        $11
      )
      RETURNING id
      `,
      [
        context.dorm_id,
        context.room_id,
        context.contract_id,
        tenantUserId,
        furnitureItem?.id || null,
        furnitureItem?.id || null,
        title,
        description,
        category,
        priority,
        ownerNote,
      ]
    );

    const repairRequestId = insertResult.rows[0].id;

    await insertStatusLog(client, {
      repairRequestId,
      oldStatus: null,
      newStatus: "pending",
      note: normalizeTextOrNull(payload.status_note) || "ผู้เช่าแจ้งซ่อม",
      changedBy: tenantUserId,
    });

    await insertAttachments(
      client,
      repairRequestId,
      tenantUserId,
      beforeImageUrls,
      "before"
    );
    await insertAttachments(
      client,
      repairRequestId,
      tenantUserId,
      generalImageUrls,
      "general"
    );

    await client.query("COMMIT");

    const [detailRow, attachments, logs] = await Promise.all([
      getRepairDetailRowById(client, repairRequestId),
      getRepairAttachments(client, repairRequestId),
      getRepairStatusLogs(client, repairRequestId),
    ]);

    return mapRepairDetail(detailRow, attachments, logs);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {}
    throw error;
  } finally {
    client.release();
  }
}

async function listMyRepairRequestsByTenantId(
  tenantUserId,
  tokenDormId = null,
  query = {}
) {
  const client = await pool.connect();

  try {
    const page = integerOrDefault(query.page, 1);
    const limit = integerOrDefault(query.limit, 20);
    const offset = (page - 1) * limit;
    const search = s(query.search);
    const status = s(query.status).toLowerCase();

    const params = [tenantUserId];
    let whereSql = `WHERE rr.tenant_user_id = $1`;

    if (tokenDormId) {
      params.push(tokenDormId);
      whereSql += ` AND rr.dorm_id = $${params.length}`;
    }

    if (status) {
      if (!ALLOWED_STATUSES.has(status)) {
        throw createError(400, "สถานะที่ต้องการค้นหาไม่ถูกต้อง");
      }
      params.push(status);
      whereSql += ` AND rr.status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      whereSql += `
        AND (
          COALESCE(rr.title, '') ILIKE $${idx}
          OR COALESCE(rr.description, '') ILIKE $${idx}
          OR COALESCE(r.room_number, '') ILIKE $${idx}
          OR COALESCE(fi.item_name, '') ILIKE $${idx}
        )
      `;
    }

    const countResult = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.repair_requests rr
      JOIN public.rooms r
        ON r.id = rr.room_id
      LEFT JOIN public.furniture_items fi
        ON fi.id = COALESCE(rr.furniture_item_id, rr.furniture_id)
      ${whereSql}
      `,
      params
    );

    const total = countResult.rows[0]?.total || 0;
    const dataParams = [...params, limit, offset];

    const result = await client.query(
      `
      SELECT
        rr.id,
        rr.dorm_id,
        rr.room_id,
        rr.contract_id,
        rr.tenant_user_id,
        rr.furniture_id,
        rr.furniture_item_id,
        rr.title,
        rr.description,
        rr.category,
        rr.priority,
        rr.status,
        rr.owner_note,
        rr.requested_at,
        rr.completed_at,
        rr.created_at,
        rr.updated_at,
        r.room_number,
        r.floor_no,
        r.building_id,
        b.building_code,
        b.display_name AS building_name,
        u.full_name AS tenant_full_name,
        u.username AS tenant_username,
        u.phone AS tenant_phone,
        fi.item_name AS furniture_item_name,
        fc.name AS furniture_category_name,
        (
          SELECT rra.file_url
          FROM public.repair_request_attachments rra
          WHERE rra.repair_request_id = rr.id
            AND rra.label = 'before'
          ORDER BY rra.created_at ASC
          LIMIT 1
        ) AS before_image_url,
        (
          SELECT rra.file_url
          FROM public.repair_request_attachments rra
          WHERE rra.repair_request_id = rr.id
            AND rra.label = 'after'
          ORDER BY rra.created_at ASC
          LIMIT 1
        ) AS after_image_url
      FROM public.repair_requests rr
      JOIN public.rooms r
        ON r.id = rr.room_id
      LEFT JOIN public.buildings b
        ON b.id = r.building_id
      JOIN public.users u
        ON u.id = rr.tenant_user_id
      LEFT JOIN public.furniture_items fi
        ON fi.id = COALESCE(rr.furniture_item_id, rr.furniture_id)
      LEFT JOIN public.furniture_categories fc
        ON fc.id = fi.category_id
      ${whereSql}
      ORDER BY
        rr.requested_at DESC,
        rr.created_at DESC,
        rr.id DESC
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return {
      data: result.rows.map(mapRepairSummaryRow),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        start: total === 0 ? 0 : offset + 1,
        end: Math.min(offset + limit, total),
      },
    };
  } finally {
    client.release();
  }
}

async function listRepairRequestsByOwnerId(ownerUserId, query = {}) {
  const client = await pool.connect();

  try {
    const dorm = await getOwnerDorm(client, ownerUserId);
    const page = integerOrDefault(query.page, 1);
    const limit = integerOrDefault(query.limit, 20);
    const offset = (page - 1) * limit;
    const search = s(query.search);
    const status = s(query.status).toLowerCase();
    const roomId = normalizeTextOrNull(query.room_id || query.roomId);
    const buildingId = normalizeTextOrNull(query.building_id || query.buildingId);

    const params = [dorm.id];
    let whereSql = `WHERE rr.dorm_id = $1`;

    if (status) {
      if (!ALLOWED_STATUSES.has(status)) {
        throw createError(400, "สถานะที่ต้องการค้นหาไม่ถูกต้อง");
      }
      params.push(status);
      whereSql += ` AND rr.status = $${params.length}`;
    }

    if (roomId) {
      params.push(roomId);
      whereSql += ` AND rr.room_id = $${params.length}`;
    }

    if (buildingId) {
      params.push(buildingId);
      whereSql += ` AND r.building_id = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      whereSql += `
        AND (
          COALESCE(rr.title, '') ILIKE $${idx}
          OR COALESCE(rr.description, '') ILIKE $${idx}
          OR COALESCE(r.room_number, '') ILIKE $${idx}
          OR COALESCE(u.full_name, '') ILIKE $${idx}
          OR COALESCE(fi.item_name, '') ILIKE $${idx}
        )
      `;
    }

    const countResult = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.repair_requests rr
      JOIN public.rooms r
        ON r.id = rr.room_id
      JOIN public.users u
        ON u.id = rr.tenant_user_id
      LEFT JOIN public.furniture_items fi
        ON fi.id = COALESCE(rr.furniture_item_id, rr.furniture_id)
      ${whereSql}
      `,
      params
    );

    const total = countResult.rows[0]?.total || 0;
    const dataParams = [...params, limit, offset];

    const result = await client.query(
      `
      SELECT
        rr.id,
        rr.dorm_id,
        rr.room_id,
        rr.contract_id,
        rr.tenant_user_id,
        rr.furniture_id,
        rr.furniture_item_id,
        rr.title,
        rr.description,
        rr.category,
        rr.priority,
        rr.status,
        rr.owner_note,
        rr.requested_at,
        rr.completed_at,
        rr.created_at,
        rr.updated_at,
        r.room_number,
        r.floor_no,
        r.building_id,
        b.building_code,
        b.display_name AS building_name,
        u.full_name AS tenant_full_name,
        u.username AS tenant_username,
        u.phone AS tenant_phone,
        fi.item_name AS furniture_item_name,
        fc.name AS furniture_category_name,
        (
          SELECT rra.file_url
          FROM public.repair_request_attachments rra
          WHERE rra.repair_request_id = rr.id
            AND rra.label = 'before'
          ORDER BY rra.created_at ASC
          LIMIT 1
        ) AS before_image_url,
        (
          SELECT rra.file_url
          FROM public.repair_request_attachments rra
          WHERE rra.repair_request_id = rr.id
            AND rra.label = 'after'
          ORDER BY rra.created_at ASC
          LIMIT 1
        ) AS after_image_url
      FROM public.repair_requests rr
      JOIN public.rooms r
        ON r.id = rr.room_id
      LEFT JOIN public.buildings b
        ON b.id = r.building_id
      JOIN public.users u
        ON u.id = rr.tenant_user_id
      LEFT JOIN public.furniture_items fi
        ON fi.id = COALESCE(rr.furniture_item_id, rr.furniture_id)
      LEFT JOIN public.furniture_categories fc
        ON fc.id = fi.category_id
      ${whereSql}
      ORDER BY
        CASE rr.status
          WHEN 'pending' THEN 0
          WHEN 'in_progress' THEN 1
          WHEN 'waiting_parts' THEN 2
          WHEN 'completed' THEN 3
          WHEN 'cancelled' THEN 4
          ELSE 5
        END ASC,
        rr.requested_at DESC,
        rr.created_at DESC,
        rr.id DESC
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return {
      data: result.rows.map(mapRepairSummaryRow),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        start: total === 0 ? 0 : offset + 1,
        end: Math.min(offset + limit, total),
      },
    };
  } finally {
    client.release();
  }
}

async function getRepairRequestDetailForTenantById(
  tenantUserId,
  tokenDormId = null,
  repairRequestId
) {
  const client = await pool.connect();

  try {
    const detail = await getRepairDetailRowById(client, repairRequestId);

    if (!detail) {
      throw createError(404, "ไม่พบรายการแจ้งซ่อม");
    }

    if (detail.tenant_user_id !== tenantUserId) {
      throw createError(403, "คุณไม่มีสิทธิ์ดูรายการแจ้งซ่อมนี้");
    }

    if (tokenDormId && detail.dorm_id !== tokenDormId) {
      throw createError(403, "รายการแจ้งซ่อมนี้ไม่ได้อยู่ในหอที่คุณกำลังใช้งาน");
    }

    const [attachments, logs] = await Promise.all([
      getRepairAttachments(client, repairRequestId),
      getRepairStatusLogs(client, repairRequestId),
    ]);

    return mapRepairDetail(detail, attachments, logs);
  } finally {
    client.release();
  }
}

async function getRepairRequestDetailForOwnerById(ownerUserId, repairRequestId) {
  const client = await pool.connect();

  try {
    const dorm = await getOwnerDorm(client, ownerUserId);
    const detail = await getRepairDetailRowById(client, repairRequestId);

    if (!detail) {
      throw createError(404, "ไม่พบรายการแจ้งซ่อม");
    }

    if (detail.dorm_id !== dorm.id) {
      throw createError(403, "คุณไม่มีสิทธิ์ดูรายการแจ้งซ่อมนี้");
    }

    const [attachments, logs] = await Promise.all([
      getRepairAttachments(client, repairRequestId),
      getRepairStatusLogs(client, repairRequestId),
    ]);

    return mapRepairDetail(detail, attachments, logs);
  } finally {
    client.release();
  }
}

async function updateRepairRequestStatusByOwnerId(
  ownerUserId,
  repairRequestId,
  payload = {}
) {
  const client = await pool.connect();

  try {
    const ownerDorm = await getOwnerDorm(client, ownerUserId);
    const detail = await getRepairDetailRowById(client, repairRequestId);

    if (!detail) {
      throw createError(404, "ไม่พบรายการแจ้งซ่อม");
    }

    if (detail.dorm_id !== ownerDorm.id) {
      throw createError(403, "คุณไม่มีสิทธิ์อัปเดตรายการแจ้งซ่อมนี้");
    }

    if (["completed", "cancelled"].includes(detail.status)) {
      throw createError(400, "รายการแจ้งซ่อมนี้ปิดงานแล้ว ไม่สามารถอัปเดตต่อได้");
    }

    const nextStatus = payload.status
      ? normalizeStatus(payload.status)
      : detail.status;
    const note = normalizeTextOrNull(
      payload.note || payload.status_note || payload.statusNote
    );
    const ownerNote =
      Object.prototype.hasOwnProperty.call(payload, "owner_note") ||
      Object.prototype.hasOwnProperty.call(payload, "ownerNote")
        ? normalizeTextOrNull(payload.owner_note || payload.ownerNote)
        : detail.owner_note;

    const afterImageUrls = normalizeUrlArray(
      payload.after_image_urls || payload.afterImageUrls
    );
    const generalImageUrls = normalizeUrlArray(
      payload.general_image_urls || payload.generalImageUrls || payload.image_urls
    );

    if (
      nextStatus === detail.status &&
      note === null &&
      ownerNote === detail.owner_note &&
      afterImageUrls.length === 0 &&
      generalImageUrls.length === 0
    ) {
      throw createError(400, "ไม่มีข้อมูลใหม่สำหรับอัปเดตรายการแจ้งซ่อม");
    }

    const completedAt =
      nextStatus === "completed" ? new Date() : detail.completed_at;

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE public.repair_requests
      SET
        status = $1,
        owner_note = $2,
        completed_at = $3,
        updated_at = now()
      WHERE id = $4
      `,
      [nextStatus, ownerNote, completedAt, repairRequestId]
    );

    if (note || nextStatus !== detail.status) {
      await insertStatusLog(client, {
        repairRequestId,
        oldStatus: detail.status,
        newStatus: nextStatus,
        note,
        changedBy: ownerUserId,
      });
    }

    await insertAttachments(
      client,
      repairRequestId,
      ownerUserId,
      afterImageUrls,
      "after"
    );
    await insertAttachments(
      client,
      repairRequestId,
      ownerUserId,
      generalImageUrls,
      "general"
    );

    await client.query("COMMIT");

    const [updatedRow, attachments, logs] = await Promise.all([
      getRepairDetailRowById(client, repairRequestId),
      getRepairAttachments(client, repairRequestId),
      getRepairStatusLogs(client, repairRequestId),
    ]);

    return mapRepairDetail(updatedRow, attachments, logs);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {}
    throw error;
  } finally {
    client.release();
  }
}

async function cancelRepairRequestByTenantId(
  tenantUserId,
  tokenDormId = null,
  repairRequestId,
  payload = {}
) {
  const client = await pool.connect();

  try {
    const detail = await getRepairDetailRowById(client, repairRequestId);

    if (!detail) {
      throw createError(404, "ไม่พบรายการแจ้งซ่อม");
    }

    if (detail.tenant_user_id !== tenantUserId) {
      throw createError(403, "คุณไม่มีสิทธิ์ยกเลิกรายการแจ้งซ่อมนี้");
    }

    if (tokenDormId && detail.dorm_id !== tokenDormId) {
      throw createError(403, "รายการแจ้งซ่อมนี้ไม่ได้อยู่ในหอที่คุณกำลังใช้งาน");
    }

    if (detail.status !== "pending") {
      throw createError(400, "สามารถยกเลิกได้เฉพาะรายการที่ยังรอรับเรื่องเท่านั้น");
    }

    const note =
      normalizeTextOrNull(payload.note || payload.reason || payload.cancel_note) ||
      "ผู้เช่ายกเลิกรายการแจ้งซ่อม";

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE public.repair_requests
      SET
        status = 'cancelled',
        updated_at = now()
      WHERE id = $1
      `,
      [repairRequestId]
    );

    await insertStatusLog(client, {
      repairRequestId,
      oldStatus: detail.status,
      newStatus: "cancelled",
      note,
      changedBy: tenantUserId,
    });

    await client.query("COMMIT");

    const [updatedRow, attachments, logs] = await Promise.all([
      getRepairDetailRowById(client, repairRequestId),
      getRepairAttachments(client, repairRequestId),
      getRepairStatusLogs(client, repairRequestId),
    ]);

    return mapRepairDetail(updatedRow, attachments, logs);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getUserIdFromToken,
  getDormIdFromToken,
  getTenantRepairFormOptionsByTenantId,
  createRepairRequestByTenantId,
  listMyRepairRequestsByTenantId,
  listRepairRequestsByOwnerId,
  getRepairRequestDetailForTenantById,
  getRepairRequestDetailForOwnerById,
  updateRepairRequestStatusByOwnerId,
  cancelRepairRequestByTenantId,
};