const { pool } = require("../config/db");

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function toMoney(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(num * 100) / 100;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeBillingMonth(input) {
  if (!hasValue(input)) {
    throw createError(400, "billing_month is required");
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw createError(400, "Invalid billing_month");
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function normalizeDate(input, fieldName = "date") {
  if (!hasValue(input)) {
    throw createError(400, `${fieldName} is required`);
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw createError(400, `Invalid ${fieldName}`);
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeDueDate(billingMonth, billingDueDay = 1) {
  const base = new Date(`${billingMonth}T00:00:00.000Z`);
  const year = base.getUTCFullYear();
  const monthIndex = base.getUTCMonth();

  const lastDayOfMonth = new Date(
    Date.UTC(year, monthIndex + 1, 0)
  ).getUTCDate();

  const safeDay = Math.min(
    Math.max(Number(billingDueDay) || 1, 1),
    lastDayOfMonth
  );

  const month = String(monthIndex + 1).padStart(2, "0");
  const day = String(safeDay).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function resolveInvoiceStatus(status, dueDate) {
  if (status !== "unpaid") return status;
  if (!dueDate) return status;

  const parsedDueDate = new Date(dueDate);
  if (Number.isNaN(parsedDueDate.getTime())) return status;

  const dueDateEnd = new Date(parsedDueDate);
  dueDateEnd.setHours(23, 59, 59, 999);

  return Date.now() > dueDateEnd.getTime() ? "overdue" : status;
}

function getResolvedInvoiceStatusSql(
  statusColumn = "i.status",
  dueDateColumn = "i.due_date"
) {
  return `
    CASE
      WHEN ${statusColumn} = 'unpaid'
       AND ${dueDateColumn} IS NOT NULL
       AND ${dueDateColumn} < CURRENT_DATE
      THEN 'overdue'
      ELSE ${statusColumn}
    END
  `;
}

function mapInvoiceStatus(invoice) {
  if (!invoice) return invoice;

  return {
    ...invoice,
    raw_status: invoice.status,
    status: resolveInvoiceStatus(invoice.status, invoice.due_date),
  };
}

async function ensureOwnerDorm(ownerUserId, dormId, client = pool) {
  const result = await client.query(
    `
      SELECT id, owner_user_id, name
      FROM dorms
      WHERE id = $1
        AND owner_user_id = $2
      LIMIT 1
    `,
    [dormId, ownerUserId]
  );

  const dorm = result.rows[0];
  if (!dorm) {
    throw createError(403, "Dorm not found or access denied");
  }

  return dorm;
}

async function getInvoiceFormOptionsByOwnerId(ownerUserId, dormId, query = {}) {
  await ensureOwnerDorm(ownerUserId, dormId);

  const { building_id, floor_no, room_id, billing_month } = query;

  const buildingsResult = await pool.query(
    `
      SELECT
        id,
        dorm_id,
        building_code,
        display_name,
        sort_order
      FROM buildings
      WHERE dorm_id = $1
      ORDER BY sort_order ASC, display_name ASC
    `,
    [dormId]
  );

  let floors = [];

  if (hasValue(building_id)) {
    const floorsResult = await pool.query(
      `
        SELECT DISTINCT floor_no
        FROM rooms
        WHERE dorm_id = $1
          AND building_id = $2
        ORDER BY floor_no ASC
      `,
      [dormId, building_id]
    );

    floors = floorsResult.rows.map((row) => row.floor_no);
  }

  let rooms = [];

  if (hasValue(building_id) && hasValue(floor_no)) {
    const roomsResult = await pool.query(
      `
        SELECT
          r.id,
          r.dorm_id,
          r.building_id,
          r.room_number,
          r.floor_no,
          r.monthly_rent,
          r.status,
          r.tenant_name
        FROM rooms r
        WHERE r.dorm_id = $1
          AND r.building_id = $2
          AND r.floor_no = $3
          AND EXISTS (
            SELECT 1
            FROM rental_contracts rc
            WHERE rc.room_id = r.id
              AND rc.status = 'active'
          )
        ORDER BY r.room_number ASC
      `,
      [dormId, building_id, Number(floor_no)]
    );

    rooms = roomsResult.rows;
  }

  let selected_room_contract = null;

  if (hasValue(room_id)) {
    const selectedRoomResult = await pool.query(
      `
        SELECT
          r.id AS room_id,
          r.dorm_id,
          r.building_id,
          r.room_number,
          r.floor_no,
          r.monthly_rent,
          r.status,
          r.tenant_name,
          b.display_name AS building_name,
          b.building_code,
          rc.id AS contract_id,
          rc.tenant_user_id,
          rc.rent_amount,
          rc.water_rate,
          rc.electric_rate,
          rc.billing_due_day,
          ba.id AS bank_account_id,
          ba.bank_name,
          ba.account_name,
          ba.account_number,
          ba.promptpay_id,
          ba.qr_image_url
        FROM rooms r
        JOIN buildings b
          ON b.id = r.building_id
        LEFT JOIN rental_contracts rc
          ON rc.room_id = r.id
         AND rc.status = 'active'
        LEFT JOIN bank_accounts ba
          ON ba.dorm_id = r.dorm_id
         AND ba.is_default = true
        WHERE r.id = $1
          AND r.dorm_id = $2
        LIMIT 1
      `,
      [room_id, dormId]
    );

    const selected = selectedRoomResult.rows[0] || null;

    if (selected) {
      const normalizedMonth = hasValue(billing_month)
        ? normalizeBillingMonth(billing_month)
        : null;

      selected_room_contract = {
        room_id: selected.room_id,
        dorm_id: selected.dorm_id,
        building_id: selected.building_id,
        room_number: selected.room_number,
        floor_no: selected.floor_no,
        room_status: selected.status,
        building_name: selected.building_name,
        building_code: selected.building_code,
        tenant_name: selected.tenant_name,
        contract_id: selected.contract_id,
        tenant_user_id: selected.tenant_user_id,
        base_rent_amount: toMoney(
          selected.rent_amount ?? selected.monthly_rent,
          0
        ),
        water_rate: toMoney(selected.water_rate, 0),
        electric_rate: toMoney(selected.electric_rate, 0),
        billing_due_day: selected.billing_due_day,
        suggested_due_date:
          normalizedMonth && selected.billing_due_day
            ? computeDueDate(normalizedMonth, selected.billing_due_day)
            : normalizedMonth
            ? computeDueDate(normalizedMonth, 1)
            : null,
        bank_account: selected.bank_account_id
          ? {
              id: selected.bank_account_id,
              bank_name: selected.bank_name,
              account_name: selected.account_name,
              account_number: selected.account_number,
              promptpay_id: selected.promptpay_id,
              qr_image_url: selected.qr_image_url,
            }
          : null,
      };
    }
  }

  return {
    buildings: buildingsResult.rows,
    floors,
    rooms,
    selected_room_contract,
  };
}

async function createInvoiceByOwnerId(ownerUserId, dormId, payload = {}) {
  await ensureOwnerDorm(ownerUserId, dormId);

  const {
    room_id,
    billing_month,
    due_date,
    base_rent_amount,
    water_units,
    water_rate,
    electric_units,
    electric_rate,
    other_amount,
    discount_amount,
    status,
  } = payload;

  if (!hasValue(room_id)) {
    throw createError(400, "room_id is required");
  }

  const normalizedBillingMonth = normalizeBillingMonth(billing_month);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const roomContextResult = await client.query(
      `
        SELECT
          r.id AS room_id,
          r.dorm_id,
          r.building_id,
          r.room_number,
          r.floor_no,
          r.monthly_rent,
          r.status,
          r.tenant_name,
          rc.id AS contract_id,
          rc.tenant_user_id,
          rc.rent_amount,
          rc.water_rate,
          rc.electric_rate,
          rc.billing_due_day,
          ba.id AS bank_account_id,
          ba.bank_name,
          ba.account_name,
          ba.account_number,
          ba.promptpay_id,
          ba.qr_image_url
        FROM rooms r
        LEFT JOIN rental_contracts rc
          ON rc.room_id = r.id
         AND rc.status = 'active'
        LEFT JOIN bank_accounts ba
          ON ba.dorm_id = r.dorm_id
         AND ba.is_default = true
        WHERE r.id = $1
          AND r.dorm_id = $2
        LIMIT 1
      `,
      [room_id, dormId]
    );

    const roomContext = roomContextResult.rows[0];

    if (!roomContext) {
      throw createError(404, "Room not found");
    }

    if (!roomContext.contract_id) {
      throw createError(400, "This room has no active rental contract");
    }

    const finalBaseRentAmount = hasValue(base_rent_amount)
      ? toMoney(base_rent_amount, 0)
      : toMoney(roomContext.rent_amount ?? roomContext.monthly_rent, 0);

    const finalWaterUnits = toMoney(water_units, 0);
    const finalWaterRate = hasValue(water_rate)
      ? toMoney(water_rate, 0)
      : toMoney(roomContext.water_rate, 0);

    const finalElectricUnits = toMoney(electric_units, 0);
    const finalElectricRate = hasValue(electric_rate)
      ? toMoney(electric_rate, 0)
      : toMoney(roomContext.electric_rate, 0);

    const finalOtherAmount = toMoney(other_amount, 0);
    const finalDiscountAmount = toMoney(discount_amount, 0);

    const finalWaterAmount = round2(finalWaterUnits * finalWaterRate);
    const finalElectricAmount = round2(finalElectricUnits * finalElectricRate);

    const finalTotalAmount = round2(
      finalBaseRentAmount +
        finalWaterAmount +
        finalElectricAmount +
        finalOtherAmount -
        finalDiscountAmount
    );

    if (finalTotalAmount < 0) {
      throw createError(400, "total_amount cannot be negative");
    }

    const finalDueDate = hasValue(due_date)
      ? normalizeDate(due_date, "due_date")
      : computeDueDate(
          normalizedBillingMonth,
          Number(roomContext.billing_due_day) || 1
        );

    const finalStatus = status === "draft" ? "draft" : "unpaid";

    const insertResult = await client.query(
      `
        INSERT INTO invoices (
          dorm_id,
          room_id,
          contract_id,
          tenant_user_id,
          billing_month,
          due_date,
          base_rent_amount,
          water_units,
          water_rate,
          water_amount,
          electric_units,
          electric_rate,
          electric_amount,
          other_amount,
          discount_amount,
          total_amount,
          status,
          generated_by,
          bank_account_id,
          payment_bank_name,
          payment_account_name,
          payment_account_number,
          payment_promptpay_id,
          payment_qr_image_url
        )
        VALUES (
          $1,  $2,  $3,  $4,  $5,  $6,
          $7,  $8,  $9,  $10, $11, $12,
          $13, $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24
        )
        RETURNING *
      `,
      [
        roomContext.dorm_id,
        roomContext.room_id,
        roomContext.contract_id,
        roomContext.tenant_user_id,
        normalizedBillingMonth,
        finalDueDate,
        finalBaseRentAmount,
        finalWaterUnits,
        finalWaterRate,
        finalWaterAmount,
        finalElectricUnits,
        finalElectricRate,
        finalElectricAmount,
        finalOtherAmount,
        finalDiscountAmount,
        finalTotalAmount,
        finalStatus,
        ownerUserId,
        roomContext.bank_account_id,
        roomContext.bank_name,
        roomContext.account_name,
        roomContext.account_number,
        roomContext.promptpay_id,
        roomContext.qr_image_url,
      ]
    );

    await client.query("COMMIT");

    return insertResult.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      throw createError(
        409,
        "Invoice for this room and billing month already exists"
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

async function listInvoicesByOwnerId(ownerUserId, dormId, query = {}) {
  await ensureOwnerDorm(ownerUserId, dormId);

  const params = [dormId];
  const conditions = [`i.dorm_id = $1`];
  const resolvedStatusSql = getResolvedInvoiceStatusSql("i.status", "i.due_date");

  if (hasValue(query.building_id)) {
    params.push(query.building_id);
    conditions.push(`r.building_id = $${params.length}`);
  }

  if (hasValue(query.floor_no)) {
    params.push(Number(query.floor_no));
    conditions.push(`r.floor_no = $${params.length}`);
  }

  if (hasValue(query.room_id)) {
    params.push(query.room_id);
    conditions.push(`i.room_id = $${params.length}`);
  }

  if (hasValue(query.status)) {
    params.push(String(query.status).trim());
    conditions.push(`${resolvedStatusSql} = $${params.length}`);
  }

  if (hasValue(query.billing_month)) {
    params.push(normalizeBillingMonth(query.billing_month));
    conditions.push(`i.billing_month = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        i.id,
        i.dorm_id,
        i.room_id,
        i.contract_id,
        i.tenant_user_id,
        i.billing_month,
        i.due_date,
        i.base_rent_amount,
        i.water_units,
        i.water_rate,
        i.water_amount,
        i.electric_units,
        i.electric_rate,
        i.electric_amount,
        i.other_amount,
        i.discount_amount,
        i.total_amount,
        i.status,
        i.generated_at,
        r.room_number,
        r.floor_no,
        r.tenant_name,
        b.display_name AS building_name,
        b.building_code
      FROM invoices i
      JOIN rooms r ON r.id = i.room_id
      JOIN buildings b ON b.id = r.building_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY i.billing_month DESC, b.sort_order ASC, r.floor_no ASC, r.room_number ASC
    `,
    params
  );

  return result.rows.map(mapInvoiceStatus);
}

async function getInvoiceDetailByOwnerId(ownerUserId, dormId, invoiceId) {
  await ensureOwnerDorm(ownerUserId, dormId);

  const invoiceResult = await pool.query(
    `
      SELECT
        i.*,
        r.room_number,
        r.floor_no,
        r.tenant_name,
        b.display_name AS building_name,
        b.building_code,
        rc.start_date AS contract_start_date,
        rc.end_date AS contract_end_date,
        rc.move_in_date,
        rc.move_out_date
      FROM invoices i
      JOIN rooms r ON r.id = i.room_id
      JOIN buildings b ON b.id = r.building_id
      LEFT JOIN rental_contracts rc ON rc.id = i.contract_id
      WHERE i.id = $1
        AND i.dorm_id = $2
      LIMIT 1
    `,
    [invoiceId, dormId]
  );

  const invoice = invoiceResult.rows[0];

  if (!invoice) {
    throw createError(404, "Invoice not found");
  }

  const paymentsResult = await pool.query(
    `
      SELECT
        id,
        invoice_id,
        payer_user_id,
        bank_account_id,
        payment_method,
        submitted_amount,
        slip_image_url,
        reference_no,
        paid_at,
        status,
        reviewed_by,
        reviewed_at,
        review_note,
        created_at,
        updated_at
      FROM payments
      WHERE invoice_id = $1
      ORDER BY created_at DESC
    `,
    [invoiceId]
  );

  return {
    invoice: mapInvoiceStatus(invoice),
    payments: paymentsResult.rows,
  };
}

module.exports = {
  getInvoiceFormOptionsByOwnerId,
  createInvoiceByOwnerId,
  listInvoicesByOwnerId,
  getInvoiceDetailByOwnerId,
};