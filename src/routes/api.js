const express = require("express");
const { authenticate } = require("../middleware/auth");

const authRoutes = require("./auth");
const userRoutes = require("./users");
const structureRoutes = require("./structure");
const catalogRoutes = require("./catalog");
const batchRoutes = require("./batches");
const monitoringRoutes = require("./monitoring");

const router = express.Router();

// Public: login only
router.use("/auth", authRoutes);

// All routes below require authentication
router.use(authenticate);

// User management
router.use("/users", userRoutes);

// Structure (areas, dryers, sensors, controls)
router.use("/", structureRoutes);
router.use("/structure", structureRoutes);

// Catalog (fruits, recipes, phases, policies)
router.use("/", catalogRoutes);
router.use("/catalog", catalogRoutes);

// Batch operations + sensor data
router.use("/", batchRoutes);

// Monitoring (logs, dashboard, reports)
router.use("/", monitoringRoutes);
router.use("/monitoring", monitoringRoutes);

module.exports = router;
