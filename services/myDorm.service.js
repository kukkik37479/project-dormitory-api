const { pool } = require("../config/db");

function toNullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

async function getAmenityOptions(client) {
  const result = await client.query(`
    SELECT code, label_th, sort_order, is_active
    FROM public.amenity_master
    WHERE is_active = true
    ORDER BY sort_order ASC, code ASC
  `);
  return result.rows;
}

async function getRoomTypesByDormId(client, dormId) {
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
    ORDER BY sort_order ASC, created_at ASC
    `,
    [dormId]
  );

  return result.rows;
}

async function getAmenitiesByDormId(client, dormId) {
  const result = await client.query(
    `
    SELECT amenity_code
    FROM public.dorm_amenities
    WHERE dorm_id = $1
    ORDER BY amenity_code ASC
    `,
    [dormId]
  );

  return result.rows.map((row) => row.amenity_code);
}

async function getContactPhonesByDormId(client, dormId) {
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

  return result.rows;
}

async function getImagesByDormId(client, dormId) {
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
    ORDER BY sort_order ASC, created_at ASC
    `,
    [dormId]
  );

  return result.rows;
}

async function getCurrentOwnerDorm(client, ownerUserId) {
  const result = await client.query(
    `
    SELECT
      d.id,
      d.owner_user_id,
      d.name,
      d.name_en,
      d.phone,
      d.full_address,
      d.road,
      d.alley,
      d.subdistrict,
      d.district,
      d.province,
      d.postal_code,
      d.description,
      d.status,
      d.dorm_slug,
      d.latitude,
      d.longitude,
      d.water_rate,
      d.electric_rate,
      d.contact_name,
      d.contact_email,
      d.line_id,
      d.created_at,
      d.updated_at
    FROM public.users u
    JOIN public.dorms d
      ON d.id = u.login_dorm_id
    WHERE u.id = $1
      AND u.role = 'owner'
      AND d.owner_user_id = $1
    LIMIT 1
    `,
    [ownerUserId]
  );

  return result.rows[0] || null;
}

async function getMyDormProfileByOwnerId(ownerUserId) {
  const client = await pool.connect();

  try {
    const dorm = await getCurrentOwnerDorm(client, ownerUserId);

    if (!dorm) {
      return null;
    }

    const roomTypes = await getRoomTypesByDormId(client, dorm.id);
    const amenities = await getAmenitiesByDormId(client, dorm.id);
    const amenityOptions = await getAmenityOptions(client);
    const contactPhones = await getContactPhonesByDormId(client, dorm.id);
    const images = await getImagesByDormId(client, dorm.id);

    return {
      ...dorm,
      room_types: roomTypes,
      amenities,
      amenity_options: amenityOptions,
      contact_phones: contactPhones,
      images,
    };
  } finally {
    client.release();
  }
}

async function updateMyDormProfileByOwnerId(ownerUserId, payload) {
  const {
    name,
    name_en,
    phone,
    full_address,
    road,
    alley,
    subdistrict,
    district,
    province,
    postal_code,
    description,
    latitude,
    longitude,
    water_rate,
    electric_rate,
    contact_name,
    contact_email,
    line_id,
    room_types,
    amenities,
    contact_phones,
    images,
  } = payload;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentDorm = await getCurrentOwnerDorm(client, ownerUserId);

    if (!currentDorm) {
      await client.query("ROLLBACK");
      return null;
    }

    const dormResult = await client.query(
      `
      UPDATE public.dorms
      SET
        name = $1,
        name_en = $2,
        phone = $3,
        full_address = $4,
        road = $5,
        alley = $6,
        subdistrict = $7,
        district = $8,
        province = $9,
        postal_code = $10,
        description = $11,
        latitude = $12,
        longitude = $13,
        water_rate = $14,
        electric_rate = $15,
        contact_name = $16,
        contact_email = $17,
        line_id = $18,
        updated_at = now()
      WHERE id = $19
        AND owner_user_id = $20
      RETURNING
        id,
        owner_user_id,
        name,
        name_en,
        phone,
        full_address,
        road,
        alley,
        subdistrict,
        district,
        province,
        postal_code,
        description,
        status,
        dorm_slug,
        latitude,
        longitude,
        water_rate,
        electric_rate,
        contact_name,
        contact_email,
        line_id,
        created_at,
        updated_at
      `,
      [
        String(name).trim(),
        String(name_en).trim(),
        phone ? String(phone).trim() : null,
        String(full_address).trim(),
        road ? String(road).trim() : null,
        alley ? String(alley).trim() : null,
        subdistrict ? String(subdistrict).trim() : null,
        district ? String(district).trim() : null,
        province ? String(province).trim() : null,
        postal_code ? String(postal_code).trim() : null,
        description ? String(description).trim() : null,
        toNullableNumber(latitude),
        toNullableNumber(longitude),
        water_rate !== "" && water_rate !== null && water_rate !== undefined
          ? Number(water_rate)
          : 0,
        electric_rate !== "" && electric_rate !== null && electric_rate !== undefined
          ? Number(electric_rate)
          : 0,
        contact_name ? String(contact_name).trim() : null,
        contact_email ? String(contact_email).trim().toLowerCase() : null,
        line_id ? String(line_id).trim() : null,
        currentDorm.id,
        ownerUserId,
      ]
    );

    const dorm = dormResult.rows[0] || null;

    if (!dorm) {
      await client.query("ROLLBACK");
      return null;
    }

    if (Array.isArray(room_types)) {
      await client.query(`DELETE FROM public.room_types WHERE dorm_id = $1`, [
        dorm.id,
      ]);

      for (let index = 0; index < room_types.length; index += 1) {
        const item = room_types[index];

        if (!item || !item.type_name || !String(item.type_name).trim()) {
          continue;
        }

        const rawPriceMin = toNullableNumber(item.price_min);
        const rawPriceMax = toNullableNumber(item.price_max);

        let priceMin = rawPriceMin ?? 0;
        let priceMax = rawPriceMax ?? priceMin;

        if (priceMax < priceMin) {
          priceMax = priceMin;
        }

        await client.query(
          `
          INSERT INTO public.room_types (
            dorm_id,
            type_name,
            room_layout,
            size_sqm,
            price_min,
            price_max,
            sort_order,
            is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            dorm.id,
            String(item.type_name).trim(),
            item.room_layout ? String(item.room_layout).trim() : null,
            toNullableNumber(item.size_sqm),
            priceMin,
            priceMax,
            item.sort_order !== undefined && item.sort_order !== null
              ? Number(item.sort_order)
              : index,
            item.is_active !== undefined ? Boolean(item.is_active) : true,
          ]
        );
      }
    }

    if (Array.isArray(amenities)) {
      const amenityOptions = await getAmenityOptions(client);
      const allowedAmenityCodes = new Set(
        amenityOptions.map((item) => item.code)
      );

      await client.query(
        `DELETE FROM public.dorm_amenities WHERE dorm_id = $1`,
        [dorm.id]
      );

      for (const amenityCode of amenities) {
        if (!amenityCode || !allowedAmenityCodes.has(amenityCode)) {
          continue;
        }

        await client.query(
          `
          INSERT INTO public.dorm_amenities (dorm_id, amenity_code)
          VALUES ($1, $2)
          `,
          [dorm.id, amenityCode]
        );
      }
    }

    if (Array.isArray(contact_phones)) {
      await client.query(
        `DELETE FROM public.dorm_contact_phones WHERE dorm_id = $1`,
        [dorm.id]
      );

      for (let index = 0; index < contact_phones.length; index += 1) {
        const item = contact_phones[index];

        if (!item || !item.phone || !String(item.phone).trim()) {
          continue;
        }

        await client.query(
          `
          INSERT INTO public.dorm_contact_phones (
            dorm_id,
            phone,
            label,
            sort_order
          )
          VALUES ($1, $2, $3, $4)
          `,
          [
            dorm.id,
            String(item.phone).trim(),
            item.label ? String(item.label).trim() : null,
            item.sort_order !== undefined && item.sort_order !== null
              ? Number(item.sort_order)
              : index,
          ]
        );
      }
    }

    if (Array.isArray(images)) {
      await client.query(`DELETE FROM public.dorm_images WHERE dorm_id = $1`, [
        dorm.id,
      ]);

      for (let index = 0; index < images.length; index += 1) {
        const item = images[index];

        if (!item || !item.image_url || !String(item.image_url).trim()) {
          continue;
        }

        await client.query(
          `
          INSERT INTO public.dorm_images (
            dorm_id,
            image_url,
            public_id,
            sort_order,
            is_cover
          )
          VALUES ($1, $2, $3, $4, $5)
          `,
          [
            dorm.id,
            String(item.image_url).trim(),
            item.public_id ? String(item.public_id).trim() : null,
            item.sort_order !== undefined && item.sort_order !== null
              ? Number(item.sort_order)
              : index,
            item.is_cover !== undefined ? Boolean(item.is_cover) : index === 0,
          ]
        );
      }
    }

    const savedRoomTypes = await getRoomTypesByDormId(client, dorm.id);
    const savedAmenities = await getAmenitiesByDormId(client, dorm.id);
    const amenityOptions = await getAmenityOptions(client);
    const savedContactPhones = await getContactPhonesByDormId(client, dorm.id);
    const savedImages = await getImagesByDormId(client, dorm.id);

    await client.query("COMMIT");

    return {
      ...dorm,
      room_types: savedRoomTypes,
      amenities: savedAmenities,
      amenity_options: amenityOptions,
      contact_phones: savedContactPhones,
      images: savedImages,
    };
  } catch (error) {
    console.error("updateMyDormProfileByOwnerId service error:", error);
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getMyDormProfileByOwnerId,
  updateMyDormProfileByOwnerId,
};