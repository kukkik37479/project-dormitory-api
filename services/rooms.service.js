const { pool } = require("../config/db");

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
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

async function getRoomMetaByOwnerId(ownerUserId) {
  const client = await pool.connect();

  try {
    const dorm = await getOwnerDorm(client, ownerUserId);

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

    const roomTypesResult = await client.query(
      `
      SELECT
        id,
        dorm_id,
        type_name,
        room_layout,
        size_sqm,
        price_min,
        price_max,
        sort_order,
        is_active
      FROM public.room_types
      WHERE dorm_id = $1
      ORDER BY sort_order ASC, type_name ASC
      `,
      [dorm.id]
    );

    return {
      dorm,
      buildings: buildingsResult.rows,
      room_types: roomTypesResult.rows,
    };
  } finally {
    client.release();
  }
}

async function listRoomsByOwnerId(ownerUserId) {
  const client = await pool.connect();

  try {
    const dorm = await getOwnerDorm(client, ownerUserId);

    const result = await client.query(
      `
      SELECT
        r.id,
        r.dorm_id,
        r.building_id,
        r.room_number,
        r.floor_no,
        r.monthly_rent,
        r.room_type,
        r.status,
        r.note,
        r.tenant_name,
        r.created_at,
        r.updated_at,
        b.building_code,
        b.display_name AS building_display_name,
        b.sort_order AS building_sort_order
      FROM public.rooms r
      INNER JOIN public.buildings b ON b.id = r.building_id
      WHERE r.dorm_id = $1
      ORDER BY
        b.sort_order ASC,
        b.building_code ASC,
        r.floor_no ASC,
        r.room_number ASC
      `,
      [dorm.id]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

async function getVacantRoomsByOwnerId(ownerUserId) {
  const client = await pool.connect();

  try {
    const dorm = await getOwnerDorm(client, ownerUserId);

    const result = await client.query(
      `
      SELECT
        r.id,
        r.dorm_id,
        r.building_id,
        r.room_number,
        r.floor_no,
        r.monthly_rent,
        r.room_type,
        r.status,
        r.note,
        r.tenant_name,
        r.created_at,
        r.updated_at,
        b.building_code,
        b.display_name AS building_display_name,
        rt.size_sqm,
        rt.room_layout
      FROM public.rooms r
      INNER JOIN public.buildings b
        ON b.id = r.building_id
      LEFT JOIN public.room_types rt
        ON rt.dorm_id = r.dorm_id
       AND rt.type_name = r.room_type
      WHERE r.dorm_id = $1
        AND r.status = 'vacant'
      ORDER BY
        b.sort_order ASC,
        b.building_code ASC,
        r.floor_no ASC,
        r.room_number ASC
      `,
      [dorm.id]
    );

    return result.rows;
  } finally {
    client.release();
  }
}

async function createBuildingByOwnerId(ownerUserId, payload) {
  const { building_code, display_name, sort_order } = payload;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const dorm = await getOwnerDorm(client, ownerUserId);

    const code = String(building_code || "")
      .trim()
      .toUpperCase();

    if (!code) {
      throw createError(400, "กรุณากรอกรหัสตึก");
    }

    const existsResult = await client.query(
      `
      SELECT id
      FROM public.buildings
      WHERE dorm_id = $1 AND building_code = $2
      LIMIT 1
      `,
      [dorm.id, code]
    );

    if (existsResult.rows[0]) {
      throw createError(400, `ตึก ${code} มีอยู่แล้ว`);
    }

    const nextSortOrderResult = await client.query(
      `
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order
      FROM public.buildings
      WHERE dorm_id = $1
      `,
      [dorm.id]
    );

    const nextSortOrder = Number(
      nextSortOrderResult.rows[0]?.next_sort_order || 1
    );

    const result = await client.query(
      `
      INSERT INTO public.buildings (
        dorm_id,
        building_code,
        display_name,
        sort_order
      )
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        dorm_id,
        building_code,
        display_name,
        sort_order,
        created_at,
        updated_at
      `,
      [
        dorm.id,
        code,
        String(display_name || `ตึก ${code}`).trim(),
        sort_order !== undefined && sort_order !== null
          ? normalizeNumber(sort_order, nextSortOrder)
          : nextSortOrder,
      ]
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createRoomByOwnerId(ownerUserId, payload) {
  const {
    building_id,
    room_number,
    floor_no,
    monthly_rent,
    room_type,
    status,
    tenant_name,
    note,
  } = payload;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const dorm = await getOwnerDorm(client, ownerUserId);

    if (!building_id) {
      throw createError(400, "กรุณาเลือกตึก");
    }

    const buildingResult = await client.query(
      `
      SELECT id, dorm_id, building_code, display_name
      FROM public.buildings
      WHERE id = $1 AND dorm_id = $2
      LIMIT 1
      `,
      [building_id, dorm.id]
    );

    const building = buildingResult.rows[0];

    if (!building) {
      throw createError(400, "ไม่พบตึกที่เลือก");
    }

    const roomNumber = String(room_number || "").trim();
    if (!roomNumber) {
      throw createError(400, "กรุณากรอกเลขห้อง");
    }

    const roomType = String(room_type || "").trim();
    if (!roomType) {
      throw createError(400, "กรุณาระบุประเภทห้อง");
    }

    const allowedStatuses = new Set(["vacant", "occupied", "maintenance"]);
    const safeStatus = String(status || "vacant").trim();

    if (!allowedStatuses.has(safeStatus)) {
      throw createError(400, "สถานะห้องไม่ถูกต้อง");
    }

    const duplicateResult = await client.query(
      `
      SELECT id
      FROM public.rooms
      WHERE dorm_id = $1 AND building_id = $2 AND room_number = $3
      LIMIT 1
      `,
      [dorm.id, building.id, roomNumber]
    );

    if (duplicateResult.rows[0]) {
      throw createError(400, `ห้อง ${roomNumber} ในตึกนี้มีอยู่แล้ว`);
    }

    const result = await client.query(
      `
      INSERT INTO public.rooms (
        dorm_id,
        building_id,
        room_number,
        floor_no,
        monthly_rent,
        room_type,
        status,
        note,
        tenant_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING
        id,
        dorm_id,
        building_id,
        room_number,
        floor_no,
        monthly_rent,
        room_type,
        status,
        note,
        tenant_name,
        created_at,
        updated_at
      `,
      [
        dorm.id,
        building.id,
        roomNumber,
        normalizeNumber(floor_no, 1),
        normalizeNumber(monthly_rent, 0),
        roomType,
        safeStatus,
        note ? String(note).trim() : null,
        tenant_name ? String(tenant_name).trim() : null,
      ]
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getRoomDetailByOwnerId(ownerUserId, roomId) {
  const client = await pool.connect();

  try {
    const dorm = await getOwnerDorm(client, ownerUserId);

    const roomResult = await client.query(
      `
      SELECT
        r.id,
        r.dorm_id,
        r.building_id,
        r.room_number,
        r.floor_no,
        r.monthly_rent,
        r.room_type,
        r.status,
        r.note,
        r.tenant_name,
        r.created_at,
        r.updated_at,
        b.building_code,
        b.display_name AS building_display_name
      FROM public.rooms r
      INNER JOIN public.buildings b ON b.id = r.building_id
      WHERE r.id = $1 AND r.dorm_id = $2
      LIMIT 1
      `,
      [roomId, dorm.id]
    );

    const room = roomResult.rows[0];

    if (!room) {
      throw createError(404, "ไม่พบห้องนี้");
    }

    const furnitureResult = await client.query(
      `
      SELECT
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
        created_at,
        updated_at
      FROM public.furniture_items
      WHERE room_id = $1
      ORDER BY item_name ASC, created_at ASC
      `,
      [roomId]
    );

    const latestContractResult = await client.query(
      `
      SELECT
        id,
        room_id,
        tenant_user_id,
        start_date,
        end_date,
        rent_amount,
        deposit_amount,
        water_rate,
        electric_rate,
        billing_due_day,
        status,
        note,
        contract_number,
        move_in_date,
        move_out_date,
        ended_at,
        ended_reason,
        created_at,
        updated_at
      FROM public.rental_contracts
      WHERE room_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [roomId]
    );

    return {
      room,
      furniture_items: furnitureResult.rows,
      latest_contract: latestContractResult.rows[0] || null,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  getRoomMetaByOwnerId,
  listRoomsByOwnerId,
  getVacantRoomsByOwnerId,
  createBuildingByOwnerId,
  createRoomByOwnerId,
  getRoomDetailByOwnerId,
};