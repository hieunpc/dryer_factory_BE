const dotenv = require("dotenv");
const Joi = require("joi");

dotenv.config({ override: true });

const schema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().port().default(3000),

  DB_HOST: Joi.string().default("localhost"),
  DB_PORT: Joi.number().default(55432),
  DB_NAME: Joi.string().default("dryerdb"),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default("12h"),

  MQTT_ENABLED: Joi.boolean().truthy("true").falsy("false").default(false),
  AIO_USERNAME: Joi.string().allow(""),
  AIO_KEY: Joi.string().allow(""),
  AIO_BROKER_URL: Joi.string().allow(""),
  AIO_FEED_TEMP: Joi.string().allow(""),
  AIO_FEED_HUM: Joi.string().allow(""),
  AIO_FEED_FAN: Joi.string().allow(""),
  AIO_FEED_LAMP: Joi.string().allow(""),
  AIO_FEED_LED: Joi.string().allow(""),
  AIO_FEED_LIGHT: Joi.string().allow(""),
  AIO_SENSOR_ID_TEMP: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_HUM: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
}).unknown();

const { value, error } = schema.validate(process.env, { abortEarly: false, convert: true });

if (error) {
  throw new Error(`Invalid environment variables: ${error.message}`);
}

module.exports = {
  nodeEnv: value.NODE_ENV,
  port: value.PORT,
  db: {
    host: value.DB_HOST,
    port: value.DB_PORT,
    name: value.DB_NAME,
    user: value.DB_USER,
    password: value.DB_PASSWORD,
  },
  jwt: {
    secret: value.JWT_SECRET,
    expiresIn: value.JWT_EXPIRES_IN,
  },
  mqtt: {
    enabled: value.MQTT_ENABLED,
    username: value.AIO_USERNAME,
    key: value.AIO_KEY,
    brokerUrl: value.AIO_BROKER_URL,
    feeds: {
      temp: value.AIO_FEED_TEMP,
      hum: value.AIO_FEED_HUM,
      fan: value.AIO_FEED_FAN,
      lamp: value.AIO_FEED_LAMP || value.AIO_FEED_LED || value.AIO_FEED_LIGHT,
    },
    sensorMap: {
      temp: value.AIO_SENSOR_ID_TEMP || null,
      hum: value.AIO_SENSOR_ID_HUM || null,
    },
  },
};
