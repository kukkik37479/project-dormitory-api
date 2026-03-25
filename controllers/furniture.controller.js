const {
  listFurnitureRoomsByOwnerId,
  getRoomFurnitureItemsByOwnerId,
  listFurnitureCategoriesByOwnerId,
  createFurnitureCategoryByOwnerId,
  createFurnitureItemByOwnerId,
  updateFurnitureItemByOwnerId,
  deleteFurnitureItemByOwnerId,
} = require("../services/furniture.service");

function ensureOwner(req, res) {
  if (!req.user || req.user.role !== "owner") {
    res.status(403).json({ message: "Only owner can access furniture API" });
    return false;
  }
  return true;
}

async function getFurnitureRooms(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const data = await listFurnitureRoomsByOwnerId(req.user.userId, req.query);

    return res.json({
      message: "Furniture rooms fetched successfully",
      ...data,
    });
  } catch (error) {
    console.error("getFurnitureRooms error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function getRoomFurnitureItems(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const data = await getRoomFurnitureItemsByOwnerId(
      req.user.userId,
      req.params.roomId
    );

    return res.json({
      message: "Room furniture items fetched successfully",
      ...data,
    });
  } catch (error) {
    console.error("getRoomFurnitureItems error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function getFurnitureCategories(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const data = await listFurnitureCategoriesByOwnerId(req.user.userId);

    return res.json({
      message: "Furniture categories fetched successfully",
      ...data,
    });
  } catch (error) {
    console.error("getFurnitureCategories error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function createFurnitureCategory(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const category = await createFurnitureCategoryByOwnerId(
      req.user.userId,
      req.body
    );

    return res.status(201).json({
      message: "Furniture category created successfully",
      category,
    });
  } catch (error) {
    console.error("createFurnitureCategory error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function createFurnitureItem(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const item = await createFurnitureItemByOwnerId(req.user.userId, req.body);

    return res.status(201).json({
      message: "Furniture item created successfully",
      item,
    });
  } catch (error) {
    console.error("createFurnitureItem error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function updateFurnitureItem(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const item = await updateFurnitureItemByOwnerId(
      req.user.userId,
      req.params.itemId,
      req.body
    );

    return res.json({
      message: "Furniture item updated successfully",
      item,
    });
  } catch (error) {
    console.error("updateFurnitureItem error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

async function deleteFurnitureItem(req, res) {
  try {
    if (!ensureOwner(req, res)) return;

    const item = await deleteFurnitureItemByOwnerId(
      req.user.userId,
      req.params.itemId
    );

    return res.json({
      message: "Furniture item deleted successfully",
      item,
    });
  } catch (error) {
    console.error("deleteFurnitureItem error:", error);
    return res.status(error.status || 500).json({
      message: error.message || "Internal server error",
    });
  }
}

module.exports = {
  getFurnitureRooms,
  getRoomFurnitureItems,
  getFurnitureCategories,
  createFurnitureCategory,
  createFurnitureItem,
  updateFurnitureItem,
  deleteFurnitureItem,
};