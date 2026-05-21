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

  MQTT1_ENABLED: Joi.boolean().truthy("true").falsy("false").default(false),
  MQTT1_USERNAME: Joi.string().allow(""),
  MQTT1_KEY: Joi.string().allow(""),
  MQTT1_BROKER_URL: Joi.string().allow(""),
  MQTT1_FEED_TEMP: Joi.string().allow(""),
  MQTT1_FEED_HUM: Joi.string().allow(""),
  MQTT1_FEED_LIGHT: Joi.string().allow(""),
  MQTT1_FEED_FAN: Joi.string().allow(""),
  MQTT1_FEED_LAMP: Joi.string().allow(""),
  MQTT2_ENABLED: Joi.boolean().truthy("true").falsy("false").default(false),
  MQTT2_USERNAME: Joi.string().allow(""),
  MQTT2_KEY: Joi.string().allow(""),
  MQTT2_BROKER_URL: Joi.string().allow(""),
  MQTT2_FEED_TEMP_DRYER2: Joi.string().allow(""),
  MQTT2_FEED_HUM_DRYER2: Joi.string().allow(""),
  MQTT2_FEED_LIGHT_DRYER2: Joi.string().allow(""),
  MQTT2_FEED_TEMP_DRYER3: Joi.string().allow(""),
  MQTT2_FEED_HUM_DRYER3: Joi.string().allow(""),
  MQTT2_FEED_LIGHT_DRYER3: Joi.string().allow(""),
  MQTT2_FEED_TEMP_DRYER4: Joi.string().allow(""),
  MQTT2_FEED_HUM_DRYER4: Joi.string().allow(""),
  MQTT2_FEED_LIGHT_DRYER4: Joi.string().allow(""),
  AIO_SENSOR_ID_TEMP_DRYER1: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_HUM_DRYER1: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_LIGHT_DRYER1: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_TEMP_DRYER2: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_HUM_DRYER2: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_LIGHT_DRYER2: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_TEMP_DRYER3: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_HUM_DRYER3: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_LIGHT_DRYER3: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_TEMP_DRYER4: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_HUM_DRYER4: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
  AIO_SENSOR_ID_LIGHT_DRYER4: Joi.alternatives().try(Joi.number(), Joi.string().allow(""), Joi.valid(null)).default(null),
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
    mqtt1: {
      enabled: value.MQTT1_ENABLED,
      username: value.MQTT1_USERNAME,
      key: value.MQTT1_KEY,
      brokerUrl: value.MQTT1_BROKER_URL,
      feeds: {
        temp: value.MQTT1_FEED_TEMP,
        hum: value.MQTT1_FEED_HUM,
        light: value.MQTT1_FEED_LIGHT,
        fan: value.MQTT1_FEED_FAN,
        lamp: value.MQTT1_FEED_LAMP,
      },
    },
    mqtt2: {
      enabled: value.MQTT2_ENABLED,
      username: value.MQTT2_USERNAME,
      key: value.MQTT2_KEY,
      brokerUrl: value.MQTT2_BROKER_URL,
      feeds: {
        tempDryer2: value.MQTT2_FEED_TEMP_DRYER2,
        humDryer2: value.MQTT2_FEED_HUM_DRYER2,
        lightDryer2: value.MQTT2_FEED_LIGHT_DRYER2,
        tempDryer3: value.MQTT2_FEED_TEMP_DRYER3,
        humDryer3: value.MQTT2_FEED_HUM_DRYER3,
        lightDryer3: value.MQTT2_FEED_LIGHT_DRYER3,
        tempDryer4: value.MQTT2_FEED_TEMP_DRYER4,
        humDryer4: value.MQTT2_FEED_HUM_DRYER4,
        lightDryer4: value.MQTT2_FEED_LIGHT_DRYER4,
      },
    },
    sensorMap: {
      tempDryer1: value.AIO_SENSOR_ID_TEMP_DRYER1 || null,
      humDryer1: value.AIO_SENSOR_ID_HUM_DRYER1 || null,
      lightDryer1: value.AIO_SENSOR_ID_LIGHT_DRYER1 || null,
      tempDryer2: value.AIO_SENSOR_ID_TEMP_DRYER2 || null,
      humDryer2: value.AIO_SENSOR_ID_HUM_DRYER2 || null,
      lightDryer2: value.AIO_SENSOR_ID_LIGHT_DRYER2 || null,
      tempDryer3: value.AIO_SENSOR_ID_TEMP_DRYER3 || null,
      humDryer3: value.AIO_SENSOR_ID_HUM_DRYER3 || null,
      lightDryer3: value.AIO_SENSOR_ID_LIGHT_DRYER3 || null,
      tempDryer4: value.AIO_SENSOR_ID_TEMP_DRYER4 || null,
      humDryer4: value.AIO_SENSOR_ID_HUM_DRYER4 || null,
      lightDryer4: value.AIO_SENSOR_ID_LIGHT_DRYER4 || null,
    },
  },
};
