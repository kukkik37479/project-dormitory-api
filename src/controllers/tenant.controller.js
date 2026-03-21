const getTenants = async (req, res) => {
  return res.status(200).json({
    message: "GET /api/tenants working",
    user: req.user || null,
    data: [],
    meta: {
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 1,
      start: 0,
      end: 0,
    },
  });
};

const getTenantFormOptions = async (req, res) => {
  return res.status(200).json({
    message: "GET /api/tenants/form-options working",
    data: {
      buildings: [],
      floors: [],
      rooms: [],
    },
  });
};

const createTenant = async (req, res) => {
  return res.status(200).json({
    message: "POST /api/tenants working",
    body: req.body,
  });
};

const endContract = async (req, res) => {
  return res.status(200).json({
    message: "PATCH /api/contracts/:contractId/end working",
    contractId: req.params.contractId,
    body: req.body,
  });
};

module.exports = {
  getTenants,
  getTenantFormOptions,
  createTenant,
  endContract,
};