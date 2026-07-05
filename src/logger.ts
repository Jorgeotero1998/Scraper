import path from "path";
import winston from "winston";

const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const LOG_FORMAT = (process.env.LOG_FORMAT ?? "text").toLowerCase();
const LOG_DIR = process.env.LOG_DIR ?? "logs";

const textFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level.toUpperCase().padEnd(5)}: ${message}`;
  })
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: LOG_FORMAT === "json" ? jsonFormat : textFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
      handleExceptions: true,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
    }),
  ],
  exitOnError: false,
});
