const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const env = require("./config/env");
const apiRoutes = require("./routes/api");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

app.get("/health", (_req, res) => {
  res.json({ status: "success", data: { service: "dryer-factory-be", uptime: process.uptime() } });
});

app.use("/api/v1", apiRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
