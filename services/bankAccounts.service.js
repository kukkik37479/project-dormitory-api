const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeNullableString(value) {
  if (!hasValue(value)) return null;
  return String(value).trim();
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

async function getDefaultBankAccountRow(dormId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM bank_accounts
      WHERE dorm_id = $1
        AND is_default = true
      LIMIT 1
    `,
    [dormId]
  );

  return result.rows[0] || null;
}

function deleteLocalFileByUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return;
  if (!fileUrl.startsWith("/uploads/")) return;

  const uploadsRoot = path.resolve(path.join(__dirname, "../../uploads"));
  const relativePath = fileUrl.replace(/^\/uploads\//, "");
  const absolutePath = path.resolve(path.join(uploadsRoot, relativePath));

  if (!absolutePath.startsWith(uploadsRoot)) return;
  if (!fs.existsSync(absolutePath)) return;

  try {
    fs.unlinkSync(absolutePath);
  } catch (error) {
    console.error("deleteLocalFileByUrl error:", error);
  }
}

async function getDefaultBankAccountByOwnerId(ownerUserId, dormId) {
  await ensureOwnerDorm(ownerUserId, dormId);

  return getDefaultBankAccountRow(dormId);
}

async function upsertDefaultBankAccountByOwnerId(
  ownerUserId,
  dormId,
  body = {},
  file = null
) {
  await ensureOwnerDorm(ownerUserId, dormId);

  const client = await pool.connect();

  let oldQrToDelete = null;
  let newUploadedQrToDeleteOnFail = null;

  try {
    await client.query("BEGIN");

    const existing = await getDefaultBankAccountRow(dormId, client);

    const nextBankName = hasValue(body.bank_name)
      ? String(body.bank_name).trim()
      : existing?.bank_name || null;

    const nextAccountName = hasValue(body.account_name)
      ? String(body.account_name).trim()
      : existing?.account_name || null;

    const nextAccountNumber = hasValue(body.account_number)
      ? String(body.account_number).trim()
      : existing?.account_number || null;

    const nextPromptpayId =
      body.promptpay_id !== undefined
        ? normalizeNullableString(body.promptpay_id)
        : existing?.promptpay_id || null;

    const nextQrImageUrl = file
      ? `/uploads/payment-qr/${dormId}/${file.filename}`
      : existing?.qr_image_url || null;

    if (!nextBankName) {
      throw createError(400, "bank_name is required");
    }

    if (!nextAccountName) {
      throw createError(400, "account_name is required");
    }

    if (!nextAccountNumber) {
      throw createError(400, "account_number is required");
    }

    if (file) {
      newUploadedQrToDeleteOnFail = nextQrImageUrl;
    }

    let bankAccount;

    if (existing) {
      const result = await client.query(
        `
          UPDATE bank_accounts
          SET
            bank_name = $1,
            account_name = $2,
            account_number = $3,
            promptpay_id = $4,
            qr_image_url = $5,
            is_default = true,
            updated_at = now()
          WHERE id = $6
          RETURNING *
        `,
        [
          nextBankName,
          nextAccountName,
          nextAccountNumber,
          nextPromptpayId,
          nextQrImageUrl,
          existing.id,
        ]
      );

      bankAccount = result.rows[0];

      if (file && existing.qr_image_url && existing.qr_image_url !== nextQrImageUrl) {
        oldQrToDelete = existing.qr_image_url;
      }
    } else {
      const result = await client.query(
        `
          INSERT INTO bank_accounts (
            dorm_id,
            bank_name,
            account_name,
            account_number,
            promptpay_id,
            qr_image_url,
            is_default
          )
          VALUES ($1, $2, $3, $4, $5, $6, true)
          RETURNING *
        `,
        [
          dormId,
          nextBankName,
          nextAccountName,
          nextAccountNumber,
          nextPromptpayId,
          nextQrImageUrl,
        ]
      );

      bankAccount = result.rows[0];
    }

    await client.query("COMMIT");

    if (oldQrToDelete) {
      deleteLocalFileByUrl(oldQrToDelete);
    }

    return bankAccount;
  } catch (error) {
    await client.query("ROLLBACK");

    if (newUploadedQrToDeleteOnFail) {
      deleteLocalFileByUrl(newUploadedQrToDeleteOnFail);
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getDefaultBankAccountByOwnerId,
  upsertDefaultBankAccountByOwnerId,
};