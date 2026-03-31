const { pool } = require("../config/db");

let tableColumnsCache = {};

function monthToDate(month) {
  return `${month}-01`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getResolvedInvoiceStatusSql(
  statusColumn = "status",
  dueDateColumn = "due_date"
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

async function getTableColumns(tableName) {
  if (tableColumnsCache[tableName]) {
    return tableColumnsCache[tableName];
  }

  const { rows } = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  const columns = new Set(rows.map((row) => row.column_name));
  tableColumnsCache[tableName] = columns;
  return columns;
}

async function getUserDisplayExpr(alias = "u") {
  const columns = await getTableColumns("users");
  const fallbacks = [];

  if (columns.has("first_name") && columns.has("last_name")) {
    fallbacks.push(
      `NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)), '')`
    );
  }

  if (columns.has("display_name")) {
    fallbacks.push(`NULLIF(${alias}.display_name, '')`);
  }

  if (columns.has("full_name")) {
    fallbacks.push(`NULLIF(${alias}.full_name, '')`);
  }

  if (columns.has("name")) {
    fallbacks.push(`NULLIF(${alias}.name, '')`);
  }

  if (columns.has("username")) {
    fallbacks.push(`NULLIF(${alias}.username, '')`);
  }

  if (columns.has("email")) {
    fallbacks.push(`NULLIF(${alias}.email, '')`);
  }

  fallbacks.push(`${alias}.id::text`);

  return `COALESCE(${fallbacks.join(", ")})`;
}

function normalizeBuildingSummaryRows(rows) {
  return rows.map((row) => ({
    buildingId: row.building_id,
    buildingCode: row.building_code,
    buildingName: row.building_name,
    sortOrder: Number(row.sort_order || 0),
    totalRooms: toNumber(row.total_rooms),
    occupiedRooms: toNumber(row.occupied_rooms),
    vacantRooms: toNumber(row.vacant_rooms),
    maintenanceRooms: toNumber(row.maintenance_rooms),
    reservedRooms: toNumber(row.reserved_rooms),
    occupancyRate: toNumber(row.occupancy_rate),
  }));
}

async function getOverview({ dormId, month }) {
  const monthDate = monthToDate(month);
  const resolvedStatusSql = getResolvedInvoiceStatusSql("i.status", "i.due_date");

  const roomSummaryQuery = pool.query(
    `
      SELECT
        COUNT(*)::int AS total_rooms,
        COUNT(*) FILTER (WHERE status = 'occupied')::int AS occupied_rooms,
        COUNT(*) FILTER (WHERE status = 'vacant')::int AS vacant_rooms,
        COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance_rooms,
        COUNT(*) FILTER (WHERE status = 'reserved')::int AS reserved_rooms,
        COALESCE(SUM(monthly_rent) FILTER (WHERE status = 'occupied'), 0)::double precision AS occupied_monthly_rent,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND((COUNT(*) FILTER (WHERE status = 'occupied')::numeric * 100.0) / COUNT(*), 2)
        END::double precision AS occupancy_rate
      FROM public.rooms
      WHERE dorm_id = $1
    `,
    [dormId]
  );

  const buildingSummaryQuery = pool.query(
    `
      SELECT
        b.id AS building_id,
        b.building_code,
        b.display_name AS building_name,
        b.sort_order,
        COUNT(r.id)::int AS total_rooms,
        COUNT(r.id) FILTER (WHERE r.status = 'occupied')::int AS occupied_rooms,
        COUNT(r.id) FILTER (WHERE r.status = 'vacant')::int AS vacant_rooms,
        COUNT(r.id) FILTER (WHERE r.status = 'maintenance')::int AS maintenance_rooms,
        COUNT(r.id) FILTER (WHERE r.status = 'reserved')::int AS reserved_rooms,
        CASE
          WHEN COUNT(r.id) = 0 THEN 0
          ELSE ROUND((COUNT(r.id) FILTER (WHERE r.status = 'occupied')::numeric * 100.0) / COUNT(r.id), 2)
        END::double precision AS occupancy_rate
      FROM public.buildings b
      LEFT JOIN public.rooms r
        ON r.building_id = b.id
       AND r.dorm_id = b.dorm_id
      WHERE b.dorm_id = $1
      GROUP BY b.id, b.building_code, b.display_name, b.sort_order
      ORDER BY b.sort_order ASC, b.display_name ASC
    `,
    [dormId]
  );

  const financeSummaryQuery = pool.query(
    `
      WITH invoice_base AS (
        SELECT
          i.*,
          ${resolvedStatusSql} AS resolved_status
        FROM public.invoices i
        WHERE i.dorm_id = $1
          AND DATE_TRUNC('month', i.billing_month) = DATE_TRUNC('month', $2::date)
      ),
      payment_base AS (
        SELECT p.*
        FROM public.payments p
        INNER JOIN invoice_base i ON i.id = p.invoice_id
      )
      SELECT
        COUNT(*)::int AS total_invoices,
        COALESCE(SUM(total_amount), 0)::double precision AS total_billed_amount,

        COUNT(*) FILTER (WHERE resolved_status = 'paid')::int AS paid_invoice_count,
        COUNT(*) FILTER (WHERE resolved_status = 'pending_review')::int AS pending_review_invoice_count,
        COUNT(*) FILTER (WHERE resolved_status = 'unpaid')::int AS unpaid_invoice_count,
        COUNT(*) FILTER (WHERE resolved_status = 'overdue')::int AS overdue_invoice_count,
        COUNT(*) FILTER (WHERE resolved_status IN ('unpaid', 'overdue'))::int AS outstanding_invoice_count,
        COUNT(*) FILTER (WHERE resolved_status = 'cancelled')::int AS cancelled_invoice_count,

        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status = 'paid'), 0)::double precision AS paid_invoice_amount,
        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status = 'pending_review'), 0)::double precision AS pending_review_invoice_amount,
        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status = 'unpaid'), 0)::double precision AS unpaid_invoice_amount,
        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status = 'overdue'), 0)::double precision AS overdue_invoice_amount,
        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status IN ('unpaid', 'overdue')), 0)::double precision AS outstanding_invoice_amount,

        COALESCE(SUM(base_rent_amount), 0)::double precision AS base_rent_total,
        COALESCE(SUM(water_amount), 0)::double precision AS water_total,
        COALESCE(SUM(electric_amount), 0)::double precision AS electric_total,
        COALESCE(SUM(other_amount), 0)::double precision AS other_total,
        COALESCE(SUM(discount_amount), 0)::double precision AS discount_total,

        COALESCE((SELECT SUM(submitted_amount) FROM payment_base WHERE status = 'approved'), 0)::double precision AS approved_payment_amount,
        COALESCE((SELECT SUM(submitted_amount) FROM payment_base WHERE status = 'submitted'), 0)::double precision AS submitted_payment_amount,
        COALESCE((SELECT SUM(submitted_amount) FROM payment_base WHERE status = 'rejected'), 0)::double precision AS rejected_payment_amount,
        COALESCE((SELECT COUNT(*) FROM payment_base WHERE status = 'submitted'), 0)::int AS submitted_payment_count,
        COALESCE((SELECT COUNT(*) FROM payment_base WHERE status = 'rejected'), 0)::int AS rejected_payment_count
      FROM invoice_base
    `,
    [dormId, monthDate]
  );

  const contractSummaryQuery = pool.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_contract_count,
        COUNT(*) FILTER (
          WHERE status = 'active'
            AND end_date IS NOT NULL
            AND end_date >= CURRENT_DATE
            AND end_date <= CURRENT_DATE + (30 * INTERVAL '1 day')
        )::int AS expiring_in_30_days_count
      FROM public.rental_contracts
      WHERE dorm_id = $1
    `,
    [dormId]
  );

  const [
    roomSummaryResult,
    buildingSummaryResult,
    financeSummaryResult,
    contractSummaryResult,
  ] = await Promise.all([
    roomSummaryQuery,
    buildingSummaryQuery,
    financeSummaryQuery,
    contractSummaryQuery,
  ]);

  const roomSummary = roomSummaryResult.rows[0] || {};
  const financeSummary = financeSummaryResult.rows[0] || {};
  const contractSummary = contractSummaryResult.rows[0] || {};

  return {
    month,
    rooms: {
      total: toNumber(roomSummary.total_rooms),
      occupied: toNumber(roomSummary.occupied_rooms),
      vacant: toNumber(roomSummary.vacant_rooms),
      maintenance: toNumber(roomSummary.maintenance_rooms),
      reserved: toNumber(roomSummary.reserved_rooms),
      occupiedMonthlyRent: toNumber(roomSummary.occupied_monthly_rent),
      occupancyRate: toNumber(roomSummary.occupancy_rate),
    },
    buildings: normalizeBuildingSummaryRows(buildingSummaryResult.rows || []),
    invoices: {
      totalInvoices: toNumber(financeSummary.total_invoices),
      totalBilledAmount: toNumber(financeSummary.total_billed_amount),
      paidInvoiceCount: toNumber(financeSummary.paid_invoice_count),
      pendingReviewInvoiceCount: toNumber(financeSummary.pending_review_invoice_count),
      unpaidInvoiceCount: toNumber(financeSummary.unpaid_invoice_count),
      overdueInvoiceCount: toNumber(financeSummary.overdue_invoice_count),
      outstandingInvoiceCount: toNumber(financeSummary.outstanding_invoice_count),
      cancelledInvoiceCount: toNumber(financeSummary.cancelled_invoice_count),
      paidInvoiceAmount: toNumber(financeSummary.paid_invoice_amount),
      pendingReviewInvoiceAmount: toNumber(financeSummary.pending_review_invoice_amount),
      unpaidInvoiceAmount: toNumber(financeSummary.unpaid_invoice_amount),
      overdueInvoiceAmount: toNumber(financeSummary.overdue_invoice_amount),
      outstandingInvoiceAmount: toNumber(financeSummary.outstanding_invoice_amount),
      baseRentTotal: toNumber(financeSummary.base_rent_total),
      waterTotal: toNumber(financeSummary.water_total),
      electricTotal: toNumber(financeSummary.electric_total),
      otherTotal: toNumber(financeSummary.other_total),
      discountTotal: toNumber(financeSummary.discount_total),
    },
    payments: {
      approvedPaymentAmount: toNumber(financeSummary.approved_payment_amount),
      submittedPaymentAmount: toNumber(financeSummary.submitted_payment_amount),
      rejectedPaymentAmount: toNumber(financeSummary.rejected_payment_amount),
      submittedPaymentCount: toNumber(financeSummary.submitted_payment_count),
      rejectedPaymentCount: toNumber(financeSummary.rejected_payment_count),
      collectionRate:
        toNumber(financeSummary.total_billed_amount) > 0
          ? Number(
              (
                (toNumber(financeSummary.approved_payment_amount) /
                  toNumber(financeSummary.total_billed_amount)) *
                100
              ).toFixed(2)
            )
          : 0,
    },
    contracts: {
      activeCount: toNumber(contractSummary.active_contract_count),
      expiringIn30DaysCount: toNumber(contractSummary.expiring_in_30_days_count),
    },
    alerts: {
      pendingReviewInvoices: toNumber(financeSummary.pending_review_invoice_count),
      unpaidInvoices: toNumber(financeSummary.unpaid_invoice_count),
      overdueInvoices: toNumber(financeSummary.overdue_invoice_count),
      submittedPayments: toNumber(financeSummary.submitted_payment_count),
      rejectedPayments: toNumber(financeSummary.rejected_payment_count),
      expiringContracts: toNumber(contractSummary.expiring_in_30_days_count),
    },
  };
}

async function getRevenueTrend({ dormId, months }) {
  const { rows } = await pool.query(
    `
      WITH month_series AS (
        SELECT
          GENERATE_SERIES(
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month'),
            DATE_TRUNC('month', CURRENT_DATE),
            INTERVAL '1 month'
          )::date AS month_bucket
      ),
      invoice_agg AS (
        SELECT
          DATE_TRUNC('month', billing_month)::date AS month_bucket,
          COALESCE(SUM(total_amount), 0)::double precision AS billed_amount,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0)::double precision AS paid_invoice_amount,
          COALESCE(SUM(total_amount) FILTER (WHERE status IN ('unpaid', 'overdue')), 0)::double precision AS outstanding_amount
        FROM public.invoices
        WHERE dorm_id = $1
          AND billing_month >= (
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month')
          )::date
          AND billing_month < (
            DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
          )::date
        GROUP BY 1
      ),
      payment_agg AS (
        SELECT
          DATE_TRUNC('month', i.billing_month)::date AS month_bucket,
          COALESCE(SUM(p.submitted_amount) FILTER (WHERE p.status = 'approved'), 0)::double precision AS approved_payment_amount
        FROM public.invoices i
        LEFT JOIN public.payments p ON p.invoice_id = i.id
        WHERE i.dorm_id = $1
          AND i.billing_month >= (
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month')
          )::date
          AND i.billing_month < (
            DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
          )::date
        GROUP BY 1
      )
      SELECT
        TO_CHAR(ms.month_bucket, 'YYYY-MM') AS month,
        COALESCE(ia.billed_amount, 0)::double precision AS billed_amount,
        COALESCE(ia.paid_invoice_amount, 0)::double precision AS paid_invoice_amount,
        COALESCE(ia.outstanding_amount, 0)::double precision AS outstanding_amount,
        COALESCE(pa.approved_payment_amount, 0)::double precision AS approved_payment_amount
      FROM month_series ms
      LEFT JOIN invoice_agg ia ON ia.month_bucket = ms.month_bucket
      LEFT JOIN payment_agg pa ON pa.month_bucket = ms.month_bucket
      ORDER BY ms.month_bucket ASC
    `,
    [dormId, months]
  );

  return rows.map((row) => ({
    month: row.month,
    billedAmount: toNumber(row.billed_amount),
    paidInvoiceAmount: toNumber(row.paid_invoice_amount),
    outstandingAmount: toNumber(row.outstanding_amount),
    approvedPaymentAmount: toNumber(row.approved_payment_amount),
  }));
}

async function getPaymentStatus({ dormId, month }) {
  const monthDate = monthToDate(month);
  const resolvedStatusSql = getResolvedInvoiceStatusSql(
    "i.status",
    "i.due_date"
  );

  const { rows } = await pool.query(
    `
      WITH invoice_base AS (
        SELECT
          i.*,
          ${resolvedStatusSql} AS resolved_status
        FROM public.invoices i
        WHERE i.dorm_id = $1
          AND DATE_TRUNC('month', i.billing_month) = DATE_TRUNC('month', $2::date)
      )
      SELECT
        COUNT(*)::int AS total_invoices,
        COALESCE(SUM(total_amount), 0)::double precision AS total_amount,

        COUNT(*) FILTER (WHERE resolved_status = 'paid')::int AS paid_count,
        COUNT(*) FILTER (WHERE resolved_status = 'pending_review')::int AS pending_count,
        COUNT(*) FILTER (WHERE resolved_status = 'unpaid')::int AS unpaid_count,
        COUNT(*) FILTER (WHERE resolved_status = 'overdue')::int AS overdue_count,
        COUNT(*) FILTER (WHERE resolved_status IN ('unpaid', 'overdue'))::int AS outstanding_count,

        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status = 'paid'), 0)::double precision AS paid_amount,
        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status = 'pending_review'), 0)::double precision AS pending_amount,
        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status = 'unpaid'), 0)::double precision AS unpaid_amount,
        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status = 'overdue'), 0)::double precision AS overdue_amount,
        COALESCE(SUM(total_amount) FILTER (WHERE resolved_status IN ('unpaid', 'overdue')), 0)::double precision AS outstanding_amount
      FROM invoice_base
    `,
    [dormId, monthDate]
  );

  const summary = rows[0] || {};
  const totalAmount = toNumber(summary.total_amount);

  const items = [
    {
      key: "paid",
      label: "ชำระแล้ว",
      count: toNumber(summary.paid_count),
      amount: toNumber(summary.paid_amount),
    },
    {
      key: "pending_review",
      label: "รอตรวจสอบ",
      count: toNumber(summary.pending_count),
      amount: toNumber(summary.pending_amount),
    },
    {
      key: "unpaid",
      label: "ยังไม่ชำระ",
      count: toNumber(summary.unpaid_count),
      amount: toNumber(summary.unpaid_amount),
    },
    {
      key: "overdue",
      label: "เกินกำหนดชำระ",
      count: toNumber(summary.overdue_count),
      amount: toNumber(summary.overdue_amount),
    },
  ].map((item) => ({
    ...item,
    percent:
      totalAmount > 0 ? Number(((item.amount / totalAmount) * 100).toFixed(2)) : 0,
  }));

  return {
    month,
    totalInvoices: toNumber(summary.total_invoices),
    totalAmount,

    paidCount: toNumber(summary.paid_count),
    pendingCount: toNumber(summary.pending_count),
    unpaidCount: toNumber(summary.unpaid_count),
    overdueCount: toNumber(summary.overdue_count),
    outstandingCount: toNumber(summary.outstanding_count),

    paidAmount: toNumber(summary.paid_amount),
    pendingAmount: toNumber(summary.pending_amount),
    unpaidAmount: toNumber(summary.unpaid_amount),
    overdueAmount: toNumber(summary.overdue_amount),
    outstandingAmount: toNumber(summary.outstanding_amount),

    items,
  };
}

async function getTenantMovement({ dormId, months }) {
  const { rows } = await pool.query(
    `
      WITH month_series AS (
        SELECT
          GENERATE_SERIES(
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month'),
            DATE_TRUNC('month', CURRENT_DATE),
            INTERVAL '1 month'
          )::date AS month_bucket
      ),
      move_in_agg AS (
        SELECT
          DATE_TRUNC('month', move_in_date)::date AS month_bucket,
          COUNT(*)::int AS move_in_count
        FROM public.rental_contracts
        WHERE dorm_id = $1
          AND move_in_date IS NOT NULL
          AND move_in_date >= (
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month')
          )::date
          AND move_in_date < (
            DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
          )::date
        GROUP BY 1
      ),
      move_out_agg AS (
        SELECT
          DATE_TRUNC('month', move_out_date)::date AS month_bucket,
          COUNT(*)::int AS move_out_count
        FROM public.rental_contracts
        WHERE dorm_id = $1
          AND move_out_date IS NOT NULL
          AND move_out_date >= (
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month')
          )::date
          AND move_out_date < (
            DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
          )::date
        GROUP BY 1
      )
      SELECT
        TO_CHAR(ms.month_bucket, 'YYYY-MM') AS month,
        COALESCE(mi.move_in_count, 0)::int AS move_in_count,
        COALESCE(mo.move_out_count, 0)::int AS move_out_count
      FROM month_series ms
      LEFT JOIN move_in_agg mi ON mi.month_bucket = ms.month_bucket
      LEFT JOIN move_out_agg mo ON mo.month_bucket = ms.month_bucket
      ORDER BY ms.month_bucket ASC
    `,
    [dormId, months]
  );

  return rows.map((row) => ({
    month: row.month,
    moveInCount: toNumber(row.move_in_count),
    moveOutCount: toNumber(row.move_out_count),
  }));
}

async function getUtilityUsageTrend({ dormId, months }) {
  const { rows } = await pool.query(
    `
      WITH month_series AS (
        SELECT
          GENERATE_SERIES(
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month'),
            DATE_TRUNC('month', CURRENT_DATE),
            INTERVAL '1 month'
          )::date AS month_bucket
      ),
      invoice_agg AS (
        SELECT
          DATE_TRUNC('month', billing_month)::date AS month_bucket,
          COALESCE(SUM(water_units), 0)::double precision AS total_water_units,
          COALESCE(SUM(electric_units), 0)::double precision AS total_electric_units,
          COALESCE(SUM(water_amount), 0)::double precision AS total_water_amount,
          COALESCE(SUM(electric_amount), 0)::double precision AS total_electric_amount,
          COUNT(*)::int AS total_invoices
        FROM public.invoices
        WHERE dorm_id = $1
          AND billing_month >= (
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month')
          )::date
          AND billing_month < (
            DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
          )::date
        GROUP BY 1
      )
      SELECT
        TO_CHAR(ms.month_bucket, 'YYYY-MM') AS month,
        COALESCE(ia.total_water_units, 0)::double precision AS total_water_units,
        COALESCE(ia.total_electric_units, 0)::double precision AS total_electric_units,
        COALESCE(ia.total_water_amount, 0)::double precision AS total_water_amount,
        COALESCE(ia.total_electric_amount, 0)::double precision AS total_electric_amount,
        COALESCE(ia.total_invoices, 0)::int AS total_invoices,
        CASE
          WHEN COALESCE(ia.total_invoices, 0) > 0
          THEN ROUND((ia.total_water_units / ia.total_invoices)::numeric, 2)::double precision
          ELSE 0
        END AS avg_water_units,
        CASE
          WHEN COALESCE(ia.total_invoices, 0) > 0
          THEN ROUND((ia.total_electric_units / ia.total_invoices)::numeric, 2)::double precision
          ELSE 0
        END AS avg_electric_units
      FROM month_series ms
      LEFT JOIN invoice_agg ia ON ia.month_bucket = ms.month_bucket
      ORDER BY ms.month_bucket ASC
    `,
    [dormId, months]
  );

  return rows.map((row) => ({
    month: row.month,
    totalWaterUnits: toNumber(row.total_water_units),
    totalElectricUnits: toNumber(row.total_electric_units),
    totalWaterAmount: toNumber(row.total_water_amount),
    totalElectricAmount: toNumber(row.total_electric_amount),
    totalInvoices: toNumber(row.total_invoices),
    avgWaterUnits: toNumber(row.avg_water_units),
    avgElectricUnits: toNumber(row.avg_electric_units),
  }));
}

async function getExpiringContracts({ dormId, days }) {
  const userDisplayExpr = await getUserDisplayExpr("u");

  const { rows } = await pool.query(
    `
      SELECT
        rc.id AS contract_id,
        rc.contract_number,
        rc.start_date,
        rc.end_date,
        rc.move_in_date,
        rc.move_out_date,
        rc.status AS contract_status,
        rc.rent_amount::double precision AS rent_amount,
        r.id AS room_id,
        r.room_number,
        b.id AS building_id,
        b.display_name AS building_name,
        ${userDisplayExpr} AS tenant_name,
        GREATEST((rc.end_date - CURRENT_DATE), 0)::int AS days_remaining
      FROM public.rental_contracts rc
      INNER JOIN public.rooms r ON r.id = rc.room_id
      INNER JOIN public.buildings b ON b.id = r.building_id
      INNER JOIN public.users u ON u.id = rc.tenant_user_id
      WHERE rc.dorm_id = $1
        AND rc.status = 'active'
        AND rc.end_date IS NOT NULL
        AND rc.end_date >= CURRENT_DATE
        AND rc.end_date <= CURRENT_DATE + ($2::int * INTERVAL '1 day')
      ORDER BY rc.end_date ASC, b.sort_order ASC, r.room_number ASC
    `,
    [dormId, days]
  );

  return rows.map((row) => ({
    contractId: row.contract_id,
    contractNumber: row.contract_number,
    startDate: row.start_date,
    endDate: row.end_date,
    moveInDate: row.move_in_date,
    moveOutDate: row.move_out_date,
    contractStatus: row.contract_status,
    rentAmount: toNumber(row.rent_amount),
    roomId: row.room_id,
    roomNumber: row.room_number,
    buildingId: row.building_id,
    buildingName: row.building_name,
    tenantName: row.tenant_name,
    daysRemaining: toNumber(row.days_remaining),
  }));
}

async function getInvoiceReport({ dormId, month, buildingId, status }) {
  const monthDate = monthToDate(month);
  const userDisplayExpr = await getUserDisplayExpr("u");

  const params = [dormId, monthDate];
  const conditions = [
    `i.dorm_id = $1`,
    `DATE_TRUNC('month', i.billing_month) = DATE_TRUNC('month', $2::date)`,
  ];

  if (buildingId) {
    params.push(buildingId);
    conditions.push(`r.building_id = $${params.length}`);
  }

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`i.status = $${params.length}`);
  }

  const { rows } = await pool.query(
    `
      SELECT
        i.id AS invoice_id,
        i.billing_month,
        i.due_date,
        i.status AS invoice_status,
        i.base_rent_amount::double precision AS base_rent_amount,
        i.water_units::double precision AS water_units,
        i.water_rate::double precision AS water_rate,
        i.water_amount::double precision AS water_amount,
        i.electric_units::double precision AS electric_units,
        i.electric_rate::double precision AS electric_rate,
        i.electric_amount::double precision AS electric_amount,
        i.other_amount::double precision AS other_amount,
        i.discount_amount::double precision AS discount_amount,
        i.total_amount::double precision AS total_amount,
        i.generated_at,
        i.updated_at,
        r.id AS room_id,
        r.room_number,
        b.id AS building_id,
        b.display_name AS building_name,
        b.building_code,
        ${userDisplayExpr} AS tenant_name
      FROM public.invoices i
      INNER JOIN public.rooms r ON r.id = i.room_id
      INNER JOIN public.buildings b ON b.id = r.building_id
      INNER JOIN public.users u ON u.id = i.tenant_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY b.sort_order ASC, r.room_number ASC, i.due_date ASC
    `,
    params
  );

  return rows.map((row) => ({
    invoiceId: row.invoice_id,
    billingMonth: row.billing_month,
    dueDate: row.due_date,
    invoiceStatus: row.invoice_status,
    baseRentAmount: toNumber(row.base_rent_amount),
    waterUnits: toNumber(row.water_units),
    waterRate: toNumber(row.water_rate),
    waterAmount: toNumber(row.water_amount),
    electricUnits: toNumber(row.electric_units),
    electricRate: toNumber(row.electric_rate),
    electricAmount: toNumber(row.electric_amount),
    otherAmount: toNumber(row.other_amount),
    discountAmount: toNumber(row.discount_amount),
    totalAmount: toNumber(row.total_amount),
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    roomId: row.room_id,
    roomNumber: row.room_number,
    buildingId: row.building_id,
    buildingName: row.building_name,
    buildingCode: row.building_code,
    tenantName: row.tenant_name,
  }));
}

async function getPaymentReport({ dormId, month, buildingId, status }) {
  const monthDate = monthToDate(month);
  const userDisplayExpr = await getUserDisplayExpr("u");

  const params = [dormId, monthDate];
  const conditions = [
    `i.dorm_id = $1`,
    `DATE_TRUNC('month', i.billing_month) = DATE_TRUNC('month', $2::date)`,
  ];

  if (buildingId) {
    params.push(buildingId);
    conditions.push(`r.building_id = $${params.length}`);
  }

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }

  const { rows } = await pool.query(
    `
      SELECT
        p.id AS payment_id,
        p.invoice_id,
        p.payment_method,
        p.submitted_amount::double precision AS submitted_amount,
        p.slip_image_url,
        p.reference_no,
        p.paid_at,
        p.status AS payment_status,
        p.reviewed_at,
        p.review_note,
        p.created_at,
        i.billing_month,
        i.due_date,
        i.status AS invoice_status,
        i.total_amount::double precision AS invoice_total_amount,
        r.id AS room_id,
        r.room_number,
        b.id AS building_id,
        b.display_name AS building_name,
        b.building_code,
        ${userDisplayExpr} AS tenant_name
      FROM public.payments p
      INNER JOIN public.invoices i ON i.id = p.invoice_id
      INNER JOIN public.rooms r ON r.id = i.room_id
      INNER JOIN public.buildings b ON b.id = r.building_id
      INNER JOIN public.users u ON u.id = i.tenant_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY p.created_at DESC, b.sort_order ASC, r.room_number ASC
    `,
    params
  );

  return rows.map((row) => ({
    paymentId: row.payment_id,
    invoiceId: row.invoice_id,
    paymentMethod: row.payment_method,
    submittedAmount: toNumber(row.submitted_amount),
    slipImageUrl: row.slip_image_url,
    referenceNo: row.reference_no,
    paidAt: row.paid_at,
    paymentStatus: row.payment_status,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    billingMonth: row.billing_month,
    dueDate: row.due_date,
    invoiceStatus: row.invoice_status,
    invoiceTotalAmount: toNumber(row.invoice_total_amount),
    roomId: row.room_id,
    roomNumber: row.room_number,
    buildingId: row.building_id,
    buildingName: row.building_name,
    buildingCode: row.building_code,
    tenantName: row.tenant_name,
  }));
}

async function getArrearsReport({ dormId, month, buildingId }) {
  const monthDate = monthToDate(month);
  const userDisplayExpr = await getUserDisplayExpr("u");

  const params = [dormId, monthDate];
  const conditions = [
    `i.dorm_id = $1`,
    `DATE_TRUNC('month', i.billing_month) = DATE_TRUNC('month', $2::date)`,
    `i.status IN ('unpaid', 'overdue')`,
  ];

  if (buildingId) {
    params.push(buildingId);
    conditions.push(`r.building_id = $${params.length}`);
  }

  const { rows } = await pool.query(
    `
      SELECT
        i.id AS invoice_id,
        i.billing_month,
        i.due_date,
        i.status AS invoice_status,
        i.total_amount::double precision AS total_amount,
        i.base_rent_amount::double precision AS base_rent_amount,
        i.water_amount::double precision AS water_amount,
        i.electric_amount::double precision AS electric_amount,
        i.other_amount::double precision AS other_amount,
        i.discount_amount::double precision AS discount_amount,
        r.id AS room_id,
        r.room_number,
        b.id AS building_id,
        b.display_name AS building_name,
        b.building_code,
        ${userDisplayExpr} AS tenant_name,
        GREATEST((CURRENT_DATE - i.due_date), 0)::int AS days_overdue
      FROM public.invoices i
      INNER JOIN public.rooms r ON r.id = i.room_id
      INNER JOIN public.buildings b ON b.id = r.building_id
      INNER JOIN public.users u ON u.id = i.tenant_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY days_overdue DESC, b.sort_order ASC, r.room_number ASC
    `,
    params
  );

  return rows.map((row) => ({
    invoiceId: row.invoice_id,
    billingMonth: row.billing_month,
    dueDate: row.due_date,
    invoiceStatus: row.invoice_status,
    totalAmount: toNumber(row.total_amount),
    baseRentAmount: toNumber(row.base_rent_amount),
    waterAmount: toNumber(row.water_amount),
    electricAmount: toNumber(row.electric_amount),
    otherAmount: toNumber(row.other_amount),
    discountAmount: toNumber(row.discount_amount),
    roomId: row.room_id,
    roomNumber: row.room_number,
    buildingId: row.building_id,
    buildingName: row.building_name,
    buildingCode: row.building_code,
    tenantName: row.tenant_name,
    daysOverdue: toNumber(row.days_overdue),
  }));
}

async function getMonthlyRevenueSummaryReport({ dormId, months }) {
  const { rows } = await pool.query(
    `
      WITH month_series AS (
        SELECT
          GENERATE_SERIES(
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month'),
            DATE_TRUNC('month', CURRENT_DATE),
            INTERVAL '1 month'
          )::date AS month_bucket
      ),
      invoice_agg AS (
        SELECT
          DATE_TRUNC('month', billing_month)::date AS month_bucket,
          COUNT(*)::int AS total_invoices,
          COALESCE(SUM(total_amount), 0)::double precision AS total_billed_amount,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0)::double precision AS paid_invoice_amount,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'pending_review'), 0)::double precision AS pending_review_amount,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'unpaid'), 0)::double precision AS unpaid_amount,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'overdue'), 0)::double precision AS overdue_amount,
          COALESCE(SUM(total_amount) FILTER (WHERE status IN ('unpaid', 'overdue')), 0)::double precision AS outstanding_amount,
          COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_invoice_count,
          COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending_review_count,
          COUNT(*) FILTER (WHERE status = 'unpaid')::int AS unpaid_count,
          COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue_count,
          COUNT(*) FILTER (WHERE status IN ('unpaid', 'overdue'))::int AS outstanding_count
        FROM public.invoices
        WHERE dorm_id = $1
          AND billing_month >= (
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month')
          )::date
          AND billing_month < (
            DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
          )::date
        GROUP BY 1
      ),
      payment_agg AS (
        SELECT
          DATE_TRUNC('month', i.billing_month)::date AS month_bucket,
          COALESCE(SUM(p.submitted_amount) FILTER (WHERE p.status = 'approved'), 0)::double precision AS approved_payment_amount,
          COALESCE(SUM(p.submitted_amount) FILTER (WHERE p.status = 'submitted'), 0)::double precision AS submitted_payment_amount,
          COALESCE(SUM(p.submitted_amount) FILTER (WHERE p.status = 'rejected'), 0)::double precision AS rejected_payment_amount,
          COUNT(*) FILTER (WHERE p.status = 'approved')::int AS approved_payment_count,
          COUNT(*) FILTER (WHERE p.status = 'submitted')::int AS submitted_payment_count,
          COUNT(*) FILTER (WHERE p.status = 'rejected')::int AS rejected_payment_count
        FROM public.invoices i
        LEFT JOIN public.payments p ON p.invoice_id = i.id
        WHERE i.dorm_id = $1
          AND i.billing_month >= (
            DATE_TRUNC('month', CURRENT_DATE) - (($2::int - 1) * INTERVAL '1 month')
          )::date
          AND i.billing_month < (
            DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
          )::date
        GROUP BY 1
      )
      SELECT
        TO_CHAR(ms.month_bucket, 'YYYY-MM') AS month,
        COALESCE(ia.total_invoices, 0)::int AS total_invoices,
        COALESCE(ia.total_billed_amount, 0)::double precision AS total_billed_amount,
        COALESCE(ia.paid_invoice_amount, 0)::double precision AS paid_invoice_amount,
        COALESCE(ia.pending_review_amount, 0)::double precision AS pending_review_amount,
        COALESCE(ia.unpaid_amount, 0)::double precision AS unpaid_amount,
        COALESCE(ia.overdue_amount, 0)::double precision AS overdue_amount,
        COALESCE(ia.outstanding_amount, 0)::double precision AS outstanding_amount,
        COALESCE(ia.paid_invoice_count, 0)::int AS paid_invoice_count,
        COALESCE(ia.pending_review_count, 0)::int AS pending_review_count,
        COALESCE(ia.unpaid_count, 0)::int AS unpaid_count,
        COALESCE(ia.overdue_count, 0)::int AS overdue_count,
        COALESCE(ia.outstanding_count, 0)::int AS outstanding_count,
        COALESCE(pa.approved_payment_amount, 0)::double precision AS approved_payment_amount,
        COALESCE(pa.submitted_payment_amount, 0)::double precision AS submitted_payment_amount,
        COALESCE(pa.rejected_payment_amount, 0)::double precision AS rejected_payment_amount,
        COALESCE(pa.approved_payment_count, 0)::int AS approved_payment_count,
        COALESCE(pa.submitted_payment_count, 0)::int AS submitted_payment_count,
        COALESCE(pa.rejected_payment_count, 0)::int AS rejected_payment_count,
        CASE
          WHEN COALESCE(ia.total_billed_amount, 0) > 0
          THEN ROUND(
            ((COALESCE(pa.approved_payment_amount, 0) / ia.total_billed_amount) * 100.0)::numeric,
            2
          )::double precision
          ELSE 0
        END AS collection_rate
      FROM month_series ms
      LEFT JOIN invoice_agg ia ON ia.month_bucket = ms.month_bucket
      LEFT JOIN payment_agg pa ON pa.month_bucket = ms.month_bucket
      ORDER BY ms.month_bucket ASC
    `,
    [dormId, months]
  );

  return rows.map((row) => ({
    month: row.month,
    totalInvoices: toNumber(row.total_invoices),
    totalBilledAmount: toNumber(row.total_billed_amount),
    paidInvoiceAmount: toNumber(row.paid_invoice_amount),
    pendingReviewAmount: toNumber(row.pending_review_amount),
    unpaidAmount: toNumber(row.unpaid_amount),
    overdueAmount: toNumber(row.overdue_amount),
    outstandingAmount: toNumber(row.outstanding_amount),
    paidInvoiceCount: toNumber(row.paid_invoice_count),
    pendingReviewCount: toNumber(row.pending_review_count),
    unpaidCount: toNumber(row.unpaid_count),
    overdueCount: toNumber(row.overdue_count),
    outstandingCount: toNumber(row.outstanding_count),
    approvedPaymentAmount: toNumber(row.approved_payment_amount),
    submittedPaymentAmount: toNumber(row.submitted_payment_amount),
    rejectedPaymentAmount: toNumber(row.rejected_payment_amount),
    approvedPaymentCount: toNumber(row.approved_payment_count),
    submittedPaymentCount: toNumber(row.submitted_payment_count),
    rejectedPaymentCount: toNumber(row.rejected_payment_count),
    collectionRate: toNumber(row.collection_rate),
  }));
}

module.exports = {
  getOverview,
  getRevenueTrend,
  getPaymentStatus,
  getTenantMovement,
  getUtilityUsageTrend,
  getExpiringContracts,
  getInvoiceReport,
  getPaymentReport,
  getArrearsReport,
  getMonthlyRevenueSummaryReport,
};