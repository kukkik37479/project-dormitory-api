const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { pool } = require("../config/db");

function s(value) {
  return String(value ?? "").trim();
}

function nullableString(value) {
  const v = s(value);
  return v || null;
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function numberOrDefault(value, defaultValue = 0) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function removeUploadedFile(file) {
  try {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  } catch (_error) {}
}

function buildRelativeFilePath(file) {
  if (!file?.path) return null;
  const projectRoot = path.join(__dirname, "../../");
  return path.relative(projectRoot, file.path).replace(/\\/g, "/");
}

function decodeUploadedOriginalName(file) {
  if (!file?.originalname) return null;
  try {
    return Buffer.from(file.originalname, "latin1").toString("utf8");
  } catch {
    return file.originalname;
  }
}

async function resolveDormIdFromIdentifier(client, identifier) {
  const value = s(identifier);
  if (!value) return null;

  const result = await client.query(
    `
    SELECT id
    FROM public.dorms
    WHERE CAST(id AS text) = $1
       OR dorm_slug = $1
    LIMIT 1
    `,
    [value]
  );

  return result.rows[0]?.id || null;
}

const getTenants = async (req, res) => {
  try {
    const dormId = req.user?.dormId;

    if (!dormId) {
      return res.status(401).json({
        message: "No dorm in token",
      });
    }

    const search = s(req.query.search);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
    const offset = (page - 1) * limit;

    const params = [dormId];
    let whereSql = `WHERE tp.dorm_id = $1`;

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      whereSql += `
        AND (
          COALESCE(u.full_name, '') ILIKE $${idx}
          OR COALESCE(u.phone, '') ILIKE $${idx}
          OR COALESCE(u.username, '') ILIKE $${idx}
          OR COALESCE(r.room_number, '') ILIKE $${idx}
          OR COALESCE(b.building_code, '') ILIKE $${idx}
          OR COALESCE(b.display_name, '') ILIKE $${idx}
        )
      `;
    }

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM public.tenant_profiles tp
      JOIN public.users u
        ON u.id = tp.user_id
      JOIN LATERAL (
        SELECT rc1.*
        FROM public.rental_contracts rc1
        WHERE rc1.tenant_user_id = u.id
          AND rc1.dorm_id = tp.dorm_id
          AND rc1.status = 'active'
        ORDER BY rc1.created_at DESC
        LIMIT 1
      ) rc ON TRUE
      LEFT JOIN public.rooms r
        ON r.id = rc.room_id
      LEFT JOIN public.buildings b
        ON b.id = r.building_id
      ${whereSql}
      `,
      params
    );

    const total = countResult.rows[0]?.total || 0;
    const dataParams = [...params, limit, offset];

    const result = await pool.query(
      `
      SELECT
        tp.id AS tenant_profile_id,
        u.id AS tenant_user_id,
        u.full_name,
        u.phone,
        u.username,
        b.id AS building_id,
        b.building_code,
        b.display_name AS building_name,
        r.id AS room_id,
        r.room_number,
        r.floor_no,
        r.status AS room_status,
        rc.id AS contract_id,
        rc.status AS contract_status,
        rc.start_date,
        rc.end_date,
        rc.rent_amount,
        rc.deposit_amount,
        rc.water_rate,
        rc.electric_rate,
        rc.billing_due_day,
        rc.contract_file_path,
        rc.contract_file_name
      FROM public.tenant_profiles tp
      JOIN public.users u
        ON u.id = tp.user_id
      JOIN LATERAL (
        SELECT rc1.*
        FROM public.rental_contracts rc1
        WHERE rc1.tenant_user_id = u.id
          AND rc1.dorm_id = tp.dorm_id
          AND rc1.status = 'active'
        ORDER BY rc1.created_at DESC
        LIMIT 1
      ) rc ON TRUE
      LEFT JOIN public.rooms r
        ON r.id = rc.room_id
      LEFT JOIN public.buildings b
        ON b.id = r.building_id
      ${whereSql}
      ORDER BY
        b.sort_order ASC NULLS LAST,
        r.floor_no ASC NULLS LAST,
        r.room_number ASC NULLS LAST,
        u.created_at DESC
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}
      `,
      dataParams
    );

    return res.status(200).json({
      message: "ดึงรายชื่อผู้เช่าสำเร็จ",
      data: result.rows,
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
    console.error("GET TENANTS ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงรายชื่อผู้เช่า",
      error: error.message,
    });
  }
};

const getTenantFormOptions = async (req, res) => {
  try {
    const dormId = req.user?.dormId;

    if (!dormId) {
      return res.status(401).json({
        message: "No dorm in token",
      });
    }

    const buildingId = s(req.query.building_id) || null;
    const floorNo = integerOrNull(req.query.floor_no);

    const buildingsResult = await pool.query(
      `
      SELECT
        id,
        building_code,
        display_name,
        sort_order
      FROM public.buildings
      WHERE dorm_id = $1
      ORDER BY sort_order ASC NULLS LAST, display_name ASC
      `,
      [dormId]
    );

    const floorParams = [dormId];
    let floorSql = `
      SELECT DISTINCT floor_no
      FROM public.rooms
      WHERE dorm_id = $1
    `;

    if (buildingId) {
      floorParams.push(buildingId);
      floorSql += ` AND building_id = $2`;
    }

    floorSql += ` ORDER BY floor_no ASC`;

    const floorsResult = await pool.query(floorSql, floorParams);

    const roomParams = [dormId];
    let roomSql = `
      SELECT
        r.id,
        r.building_id,
        r.room_number,
        r.floor_no,
        r.monthly_rent,
        r.status,
        b.display_name AS building_name
      FROM public.rooms r
      JOIN public.buildings b
        ON b.id = r.building_id
      WHERE r.dorm_id = $1
        AND r.status = 'vacant'
    `;

    if (buildingId) {
      roomParams.push(buildingId);
      roomSql += ` AND r.building_id = $${roomParams.length}`;
    }

    if (floorNo !== null) {
      roomParams.push(floorNo);
      roomSql += ` AND r.floor_no = $${roomParams.length}`;
    }

    roomSql += `
      ORDER BY
        b.sort_order ASC NULLS LAST,
        r.floor_no ASC,
        r.room_number ASC
    `;

    const roomsResult = await pool.query(roomSql, roomParams);

    return res.status(200).json({
      message: "ดึงข้อมูลตัวเลือกฟอร์มสำเร็จ",
      data: {
        buildings: buildingsResult.rows,
        floors: floorsResult.rows.map((row) => row.floor_no),
        rooms: roomsResult.rows,
      },
    });
  } catch (error) {
    console.error("GET TENANT FORM OPTIONS ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลตัวเลือกฟอร์ม",
      error: error.message,
    });
  }
};

const createTenant = async (req, res) => {
  const client = await pool.connect();

  try {
    const dormId = req.user?.dormId;
    const file = req.file || null;

    if (!dormId) {
      removeUploadedFile(file);
      return res.status(401).json({
        message: "No dorm in token",
      });
    }

    const fullName = s(req.body.full_name);
    const phone = nullableString(req.body.phone);
    const rawUsername = s(req.body.username).toLowerCase();
    const username = rawUsername.includes("@")
      ? rawUsername.split("@")[0]
      : rawUsername;
    const password = s(req.body.password);
    const roomId = nullableString(req.body.room_id);
    const buildingId = nullableString(req.body.building_id);
    const floorNo = integerOrNull(req.body.floor_no);

    const startDate = nullableString(req.body.start_date);
    const endDate = nullableString(req.body.end_date);

    const rentAmount = numberOrDefault(req.body.rent_amount, 0);
    const depositAmount = numberOrDefault(req.body.deposit_amount, 0);
    const waterRate = numberOrDefault(req.body.water_rate, 0);
    const electricRate = numberOrDefault(req.body.electric_rate, 0);
    const billingDueDay = integerOrNull(req.body.billing_due_day);

    const tenantCode = nullableString(req.body.tenant_code);
    const tenantNote = nullableString(req.body.tenant_note);
    const contractNote = nullableString(req.body.contract_note);

    const errors = {};

    if (!fullName) errors.full_name = "กรุณากรอกชื่อผู้เช่า";
    if (!username) errors.username = "กรุณากรอก username";
    if (!password || password.length < 6) {
      errors.password = "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร";
    }
    if (!roomId) errors.room_id = "กรุณาเลือกห้อง";
    if (billingDueDay !== null && (billingDueDay < 1 || billingDueDay > 31)) {
      errors.billing_due_day = "วันครบกำหนดต้องอยู่ระหว่าง 1 ถึง 31";
    }

    if (Object.keys(errors).length > 0) {
      removeUploadedFile(file);
      return res.status(400).json({
        message: "ข้อมูลไม่ถูกต้อง",
        errors,
      });
    }

    await client.query("BEGIN");

    const roomResult = await client.query(
      `
      SELECT
        r.id,
        r.dorm_id,
        r.building_id,
        r.room_number,
        r.floor_no,
        r.monthly_rent,
        r.status
      FROM public.rooms r
      WHERE r.id = $1
        AND r.dorm_id = $2
      LIMIT 1
      `,
      [roomId, dormId]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");
      removeUploadedFile(file);
      return res.status(404).json({
        message: "ไม่พบห้องที่เลือก หรือห้องนี้ไม่ได้อยู่ในหอของคุณ",
      });
    }

    const room = roomResult.rows[0];

    if (buildingId && room.building_id !== buildingId) {
      await client.query("ROLLBACK");
      removeUploadedFile(file);
      return res.status(400).json({
        message: "building_id ไม่ตรงกับห้องที่เลือก",
      });
    }

    if (floorNo !== null && Number(room.floor_no) !== floorNo) {
      await client.query("ROLLBACK");
      removeUploadedFile(file);
      return res.status(400).json({
        message: "floor_no ไม่ตรงกับห้องที่เลือก",
      });
    }

    if (room.status !== "vacant") {
      await client.query("ROLLBACK");
      removeUploadedFile(file);
      return res.status(409).json({
        message: "ห้องนี้ไม่ว่าง",
      });
    }

    const activeContractCheck = await client.query(
      `
      SELECT id
      FROM public.rental_contracts
      WHERE room_id = $1
        AND status = 'active'
      LIMIT 1
      `,
      [roomId]
    );

    if (activeContractCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      removeUploadedFile(file);
      return res.status(409).json({
        message: "ห้องนี้มีสัญญา active อยู่แล้ว",
      });
    }

    const usernameCheck = await client.query(
      `
      SELECT id
      FROM public.users
      WHERE login_dorm_id = $1
        AND lower(username) = lower($2)
      LIMIT 1
      `,
      [dormId, username]
    );

    if (usernameCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      removeUploadedFile(file);
      return res.status(409).json({
        message: "username นี้ถูกใช้งานแล้วในหอนี้",
      });
    }

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
      VALUES (
        'tenant',
        NULL,
        $1,
        $2,
        $3,
        $4,
        false,
        true,
        $5
      )
      RETURNING id, role, username, full_name, phone, created_at
      `,
      [username, passwordHash, fullName, phone, dormId]
    );

    const tenantUser = userResult.rows[0];

    const tenantProfileResult = await client.query(
      `
      INSERT INTO public.tenant_profiles (
        user_id,
        dorm_id,
        tenant_code,
        note
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, dorm_id, tenant_code, note
      `,
      [tenantUser.id, dormId, tenantCode, tenantNote]
    );

    const relativeFilePath = buildRelativeFilePath(file);
    const originalFileName = decodeUploadedOriginalName(file);
    const contractFileUrl = relativeFilePath ? `/${relativeFilePath}` : null;

    const finalRentAmount =
      req.body.rent_amount === undefined || req.body.rent_amount === ""
        ? Number(room.monthly_rent || 0)
        : rentAmount;

    const contractResult = await client.query(
      `
      INSERT INTO public.rental_contracts (
        dorm_id,
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
        contract_file_path,
        contract_file_name,
        contract_file_url,
        contract_file_mime_type,
        contract_file_size
      )
      VALUES (
        $1,
        $2,
        $3,
        COALESCE($4::date, CURRENT_DATE),
        $5::date,
        $6,
        $7,
        $8,
        $9,
        $10,
        'active',
        $11,
        $12,
        $13,
        $14,
        $15,
        $16
      )
      RETURNING
        id,
        dorm_id,
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
        contract_file_path,
        contract_file_name,
        contract_file_url
      `,
      [
        dormId,
        roomId,
        tenantUser.id,
        startDate,
        endDate,
        finalRentAmount,
        depositAmount,
        waterRate,
        electricRate,
        billingDueDay,
        contractNote,
        relativeFilePath,
        originalFileName,
        contractFileUrl,
        file?.mimetype || null,
        file?.size || null,
      ]
    );

    await client.query(
      `
      UPDATE public.rooms
      SET
        status = 'occupied',
        tenant_name = $1,
        updated_at = now()
      WHERE id = $2
      `,
      [fullName, roomId]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "เพิ่มผู้เช่าสำเร็จ",
      data: {
        tenant: tenantUser,
        tenant_profile: tenantProfileResult.rows[0],
        contract: contractResult.rows[0],
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    removeUploadedFile(req.file);

    console.error("CREATE TENANT ERROR:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        message: "ข้อมูลซ้ำในระบบ",
        error: error.detail || error.message,
      });
    }

    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการเพิ่มผู้เช่า",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

const endContract = async (req, res) => {
  const client = await pool.connect();

  try {
    const dormId = req.user?.dormId;
    const contractId = req.params.contractId;
    const endDate = nullableString(req.body.end_date);

    if (!dormId) {
      return res.status(401).json({
        message: "No dorm in token",
      });
    }

    await client.query("BEGIN");

    const contractResult = await client.query(
      `
      SELECT
        rc.id,
        rc.room_id,
        rc.tenant_user_id,
        rc.status,
        rc.start_date,
        rc.end_date
      FROM public.rental_contracts rc
      WHERE rc.id = $1
        AND rc.dorm_id = $2
      LIMIT 1
      `,
      [contractId, dormId]
    );

    if (contractResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "ไม่พบสัญญาเช่า",
      });
    }

    const contract = contractResult.rows[0];

    if (contract.status !== "active") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "สัญญานี้ไม่ได้อยู่ในสถานะ active",
      });
    }

    const updatedContract = await client.query(
      `
      UPDATE public.rental_contracts
      SET
        status = 'ended',
        end_date = COALESCE($1::date, CURRENT_DATE),
        updated_at = now()
      WHERE id = $2
      RETURNING id, room_id, tenant_user_id, status, start_date, end_date
      `,
      [endDate, contractId]
    );

    await client.query(
      `
      UPDATE public.rooms
      SET
        status = 'vacant',
        tenant_name = NULL,
        updated_at = now()
      WHERE id = $1
      `,
      [contract.room_id]
    );

    await client.query(
      `
      UPDATE public.users
      SET
        is_active = false,
        updated_at = now()
      WHERE id = $1
      `,
      [contract.tenant_user_id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "จบสัญญาเช่าและปิดสิทธิ์ผู้เช่าสำเร็จ",
      data: updatedContract.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("END CONTRACT ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการจบสัญญาเช่า",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

const updateContractFile = async (req, res) => {
  const client = await pool.connect();

  try {
    const dormId = req.user?.dormId;
    const contractId = req.params.contractId;
    const file = req.file || null;

    if (!dormId) {
      removeUploadedFile(file);
      return res.status(401).json({
        message: "No dorm in token",
      });
    }

    if (!file) {
      return res.status(400).json({
        message: "กรุณาเลือกไฟล์สัญญา",
      });
    }

    await client.query("BEGIN");

    const contractResult = await client.query(
      `
      SELECT
        id,
        contract_file_path,
        contract_file_name
      FROM public.rental_contracts
      WHERE id = $1
        AND dorm_id = $2
      LIMIT 1
      `,
      [contractId, dormId]
    );

    if (contractResult.rows.length === 0) {
      await client.query("ROLLBACK");
      removeUploadedFile(file);
      return res.status(404).json({
        message: "ไม่พบสัญญาเช่า",
      });
    }

    const oldFilePath = contractResult.rows[0].contract_file_path;
    const relativeFilePath = buildRelativeFilePath(file);
    const originalFileName = decodeUploadedOriginalName(file);
    const contractFileUrl = relativeFilePath ? `/${relativeFilePath}` : null;

    await client.query(
      `
      UPDATE public.rental_contracts
      SET
        contract_file_path = $1,
        contract_file_name = $2,
        contract_file_url = $3,
        contract_file_mime_type = $4,
        contract_file_size = $5,
        updated_at = now()
      WHERE id = $6
      `,
      [
        relativeFilePath,
        originalFileName,
        contractFileUrl,
        file.mimetype || null,
        file.size || null,
        contractId,
      ]
    );

    await client.query("COMMIT");

    if (oldFilePath) {
      try {
        const oldAbsolutePath = path.join(__dirname, "../../", oldFilePath);
        if (fs.existsSync(oldAbsolutePath)) {
          fs.unlinkSync(oldAbsolutePath);
        }
      } catch (_error) {}
    }

    return res.status(200).json({
      message: "อัปเดตไฟล์สัญญาสำเร็จ",
      data: {
        contract_id: contractId,
        contract_file_path: relativeFilePath,
        contract_file_name: originalFileName,
        contract_file_url: contractFileUrl,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    removeUploadedFile(req.file);

    console.error("UPDATE CONTRACT FILE ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการอัปเดตไฟล์สัญญา",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

const getMyRoom = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const dormId =
      req.user?.dormId ||
      req.user?.loginDormId ||
      req.user?.login_dorm_id;

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบ user ใน token",
      });
    }

    const roomResult = await pool.query(
      `
      SELECT
        rc.id AS contract_id,
        rc.start_date,
        rc.end_date,
        rc.rent_amount,
        rc.deposit_amount,
        rc.water_rate,
        rc.electric_rate,
        rc.billing_due_day,
        rc.status AS contract_status,
        rc.note AS contract_note,
        rc.contract_file_path,
        rc.contract_file_name,
        rc.contract_file_url,

        r.id AS room_id,
        r.room_number,
        r.floor_no,
        r.monthly_rent,
        r.room_type,
        r.status AS room_status,
        r.tenant_name,

        b.id AS building_id,
        b.building_code,
        b.display_name AS building_name
      FROM public.rental_contracts rc
      JOIN public.rooms r
        ON r.id = rc.room_id
      LEFT JOIN public.buildings b
        ON b.id = r.building_id
      WHERE rc.tenant_user_id = $1
        ${dormId ? "AND rc.dorm_id = $2" : ""}
        AND rc.status = 'active'
      ORDER BY rc.created_at DESC
      LIMIT 1
      `,
      dormId ? [userId, dormId] : [userId]
    );

    if (roomResult.rows.length === 0) {
      return res.status(200).json({
        message: "ยังไม่มีข้อมูลห้องสำหรับผู้เช่านี้",
        data: null,
      });
    }

    const room = roomResult.rows[0];

    const furnitureResult = await pool.query(
      `
      SELECT
        id,
        item_name,
        quantity,
        condition_status,
        usage_status
      FROM public.furniture_items
      WHERE room_id = $1
        ${dormId ? "AND dorm_id = $2" : ""}
        AND usage_status = 'active'
      ORDER BY item_name ASC
      `,
      dormId ? [room.room_id, dormId] : [room.room_id]
    );

    return res.status(200).json({
      message: "ดึงข้อมูลห้องของฉันสำเร็จ",
      data: {
        room: {
          id: room.room_id,
          roomNumber: room.room_number,
          floor: room.floor_no,
          buildingId: room.building_id,
          buildingCode: room.building_code,
          buildingName: room.building_name,
          roomType: room.room_type,
          monthlyRent: Number(room.monthly_rent || 0),
          status: room.room_status,
          tenantName: room.tenant_name,
        },
        contract: {
          id: room.contract_id,
          startDate: room.start_date,
          endDate: room.end_date,
          rentAmount: Number(room.rent_amount || 0),
          depositAmount: Number(room.deposit_amount || 0),
          waterRate: Number(room.water_rate || 0),
          electricRate: Number(room.electric_rate || 0),
          billingDueDay: room.billing_due_day,
          status: room.contract_status,
          note: room.contract_note,
          filePath: room.contract_file_path,
          fileName: room.contract_file_name,
          fileUrl:
            room.contract_file_url ||
            (room.contract_file_path ? `/${room.contract_file_path}` : null),
        },
        furniture: furnitureResult.rows.map((item) => ({
          id: item.id,
          name: item.item_name,
          quantity: Number(item.quantity || 0),
          conditionStatus: item.condition_status,
          usageStatus: item.usage_status,
        })),
      },
    });
  } catch (error) {
    console.error("GET MY ROOM ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลห้องของฉัน",
      error: error.message,
    });
  }
};

const getMyDormReview = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user?.id || req.user?.userId;
    const role = req.user?.role;
    const dormIdentifier = req.params.dormId;

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบ user ใน token",
      });
    }

    if (role !== "tenant") {
      return res.status(403).json({
        message: "เฉพาะผู้เช่าเท่านั้นที่ดูรีวิวของตัวเองได้",
      });
    }

    const dormId = await resolveDormIdFromIdentifier(client, dormIdentifier);

    if (!dormId) {
      return res.status(404).json({
        message: "ไม่พบหอพักนี้",
      });
    }

    const contractResult = await client.query(
      `
      SELECT
        rc.id,
        rc.room_id
      FROM public.rental_contracts rc
      WHERE rc.tenant_user_id = $1
        AND rc.dorm_id = $2
        AND rc.status = 'active'
      ORDER BY rc.created_at DESC
      LIMIT 1
      `,
      [userId, dormId]
    );

    if (contractResult.rows.length === 0) {
      return res.status(200).json({
        message: "ผู้เช่าคนนี้ไม่มีสิทธิ์รีวิวหอนี้",
        data: {
          canReview: false,
          room_id: null,
          review: null,
        },
      });
    }

    const reviewResult = await client.query(
      `
      SELECT
        id,
        dorm_id,
        room_id,
        tenant_user_id,
        rating,
        comment,
        status,
        created_at,
        updated_at
      FROM public.reviews
      WHERE dorm_id = $1
        AND tenant_user_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [dormId, userId]
    );

    return res.status(200).json({
      message: "ดึงรีวิวของฉันสำเร็จ",
      data: {
        canReview: true,
        room_id: contractResult.rows[0].room_id,
        review: reviewResult.rows[0] || null,
      },
    });
  } catch (error) {
    console.error("GET MY DORM REVIEW ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงรีวิวของฉัน",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

const upsertMyDormReview = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.user?.id || req.user?.userId;
    const role = req.user?.role;
    const dormIdentifier = req.params.dormId;
    const rating = Number(req.body.rating);
    const comment = s(req.body.comment);

    if (!userId) {
      return res.status(401).json({
        message: "ไม่พบ user ใน token",
      });
    }

    if (role !== "tenant") {
      return res.status(403).json({
        message: "เฉพาะผู้เช่าเท่านั้นที่รีวิวได้",
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        message: "คะแนนรีวิวต้องอยู่ระหว่าง 1 ถึง 5",
      });
    }

    if (!comment) {
      return res.status(400).json({
        message: "กรุณากรอกข้อความรีวิว",
      });
    }

    const dormId = await resolveDormIdFromIdentifier(client, dormIdentifier);

    if (!dormId) {
      return res.status(404).json({
        message: "ไม่พบหอพักนี้",
      });
    }

    await client.query("BEGIN");

    const contractResult = await client.query(
      `
      SELECT
        rc.id,
        rc.room_id
      FROM public.rental_contracts rc
      WHERE rc.tenant_user_id = $1
        AND rc.dorm_id = $2
        AND rc.status = 'active'
      ORDER BY rc.created_at DESC
      LIMIT 1
      `,
      [userId, dormId]
    );

    if (contractResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "คุณไม่มีสิทธิ์รีวิวหอนี้",
      });
    }

    const roomId = contractResult.rows[0].room_id;

    const existingReviewResult = await client.query(
      `
      SELECT id
      FROM public.reviews
      WHERE dorm_id = $1
        AND tenant_user_id = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [dormId, userId]
    );

    let savedReview;
    let statusCode = 200;
    let message = "อัปเดตรีวิวสำเร็จ";

    if (existingReviewResult.rows.length > 0) {
      const reviewId = existingReviewResult.rows[0].id;

      const updateResult = await client.query(
        `
        UPDATE public.reviews
        SET
          room_id = $1,
          rating = $2,
          comment = $3,
          status = 'visible',
          updated_at = now()
        WHERE id = $4
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
        [roomId, rating, comment, reviewId]
      );

      savedReview = updateResult.rows[0];
    } else {
      const insertResult = await client.query(
        `
        INSERT INTO public.reviews (
          dorm_id,
          room_id,
          tenant_user_id,
          rating,
          comment,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'visible')
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
        [dormId, roomId, userId, rating, comment]
      );

      savedReview = insertResult.rows[0];
      statusCode = 201;
      message = "ส่งรีวิวสำเร็จ";
    }

    await client.query("COMMIT");

    return res.status(statusCode).json({
      message,
      data: savedReview,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("UPSERT MY DORM REVIEW ERROR:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการบันทึกรีวิว",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

module.exports = {
  getTenants,
  getTenantFormOptions,
  createTenant,
  updateContractFile,
  endContract,
  getMyRoom,
  getMyDormReview,
  upsertMyDormReview,
};