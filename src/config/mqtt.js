const mqtt = require("mqtt");
const env = require("./env");
const { query } = require("./db");

let client1 = null;
let client2 = null;
let onSensorData = null;

function topicFromFeed(username, feed) {
  return `${username}/feeds/${feed}`;
}

function startMqtt(sensorIngestCallback) {
  onSensorData = sensorIngestCallback;

  // Start MQTT1 for Dryer1
  if (env.mqtt.mqtt1.enabled) {
    client1 = mqtt.connect(env.mqtt.mqtt1.brokerUrl, {
      username: env.mqtt.mqtt1.username,
      password: env.mqtt.mqtt1.key,
      reconnectPeriod: 5000,
    });

    client1.on("connect", () => {
      console.log("MQTT1 connected for Dryer1");
      [env.mqtt.mqtt1.feeds.temp, env.mqtt.mqtt1.feeds.hum, env.mqtt.mqtt1.feeds.light]
        .filter(Boolean)
        .forEach((feed) => {
          client1.subscribe(topicFromFeed(env.mqtt.mqtt1.username, feed));
        });
    });

    client1.on("message", async (topic, payload) => {
      try {
        const text = payload.toString().trim();
        const numericValue = Number(text);
        if (Number.isNaN(numericValue)) return;

        const feed = topic.split("/").pop();
        if (!feed || typeof onSensorData !== "function") return;

        let sensorId = null;
        if (feed === env.mqtt.mqtt1.feeds.temp && env.mqtt.sensorMap.tempDryer1) {
          sensorId = env.mqtt.sensorMap.tempDryer1;
        } else if (feed === env.mqtt.mqtt1.feeds.hum && env.mqtt.sensorMap.humDryer1) {
          sensorId = env.mqtt.sensorMap.humDryer1;
        } else if (feed === env.mqtt.mqtt1.feeds.light && env.mqtt.sensorMap.lightDryer1) {
          sensorId = env.mqtt.sensorMap.lightDryer1;
        }

        if (sensorId) {
          await onSensorData(sensorId, numericValue, "mqtt");
        }
      } catch (error) {
        console.error("MQTT1 message handling error", error);
      }
    });

    client1.on("error", (error) => {
      console.error("MQTT1 error", error.message);
    });
  }

  // Start MQTT2 for Dryer2,3,4
  if (env.mqtt.mqtt2.enabled) {
    client2 = mqtt.connect(env.mqtt.mqtt2.brokerUrl, {
      username: env.mqtt.mqtt2.username,
      password: env.mqtt.mqtt2.key,
      reconnectPeriod: 5000,
    });

    client2.on("connect", () => {
      console.log("MQTT2 connected for Dryer2,3,4");
      const feeds = [
        env.mqtt.mqtt2.feeds.tempDryer2, env.mqtt.mqtt2.feeds.humDryer2, env.mqtt.mqtt2.feeds.lightDryer2,
        env.mqtt.mqtt2.feeds.tempDryer3, env.mqtt.mqtt2.feeds.humDryer3, env.mqtt.mqtt2.feeds.lightDryer3,
        env.mqtt.mqtt2.feeds.tempDryer4, env.mqtt.mqtt2.feeds.humDryer4, env.mqtt.mqtt2.feeds.lightDryer4,
      ].filter(Boolean);
      feeds.forEach((feed) => {
        client2.subscribe(topicFromFeed(env.mqtt.mqtt2.username, feed));
      });
    });

    client2.on("message", async (topic, payload) => {
      try {
        const text = payload.toString().trim();
        const numericValue = Number(text);
        if (Number.isNaN(numericValue)) return;

        const feed = topic.split("/").pop();
        if (!feed || typeof onSensorData !== "function") return;

        let sensorId = null;
        if (feed === env.mqtt.mqtt2.feeds.tempDryer2 && env.mqtt.sensorMap.tempDryer2) {
          sensorId = env.mqtt.sensorMap.tempDryer2;
        } else if (feed === env.mqtt.mqtt2.feeds.humDryer2 && env.mqtt.sensorMap.humDryer2) {
          sensorId = env.mqtt.sensorMap.humDryer2;
        } else if (feed === env.mqtt.mqtt2.feeds.lightDryer2 && env.mqtt.sensorMap.lightDryer2) {
          sensorId = env.mqtt.sensorMap.lightDryer2;
        } else if (feed === env.mqtt.mqtt2.feeds.tempDryer3 && env.mqtt.sensorMap.tempDryer3) {
          sensorId = env.mqtt.sensorMap.tempDryer3;
        } else if (feed === env.mqtt.mqtt2.feeds.humDryer3 && env.mqtt.sensorMap.humDryer3) {
          sensorId = env.mqtt.sensorMap.humDryer3;
        } else if (feed === env.mqtt.mqtt2.feeds.lightDryer3 && env.mqtt.sensorMap.lightDryer3) {
          sensorId = env.mqtt.sensorMap.lightDryer3;
        } else if (feed === env.mqtt.mqtt2.feeds.tempDryer4 && env.mqtt.sensorMap.tempDryer4) {
          sensorId = env.mqtt.sensorMap.tempDryer4;
        } else if (feed === env.mqtt.mqtt2.feeds.humDryer4 && env.mqtt.sensorMap.humDryer4) {
          sensorId = env.mqtt.sensorMap.humDryer4;
        } else if (feed === env.mqtt.mqtt2.feeds.lightDryer4 && env.mqtt.sensorMap.lightDryer4) {
          sensorId = env.mqtt.sensorMap.lightDryer4;
        }

        if (sensorId) {
          await onSensorData(sensorId, numericValue, "mqtt");
        }
      } catch (error) {
        console.error("MQTT2 message handling error", error);
      }
    });

    client2.on("error", (error) => {
      console.error("MQTT2 error", error.message);
    });
  }

  return { client1, client2 };
}

async function publishControlState(dryerId, controlId, status) {
  let client = null;
  let username = null;
  let feed = null;

  if (dryerId === 1 && client1 && env.mqtt.mqtt1.enabled) {
    client = client1;
    username = env.mqtt.mqtt1.username;
    // Assuming control_type is fan or lamp
    const controlResult = await query(`SELECT control_type FROM control_device WHERE control_id = $1`, [controlId]);
    const controlType = controlResult.rows[0]?.control_type;
    if (controlType === 'fan') {
      feed = env.mqtt.mqtt1.feeds.fan;
    } else if (controlType === 'lamp') {
      feed = env.mqtt.mqtt1.feeds.lamp;
    }
  } else if ((dryerId === 2 || dryerId === 3 || dryerId === 4) && client2 && env.mqtt.mqtt2.enabled) {
    client = client2;
    username = env.mqtt.mqtt2.username;
    // No fan/lamp feeds for dryer2,3,4, so skip
    feed = null;
  }

  if (!client || !feed) {
    return;
  }

  client.publish(topicFromFeed(username, feed), JSON.stringify({ control_id: controlId, status, dryer_id: dryerId }));
}

module.exports = {
  startMqtt,
  publishControlState,
};
