const express = require("express");
const router = express.Router();

const {
  getFurnitureRooms,
  getRoomFurnitureItems,
  getFurnitureCategories,
  createFurnitureCategory,
  createFurnitureItem,
  updateFurnitureItem,
  deleteFurnitureItem,
} = require("../controllers/furniture.controller");
const { verifyToken } = require("../middleware/auth.middleware");

router.use(verifyToken);

router.get("/rooms", getFurnitureRooms);
router.get("/rooms/:roomId/items", getRoomFurnitureItems);
router.get("/categories", getFurnitureCategories);
router.post("/categories", createFurnitureCategory);
router.post("/items", createFurnitureItem);
router.patch("/items/:itemId", updateFurnitureItem);
router.delete("/items/:itemId", deleteFurnitureItem);

module.exports = router;