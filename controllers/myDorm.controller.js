const {
  getMyDormProfileByOwnerId,
  updateMyDormProfileByOwnerId,
} = require("../services/myDorm.service");
const { pool } = require("../config/db");

// GET /api/my-dorm/profile
async function getMyDormProfile(req, res) {
  try {
    const userId = req.user.userId;
    const role = req.user.role;

    if (role !== "owner") {
      return res.status(403).json({
        message: "Only owner can access dorm profile",
      });
    }

    const dorm = await getMyDormProfileByOwnerId(userId);

    if (!dorm) {
      return res.status(404).json({
        message: "Dorm not found",
      });
    }

    return res.status(200).json({
      message: "Dorm profile fetched successfully",
      dorm,
    });
  } catch (error) {
    console.error("GET MY DORM PROFILE ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

// PUT /api/my-dorm/profile
async function updateMyDormProfile(req, res) {
  try {
    const userId = req.user.userId;
    const role = req.user.role;

    if (role !== "owner") {
      return res.status(403).json({
        message: "Only owner can update dorm profile",
      });
    }

    const { name, name_en, full_address } = req.body;

    if (!name || !name_en || !full_address) {
      return res.status(400).json({
        message: "name, name_en and full_address are required",
      });
    }

    const dorm = await updateMyDormProfileByOwnerId(userId, req.body);

    if (!dorm) {
      return res.status(404).json({
        message: "Dorm not found",
      });
    }

    return res.status(200).json({
      message: "Dorm profile updated successfully",
      dorm,
    });
  } catch (error) {
    console.error("UPDATE MY DORM PROFILE ERROR:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
}

async function createAmenity(req, res) {
  try {
    const { label_th } = req.body;

    if (!label_th) {
      return res.status(400).json({ message: "label_th is required" });
    }

    const code = "custom_" + Date.now();

    await pool.query(`
      INSERT INTO public.amenity_master (code, label_th, sort_order, is_active)
      VALUES ($1, $2, 999, true)
    `, [code, label_th]);

    return res.status(201).json({ code, label_th });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "error creating amenity" });
  }
}

async function deleteAmenity(req, res) {
  try {
    const { code } = req.params;

    await pool.query(`DELETE FROM public.dorm_amenities WHERE amenity_code = $1`, [code]);
    await pool.query(`DELETE FROM public.amenity_master WHERE code = $1`, [code]);

    return res.status(200).json({ message: "deleted" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "error deleting amenity" });
  }
}

module.exports = {
  getMyDormProfile,
  updateMyDormProfile,
  getMyDormProfile,
  updateMyDormProfile,
  createAmenity,
  deleteAmenity,
};