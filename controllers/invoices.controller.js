const {
  getInvoiceFormOptionsByOwnerId,
  createInvoiceByOwnerId,
  listInvoicesByOwnerId,
  getInvoiceDetailByOwnerId,
} = require("../services/invoices.service");

function ensureOwner(req, res) {
  if (!req.user || req.user.role !== "owner") {
    res.status(403).json({
      message: "Only owner can access invoice API",
    });
    return false;
  }

  return true;
}

async function getInvoiceFormOptions(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const data = await getInvoiceFormOptionsByOwnerId(
      req.user.userId,
      req.user.dormId,
      req.query
    );

    return res.json({
      message: "getInvoiceFormOptions ok",
      ...data,
    });
  } catch (error) {
    console.error("getInvoiceFormOptions error:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
      code: error.code || null,
      detail: error.detail || null,
    });
  }
}

async function createInvoice(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const invoice = await createInvoiceByOwnerId(
      req.user.userId,
      req.user.dormId,
      req.body
    );

    return res.status(201).json({
      message: "Invoice created successfully",
      invoice,
    });
  } catch (error) {
    console.error("createInvoice error:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
      code: error.code || null,
      detail: error.detail || null,
    });
  }
}

async function getInvoices(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const invoices = await listInvoicesByOwnerId(
      req.user.userId,
      req.user.dormId,
      req.query
    );

    return res.json({
      message: "Invoices fetched successfully",
      invoices,
    });
  } catch (error) {
    console.error("getInvoices error:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
      code: error.code || null,
      detail: error.detail || null,
    });
  }
}

async function getInvoiceDetail(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const data = await getInvoiceDetailByOwnerId(
      req.user.userId,
      req.user.dormId,
      req.params.invoiceId
    );

    return res.json({
      message: "Invoice detail fetched successfully",
      ...data,
    });
  } catch (error) {
    console.error("getInvoiceDetail error:", error);

    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
      code: error.code || null,
      detail: error.detail || null,
    });
  }
}

module.exports = {
  getInvoiceFormOptions,
  createInvoice,
  getInvoices,
  getInvoiceDetail,
};