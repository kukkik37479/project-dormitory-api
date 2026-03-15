const express = require("express");
const { register, login, me } = require("../controllers/auth.controller");
const { verifyToken } = require("../middleware/auth.middleware");
const {
  validateRegister,
  validateLogin,
} = require("../validators/auth.validator");

const router = express.Router();

router.post("/register", validateRegister, register);
router.post("/login", validateLogin, login);
router.get("/me", verifyToken, me);

module.exports = router;