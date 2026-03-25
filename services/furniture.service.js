const { pool } = require("../config/db");

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function s(value) {
  return String(value ?? "").trim();
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n;
}

function normalizeTextOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeDateOrNull(value, fieldLabel) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const time = new Date(text).getTime();
  if (Number.isNaN(time)) {
    throw createError(400, `${fieldLabel} ไม่ถูกต้อง`);
  }

  return text;
}

function calcMonthsUsed(purchaseDate) {
  if (!purchaseDate) return null;

  const start = new Date(purchaseDate);
  if (Number.isNaN(start.getTime())) return null;

  const now = new Date();
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());

  if (now.getDate() < start.getDate()) {
    months -= 1;
  }

  return Math.max(months, 0);
}

function mapFurnitureItemRow(item) {
  const monthsUsed = calcMonthsUsed(item.purchase_date);
  const lifespanMonths =
    item.lifespan_months === null || item.lifespan_months === undefined
      ? null
      : Number(item.lifespan_months);

  const remainingLifespanMonths =
    lifespanMonths === null || monthsUsed === null
      ? null
      : Math.max(lifespanMonths - monthsUsed, 0);

  return {
    id: item.id,
    dormId: item.dorm_id,
    roomId: item.room_id,
    categoryId: item.category_id,
    categoryName: item.category_name || null,
    itemName: item.item_name,
    quantity: Number(item.quantity || 0),
    brand: item.brand,
    model: item.model,
    color: item.color,
    sizeDetail: item.size_detail,
    conditionStatus: item.condition_status,
    usageStatus: item.usage_status,
    purchaseDate: item.purchase_date,
    warrantyExpiry: item.warranty_expiry,
    price:
      item.price === null || item.price === undefined ? null : Number(item.price),
    note: item.note,
    imageUrl: item.image_url,
    imagePath: item.image_path,
    imageFileName: item.image_file_name,
    lifespanMonths,
    monthsUsed,
    remainingLifespanMonths,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
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

async function listFurnitureRoomsByOwnerId(ownerUserId, query = {}) {
  const client = await pool.connect();

  try {
    const dorm = await getOwnerDorm(client, ownerUserId);

    const search = s(query.search);
    const buildingId = s(query.building_id) || null;
    const floorNo = integerOrNull(query.floor_no);

    const params = [dorm.id];
    let whereSql = `WHERE r.dorm_id = $1`;

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      whereSql += `
        AND (
          COALESCE(r.room_number, '') ILIKE $${idx}
          OR COALESCE(b.display_name, '') ILIKE $${idx}
          OR COALESCE(b.building_code, '') ILIKE $${idx}
        )
      `;
    }

    if (buildingId) {
      params.push(buildingId);
      whereSql += ` AND r.building_id = $${params.length}`;
    }

    if (floorNo !== null) {
      params.push(floorNo);
      whereSql += ` AND r.floor_no = $${params.length}`;
    }

    const roomsResult = await client.query(
      `
      SELECT
        r.id,
        r.dorm_id,
        r.building_id,
        r.room_number,
        r.floor_no,
        r.status,
        r.tenant_name,
        b.building_code,
        b.display_name AS building_name,
        b.sort_order,
        COUNT(fi.id)::int AS furniture_count
      FROM public.rooms r
      INNER JOIN public.buildings b
        ON b.id = r.building_id
      LEFT JOIN public.furniture_items fi
        ON fi.room_id = r.id
       AND fi.dorm_id = r.dorm_id
       AND fi.usage_status <> 'disposed'
      ${whereSql}
      GROUP BY
        r.id,
        r.dorm_id,
        r.building_id,
        r.room_number,
        r.floor_no,
        r.status,
        r.tenant_name,
        b.building_code,
        b.display_name,
        b.sort_order
      ORDER BY
        b.sort_order ASC,
        b.building_code ASC,
        r.floor_no ASC,
        r.room_number ASC
      `,
      params
    );

    const buildingsResult = await client.query(
      `
      SELECT
        id,
        dorm_id,
        building_code,
        display_name,
        sort_order,
        created_at,
        updated_at
      FROM public.buildings
      WHERE dorm_id = $1
      ORDER BY sort_order ASC, building_code ASC
      `,
      [dorm.id]
    );

    const floorsParams = [dorm.id];
    let floorsSql = `
      SELECT DISTINCT r.floor_no
      FROM public.rooms r
      WHERE r.dorm_id = $1
    `;

    if (buildingId) {
      floorsParams.push(buildingId);
      floorsSql += ` AND r.building_id = $2`;
    }

    floorsSql += ` ORDER BY r.floor_no ASC`;

    const floorsResult = await client.query(floorsSql, floorsParams);

    return {
      filters: {
        buildings: buildingsResult.rows,
        floors: floorsResult.rows.map((row) => Number(row.floor_no)),
      },
      rooms: roomsResult.rows.map((row) => ({
        id: row.id,
        dormId: row.dorm_id,
        buildingId: row.building_id,
        buildingCode: row.building_code,
        buildingName: row.building_name,
        roomNumber: row.room_number,
        floorNo: Number(row.floor_no || 0),
        status: row.status,
        tenantName: row.tenant_name,
        furnitureCount: Number(row.furniture_count || 0),
        hasFurniture: Number(row.furniture_count || 0) > 0,
        roomLabel: `ห้อง ${row.room_number} ${row.building_name} ชั้น ${row.floor_no}`,
      })),
    };
  } finally {
    client.release();
  }
}

async function getRoomFurnitureItemsByOwnerId(ownerUserId, roomId) {
  const client = await pool.connect();

  try {
    const dorm = await getOwnerDorm(client, ownerUserId);

    if (!roomId) {
      throw createError(400, "กรุณาระบุ roomId");
    }

    const roomResult = await client.query(
      `
      SELECT
        r.id,
        r.dorm_id,
        r.building_id,
        r.room_number,
        r.floor_no,
        r.status,
        r.tenant_name,
        b.building_code,
        b.display_name AS building_name,
        b.sort_order
      FROM public.rooms r
      INNER JOIN public.buildings b
        ON b.id = r.building_id
      WHERE r.id = $1
        AND r.dorm_id = $2
      LIMIT 1
      `,
      [roomId, dorm.id]
    );

    const room = roomResult.rows[0];

    if (!room) {
      throw createError(404, "ไม่พบห้องนี้ หรือห้องนี้ไม่ได้อยู่ในหอของคุณ");
    }

    const itemsResult = await client.query(
      `
      SELECT
        fi.id,
        fi.dorm_id,
        fi.room_id,
        fi.category_id,
        fi.item_name,
        fi.quantity,
        fi.brand,
        fi.model,
        fi.color,
        fi.size_detail,
        fi.condition_status,
        fi.usage_status,
        fi.purchase_date,
        fi.warranty_expiry,
        fi.price,
        fi.note,
        fi.image_url,
        fi.image_path,
        fi.image_file_name,
        fi.lifespan_months,
        fi.created_at,
        fi.updated_at,
        fc.name AS category_name
      FROM public.furniture_items fi
      LEFT JOIN public.furniture_categories fc
        ON fc.id = fi.category_id
      WHERE fi.room_id = $1
        AND fi.dorm_id = $2
      ORDER BY
        fc.name ASC NULLS LAST,
        fi.item_name ASC,
        fi.created_at DESC
      `,
      [roomId, dorm.id]
    );

    return {
      room: {
        id: room.id,
        dormId: room.dorm_id,
        buildingId: room.building_id,
        buildingCode: room.building_code,
        buildingName: room.building_name,
        roomNumber: room.room_number,
        floorNo: Number(room.floor_no || 0),
        status: room.status,
        tenantName: room.tenant_name,
        roomLabel: `ห้อง ${room.room_number} ${room.building_name} ชั้น ${room.floor_no}`,
      },
      items: itemsResult.rows.map(mapFurnitureItemRow),
    };
  } finally {
    client.release();
  }
}

async function listFurnitureCategoriesByOwnerId(ownerUserId) {
  const client = await pool.connect();

  try {
    const dorm = await getOwnerDorm(client, ownerUserId);

    const result = await client.query(
      `
      SELECT
        id,
        dorm_id,
        name,
        created_at,
        updated_at
      FROM public.furniture_categories
      WHERE dorm_id = $1
      ORDER BY name ASC
      `,
      [dorm.id]
    );

    return {
      categories: result.rows.map((row) => ({
        id: row.id,
        dormId: row.dorm_id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  } finally {
    client.release();
  }
}

async function createFurnitureCategoryByOwnerId(ownerUserId, payload) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const dorm = await getOwnerDorm(client, ownerUserId);
    const name = s(payload.name);

    if (!name) {
      throw createError(400, "กรุณากรอกชื่อหมวดหมู่");
    }

    const duplicateResult = await client.query(
      `
      SELECT id
      FROM public.furniture_categories
      WHERE dorm_id = $1
        AND LOWER(name) = LOWER($2)
      LIMIT 1
      `,
      [dorm.id, name]
    );

    if (duplicateResult.rows.length > 0) {
      throw createError(400, "หมวดหมู่นี้มีอยู่แล้ว");
    }

    const insertResult = await client.query(
      `
      INSERT INTO public.furniture_categories (dorm_id, name)
      VALUES ($1, $2)
      RETURNING id, dorm_id, name, created_at, updated_at
      `,
      [dorm.id, name]
    );

    await client.query("COMMIT");

    const row = insertResult.rows[0];
    return {
      id: row.id,
      dormId: row.dorm_id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createFurnitureItemByOwnerId(ownerUserId, payload) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const dorm = await getOwnerDorm(client, ownerUserId);

    const roomId = s(payload.room_id);
    const categoryId = s(payload.category_id);
    const itemName = s(payload.item_name);

    if (!roomId) {
      throw createError(400, "กรุณาเลือกห้อง");
    }

    if (!categoryId) {
      throw createError(400, "กรุณาเลือกหมวดหมู่");
    }

    if (!itemName) {
      throw createError(400, "กรุณากรอกชื่อเฟอร์นิเจอร์");
    }

    const roomResult = await client.query(
      `
      SELECT id, dorm_id, building_id, room_number, floor_no
      FROM public.rooms
      WHERE id = $1 AND dorm_id = $2
      LIMIT 1
      `,
      [roomId, dorm.id]
    );

    const room = roomResult.rows[0];
    if (!room) {
      throw createError(400, "ไม่พบห้องที่เลือก");
    }

    const categoryResult = await client.query(
      `
      SELECT id, dorm_id, name
      FROM public.furniture_categories
      WHERE id = $1 AND dorm_id = $2
      LIMIT 1
      `,
      [categoryId, dorm.id]
    );

    const category = categoryResult.rows[0];
    if (!category) {
      throw createError(400, "ไม่พบหมวดหมู่ที่เลือก");
    }

    const quantity = integerOrNull(payload.quantity);
    const safeQuantity = quantity === null ? 1 : quantity;
    if (safeQuantity <= 0) {
      throw createError(400, "จำนวนต้องมากกว่า 0");
    }

    const allowedConditionStatuses = new Set(["new", "good", "fair", "damaged"]);
    const allowedUsageStatuses = new Set([
      "active",
      "under_repair",
      "disposed",
      "missing",
    ]);

    const conditionStatus = s(payload.condition_status || "good");
    if (!allowedConditionStatuses.has(conditionStatus)) {
      throw createError(400, "สภาพไม่ถูกต้อง");
    }

    const usageStatus = s(payload.usage_status || "active");
    if (!allowedUsageStatuses.has(usageStatus)) {
      throw createError(400, "สถานะการใช้งานไม่ถูกต้อง");
    }

    const purchaseDate = normalizeDateOrNull(payload.purchase_date, "วันที่ได้มา");
    const warrantyExpiry = normalizeDateOrNull(
      payload.warranty_expiry,
      "วันหมดประกัน"
    );

    if (purchaseDate && warrantyExpiry && warrantyExpiry < purchaseDate) {
      throw createError(400, "วันหมดประกันต้องไม่น้อยกว่าวันที่ได้มา");
    }

    const price = numberOrNull(payload.price);
    if (price !== null && price < 0) {
      throw createError(400, "ราคาต้องไม่น้อยกว่า 0");
    }

    const lifespanMonths = integerOrNull(payload.lifespan_months);
    if (lifespanMonths !== null && lifespanMonths < 0) {
      throw createError(400, "อายุการใช้งานต้องไม่น้อยกว่า 0 เดือน");
    }

    const insertResult = await client.query(
      `
      INSERT INTO public.furniture_items (
        dorm_id,
        room_id,
        category_id,
        item_name,
        quantity,
        brand,
        model,
        color,
        size_detail,
        condition_status,
        usage_status,
        purchase_date,
        warranty_expiry,
        price,
        note,
        image_url,
        image_path,
        image_file_name,
        lifespan_months
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      )
      RETURNING
        id,
        dorm_id,
        room_id,
        category_id,
        item_name,
        quantity,
        brand,
        model,
        color,
        size_detail,
        condition_status,
        usage_status,
        purchase_date,
        warranty_expiry,
        price,
        note,
        image_url,
        image_path,
        image_file_name,
        lifespan_months,
        created_at,
        updated_at
      `,
      [
        dorm.id,
        room.id,
        category.id,
        itemName,
        safeQuantity,
        normalizeTextOrNull(payload.brand),
        normalizeTextOrNull(payload.model),
        normalizeTextOrNull(payload.color),
        normalizeTextOrNull(payload.size_detail),
        conditionStatus,
        usageStatus,
        purchaseDate,
        warrantyExpiry,
        price,
        normalizeTextOrNull(payload.note),
        normalizeTextOrNull(payload.image_url),
        normalizeTextOrNull(payload.image_path),
        normalizeTextOrNull(payload.image_file_name),
        lifespanMonths,
      ]
    );

    const inserted = insertResult.rows[0];

    await client.query("COMMIT");

    return mapFurnitureItemRow({
      ...inserted,
      category_name: category.name,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateFurnitureItemByOwnerId(ownerUserId, itemId, payload) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const dorm = await getOwnerDorm(client, ownerUserId);
    const safeItemId = s(itemId);

    if (!safeItemId) {
      throw createError(400, "กรุณาระบุ itemId");
    }

    const existingResult = await client.query(
      `
      SELECT
        fi.id,
        fi.dorm_id,
        fi.room_id,
        fi.category_id,
        fi.item_name,
        fi.quantity,
        fi.brand,
        fi.model,
        fi.color,
        fi.size_detail,
        fi.condition_status,
        fi.usage_status,
        fi.purchase_date,
        fi.warranty_expiry,
        fi.price,
        fi.note,
        fi.image_url,
        fi.image_path,
        fi.image_file_name,
        fi.lifespan_months,
        fi.created_at,
        fi.updated_at,
        fc.name AS category_name
      FROM public.furniture_items fi
      LEFT JOIN public.furniture_categories fc
        ON fc.id = fi.category_id
      WHERE fi.id = $1
        AND fi.dorm_id = $2
      LIMIT 1
      `,
      [safeItemId, dorm.id]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      throw createError(404, "ไม่พบเฟอร์นิเจอร์รายการนี้");
    }

    let finalRoomId = existing.room_id;
    let finalCategoryId = existing.category_id;
    let finalCategoryName = existing.category_name;

    if (hasOwn(payload, "room_id")) {
      const nextRoomId = s(payload.room_id);
      if (!nextRoomId) {
        throw createError(400, "กรุณาเลือกห้อง");
      }

      const roomResult = await client.query(
        `
        SELECT id
        FROM public.rooms
        WHERE id = $1 AND dorm_id = $2
        LIMIT 1
        `,
        [nextRoomId, dorm.id]
      );

      if (roomResult.rows.length === 0) {
        throw createError(400, "ไม่พบห้องที่เลือก");
      }

      finalRoomId = nextRoomId;
    }

    if (hasOwn(payload, "category_id")) {
      const nextCategoryId = s(payload.category_id);
      if (!nextCategoryId) {
        throw createError(400, "กรุณาเลือกหมวดหมู่");
      }

      const categoryResult = await client.query(
        `
        SELECT id, name
        FROM public.furniture_categories
        WHERE id = $1 AND dorm_id = $2
        LIMIT 1
        `,
        [nextCategoryId, dorm.id]
      );

      const category = categoryResult.rows[0];
      if (!category) {
        throw createError(400, "ไม่พบหมวดหมู่ที่เลือก");
      }

      finalCategoryId = category.id;
      finalCategoryName = category.name;
    }

    const allowedConditionStatuses = new Set(["new", "good", "fair", "damaged"]);
    const allowedUsageStatuses = new Set([
      "active",
      "under_repair",
      "disposed",
      "missing",
    ]);

    const finalItemName = hasOwn(payload, "item_name")
      ? s(payload.item_name)
      : existing.item_name;

    if (!finalItemName) {
      throw createError(400, "กรุณากรอกชื่อเฟอร์นิเจอร์");
    }

    let finalQuantity = Number(existing.quantity || 1);
    if (hasOwn(payload, "quantity")) {
      const parsedQuantity = integerOrNull(payload.quantity);
      if (parsedQuantity === null || parsedQuantity <= 0) {
        throw createError(400, "จำนวนต้องมากกว่า 0");
      }
      finalQuantity = parsedQuantity;
    }

    let finalConditionStatus = existing.condition_status;
    if (hasOwn(payload, "condition_status")) {
      const nextConditionStatus = s(payload.condition_status);
      if (!allowedConditionStatuses.has(nextConditionStatus)) {
        throw createError(400, "สภาพไม่ถูกต้อง");
      }
      finalConditionStatus = nextConditionStatus;
    }

    let finalUsageStatus = existing.usage_status;
    if (hasOwn(payload, "usage_status")) {
      const nextUsageStatus = s(payload.usage_status);
      if (!allowedUsageStatuses.has(nextUsageStatus)) {
        throw createError(400, "สถานะการใช้งานไม่ถูกต้อง");
      }
      finalUsageStatus = nextUsageStatus;
    }

    const finalPurchaseDate = hasOwn(payload, "purchase_date")
      ? normalizeDateOrNull(payload.purchase_date, "วันที่ได้มา")
      : existing.purchase_date;

    const finalWarrantyExpiry = hasOwn(payload, "warranty_expiry")
      ? normalizeDateOrNull(payload.warranty_expiry, "วันหมดประกัน")
      : existing.warranty_expiry;

    if (
      finalPurchaseDate &&
      finalWarrantyExpiry &&
      finalWarrantyExpiry < finalPurchaseDate
    ) {
      throw createError(400, "วันหมดประกันต้องไม่น้อยกว่าวันที่ได้มา");
    }

    let finalPrice = existing.price === null ? null : Number(existing.price);
    if (hasOwn(payload, "price")) {
      const nextPrice = numberOrNull(payload.price);
      if (nextPrice !== null && nextPrice < 0) {
        throw createError(400, "ราคาต้องไม่น้อยกว่า 0");
      }
      finalPrice = nextPrice;
    }

    let finalLifespanMonths =
      existing.lifespan_months === null ? null : Number(existing.lifespan_months);
    if (hasOwn(payload, "lifespan_months")) {
      const nextLifespanMonths = integerOrNull(payload.lifespan_months);
      if (nextLifespanMonths !== null && nextLifespanMonths < 0) {
        throw createError(400, "อายุการใช้งานต้องไม่น้อยกว่า 0 เดือน");
      }
      finalLifespanMonths = nextLifespanMonths;
    }

    const finalBrand = hasOwn(payload, "brand")
      ? normalizeTextOrNull(payload.brand)
      : existing.brand;

    const finalModel = hasOwn(payload, "model")
      ? normalizeTextOrNull(payload.model)
      : existing.model;

    const finalColor = hasOwn(payload, "color")
      ? normalizeTextOrNull(payload.color)
      : existing.color;

    const finalSizeDetail = hasOwn(payload, "size_detail")
      ? normalizeTextOrNull(payload.size_detail)
      : existing.size_detail;

    const finalNote = hasOwn(payload, "note")
      ? normalizeTextOrNull(payload.note)
      : existing.note;

    const finalImageUrl = hasOwn(payload, "image_url")
      ? normalizeTextOrNull(payload.image_url)
      : existing.image_url;

    const finalImagePath = hasOwn(payload, "image_path")
      ? normalizeTextOrNull(payload.image_path)
      : existing.image_path;

    const finalImageFileName = hasOwn(payload, "image_file_name")
      ? normalizeTextOrNull(payload.image_file_name)
      : existing.image_file_name;

    const updateResult = await client.query(
      `
      UPDATE public.furniture_items
      SET
        room_id = $1,
        category_id = $2,
        item_name = $3,
        quantity = $4,
        brand = $5,
        model = $6,
        color = $7,
        size_detail = $8,
        condition_status = $9,
        usage_status = $10,
        purchase_date = $11,
        warranty_expiry = $12,
        price = $13,
        note = $14,
        image_url = $15,
        image_path = $16,
        image_file_name = $17,
        lifespan_months = $18,
        updated_at = now()
      WHERE id = $19
        AND dorm_id = $20
      RETURNING
        id,
        dorm_id,
        room_id,
        category_id,
        item_name,
        quantity,
        brand,
        model,
        color,
        size_detail,
        condition_status,
        usage_status,
        purchase_date,
        warranty_expiry,
        price,
        note,
        image_url,
        image_path,
        image_file_name,
        lifespan_months,
        created_at,
        updated_at
      `,
      [
        finalRoomId,
        finalCategoryId,
        finalItemName,
        finalQuantity,
        finalBrand,
        finalModel,
        finalColor,
        finalSizeDetail,
        finalConditionStatus,
        finalUsageStatus,
        finalPurchaseDate,
        finalWarrantyExpiry,
        finalPrice,
        finalNote,
        finalImageUrl,
        finalImagePath,
        finalImageFileName,
        finalLifespanMonths,
        safeItemId,
        dorm.id,
      ]
    );

    await client.query("COMMIT");

    return mapFurnitureItemRow({
      ...updateResult.rows[0],
      category_name: finalCategoryName,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteFurnitureItemByOwnerId(ownerUserId, itemId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const dorm = await getOwnerDorm(client, ownerUserId);
    const safeItemId = s(itemId);

    if (!safeItemId) {
      throw createError(400, "กรุณาระบุ itemId");
    }

    const existingResult = await client.query(
      `
      SELECT
        fi.id,
        fi.dorm_id,
        fi.room_id,
        fi.category_id,
        fi.item_name,
        fi.quantity,
        fi.brand,
        fi.model,
        fi.color,
        fi.size_detail,
        fi.condition_status,
        fi.usage_status,
        fi.purchase_date,
        fi.warranty_expiry,
        fi.price,
        fi.note,
        fi.image_url,
        fi.image_path,
        fi.image_file_name,
        fi.lifespan_months,
        fi.created_at,
        fi.updated_at,
        fc.name AS category_name
      FROM public.furniture_items fi
      LEFT JOIN public.furniture_categories fc
        ON fc.id = fi.category_id
      WHERE fi.id = $1
        AND fi.dorm_id = $2
      LIMIT 1
      `,
      [safeItemId, dorm.id]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      throw createError(404, "ไม่พบเฟอร์นิเจอร์รายการนี้");
    }

    await client.query(
      `
      DELETE FROM public.furniture_items
      WHERE id = $1
        AND dorm_id = $2
      `,
      [safeItemId, dorm.id]
    );

    await client.query("COMMIT");

    return mapFurnitureItemRow(existing);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listFurnitureRoomsByOwnerId,
  getRoomFurnitureItemsByOwnerId,
  listFurnitureCategoriesByOwnerId,
  createFurnitureCategoryByOwnerId,
  createFurnitureItemByOwnerId,
  updateFurnitureItemByOwnerId,
  deleteFurnitureItemByOwnerId,
};