# Dryer Factory Backend (Node.js)

## Run

1. Copy `.env.example` to `.env` and fill values.
2. Start PostgreSQL Docker:

```bash
docker compose up -d
```

3. Install dependencies:

```bash
npm install
```

4. Seed sample data:

```bash
npm run seed
```

5. Start in development:

```bash
npm run dev
```

6. Start in production mode:

```bash
npm start
```

## API Base

- `http://localhost:3000/api/v1`

## Notes

- JWT authentication is required for all endpoints except `POST /auth/login`.
- MQTT is optional and controlled by `MQTT_ENABLED`.
- Lamp feed supports aliases: `AIO_FEED_LAMP` or `AIO_FEED_LED` or `AIO_FEED_LIGHT`.
- Adafruit MQTT temp/hum ingestion can be mapped to DB sensor ids via:
    - `AIO_SENSOR_ID_TEMP`
    - `AIO_SENSOR_ID_HUM`
