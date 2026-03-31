function isEnglishDormName(value) {
  const normalized = String(value || "").trim();

  if (!normalized) return false;

  const allowedPattern = /^[A-Za-z0-9][A-Za-z0-9\s-]*$/;
  const hasEnglishLetter = /[A-Za-z]/.test(normalized);

  return allowedPattern.test(normalized) && hasEnglishLetter;
}

function validateRegister(req, res, next) {
  const {
    username,
    email,
    password,
    full_name,
    phone,
    dorm_name,
    dorm_name_en,
  } = req.body;

  if (
    !username ||
    !email ||
    !password ||
    !full_name ||
    !phone ||
    !dorm_name ||
    !dorm_name_en
  ) {
    return res.status(400).json({
      message:
        "username, email, password, full_name, phone, dorm_name, dorm_name_en are required",
    });
  }

  if (String(password).length < 6) {
    return res.status(400).json({
      message: "Password must be at least 6 characters",
    });
  }

  if (!isEnglishDormName(dorm_name_en)) {
    return res.status(400).json({
      message:
        "dorm_name_en must contain English letters only (numbers, spaces, and hyphen are allowed)",
    });
  }

  next();
}

function validateLogin(req, res, next) {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({
      message: "identifier and password are required",
    });
  }

  next();
}

module.exports = {
  validateRegister,
  validateLogin,
};