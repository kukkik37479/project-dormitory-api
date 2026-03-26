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

function normalizePaidAt(input) {
  if (!hasValue(input)) return null;

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw createError(400, "Invalid paid_at");
  }

  return date.toISOString();
}

function mapLatestPayment(row) {
  if (!row.payment_id) return null;

  return {
    payment_id: row.payment_id,
    invoice_id: row.invoice_id,
    submitted_amount: row.submitted_amount,
    slip_image_url: row.slip_image_url,
    reference_no: row.reference_no,
    paid_at: row.paid_at,
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    reviewed_at: row.reviewed_at,
    review_note: row.review_note,
    created_at: row.payment_created_at,
    updated_at: row.payment_updated_at,
  };
}

async function getDefaultBankAccountByDormId(dormId, client = pool) {
  const result = await client.query(
    `
      SELECT
        id,
        dorm_id,
        bank_name,
        account_name,
        account_number,
        promptpay_id,
        qr_image_url,
        qr_public_id,
        is_default,
        created_at,
        updated_at
      FROM bank_accounts
      WHERE dorm_id = $1
        AND is_default = true
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
    [dormId]
  );

  return result.rows[0] || null;
}

/* =========================
   Tenant
   ========================= */

async function getTenantBillingOverviewByUserId({ userId }) {
  const currentInvoiceResult = await pool.query(
    `
      SELECT
        i.id AS invoice_id,
        i.dorm_id,
        i.room_id,
        i.billing_month,
        i.due_date,
        i.base_rent_amount,
        i.water_amount,
        i.electric_amount,
        i.other_amount,
        i.discount_amount,
        i.total_amount,
        i.status AS invoice_status,

        COALESCE(i.bank_account_id, dba.id) AS resolved_bank_account_id,
        COALESCE(i.payment_bank_name, dba.bank_name) AS payment_bank_name,
        COALESCE(i.payment_account_name, dba.account_name) AS payment_account_name,
        COALESCE(i.payment_account_number, dba.account_number) AS payment_account_number,
        COALESCE(i.payment_promptpay_id, dba.promptpay_id) AS payment_promptpay_id,
        COALESCE(i.payment_qr_image_url, dba.qr_image_url) AS payment_qr_image_url,

        r.floor_no,
        r.room_number,
        r.tenant_name,

        b.id AS building_id,
        b.display_name AS building_name,
        b.building_code,

        lp.payment_id,
        lp.submitted_amount,
        lp.slip_image_url,
        lp.reference_no,
        lp.paid_at,
        lp.payment_method,
        lp.payment_status,
        lp.reviewed_at,
        lp.review_note,
        lp.payment_created_at,
        lp.payment_updated_at

      FROM invoices i
      JOIN rooms r
        ON r.id = i.room_id
      JOIN buildings b
        ON b.id = r.building_id

      LEFT JOIN LATERAL (
        SELECT
          ba.id,
          ba.bank_name,
          ba.account_name,
          ba.account_number,
          ba.promptpay_id,
          ba.qr_image_url
        FROM bank_accounts ba
        WHERE ba.dorm_id = i.dorm_id
          AND ba.is_default = true
        ORDER BY ba.updated_at DESC, ba.created_at DESC
        LIMIT 1
      ) dba ON true

      LEFT JOIN LATERAL (
        SELECT
          p.id AS payment_id,
          p.invoice_id,
          p.submitted_amount,
          p.slip_image_url,
          p.reference_no,
          p.paid_at,
          p.payment_method,
          p.status AS payment_status,
          p.reviewed_at,
          p.review_note,
          p.created_at AS payment_created_at,
          p.updated_at AS payment_updated_at
        FROM payments p
        WHERE p.invoice_id = i.id
        ORDER BY p.created_at DESC
        LIMIT 1
      ) lp ON true

      WHERE i.tenant_user_id = $1
        AND i.status IN ('draft', 'unpaid', 'pending_review', 'overdue')
      ORDER BY
        CASE i.status
          WHEN 'overdue' THEN 1
          WHEN 'pending_review' THEN 2
          WHEN 'unpaid' THEN 3
          WHEN 'draft' THEN 4
          ELSE 99
        END,
        i.billing_month DESC,
        i.due_date DESC
      LIMIT 1
    `,
    [userId]
  );

  const currentRow = currentInvoiceResult.rows[0] || null;
  const currentInvoiceId = currentRow?.invoice_id || null;

  const historyParams = [userId];
  let historyExcludeSql = "";

  if (currentInvoiceId) {
    historyParams.push(currentInvoiceId);
    historyExcludeSql = `AND i.id <> $2`;
  }

  const historyResult = await pool.query(
    `
      SELECT
        i.id AS invoice_id,
        i.billing_month,
        i.due_date,
        i.base_rent_amount,
        i.water_amount,
        i.electric_amount,
        i.other_amount,
        i.discount_amount,
        i.total_amount,
        i.status AS invoice_status,

        r.floor_no,
        r.room_number,
        r.tenant_name,

        b.display_name AS building_name,
        b.building_code,

        lp.payment_id,
        lp.submitted_amount,
        lp.slip_image_url,
        lp.reference_no,
        lp.paid_at,
        lp.payment_method,
        lp.payment_status,
        lp.reviewed_at,
        lp.review_note,
        lp.payment_created_at,
        lp.payment_updated_at

      FROM invoices i
      JOIN rooms r
        ON r.id = i.room_id
      JOIN buildings b
        ON b.id = r.building_id
      LEFT JOIN LATERAL (
        SELECT
          p.id AS payment_id,
          p.invoice_id,
          p.submitted_amount,
          p.slip_image_url,
          p.reference_no,
          p.paid_at,
          p.payment_method,
          p.status AS payment_status,
          p.reviewed_at,
          p.review_note,
          p.created_at AS payment_created_at,
          p.updated_at AS payment_updated_at
        FROM payments p
        WHERE p.invoice_id = i.id
        ORDER BY p.created_at DESC
        LIMIT 1
      ) lp ON true
      WHERE i.tenant_user_id = $1
        ${historyExcludeSql}
      ORDER BY i.billing_month DESC, i.due_date DESC
    `,
    historyParams
  );

  return {
    current_invoice: currentRow
      ? {
          invoice_id: currentRow.invoice_id,
          dorm_id: currentRow.dorm_id,
          billing_month: currentRow.billing_month,
          due_date: currentRow.due_date,
          room_id: currentRow.room_id,
          room_number: currentRow.room_number,
          floor_no: currentRow.floor_no,
          building_id: currentRow.building_id,
          building_name: currentRow.building_name,
          building_code: currentRow.building_code,
          tenant_name: currentRow.tenant_name,
          base_rent_amount: currentRow.base_rent_amount,
          water_amount: currentRow.water_amount,
          electric_amount: currentRow.electric_amount,
          other_amount: currentRow.other_amount,
          discount_amount: currentRow.discount_amount,
          total_amount: currentRow.total_amount,
          invoice_status: currentRow.invoice_status,
          payment_bank_name: currentRow.payment_bank_name,
          payment_account_name: currentRow.payment_account_name,
          payment_account_number: currentRow.payment_account_number,
          payment_promptpay_id: currentRow.payment_promptpay_id,
          payment_qr_image_url: currentRow.payment_qr_image_url,
          latest_payment: mapLatestPayment(currentRow),
        }
      : null,

    history: historyResult.rows.map((row) => ({
      invoice_id: row.invoice_id,
      billing_month: row.billing_month,
      due_date: row.due_date,
      room_number: row.room_number,
      floor_no: row.floor_no,
      building_name: row.building_name,
      building_code: row.building_code,
      tenant_name: row.tenant_name,
      base_rent_amount: row.base_rent_amount,
      water_amount: row.water_amount,
      electric_amount: row.electric_amount,
      other_amount: row.other_amount,
      discount_amount: row.discount_amount,
      total_amount: row.total_amount,
      invoice_status: row.invoice_status,
      latest_payment: mapLatestPayment(row),
    })),
  };
}

async function createTenantPaymentSubmission({
  userId,
  invoiceId,
  submittedAmount,
  slipImageUrl,
  referenceNo,
  paidAt,
  paymentMethod,
}) {
  const finalSubmittedAmount = toMoney(submittedAmount, NaN);
  if (!Number.isFinite(finalSubmittedAmount) || finalSubmittedAmount <= 0) {
    throw createError(400, "Invalid submitted_amount");
  }

  if (!hasValue(slipImageUrl)) {
    throw createError(400, "slip_image_url is required");
  }

  const finalPaidAt = normalizePaidAt(paidAt);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const invoiceResult = await client.query(
      `
        SELECT
          i.id,
          i.dorm_id,
          i.room_id,
          i.tenant_user_id,
          i.bank_account_id,
          i.total_amount,
          i.status
        FROM invoices i
        WHERE i.id = $1
        LIMIT 1
      `,
      [invoiceId]
    );

    const invoice = invoiceResult.rows[0];

    if (!invoice) {
      throw new Error("INVOICE_NOT_FOUND");
    }

    if (invoice.tenant_user_id !== userId) {
      throw new Error("INVOICE_NOT_BELONG_TO_TENANT");
    }

    if (!["unpaid", "overdue"].includes(invoice.status)) {
      throw new Error("INVOICE_NOT_PAYABLE");
    }

    const latestPaymentResult = await client.query(
      `
        SELECT
          id,
          status
        FROM payments
        WHERE invoice_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [invoiceId]
    );

    const latestPayment = latestPaymentResult.rows[0] || null;

    if (latestPayment && latestPayment.status !== "rejected") {
      throw new Error("INVOICE_NOT_PAYABLE");
    }

    let selectedBankAccountId = invoice.bank_account_id || null;

    if (!selectedBankAccountId && invoice.dorm_id) {
      const defaultBankAccount = await getDefaultBankAccountByDormId(
        invoice.dorm_id,
        client
      );
      selectedBankAccountId = defaultBankAccount?.id || null;
    }

    const insertResult = await client.query(
      `
        INSERT INTO payments (
          invoice_id,
          payer_user_id,
          bank_account_id,
          payment_method,
          submitted_amount,
          slip_image_url,
          reference_no,
          paid_at,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'submitted')
        RETURNING
          id AS payment_id,
          invoice_id,
          submitted_amount,
          slip_image_url,
          reference_no,
          paid_at,
          payment_method,
          status AS payment_status,
          reviewed_at,
          review_note,
          created_at,
          updated_at
      `,
      [
        invoiceId,
        userId,
        selectedBankAccountId,
        paymentMethod || "transfer",
        finalSubmittedAmount,
        String(slipImageUrl).trim(),
        hasValue(referenceNo) ? String(referenceNo).trim() : null,
        finalPaidAt,
      ]
    );

    await client.query(
      `
        UPDATE invoices
        SET
          status = 'pending_review',
          updated_at = now()
        WHERE id = $1
      `,
      [invoiceId]
    );

    await client.query("COMMIT");
    return insertResult.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* =========================
   Owner
   ========================= */

async function listOwnerPayments({ ownerUserId, dormId, query = {} }) {
  await ensureOwnerDorm(ownerUserId, dormId);

  const params = [dormId];
  const conditions = ["i.dorm_id = $1"];

  if (hasValue(query.month)) {
    params.push(query.month);
    conditions.push(`to_char(i.billing_month, 'YYYY-MM') = $${params.length}`);
  }

  if (hasValue(query.status) && query.status !== "all") {
    params.push(query.status);
    conditions.push(`i.status = $${params.length}`);
  }

  if (hasValue(query.search)) {
    params.push(`%${String(query.search).trim()}%`);
    conditions.push(`
      (
        r.room_number ILIKE $${params.length}
        OR b.display_name ILIKE $${params.length}
        OR b.building_code ILIKE $${params.length}
      )
    `);
  }

  const sql = `
    SELECT
      i.id AS invoice_id,
      i.billing_month,
      i.due_date,
      i.base_rent_amount,
      i.water_amount,
      i.electric_amount,
      i.other_amount,
      i.discount_amount,
      i.total_amount,
      i.status AS invoice_status,
      i.updated_at,

      r.id AS room_id,
      r.room_number,
      r.room_type,
      r.floor_no,
      r.tenant_name,

      b.id AS building_id,
      b.building_code,
      b.display_name AS building_name,

      lp.payment_id,
      lp.submitted_amount,
      lp.slip_image_url,
      lp.reference_no,
      lp.paid_at,
      lp.payment_method,
      lp.payment_status,
      lp.reviewed_at,
      lp.review_note,
      lp.payment_created_at,
      lp.payment_updated_at

    FROM invoices i
    JOIN rooms r
      ON r.id = i.room_id
    JOIN buildings b
      ON b.id = r.building_id
    LEFT JOIN LATERAL (
      SELECT
        p.id AS payment_id,
        p.invoice_id,
        p.submitted_amount,
        p.slip_image_url,
        p.reference_no,
        p.paid_at,
        p.payment_method,
        p.status AS payment_status,
        p.reviewed_at,
        p.review_note,
        p.created_at AS payment_created_at,
        p.updated_at AS payment_updated_at
      FROM payments p
      WHERE p.invoice_id = i.id
      ORDER BY p.created_at DESC
      LIMIT 1
    ) lp ON true

    WHERE ${conditions.join(" AND ")}
    ORDER BY i.billing_month DESC, b.sort_order ASC, r.floor_no ASC, r.room_number ASC
  `;

  const { rows } = await pool.query(sql, params);

  const summary = rows.reduce(
    (acc, row) => {
      const total = Number(row.total_amount || 0);

      if (row.invoice_status === "paid") {
        acc.paidCount += 1;
        acc.paidAmount += total;
      } else if (row.invoice_status === "pending_review") {
        acc.pendingCount += 1;
        acc.pendingAmount += total;
      } else if (row.invoice_status === "overdue") {
        acc.overdueCount += 1;
        acc.overdueAmount += total;
      }

      return acc;
    },
    {
      paidCount: 0,
      paidAmount: 0,
      pendingCount: 0,
      pendingAmount: 0,
      overdueCount: 0,
      overdueAmount: 0,
    }
  );

  return {
    items: rows,
    summary,
  };
}

async function getOwnerPaymentDetailByOwnerId({
  ownerUserId,
  dormId,
  paymentId,
}) {
  await ensureOwnerDorm(ownerUserId, dormId);

  const sql = `
    SELECT
      p.id AS payment_id,
      p.invoice_id,
      p.submitted_amount,
      p.slip_image_url,
      p.reference_no,
      p.paid_at,
      p.payment_method,
      p.status AS payment_status,
      p.reviewed_at,
      p.review_note,
      p.created_at,
      p.updated_at,

      i.billing_month,
      i.due_date,
      i.base_rent_amount,
      i.water_amount,
      i.electric_amount,
      i.other_amount,
      i.discount_amount,
      i.total_amount,
      i.status AS invoice_status,

      r.room_number,
      r.room_type,
      r.floor_no,
      r.tenant_name,

      b.display_name AS building_name,
      b.building_code

    FROM payments p
    JOIN invoices i
      ON i.id = p.invoice_id
    JOIN rooms r
      ON r.id = i.room_id
    JOIN buildings b
      ON b.id = r.building_id
    WHERE p.id = $1
      AND i.dorm_id = $2
    LIMIT 1
  `;

  const { rows } = await pool.query(sql, [paymentId, dormId]);
  return rows[0] || null;
}

async function approvePaymentByOwnerId({
  ownerUserId,
  dormId,
  paymentId,
  reviewNote,
}) {
  await ensureOwnerDorm(ownerUserId, dormId);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `
        SELECT
          p.id,
          p.invoice_id,
          p.status,
          i.dorm_id
        FROM payments p
        JOIN invoices i
          ON i.id = p.invoice_id
        WHERE p.id = $1
          AND i.dorm_id = $2
        LIMIT 1
      `,
      [paymentId, dormId]
    );

    if (!paymentResult.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const payment = paymentResult.rows[0];

    await client.query(
      `
        UPDATE payments
        SET
          status = 'approved',
          reviewed_by = $2,
          reviewed_at = now(),
          review_note = $3,
          updated_at = now()
        WHERE id = $1
      `,
      [paymentId, ownerUserId, hasValue(reviewNote) ? String(reviewNote).trim() : null]
    );

    await client.query(
      `
        UPDATE invoices
        SET
          status = 'paid',
          updated_at = now()
        WHERE id = $1
      `,
      [payment.invoice_id]
    );

    const updatedResult = await client.query(
      `
        SELECT
          p.id AS payment_id,
          p.invoice_id,
          p.status AS payment_status,
          p.reviewed_at,
          p.review_note,
          i.status AS invoice_status
        FROM payments p
        JOIN invoices i
          ON i.id = p.invoice_id
        WHERE p.id = $1
        LIMIT 1
      `,
      [paymentId]
    );

    await client.query("COMMIT");
    return updatedResult.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectPaymentByOwnerId({
  ownerUserId,
  dormId,
  paymentId,
  reviewNote,
}) {
  await ensureOwnerDorm(ownerUserId, dormId);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `
        SELECT
          p.id,
          p.invoice_id,
          p.status,
          i.dorm_id,
          i.due_date
        FROM payments p
        JOIN invoices i
          ON i.id = p.invoice_id
        WHERE p.id = $1
          AND i.dorm_id = $2
        LIMIT 1
      `,
      [paymentId, dormId]
    );

    if (!paymentResult.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const payment = paymentResult.rows[0];
    const today = new Date();
    const dueDate = payment.due_date ? new Date(payment.due_date) : null;

    let nextInvoiceStatus = "unpaid";
    if (dueDate && !Number.isNaN(dueDate.getTime())) {
      const dueDateOnly = new Date(dueDate);
      dueDateOnly.setHours(23, 59, 59, 999);

      if (today.getTime() > dueDateOnly.getTime()) {
        nextInvoiceStatus = "overdue";
      }
    }

    await client.query(
      `
        UPDATE payments
        SET
          status = 'rejected',
          reviewed_by = $2,
          reviewed_at = now(),
          review_note = $3,
          updated_at = now()
        WHERE id = $1
      `,
      [paymentId, ownerUserId, String(reviewNote).trim()]
    );

    await client.query(
      `
        UPDATE invoices
        SET
          status = $2,
          updated_at = now()
        WHERE id = $1
      `,
      [payment.invoice_id, nextInvoiceStatus]
    );

    const updatedResult = await client.query(
      `
        SELECT
          p.id AS payment_id,
          p.invoice_id,
          p.status AS payment_status,
          p.reviewed_at,
          p.review_note,
          i.status AS invoice_status
        FROM payments p
        JOIN invoices i
          ON i.id = p.invoice_id
        WHERE p.id = $1
        LIMIT 1
      `,
      [paymentId]
    );

    await client.query("COMMIT");
    return updatedResult.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getTenantBillingOverviewByUserId,
  createTenantPaymentSubmission,
  listOwnerPayments,
  getOwnerPaymentDetailByOwnerId,
  approvePaymentByOwnerId,
  rejectPaymentByOwnerId,
};