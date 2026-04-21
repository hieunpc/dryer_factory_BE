const mqtt = require("mqtt");
const env = require("./env");

let client = null;
let onSensorData = null;

function topicFromFeed(feed) {
  return `${env.mqtt.username}/feeds/${feed}`;
}

function startMqtt(sensorIngestCallback) {
  if (!env.mqtt.enabled) {
    // eslint-disable-next-line no-console
    console.log("MQTT disabled by config");
    return null;
  }

  onSensorData = sensorIngestCallback;

  client = mqtt.connect(env.mqtt.brokerUrl, {
    username: env.mqtt.username,
    password: env.mqtt.key,
    reconnectPeriod: 5000,
  });

  client.on("connect", () => {
    // eslint-disable-next-line no-console
    console.log("MQTT connected");

    [env.mqtt.feeds.temp, env.mqtt.feeds.hum]
      .filter(Boolean)
      .forEach((feed) => {
        client.subscribe(topicFromFeed(feed));
      });
  });

  client.on("message", async (topic, payload) => {
    try {
      const text = payload.toString().trim();
      const numericValue = Number(text);
      if (Number.isNaN(numericValue)) {
        return;
      }

      const feed = topic.split("/").pop();
      if (!feed || typeof onSensorData !== "function") {
        return;
      }

      if (feed === env.mqtt.feeds.temp && env.mqtt.sensorMap.temp) {
        await onSensorData(env.mqtt.sensorMap.temp, numericValue, "mqtt");
      }

      if (feed === env.mqtt.feeds.hum && env.mqtt.sensorMap.hum) {
        await onSensorData(env.mqtt.sensorMap.hum, numericValue, "mqtt");
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("MQTT message handling error", error);
    }
  });

  client.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("MQTT error", error.message);
  });

  return client;
}

function publishControlState(controlType, data) {
  if (!client || !env.mqtt.enabled) {
    return;
  }

  const feed = controlType === "fan" ? env.mqtt.feeds.fan : env.mqtt.feeds.lamp;
  if (!feed) {
    return;
  }

  client.publish(topicFromFeed(feed), JSON.stringify(data));
}

module.exports = {
  startMqtt,
  publishControlState,
};
