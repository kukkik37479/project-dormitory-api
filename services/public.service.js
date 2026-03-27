const { pool } = require("../config/db");

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return num;
}

function normalizeSearch(value) {
  return String(value || "").trim();
}

function mapDormCard(row) {
  return {
    id: row.id,
    dorm_slug: row.dorm_slug,
    name: row.name,
    name_en: row.name_en,
    phone: row.phone,
    full_address: row.full_address,
    subdistrict: row.subdistrict,
    district: row.district,
    province: row.province,
    description: row.description,
    contact_name: row.contact_name,
    contact_email: row.contact_email,
    line_id: row.line_id,
    water_rate: toNumber(row.water_rate, 0),
    electric_rate: toNumber(row.electric_rate, 0),
    total_rooms: toNumber(row.total_rooms, 0),
    vacant_rooms: toNumber(row.vacant_rooms, 0),
    price_min: toNullableNumber(row.price_min),
    price_max: toNullableNumber(row.price_max),
    cover_image: row.cover_image || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRoomType(row) {
  return {
    id: row.id,
    dorm_id: row.dorm_id,
    type_name: row.type_name,
    room_layout: row.room_layout,
    size_sqm: toNullableNumber(row.size_sqm),
    price_min: toNumber(row.price_min, 0),
    price_max: toNumber(row.price_max, 0),
    sort_order: toNumber(row.sort_order, 0),
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapVacantRoom(row) {
  return {
    id: row.id,
    dorm_id: row.dorm_id,
    dorm_slug: row.dorm_slug,
    dorm_name: row.dorm_name,
    dorm_phone: row.dorm_phone,
    dorm_full_address: row.dorm_full_address,
    dorm_cover_image: row.dorm_cover_image || null,
    building_name: row.building_name || null,
    room_number: row.room_number,
    floor_no: toNumber(row.floor_no, 0),
    monthly_rent: toNumber(row.monthly_rent, 0),
    room_type: row.room_type,
    status: row.status,
    note: row.note,
  };
}

function mapReview(row) {
  return {
    id: row.id,
    dorm_id: row.dorm_id,
    room_id: row.room_id,
    tenant_user_id: row.tenant_user_id,
    rating: toNumber(row.rating, 0),
    comment: row.comment,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewer_name: row.reviewer_name || "ผู้เช่า",
    room_number: row.room_number || null,
    building_name: row.building_name || null,
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

async function getDormImagesByDormId(client, dormId) {
  const result = await client.query(
    `
    SELECT
      id,
      dorm_id,
      image_url,
      public_id,
      sort_order,
      is_cover,
      created_at,
      updated_at
    FROM public.dorm_images
    WHERE dorm_id = $1
    ORDER BY is_cover DESC, sort_order ASC, created_at ASC
    `,
    [dormId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    dorm_id: row.dorm_id,
    image_url: row.image_url,
    public_id: row.public_id,
    sort_order: toNumber(row.sort_order, 0),
    is_cover: Boolean(row.is_cover),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function getDormContactPhonesByDormId(client, dormId) {
  const result = await client.query(
    `
    SELECT
      id,
      dorm_id,
      phone,
      label,
      sort_order,
      created_at,
      updated_at
    FROM public.dorm_contact_phones
    WHERE dorm_id = $1
    ORDER BY sort_order ASC, created_at ASC
    `,
    [dormId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    dorm_id: row.dorm_id,
    phone: row.phone,
    label: row.label,
    sort_order: toNumber(row.sort_order, 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function getDormAmenitiesByDormId(client, dormId) {
  const result = await client.query(
    `
    SELECT
      da.amenity_code AS code,
      am.label_th,
      am.sort_order
    FROM public.dorm_amenities da
    LEFT JOIN public.amenity_master am
      ON am.code = da.amenity_code
    WHERE da.dorm_id = $1
    ORDER BY am.sort_order ASC NULLS LAST, da.amenity_code ASC
    `,
    [dormId]
  );

  return result.rows.map((row) => ({
    code: row.code,
    label_th: row.label_th || row.code,
    sort_order: toNumber(row.sort_order, 0),
  }));
}

async function getDormRoomTypesByDormId(client, dormId) {
  const result = await client.query(
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
      is_active,
      created_at,
      updated_at
    FROM public.room_types
    WHERE dorm_id = $1
      AND is_active = true
    ORDER BY sort_order ASC, created_at ASC
    `,
    [dormId]
  );

  return result.rows.map(mapRoomType);
}

async function getDormVacantRoomsByDormId(client, dormId, limit = 50) {
  const safeLimit = toPositiveInt(limit, 50);

  const result = await client.query(
    `
    SELECT
      r.id,
      r.dorm_id,
      d.dorm_slug,
      d.name AS dorm_name,
      d.phone AS dorm_phone,
      d.full_address AS dorm_full_address,
      cover.image_url AS dorm_cover_image,
      b.display_name AS building_name,
      r.room_number,
      r.floor_no,
      r.monthly_rent,
      r.room_type,
      r.status,
      r.note
    FROM public.rooms r
    INNER JOIN public.dorms d
      ON d.id = r.dorm_id
    LEFT JOIN public.buildings b
      ON b.id = r.building_id
    LEFT JOIN LATERAL (
      SELECT di.image_url
      FROM public.dorm_images di
      WHERE di.dorm_id = d.id
      ORDER BY di.is_cover DESC, di.sort_order ASC, di.created_at ASC
      LIMIT 1
    ) cover ON true
    WHERE r.dorm_id = $1
      AND d.status = 'active'
      AND r.status = 'vacant'
    ORDER BY r.monthly_rent ASC, r.floor_no ASC, r.room_number ASC
    LIMIT $2
    `,
    [dormId, safeLimit]
  );

  return result.rows.map(mapVacantRoom);
}

async function getDormReviewsByDormId(client, dormId, limit = 20) {
  const safeLimit = toPositiveInt(limit, 20);

  const result = await client.query(
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
    WHERE r.dorm_id = $1
      AND r.status = 'visible'
    ORDER BY r.created_at DESC
    LIMIT $2
    `,
    [dormId, safeLimit]
  );

  return result.rows.map(mapReview);
}

async function getPublicHomeData(params = {}) {
  const search = normalizeSearch(params.search);
  const searchLike = `%${search}%`;
  const dormLimit = toPositiveInt(params.dormLimit, 12);
  const vacantLimit = toPositiveInt(params.vacantLimit, 8);
  const dormOffset = Math.max(0, toNumber(params.dormOffset, 0));
  const vacantOffset = Math.max(0, toNumber(params.vacantOffset, 0));

  const client = await pool.connect();

  try {
    const [countsResult, dormsResult, vacantRoomsResult] = await Promise.all([
      client.query(
        `
        SELECT
          (SELECT COUNT(*)
           FROM public.dorms d
           WHERE d.status = 'active'
             AND (
               $1 = ''
               OR d.name ILIKE $2
               OR COALESCE(d.name_en, '') ILIKE $2
               OR COALESCE(d.full_address, '') ILIKE $2
               OR COALESCE(d.subdistrict, '') ILIKE $2
               OR COALESCE(d.district, '') ILIKE $2
               OR COALESCE(d.province, '') ILIKE $2
             )
          )::int AS total_dorms,
          (SELECT COUNT(*)
           FROM public.rooms r
           INNER JOIN public.dorms d ON d.id = r.dorm_id
           WHERE d.status = 'active'
             AND r.status = 'vacant'
             AND (
               $1 = ''
               OR d.name ILIKE $2
               OR COALESCE(d.name_en, '') ILIKE $2
               OR COALESCE(d.full_address, '') ILIKE $2
               OR COALESCE(r.room_number, '') ILIKE $2
               OR COALESCE(r.room_type, '') ILIKE $2
             )
          )::int AS total_vacant_rooms
        `,
        [search, searchLike]
      ),

      client.query(
        `
        SELECT
          d.id,
          d.dorm_slug,
          d.name,
          d.name_en,
          d.phone,
          d.full_address,
          d.subdistrict,
          d.district,
          d.province,
          d.description,
          d.contact_name,
          d.contact_email,
          d.line_id,
          d.water_rate,
          d.electric_rate,
          d.created_at,
          d.updated_at,
          COALESCE(room_stats.total_rooms, 0)::int AS total_rooms,
          COALESCE(room_stats.vacant_rooms, 0)::int AS vacant_rooms,
          price_stats.price_min,
          price_stats.price_max,
          cover.image_url AS cover_image
        FROM public.dorms d
        LEFT JOIN (
          SELECT
            dorm_id,
            COUNT(*)::int AS total_rooms,
            COUNT(*) FILTER (WHERE status = 'vacant')::int AS vacant_rooms
          FROM public.rooms
          GROUP BY dorm_id
        ) room_stats
          ON room_stats.dorm_id = d.id
        LEFT JOIN (
          SELECT
            dorm_id,
            MIN(price_min) AS price_min,
            MAX(price_max) AS price_max
          FROM public.room_types
          WHERE is_active = true
          GROUP BY dorm_id
        ) price_stats
          ON price_stats.dorm_id = d.id
        LEFT JOIN LATERAL (
          SELECT di.image_url
          FROM public.dorm_images di
          WHERE di.dorm_id = d.id
          ORDER BY di.is_cover DESC, di.sort_order ASC, di.created_at ASC
          LIMIT 1
        ) cover ON true
        WHERE d.status = 'active'
          AND (
            $1 = ''
            OR d.name ILIKE $2
            OR COALESCE(d.name_en, '') ILIKE $2
            OR COALESCE(d.full_address, '') ILIKE $2
            OR COALESCE(d.subdistrict, '') ILIKE $2
            OR COALESCE(d.district, '') ILIKE $2
            OR COALESCE(d.province, '') ILIKE $2
          )
        ORDER BY d.updated_at DESC, d.created_at DESC, d.name ASC
        LIMIT $3 OFFSET $4
        `,
        [search, searchLike, dormLimit, dormOffset]
      ),

      client.query(
        `
        SELECT
          r.id,
          r.dorm_id,
          d.dorm_slug,
          d.name AS dorm_name,
          d.phone AS dorm_phone,
          d.full_address AS dorm_full_address,
          cover.image_url AS dorm_cover_image,
          b.display_name AS building_name,
          r.room_number,
          r.floor_no,
          r.monthly_rent,
          r.room_type,
          r.status,
          r.note
        FROM public.rooms r
        INNER JOIN public.dorms d
          ON d.id = r.dorm_id
        LEFT JOIN public.buildings b
          ON b.id = r.building_id
        LEFT JOIN LATERAL (
          SELECT di.image_url
          FROM public.dorm_images di
          WHERE di.dorm_id = d.id
          ORDER BY di.is_cover DESC, di.sort_order ASC, di.created_at ASC
          LIMIT 1
        ) cover ON true
        WHERE d.status = 'active'
          AND r.status = 'vacant'
          AND (
            $1 = ''
            OR d.name ILIKE $2
            OR COALESCE(d.name_en, '') ILIKE $2
            OR COALESCE(d.full_address, '') ILIKE $2
            OR COALESCE(r.room_number, '') ILIKE $2
            OR COALESCE(r.room_type, '') ILIKE $2
          )
        ORDER BY r.monthly_rent ASC, d.updated_at DESC, r.floor_no ASC, r.room_number ASC
        LIMIT $3 OFFSET $4
        `,
        [search, searchLike, vacantLimit, vacantOffset]
      ),
    ]);

    const counts = countsResult.rows[0] || {
      total_dorms: 0,
      total_vacant_rooms: 0,
    };

    return {
      search,
      counts: {
        total_dorms: toNumber(counts.total_dorms, 0),
        total_vacant_rooms: toNumber(counts.total_vacant_rooms, 0),
      },
      featured_vacant_rooms: vacantRoomsResult.rows.map(mapVacantRoom),
      dorms: dormsResult.rows.map(mapDormCard),
    };
  } finally {
    client.release();
  }
}

async function getPublicDormDetailByIdentifier(identifier) {
  const resolvedIdentifier = normalizeSearch(identifier);

  if (!resolvedIdentifier) {
    return null;
  }

  const client = await pool.connect();

  try {
    const dormResult = await client.query(
      `
      SELECT
        d.id,
        d.owner_user_id,
        d.dorm_slug,
        d.name,
        d.name_en,
        d.phone,
        d.full_address,
        d.house_no,
        d.road,
        d.alley,
        d.subdistrict,
        d.district,
        d.province,
        d.postal_code,
        d.description,
        d.status,
        d.latitude,
        d.longitude,
        d.google_map_url,
        d.water_rate,
        d.electric_rate,
        d.contact_name,
        d.contact_email,
        d.contact_line_id,
        d.line_id,
        d.created_at,
        d.updated_at,
        COALESCE(room_stats.total_rooms, 0)::int AS total_rooms,
        COALESCE(room_stats.vacant_rooms, 0)::int AS vacant_rooms,
        price_stats.price_min,
        price_stats.price_max,
        cover.image_url AS cover_image
      FROM public.dorms d
      LEFT JOIN (
        SELECT
          dorm_id,
          COUNT(*)::int AS total_rooms,
          COUNT(*) FILTER (WHERE status = 'vacant')::int AS vacant_rooms
        FROM public.rooms
        GROUP BY dorm_id
      ) room_stats
        ON room_stats.dorm_id = d.id
      LEFT JOIN (
        SELECT
          dorm_id,
          MIN(price_min) AS price_min,
          MAX(price_max) AS price_max
        FROM public.room_types
        WHERE is_active = true
        GROUP BY dorm_id
      ) price_stats
        ON price_stats.dorm_id = d.id
      LEFT JOIN LATERAL (
        SELECT di.image_url
        FROM public.dorm_images di
        WHERE di.dorm_id = d.id
        ORDER BY di.is_cover DESC, di.sort_order ASC, di.created_at ASC
        LIMIT 1
      ) cover ON true
      WHERE d.status = 'active'
        AND (
          d.dorm_slug = $1
          OR CAST(d.id AS text) = $1
        )
      LIMIT 1
      `,
      [resolvedIdentifier]
    );

    const dormRow = dormResult.rows[0] || null;

    if (!dormRow) {
      return null;
    }

    const [images, roomTypes, contactPhones, vacantRooms, amenities, reviews] =
      await Promise.all([
        getDormImagesByDormId(client, dormRow.id),
        getDormRoomTypesByDormId(client, dormRow.id),
        getDormContactPhonesByDormId(client, dormRow.id),
        getDormVacantRoomsByDormId(client, dormRow.id, 100),
        getDormAmenitiesByDormId(client, dormRow.id),
        getDormReviewsByDormId(client, dormRow.id, 20),
      ]);

    const review_count = reviews.length;
    const review_average =
      review_count > 0
        ? Number(
            (
              reviews.reduce((sum, item) => sum + toNumber(item.rating, 0), 0) /
              review_count
            ).toFixed(1)
          )
        : 0;

    return {
      ...mapDormCard(dormRow),
      owner_user_id: dormRow.owner_user_id,
      house_no: dormRow.house_no,
      road: dormRow.road,
      alley: dormRow.alley,
      postal_code: dormRow.postal_code,
      latitude: toNullableNumber(dormRow.latitude),
      longitude: toNullableNumber(dormRow.longitude),
      google_map_url: dormRow.google_map_url,
      contact_line_id: dormRow.contact_line_id,
      images,
      room_types: roomTypes,
      contact_phones: contactPhones,
      vacant_rooms: vacantRooms,
      amenities,
      reviews,
      review_count,
      review_average,
    };
  } finally {
    client.release();
  }
}

async function getPublicRoomDetailById(roomId) {
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT
        r.id,
        r.dorm_id,
        r.room_number,
        r.floor_no,
        r.monthly_rent,
        r.room_type,
        r.status,
        r.note,
        d.dorm_slug,
        d.name AS dorm_name,
        d.name_en AS dorm_name_en,
        d.phone AS dorm_phone,
        d.full_address AS dorm_full_address,
        d.description AS dorm_description,
        d.water_rate,
        d.electric_rate,
        d.contact_name,
        d.contact_email,
        d.contact_line_id,
        d.line_id,
        d.latitude,
        d.longitude,
        d.google_map_url,
        b.display_name AS building_name,
        cover.image_url AS dorm_cover_image
      FROM public.rooms r
      INNER JOIN public.dorms d
        ON d.id = r.dorm_id
      LEFT JOIN public.buildings b
        ON b.id = r.building_id
      LEFT JOIN LATERAL (
        SELECT di.image_url
        FROM public.dorm_images di
        WHERE di.dorm_id = d.id
        ORDER BY di.is_cover DESC, di.sort_order ASC, di.created_at ASC
        LIMIT 1
      ) cover ON true
      WHERE r.id = $1
        AND d.status = 'active'
      LIMIT 1
      `,
      [roomId]
    );

    const row = result.rows[0] || null;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      dorm_id: row.dorm_id,
      dorm_slug: row.dorm_slug,
      dorm_name: row.dorm_name,
      dorm_name_en: row.dorm_name_en,
      dorm_phone: row.dorm_phone,
      dorm_full_address: row.dorm_full_address,
      dorm_description: row.dorm_description,
      dorm_cover_image: row.dorm_cover_image || null,
      building_name: row.building_name || null,
      room_number: row.room_number,
      floor_no: Number(row.floor_no || 0),
      monthly_rent: Number(row.monthly_rent || 0),
      room_type: row.room_type,
      status: row.status,
      note: row.note,
      water_rate: Number(row.water_rate || 0),
      electric_rate: Number(row.electric_rate || 0),
      contact_name: row.contact_name,
      contact_email: row.contact_email,
      contact_line_id: row.contact_line_id,
      line_id: row.line_id,
      latitude:
        row.latitude !== null && row.latitude !== undefined
          ? Number(row.latitude)
          : null,
      longitude:
        row.longitude !== null && row.longitude !== undefined
          ? Number(row.longitude)
          : null,
      google_map_url: row.google_map_url,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  getPublicHomeData,
  getPublicDormDetailByIdentifier,
  getPublicRoomDetailById,
};